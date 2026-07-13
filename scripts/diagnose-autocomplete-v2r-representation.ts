/** Conservative, release-ineligible phrase-bank ceiling on an already observed holdout. */
import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  extractPhraseVariantsAtCursor,
  V2R_REPOSITORY_ROOT,
  type V2RLanguage,
} from './autocomplete-v2r/index';
import { resolveWorkspaceInput } from './workspace-paths';

interface ObservedCase {
  language: V2RLanguage;
  text: string;
  checkpoints: Array<{
    cursorOffset: number;
    expectedBehavior: 'complete' | 'silence';
  }>;
}

interface ObservedHoldout {
  datasetId: string;
  cases: ObservedCase[];
}

export async function diagnoseObservedV2RRepresentation(options: {
  workspaceRoot?: string;
  holdoutPath: string;
  phraseBankSize: 8192 | 12288 | 16384;
}): Promise<Record<string, unknown>> {
  const workspaceRoot = path.resolve(options.workspaceRoot ?? V2R_REPOSITORY_ROOT);
  const holdout = JSON.parse(
    await readFile(resolveWorkspaceInput(workspaceRoot, options.holdoutPath), 'utf8'),
  ) as ObservedHoldout;
  if (!holdout.datasetId || !Array.isArray(holdout.cases)) {
    throw new Error('Observed V2R diagnostic holdout is invalid.');
  }
  const bankPath = resolveWorkspaceInput(
    workspaceRoot,
    `scripts/corpus/_web-cache/autocomplete-v2r/training/${options.phraseBankSize}/phrase-bank.jsonl`,
  );
  const phraseBank = new Set(
    (await readFile(bankPath, 'utf8'))
      .split(/\r?\n/u)
      .filter(Boolean)
      .map((line) => String((JSON.parse(line) as { text?: unknown }).text)),
  );
  const slices = {
    overall: { opportunities: 0, complete: 0, hits: 0 },
    zh: { opportunities: 0, complete: 0, hits: 0 },
    en: { opportunities: 0, complete: 0, hits: 0 },
  };
  for (const item of holdout.cases) {
    for (const checkpoint of item.checkpoints) {
      for (const name of ['overall', item.language] as const) slices[name].opportunities++;
      if (checkpoint.expectedBehavior !== 'complete') continue;
      for (const name of ['overall', item.language] as const) slices[name].complete++;
      const represented = extractPhraseVariantsAtCursor(
        item.text,
        checkpoint.cursorOffset,
        item.language,
      ).some((phrase) => phraseBank.has(phrase));
      if (represented) {
        for (const name of ['overall', item.language] as const) slices[name].hits++;
      }
    }
  }
  return {
    schema: 'jotluck.autocomplete.v2r-observed-representation-diagnostic.v1',
    schemaVersion: 1,
    datasetId: holdout.datasetId,
    phraseBankSize: options.phraseBankSize,
    observedDiagnostic: true,
    releaseEvidence: false,
    caveat: 'single-observed-reference-conservative-ceiling',
    slices: Object.fromEntries(
      Object.entries(slices).map(([name, value]) => [
        name,
        {
          ...value,
          absoluteRate: value.hits / Math.max(1, value.opportunities),
          positiveRecall: value.hits / Math.max(1, value.complete),
        },
      ]),
    ),
  };
}

function readArgument(argv: readonly string[], name: string): string | undefined {
  const value = argv.find((argument) => argument.startsWith(`${name}=`));
  return value?.slice(name.length + 1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const holdoutPath = readArgument(process.argv.slice(2), '--holdout');
  const phraseBankSize = Number(readArgument(process.argv.slice(2), '--phrase-bank-size'));
  if (!holdoutPath || ![8192, 12288, 16384].includes(phraseBankSize)) {
    throw new Error('--holdout and a valid --phrase-bank-size are required.');
  }
  diagnoseObservedV2RRepresentation({
    holdoutPath,
    phraseBankSize: phraseBankSize as 8192 | 12288 | 16384,
  })
    .then((report) => console.log(JSON.stringify(report, null, 2)))
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.stack : String(error));
      process.exitCode = 1;
    });
}
