#!/usr/bin/env node
import { pathToFileURL } from 'node:url';

import {
  prepareRemoteTrainingMatrix,
  pullRemoteTrainingMatrixBundle,
  queryRemoteTrainingMatrixStatus,
  submitRemoteTrainingMatrixJob,
  uploadRemoteTrainingMatrix,
} from './orchestrator';
import type { V2FreeTrainingMatrixId } from './contract';

export async function runRemoteMatrixCli(argv: readonly string[]): Promise<number> {
  const command = argv[0];
  if (!command || command === '--help') {
    process.stdout.write(
      [
        'Usage: autocomplete-v2-free-remote <command> [options]',
        'Commands:',
        '  prepare --workspace-root <path> --output-dir <relative> --matrix-run-id <id> --source-bundle <relative> --training-corpus <relative> --selection <relative> --selection-stage-receipt <relative> --fingerprint-audit <relative> --tokenizer-model <relative> --tokenizer-runtime <relative> --remote-jobs-dir <relative> --remote-output-dir <relative> --remote-state-dir <relative> --scheduled-task-prefix <name> --deadline-at <ISO>',
        '  upload --workspace-root <path> --plan <relative> --host <ssh-alias> --remote-workspace-root <absolute-windows-path> --remote-git <absolute-windows-path> --transfer-id <id>',
        '  submit --plan <path> --host <ssh-alias> --remote-workspace-root <absolute-windows-path> --remote-git <absolute-windows-path> --remote-state-root <absolute-windows-path> --matrix-id <16m-q4|24m-q4|32m-q4>',
        '  status --plan <path> --host <ssh-alias> --remote-state-root <absolute-windows-path>',
        '  pull --workspace-root <path> --plan <relative> --host <ssh-alias> --remote-workspace-root <absolute-windows-path> --remote-state-root <absolute-windows-path> --matrix-id <16m-q4|24m-q4|32m-q4> --local-output-dir <relative>',
      ].join('\n') + '\n',
    );
    return 0;
  }
  if (command === 'prepare') {
    const result = await prepareRemoteTrainingMatrix({
      workspaceRoot: required(argv, '--workspace-root'),
      outputDirectory: required(argv, '--output-dir'),
      matrixRunId: required(argv, '--matrix-run-id'),
      sourceBundlePath: required(argv, '--source-bundle'),
      trainingCorpusPath: required(argv, '--training-corpus'),
      selectionPath: required(argv, '--selection'),
      selectionStageReceiptPath: required(argv, '--selection-stage-receipt'),
      fingerprintAuditPath: required(argv, '--fingerprint-audit'),
      tokenizerModelPath: required(argv, '--tokenizer-model'),
      tokenizerRuntimePath: required(argv, '--tokenizer-runtime'),
      remoteJobsDirectory: required(argv, '--remote-jobs-dir'),
      remoteOutputDirectory: required(argv, '--remote-output-dir'),
      remoteStateDirectory: required(argv, '--remote-state-dir'),
      scheduledTaskPrefix: required(argv, '--scheduled-task-prefix'),
      deadlineAt: required(argv, '--deadline-at'),
      ...(optional(argv, '--recipe') ? { recipePath: optional(argv, '--recipe') } : {}),
      ...(optional(argv, '--source-commit')
        ? { sourceCommit: optional(argv, '--source-commit') }
        : {}),
      ...(optional(argv, '--source-tree') ? { sourceTree: optional(argv, '--source-tree') } : {}),
    });
    process.stdout.write(
      `${JSON.stringify({ planPath: result.planPath, jobs: result.plan.jobs })}\n`,
    );
    return 0;
  }
  if (command === 'upload') {
    const result = await uploadRemoteTrainingMatrix({
      workspaceRoot: required(argv, '--workspace-root'),
      planPath: required(argv, '--plan'),
      host: required(argv, '--host'),
      remoteWorkspaceRoot: required(argv, '--remote-workspace-root'),
      remoteGitPath: required(argv, '--remote-git'),
      transferId: required(argv, '--transfer-id'),
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return 0;
  }
  if (command === 'submit') {
    const result = await submitRemoteTrainingMatrixJob({
      planPath: required(argv, '--plan'),
      host: required(argv, '--host'),
      remoteWorkspaceRoot: required(argv, '--remote-workspace-root'),
      remoteGitPath: required(argv, '--remote-git'),
      remoteStateRoot: required(argv, '--remote-state-root'),
      matrixId: matrixId(required(argv, '--matrix-id')),
    });
    process.stdout.write(`${JSON.stringify({ status: result })}\n`);
    return 0;
  }
  if (command === 'status') {
    const result = await queryRemoteTrainingMatrixStatus({
      planPath: required(argv, '--plan'),
      host: required(argv, '--host'),
      remoteStateRoot: required(argv, '--remote-state-root'),
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return 0;
  }
  if (command === 'pull') {
    const result = await pullRemoteTrainingMatrixBundle({
      workspaceRoot: required(argv, '--workspace-root'),
      planPath: required(argv, '--plan'),
      host: required(argv, '--host'),
      remoteWorkspaceRoot: required(argv, '--remote-workspace-root'),
      remoteStateRoot: required(argv, '--remote-state-root'),
      matrixId: matrixId(required(argv, '--matrix-id')),
      localOutputDirectory: required(argv, '--local-output-dir'),
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return 0;
  }
  throw new Error(`Unknown remote matrix command: ${command}.`);
}

function matrixId(value: string): V2FreeTrainingMatrixId {
  if (value === '16m-q4' || value === '24m-q4' || value === '32m-q4') return value;
  throw new Error(`Unsupported trainable matrix ID: ${value}.`);
}

function optional(argv: readonly string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  return index < 0 ? undefined : argv[index + 1];
}

function required(argv: readonly string[], name: string): string {
  const value = optional(argv, name);
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runRemoteMatrixCli(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
