#!/usr/bin/env node
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';
import { assertV2SArchitectureActive } from './architecture-stop';
import { canonicalJson, resolveInside } from './common';
import { combineV2SLanguageCandidates } from './combine-language-candidates';
import { runV2SDevelopmentDiagnostic } from './diagnostic';
import type { GateSample } from './gate';
import { resolveV2SCandidateDirectory } from './matrix';
import { repackV2SCandidateGate } from './repack-gate';
import { deriveV2SSelection } from './selection';
import { trainV2SCandidate } from './trainer';

const HELP = `V2S offline public model trainer (candidate-only)

Usage:
  tsx scripts/autocomplete-v2s/cli.ts derive --source <v3.1-selection> --candidate-id <id> [--max-documents <n>]
  tsx scripts/autocomplete-v2s/cli.ts train --selection <v2s-selection> --matrix-id <id> --candidate-id <id> --gate-samples <json> [--gate g0|g1] [--selected-tokenizer bpe|unigram] [--max-documents <n>]
  tsx scripts/autocomplete-v2s/cli.ts repack-gate --source-candidate <id> --candidate-id <id> --gate-samples <json> [--gate g0|g1]
  tsx scripts/autocomplete-v2s/cli.ts combine-languages --zh-candidate <id> --en-candidate <id> --candidate-id <id>
  tsx scripts/autocomplete-v2s/cli.ts diagnose --selection <v2s-selection> --candidate-asset <bin> --output <json> --gate-samples-output <json>
  tsx scripts/autocomplete-v2s/cli.ts --help

All writes are restricted to scripts/corpus/_web-cache/autocomplete-v2s/candidates.
Training outputs are fail-closed candidates and never claim formal holdout quality.
`;

export const V2S_REPOSITORY_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);

export async function runV2SCli(
  argv: readonly string[],
  workspaceRoot = V2S_REPOSITORY_ROOT,
): Promise<number> {
  if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(HELP);
    return 0;
  }
  const command = argv[0];
  const argumentsMap = parseArguments(argv.slice(1));
  if (command === 'derive') {
    const source = requireArgument(argumentsMap, '--source');
    const candidateId = requireArgument(argumentsMap, '--candidate-id');
    const maximum = argumentsMap.get('--max-documents');
    const maximumDocuments = maximum === undefined ? undefined : Number(maximum);
    const manifest = await deriveV2SSelection({
      workspaceRoot,
      sourceSelectionPath: source,
      maxDocuments: maximumDocuments,
    });
    const directory = resolveV2SCandidateDirectory(workspaceRoot, candidateId);
    await mkdir(path.dirname(directory), { recursive: true });
    await mkdir(directory, { recursive: false });
    await writeFile(path.join(directory, 'selection.json'), `${canonicalJson(manifest)}\n`, 'utf8');
    process.stdout.write(`${path.join(directory, 'selection.json')}\n`);
    return 0;
  }
  if (command === 'train') {
    assertV2SArchitectureActive(workspaceRoot);
    const gateSamplesPath = requireArgument(argumentsMap, '--gate-samples');
    const gateSamples = await readGateSamplesInside(workspaceRoot, gateSamplesPath);
    const result = await trainV2SCandidate({
      workspaceRoot,
      selectionPath: requireArgument(argumentsMap, '--selection'),
      matrixId: requireArgument(argumentsMap, '--matrix-id'),
      candidateId: requireArgument(argumentsMap, '--candidate-id'),
      gateKind: argumentsMap.get('--gate') === 'g1' ? 'g1' : 'g0',
      gateSamples,
      selectedTokenizer: parseTokenizer(argumentsMap.get('--selected-tokenizer')),
      maximumDocuments: parseOptionalPositiveInteger(
        argumentsMap.get('--max-documents'),
        '--max-documents',
      ),
    });
    process.stdout.write(`${result.directory}\n`);
    return 0;
  }
  if (command === 'diagnose') {
    const result = await runV2SDevelopmentDiagnostic({
      workspaceRoot,
      selectionPath: requireArgument(argumentsMap, '--selection'),
      candidateAssetPath: requireArgument(argumentsMap, '--candidate-asset'),
      reportPath: requireArgument(argumentsMap, '--output'),
      gateSamplesPath: requireArgument(argumentsMap, '--gate-samples-output'),
    });
    process.stdout.write(`${canonicalJson(result.report)}\n`);
    return 0;
  }
  if (command === 'combine-languages') {
    const result = await combineV2SLanguageCandidates({
      workspaceRoot,
      zhCandidateId: requireArgument(argumentsMap, '--zh-candidate'),
      enCandidateId: requireArgument(argumentsMap, '--en-candidate'),
      candidateId: requireArgument(argumentsMap, '--candidate-id'),
    });
    process.stdout.write(`${result.directory}\n`);
    return 0;
  }
  if (command === 'repack-gate') {
    assertV2SArchitectureActive(workspaceRoot);
    const gateSamplesPath = requireArgument(argumentsMap, '--gate-samples');
    const gateSamples = await readGateSamplesInside(workspaceRoot, gateSamplesPath);
    const result = await repackV2SCandidateGate({
      workspaceRoot,
      sourceCandidateId: requireArgument(argumentsMap, '--source-candidate'),
      candidateId: requireArgument(argumentsMap, '--candidate-id'),
      gateKind: argumentsMap.get('--gate') === 'g1' ? 'g1' : 'g0',
      gateSamples,
      gateSamplesPath,
    });
    process.stdout.write(`${result.directory}\n`);
    return 0;
  }
  throw new Error(`Unknown V2S command: ${command}. Use --help.`);
}

