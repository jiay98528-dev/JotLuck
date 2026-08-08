import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { parseRemoteTrainingJob } from './contract';
import {
  parseRemoteMatrixPlan,
  prepareRemoteTrainingMatrix,
  uploadRemoteTrainingMatrix,
  type CommandExecutor,
} from './orchestrator';

const temporaryRoots: string[] = [];
const GIT_OBJECT = '1'.repeat(40);

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe('formal remote matrix orchestrator', () => {
  it('prepares three trainable jobs with one shared tokenizer and resumable identity', async () => {
    const root = await fixtureWorkspace();
    const { plan, planPath } = await prepareRemoteTrainingMatrix(prepareOptions(root));

    expect(planPath).toBe('out/matrix/matrix-plan.json');
    expect(plan.jobs.map((job) => job.matrixId)).toEqual(['16m-q4', '24m-q4', '32m-q4']);
    expect(plan.resumeMode).toBe('if-available');
    expect(plan.files.filter((file) => file.role === 'tokenizer-model')).toHaveLength(1);
    expect(plan.files.filter((file) => file.role === 'tokenizer-runtime')).toHaveLength(1);

    for (const record of plan.jobs) {
      const job = parseRemoteTrainingJob(
        JSON.parse(await readFile(path.join(root, record.jobLocalRelativePath), 'utf8')),
      );
      expect(job.tokenizer.bindingSha256).toBe(plan.tokenizerBindingSha256);
      expect(job.resume.mode).toBe('if-available');
      expect(argumentValue(job.recipe.arguments, '--tokenizer-model')).toBe(
        'inputs/shared-tokenizer.model',
      );
      expect(argumentValue(job.recipe.arguments, '--tokenizer-runtime')).toBe(
        'inputs/shared-tokenizer.json',
      );
      if (record.matrixId === '16m-q4') {
        expect(job.selection.candidateMatrixIds).toEqual(['16m-q4', '16m-q8']);
      }
    }

    const parsedPlan = parseRemoteMatrixPlan(
      JSON.parse(await readFile(path.join(root, planPath), 'utf8')),
    );
    expect(parsedPlan.tokenizerBindingSha256).toBe(plan.tokenizerBindingSha256);
    await expect(prepareRemoteTrainingMatrix(prepareOptions(root))).rejects.toThrow();
  });

  it('rejects tokenizer binding drift in a prepared job', async () => {
    const root = await fixtureWorkspace();
    const { plan } = await prepareRemoteTrainingMatrix(prepareOptions(root));
    const record = plan.jobs[0]!;
    const value = JSON.parse(
      await readFile(path.join(root, record.jobLocalRelativePath), 'utf8'),
    ) as { tokenizer: { bindingSha256: string } };
    value.tokenizer.bindingSha256 = '0'.repeat(64);
    expect(() => parseRemoteTrainingJob(value)).toThrow(/tokenizer binding/u);
  });

  it('uploads only through verified temporary files and skips identical finals', async () => {
    const root = await fixtureWorkspace();
    const { planPath } = await prepareRemoteTrainingMatrix(prepareOptions(root));
    const uploadedExecutor = new RecordingExecutor('upload-required');
    const uploaded = await uploadRemoteTrainingMatrix(
      {
        workspaceRoot: root,
        planPath,
        host: 'ROG',
        remoteWorkspaceRoot: 'D:\\JotLuckTrain',
        remoteGitPath: 'D:\\Tools\\git.exe',
        transferId: 'transfer-001',
      },
      uploadedExecutor,
    );
    expect(uploaded).toEqual({ uploaded: 12, alreadyPresent: 0 });
    expect(uploadedExecutor.calls.filter((call) => call.executable === 'scp.exe')).toHaveLength(13);
    expect(
      uploadedExecutor.calls.some((call) =>
        call.args.join(' ').includes('.upload-transfer-001.tmp'),
      ),
    ).toBe(true);
    const remoteScripts = uploadedExecutor.calls
      .filter((call) => call.executable === 'ssh.exe')
      .map((call) => Buffer.from(call.args.at(-1) ?? '', 'base64').toString('utf16le'));
    expect(remoteScripts.some((script) => script.includes("-Phase 'Extract'"))).toBe(true);
    expect(remoteScripts.some((script) => script.includes("-Phase 'Finalize'"))).toBe(true);
    expect(remoteScripts.some((script) => script.includes(GIT_OBJECT))).toBe(true);

    const existingExecutor = new RecordingExecutor('already-installed');
    const existing = await uploadRemoteTrainingMatrix(
      {
        workspaceRoot: root,
        planPath,
        host: 'ROG',
        remoteWorkspaceRoot: 'D:\\JotLuckTrain',
        remoteGitPath: 'D:\\Tools\\git.exe',
        transferId: 'transfer-002',
      },
      existingExecutor,
    );
    expect(existing).toEqual({ uploaded: 0, alreadyPresent: 12 });
    expect(existingExecutor.calls.every((call) => call.executable === 'ssh.exe')).toBe(true);
  });
});

