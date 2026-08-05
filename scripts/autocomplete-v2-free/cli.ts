#!/usr/bin/env node
import { open, readFile } from 'node:fs/promises';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  V2_FREE_MATRIX,
  assessOraclePrecheck,
  assessV2FreeCandidate,
  selectSmallestPassingV2FreeCandidate,
  type V2FreeCandidateEvidence,
  type V2FreeOracleReport,
} from './contract';
import { evaluateV2FreeHoldout } from './evaluator';
import { claimV2FreeFinalPair, readV2FreeFinalPairClaim } from './holdout-ledger';
import { promoteV2FreeOracle } from './oracle-promotion';
import {
  loadV2FreeHoldoutContent,
  validateV2FreeHoldoutDescriptor,
  type V2FreeHoldoutDescriptor,
} from './holdout-validator';
import {
  assertV2FreeSelectionStage,
  buildV2FreeLicensedCorpusSelection,
  type V2FreeLicensedCorpusSelection,
  type V2FreeSelectionStage,
  type V2FreeValidationInput,
} from './selection-builder';

export async function runV2FreeCli(argv: readonly string[]): Promise<number> {
  const command = argv[0];
  if (!command || command === '--help') {
    process.stdout.write(
      [
        'Usage: autocomplete-v2-free <command> [options]',
        'Commands:',
        '  matrix',
        '  check-oracle <report.json>',
        '  assess <evidence.json>',
        '  select <evidence.json...>',
        '  build-selection --workspace-root <path> --v2r-selection <path> --source-registry <path> --output <path> [--stage governance|formal-32mib-smoke]',
        '  validate-selection-stage --selection <path> --stage governance|formal-32mib-smoke',
        '  validate-holdout --workspace-root <path> --descriptor <path> [--content <path>]',
        '  evaluate --workspace-root <path> --worker <exe> --manifest <path> --descriptor <path> --content <path> --output-dir <path>',
        '  promote-oracle --workspace-root <path> --candidate-root <path> --trained-manifest <path> --oracle-output-dir <path> --runtime-measurement <path> --worker <path>',
        '  claim-final-pair --workspace-root <path> --cold-descriptor <path> --workspace-descriptor <path> --candidate-artifact-sha256 <sha> --baseline-sha256 <sha> --evaluator-tree-sha256 <sha>',
      ].join('\n') + '\n',
    );
    return 0;
  }
  if (command === 'matrix') {
    process.stdout.write(`${JSON.stringify(V2_FREE_MATRIX, null, 2)}\n`);
    return 0;
  }
  if (command === 'check-oracle') {
    const report = await readJson<V2FreeOracleReport>(requirePath(argv[1]));
    const failures = assessOraclePrecheck(report);
    process.stdout.write(`${JSON.stringify({ passed: failures.length === 0, failures })}\n`);
    return failures.length === 0 ? 0 : 2;
  }
  if (command === 'assess') {
    const evidence = await readJson<V2FreeCandidateEvidence>(requirePath(argv[1]));
    const assessment = assessV2FreeCandidate(evidence);
    process.stdout.write(`${JSON.stringify(assessment)}\n`);
    return assessment.passed ? 0 : 2;
  }
  if (command === 'select') {
    const candidates = await Promise.all(
      argv.slice(1).map((value) => readJson<V2FreeCandidateEvidence>(value)),
    );
    const selected = selectSmallestPassingV2FreeCandidate(candidates);
    process.stdout.write(`${JSON.stringify({ candidateId: selected.candidateId })}\n`);
    return 0;
  }
  if (command === 'build-selection') return buildSelectionCommand(argv.slice(1));
  if (command === 'validate-selection-stage') {
    return validateSelectionStageCommand(argv.slice(1));
  }
  if (command === 'validate-holdout') return validateHoldoutCommand(argv.slice(1));
  if (command === 'evaluate') return evaluateCommand(argv.slice(1));
  if (command === 'promote-oracle') return promoteOracleCommand(argv.slice(1));
  if (command === 'claim-final-pair') return claimFinalPairCommand(argv.slice(1));
  throw new Error(`Unknown autocomplete-v2-free command: ${command}`);
}