async function readGateSamplesInside(
  workspaceRoot: string,
  gateSamplesPath: string,
): Promise<GateSample[]> {
  const absolutePath = resolveInside(workspaceRoot, gateSamplesPath, 'V2S gate samples');
  return JSON.parse(await readFile(absolutePath, 'utf8')) as GateSample[];
}

function parseArguments(argumentsList: readonly string[]): Map<string, string> {
  const output = new Map<string, string>();
  for (let index = 0; index < argumentsList.length; index += 2) {
    const key = argumentsList[index];
    const value = argumentsList[index + 1];
    if (!key?.startsWith('--') || value === undefined || value.startsWith('--')) {
      throw new Error(`Invalid V2S CLI argument near ${key ?? '<end>'}.`);
    }
    output.set(key, value);
  }
  return output;
}

function requireArgument(argumentsMap: Map<string, string>, name: string): string {
  const value = argumentsMap.get(name);
  if (!value) throw new Error(`Missing required argument ${name}.`);
  return value;
}

function parseTokenizer(value: string | undefined): 'bpe' | 'unigram' | undefined {
  if (value === undefined) return undefined;
  if (value === 'bpe' || value === 'unigram') return value;
  throw new Error('--selected-tokenizer must be bpe or unigram.');
}

function parseOptionalPositiveInteger(value: string | undefined, name: string): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive safe integer.`);
  }
  return parsed;
}

const isEntryPoint = process.argv[1]
  ? /[/\\]scripts[/\\]autocomplete-v2s[/\\]cli\.(?:ts|js)$/u.test(path.resolve(process.argv[1]))
  : false;
if (isEntryPoint) {
  const entryArguments = [...process.argv.slice(2)];
  const workspaceIndex = entryArguments.indexOf('--workspace-root');
  let workspaceRoot = V2S_REPOSITORY_ROOT;
  if (workspaceIndex >= 0) {
    const explicitRoot = entryArguments[workspaceIndex + 1];
    if (!explicitRoot) throw new Error('--workspace-root requires a path.');
    workspaceRoot = path.resolve(explicitRoot);
    const relative = path.relative(V2S_REPOSITORY_ROOT, workspaceRoot);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error('--workspace-root must remain inside the repository.');
    }
    entryArguments.splice(workspaceIndex, 2);
  }
  runV2SCli(entryArguments, workspaceRoot).catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