class RecordingExecutor implements CommandExecutor {
  readonly calls: { executable: string; args: readonly string[] }[] = [];

  constructor(private readonly mode: 'upload-required' | 'already-installed') {}

  async run(executable: string, args: readonly string[]) {
    this.calls.push({ executable, args });
    if (executable === 'scp.exe') return { exitCode: 0, stdout: '', stderr: '' };
    const script = Buffer.from(args.at(-1) ?? '', 'base64').toString('utf16le');
    if (script.includes("'install-required'")) {
      return {
        exitCode: 0,
        stdout: this.mode === 'already-installed' ? 'already-installed\n' : 'install-required\n',
        stderr: '',
      };
    }
    return {
      exitCode: 0,
      stdout: script.includes("'upload-required'") ? 'upload-required\n' : 'uploaded\n',
      stderr: '',
    };
  }
}

async function fixtureWorkspace(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'jotluck-matrix-'));
  temporaryRoots.push(root);
  await mkdir(path.join(root, 'inputs'), { recursive: true });
  await mkdir(path.join(root, 'scripts/autocomplete-v2-free'), { recursive: true });
  await mkdir(path.join(root, 'scripts/autocomplete-v2-free/remote'), { recursive: true });
  await writeFile(path.join(root, 'inputs/source.bundle'), 'source');
  await writeFile(path.join(root, 'inputs/train.jsonl'), '{"text":"hello"}\n');
  await writeFile(path.join(root, 'inputs/selection.json'), '{"selection":true}\n');
  await writeFile(path.join(root, 'inputs/selection-stage-receipt.json'), '{"passed":true}\n');
  await writeFile(path.join(root, 'inputs/fingerprint-audit.json'), '{"passed":true}\n');
  await writeFile(path.join(root, 'inputs/shared-tokenizer.model'), 'sentencepiece');
  await writeFile(
    path.join(root, 'inputs/shared-tokenizer.json'),
    `${JSON.stringify({ schema: 'jotluck.autocomplete.unigram-runtime.v1', vocabularySize: 8_000 })}\n`,
  );
  await writeFile(
    path.join(root, 'scripts/autocomplete-v2-free/train_decoder.py'),
    'print("trainer")\n',
  );
  await writeFile(
    path.join(root, 'scripts/autocomplete-v2-free/remote/Install-MatrixWorkspace.ps1'),
    'param()\n',
  );
  return root;
}

function prepareOptions(root: string) {
  return {
    workspaceRoot: root,
    outputDirectory: 'out/matrix',
    matrixRunId: 'formal-128m',
    sourceBundlePath: 'inputs/source.bundle',
    trainingCorpusPath: 'inputs/train.jsonl',
    selectionPath: 'inputs/selection.json',
    selectionStageReceiptPath: 'inputs/selection-stage-receipt.json',
    fingerprintAuditPath: 'inputs/fingerprint-audit.json',
    tokenizerModelPath: 'inputs/shared-tokenizer.model',
    tokenizerRuntimePath: 'inputs/shared-tokenizer.json',
    remoteJobsDirectory: 'jobs/formal-128m',
    remoteOutputDirectory: 'scripts/corpus/_web-cache/autocomplete-v2-free/candidates/formal-128m',
    remoteStateDirectory: 'state/formal-128m',
    scheduledTaskPrefix: 'JotLuck-V2',
    deadlineAt: '2026-08-10T00:00:00.000Z',
    createdAt: '2026-08-08T00:00:00.000Z',
    sourceCommit: GIT_OBJECT,
    sourceTree: GIT_OBJECT,
  };
}

function argumentValue(arguments_: readonly string[], name: string): string | undefined {
  const index = arguments_.indexOf(name);
  return index < 0 ? undefined : arguments_[index + 1];
}
