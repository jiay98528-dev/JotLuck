import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildV2RTrainingData,
  resolveV2RCacheRoot,
  V2R_PHRASE_BANK_SIZES,
  V2R_REPOSITORY_ROOT,
  type V2RPhraseBankSize,
} from './autocomplete-v2r/index';

interface CliOptions {
  workspaceRoot?: string;
  phraseBankSize: V2RPhraseBankSize;
}

export async function buildAutocompleteV2RTrainingData(options: CliOptions): Promise<string> {
  const workspaceRoot = path.resolve(options.workspaceRoot ?? V2R_REPOSITORY_ROOT);
  const report = await buildV2RTrainingData({
    workspaceRoot,
    phraseBankSize: options.phraseBankSize,
  });
  const outputPath = path.join(
    resolveV2RCacheRoot(workspaceRoot),
    'training',
    String(options.phraseBankSize),
    'training-data-report.json',
  );
  if (report.phraseBankSize !== options.phraseBankSize) {
    throw new Error('V2R training-data output identity is inconsistent.');
  }
  return outputPath;
}

function parseArguments(argv: readonly string[]): CliOptions {
  let phraseBankSize: number | undefined;
  let workspaceRoot: string | undefined;
  for (const argument of argv) {
    if (argument.startsWith('--phrase-bank-size=')) {
      phraseBankSize = Number(argument.slice('--phrase-bank-size='.length));
    } else if (argument.startsWith('--workspace-root=')) {
      workspaceRoot = argument.slice('--workspace-root='.length);
    } else {
      throw new Error(`Unknown V2R training-data argument: ${argument}`);
    }
  }
  if (!V2R_PHRASE_BANK_SIZES.includes(phraseBankSize as V2RPhraseBankSize)) {
    throw new Error(`--phrase-bank-size must be one of ${V2R_PHRASE_BANK_SIZES.join(', ')}.`);
  }
  return { phraseBankSize: phraseBankSize as V2RPhraseBankSize, workspaceRoot };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = parseArguments(process.argv.slice(2));
  buildAutocompleteV2RTrainingData(options)
    .then((outputPath) => console.log(outputPath))
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.stack : String(error));
      process.exitCode = 1;
    });
}
