/** Audits withheld final holdouts only after their immutable identities are claimed. */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  auditV2RFinalHoldoutOverlap,
  sha256,
  V2R_REPOSITORY_ROOT,
  type V2RCorpusCandidate,
  type V2RCorpusSelectionManifest,
  type V2RHoldoutV3,
} from './autocomplete-v2r/index';
import { resolveWorkspaceInput, resolveWorkspaceOutput } from './workspace-paths';

interface FinalOverlapOptions {
  workspaceRoot?: string;
  selectionManifest?: string;
  coldFinalHoldout: string;
  workspaceFinalHoldout: string;
  output: string;
}

export async function auditAutocompleteV2RFinalOverlap(
  options: FinalOverlapOptions,
): Promise<string> {
  const workspaceRoot = path.resolve(options.workspaceRoot ?? V2R_REPOSITORY_ROOT);
  const selectionPath = resolveWorkspaceInput(
    workspaceRoot,
    options.selectionManifest ??
      'scripts/corpus/_web-cache/autocomplete-v2r/selection-manifest.json',
  );
  const selection = readJson<V2RCorpusSelectionManifest>(await readFile(selectionPath));
  const holdouts = await Promise.all(
    [options.coldFinalHoldout, options.workspaceFinalHoldout].map(async (relativePath) =>
      readJson<V2RHoldoutV3>(await readFile(resolveWorkspaceInput(workspaceRoot, relativePath))),
    ),
  );
  const audit = auditV2RFinalHoldoutOverlap(
    selection,
    await loadMaterializedSelectionDocuments(workspaceRoot, selection),
    holdouts,
  );
  const outputPath = resolveWorkspaceOutput(workspaceRoot, options.output);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(audit, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
  });
  return outputPath;
}

async function loadMaterializedSelectionDocuments(
  workspaceRoot: string,
  selection: V2RCorpusSelectionManifest,
): Promise<V2RCorpusCandidate[]> {
  if (!Array.isArray(selection.documents) || selection.documents.length === 0) {
    throw new Error('V2R selection has no documents for final overlap audit.');
  }
  return Promise.all(
    selection.documents.map(async (document) => {
      if (!document.relativePath.startsWith('scripts/corpus/_web-cache/autocomplete-v2r/')) {
        throw new Error(
          `V2R selected document escaped the approved cache: ${document.documentId}.`,
        );
      }
      const filePath = resolveWorkspaceInput(workspaceRoot, document.relativePath);
      const bytes = await readFile(filePath);
      if (bytes.byteLength !== document.bytes || sha256(bytes) !== document.sha256) {
        throw new Error(
          `V2R selected document changed after candidate freeze: ${document.documentId}.`,
        );
      }
      return {
        documentId: document.documentId,
        sourceId: document.sourceId,
        language: document.language,
        category: document.category,
        relativePath: document.relativePath,
        text: new TextDecoder('utf-8', { fatal: true }).decode(bytes),
        ...(document.templateId ? { templateId: document.templateId } : {}),
      };
    }),
  );
}

function readJson<T>(bytes: Uint8Array): T {
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as T;
}

function readArgument(argv: readonly string[], name: string): string | undefined {
  const inline = argv.find((argument) => argument.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

function parseArguments(argv: readonly string[]): FinalOverlapOptions {
  const required = (name: string): string => {
    const value = readArgument(argv, name);
    if (!value) throw new Error(`${name} is required.`);
    return value;
  };
  return {
    workspaceRoot: readArgument(argv, '--workspace-root'),
    selectionManifest: readArgument(argv, '--selection-manifest'),
    coldFinalHoldout: required('--cold-final-holdout'),
    workspaceFinalHoldout: required('--workspace-final-holdout'),
    output: required('--output'),
  };
}

if (pathToFileURL(process.argv[1] ?? '').href === import.meta.url) {
  auditAutocompleteV2RFinalOverlap(parseArguments(process.argv.slice(2)))
    .then((output) => console.log(path.relative(V2R_REPOSITORY_ROOT, output)))
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.stack : String(error));
      process.exitCode = 1;
    });
}