async function promoteOracleCommand(argv: readonly string[]): Promise<number> {
  const result = await promoteV2FreeOracle({
    workspaceRoot: requiredArgument(argv, '--workspace-root'),
    candidateRoot: requiredArgument(argv, '--candidate-root'),
    trainedManifestPath: requiredArgument(argv, '--trained-manifest'),
    oracleOutputDirectory: requiredArgument(argv, '--oracle-output-dir'),
    runtimeMeasurementPath: requiredArgument(argv, '--runtime-measurement'),
    workerExecutablePath: requiredArgument(argv, '--worker'),
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
  return 0;
}

async function buildSelectionCommand(argv: readonly string[]): Promise<number> {
  const workspaceRoot = requiredArgument(argv, '--workspace-root');
  const descriptors = repeatedArguments(argv, '--validation-descriptor');
  const contents = repeatedArguments(argv, '--validation-content');
  if (descriptors.length !== contents.length) {
    throw new Error('Validation descriptor/content arguments must be paired.');
  }
  const validationHoldouts: V2FreeValidationInput[] = [];
  for (const [index, descriptorPath] of descriptors.entries()) {
    validationHoldouts.push({
      descriptor: await readJson<V2FreeHoldoutDescriptor>(descriptorPath),
      contentPath: contents[index]!,
    });
  }
  const selection = await buildV2FreeLicensedCorpusSelection({
    workspaceRoot,
    selectionPath: requiredArgument(argv, '--v2r-selection'),
    sourceRegistryPath: requiredArgument(argv, '--source-registry'),
    validationHoldouts,
  });
  const stage = parseSelectionStage(readArgument(argv, '--stage') ?? 'governance');
  assertV2FreeSelectionStage(selection, stage);
  const output = requiredArgument(argv, '--output');
  const resolvedOutput = resolveWorkspaceOutput(workspaceRoot, output);
  await writeJsonExclusive(resolvedOutput, selection);
  process.stdout.write(
    `${JSON.stringify({ output, stage, selectedBytes: selection.selectedBytes, inputTreeSha256: selection.inputTreeSha256 })}\n`,
  );
  return 0;
}

async function validateSelectionStageCommand(argv: readonly string[]): Promise<number> {
  const selection = await readJson<V2FreeLicensedCorpusSelection>(
    requiredArgument(argv, '--selection'),
  );
  const stage = parseSelectionStage(requiredArgument(argv, '--stage'));
  assertV2FreeSelectionStage(selection, stage);
  process.stdout.write(
    `${JSON.stringify({ passed: true, stage, selectedBytes: selection.selectedBytes, inputTreeSha256: selection.inputTreeSha256 })}\n`,
  );
  return 0;
}

function parseSelectionStage(value: string): V2FreeSelectionStage {
  if (value === 'governance' || value === 'formal-32mib-smoke') return value;
  throw new Error(`Unsupported V2 free selection stage: ${value}.`);
}

function resolveWorkspaceOutput(workspaceRoot: string, value: string): string {
  if (path.isAbsolute(value)) throw new Error('Output path must be workspace-relative.');
  const root = path.resolve(workspaceRoot);
  const output = path.resolve(root, value);
  const relative = path.relative(root, output);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Output path escaped the workspace.');
  }
  return output;
}

async function validateHoldoutCommand(argv: readonly string[]): Promise<number> {
  const workspaceRoot = requiredArgument(argv, '--workspace-root');
  const descriptor = validateV2FreeHoldoutDescriptor(
    await readJson<V2FreeHoldoutDescriptor>(requiredArgument(argv, '--descriptor')),
  );
  const contentPath = readArgument(argv, '--content');
  if (!contentPath) {
    process.stdout.write(
      `${JSON.stringify({ descriptorOnly: true, datasetId: descriptor.datasetId, sha256: descriptor.content.sha256 })}\n`,
    );
    return 0;
  }
  const final = descriptor.classification.endsWith('-final-v1');
  if (final) {
    const claimPath = requiredArgument(argv, '--claim');
    const claim = await readV2FreeFinalPairClaim({ workspaceRoot, claimPath });
    const expected = descriptor.classification.startsWith('cold-')
      ? claim.coldHoldoutSha256
      : claim.workspaceHoldoutSha256;
    if (expected !== descriptor.content.sha256) {
      throw new Error('Final pair claim does not bind the requested holdout.');
    }
  }
  const content = await loadV2FreeHoldoutContent({
    workspaceRoot,
    descriptor,
    contentPath,
    allowFinalRead: final,
  });
  process.stdout.write(
    `${JSON.stringify({ descriptorOnly: false, datasetId: content.datasetId, sha256: descriptor.content.sha256 })}\n`,
  );
  return 0;
}

async function evaluateCommand(argv: readonly string[]): Promise<number> {
  const descriptor = await readJson<V2FreeHoldoutDescriptor>(
    requiredArgument(argv, '--descriptor'),
  );
  const finalClaimPath = readArgument(argv, '--claim');
  const result = await evaluateV2FreeHoldout({
    workspaceRoot: requiredArgument(argv, '--workspace-root'),
    workerExecutablePath: requiredArgument(argv, '--worker'),
    candidateManifestPath: requiredArgument(argv, '--manifest'),
    descriptor,
    contentPath: requiredArgument(argv, '--content'),
    outputDirectory: requiredArgument(argv, '--output-dir'),
    ...(finalClaimPath ? { finalClaimPath } : {}),
  });
  process.stdout.write(
    `${JSON.stringify({ evaluationManifestSha256: result.evaluationManifestSha256, reportSha256: result.report.reportSha256 })}\n`,
  );
  return 0;
}

async function claimFinalPairCommand(argv: readonly string[]): Promise<number> {
  const workspaceRoot = requiredArgument(argv, '--workspace-root');
  const result = await claimV2FreeFinalPair({
    workspaceRoot,
    coldDescriptor: await readJson<V2FreeHoldoutDescriptor>(
      requiredArgument(argv, '--cold-descriptor'),
    ),
    workspaceDescriptor: await readJson<V2FreeHoldoutDescriptor>(
      requiredArgument(argv, '--workspace-descriptor'),
    ),
    candidateArtifactSha256: requiredArgument(argv, '--candidate-artifact-sha256'),
    baselineSha256: requiredArgument(argv, '--baseline-sha256'),
    evaluatorTreeSha256: requiredArgument(argv, '--evaluator-tree-sha256'),
  });
  process.stdout.write(
    `${JSON.stringify({ pairSha256: result.claim.pairSha256, claimSha256: result.claim.claimSha256, claimPath: result.claimPath })}\n`,
  );
  return 0;
}

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, 'utf8')) as T;
}

async function writeJsonExclusive(filePath: string, value: unknown): Promise<void> {
  const handle = await open(filePath, 'wx');
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function readArgument(argv: readonly string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  return index < 0 ? undefined : argv[index + 1];
}

function repeatedArguments(argv: readonly string[], name: string): string[] {
  const output: string[] = [];
  for (let index = 0; index < argv.length; index++) {
    if (argv[index] === name) output.push(requirePath(argv[index + 1]));
  }
  return output;
}

function requiredArgument(argv: readonly string[], name: string): string {
  const value = readArgument(argv, name);
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function requirePath(value: string | undefined): string {
  if (!value) throw new Error('A JSON report path is required.');
  return value;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runV2FreeCli(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
