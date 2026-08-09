import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

import {
  REMOTE_TRAINING_JOB_SCHEMA,
  computeSharedTokenizerBindingSha256,
  createRemoteBundleManifest,
  parseRemoteTrainingJob,
  type RemoteContentReference,
} from './contract';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

// 训练管线（pwsh.exe / .venv\Scripts\python.exe / git.exe）仅支持 Windows 宿主，
// 与 rust job 同理由：CI ubuntu 上没有这些可执行文件，整套用例在 posix 下跳过。
const describeRunnerIdempotency = describe.skipIf(process.platform !== 'win32');

describeRunnerIdempotency('remote runner terminal-state idempotency', () => {
  it('re-verifies a completed bundle and does not rewrite successful state', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'jotluck-runner-idempotency-'));
    temporaryRoots.push(root);
    const stateRoot = path.join(root, 'state-root');
    const bundleRoot = path.join(root, 'outputs/completed-job');
    const statusPath = path.join(stateRoot, 'state/completed-job/status.json');
    await mkdir(path.dirname(statusPath), { recursive: true });
    await mkdir(bundleRoot, { recursive: true });
    const pythonPath = path.join(root, 'python.exe');
    const gitPath = path.join(root, 'git.exe');
    await writeFile(pythonPath, 'bound-python');
    await writeFile(gitPath, 'bound-git');

    const tokenizerModel = reference('tokenizer-model', 'tokenizer/model.bin', 'tokenizer-seed');
    const tokenizerRuntime = reference(
      'tokenizer-runtime',
      'tokenizer/runtime.json',
      'tokenizer-seed',
    );
    const job = parseRemoteTrainingJob({
      schema: REMOTE_TRAINING_JOB_SCHEMA,
      jobId: 'completed-job',
      sourceTree: {
        commit: '1'.repeat(40),
        tree: '2'.repeat(40),
        bundleSha256: '3'.repeat(64),
      },
      recipe: {
        id: 'decoder-train-v1',
        relativePath: 'train.py',
        sha256: '4'.repeat(64),
        arguments: [
          '--tokenizer-model',
          tokenizerModel.relativePath,
          '--tokenizer-runtime',
          tokenizerRuntime.relativePath,
          '--selection-stage-receipt',
          'inputs/stage-receipt.json',
          '--fingerprint-audit',
          'inputs/fingerprint-audit.json',
        ],
      },
      selection: {
        matrixId: '16m-q4',
        parameterCount: 16_000_000,
        quantization: 'q4',
        candidateMatrixIds: ['16m-q4', '16m-q8'],
      },
      tokenizer: {
        kind: 'unigram',
        vocabularySize: 8_000,
        byteFallback: true,
        modelInputId: tokenizerModel.id,
        runtimeInputId: tokenizerRuntime.id,
        bindingSha256: computeSharedTokenizerBindingSha256({
          model: tokenizerModel,
          runtime: tokenizerRuntime,
        }),
      },
      model: {
        engine: 'public-v2-free-decoder-v1',
        candidateId: 'completed-job',
        format: 'JLFDQ02',
      },
      seed: 20_260_805,
      inputs: [
        reference('corpus', 'inputs/train.jsonl', 'training-corpus'),
        reference('selection', 'inputs/selection.json', 'recipe-config'),
        reference('stage-receipt', 'inputs/stage-receipt.json', 'selection-stage-receipt'),
        reference('fingerprint-audit', 'inputs/fingerprint-audit.json', 'fingerprint-audit'),
        tokenizerModel,
        tokenizerRuntime,
      ],
      resume: { mode: 'if-available', checkpointDirectory: 'checkpoints/completed-job' },
      output: {
        rootDirectory: 'outputs',
        bundleName: 'completed-job',
        statusPath: 'state/completed-job/status.json',
        heartbeatPath: 'state/completed-job/heartbeat.json',
      },
      deadlineAt: '2026-08-10T00:00:00.000Z',
    });
    const jobPath = path.join(root, 'job.json');
    const jobBytes = Buffer.from(`${JSON.stringify(job, null, 2)}\n`, 'utf8');
    await writeFile(jobPath, jobBytes);
    const payload = Buffer.from('verified payload', 'utf8');
    await writeFile(path.join(bundleRoot, 'evidence.json'), payload);
    const bundle = createRemoteBundleManifest({
      schema: 'jotluck.autocomplete.v2-free.remote-bundle.v1',
      jobId: job.jobId,
      sourceJobSha256: sha256(jobBytes),
      createdAt: '2026-08-08T00:00:00.000Z',
      files: [
        {
          relativePath: 'evidence.json',
          role: 'evidence',
          bytes: payload.byteLength,
          sha256: sha256(payload),
        },
      ],
    });
    await writeFile(path.join(bundleRoot, 'manifest.json'), `${JSON.stringify(bundle, null, 2)}\n`);
    const statusBytes = Buffer.from(
      `${JSON.stringify(
        {
          schema: 'jotluck.autocomplete.v2-free.remote-training-result.v1',
          jobId: job.jobId,
          jobFileSha256: sha256(jobBytes),
          status: 'completed',
          createdAt: '2026-08-08T00:00:00.000Z',
          heartbeatAt: '2026-08-08T01:00:00.000Z',
          startedAt: '2026-08-08T00:01:00.000Z',
          finishedAt: '2026-08-08T01:00:00.000Z',
          outputBundle: {
            manifestPath: 'outputs/completed-job/manifest.json',
            bytes: bundle.totalBytes,
            sha256: bundle.bundleSha256,
          },
        },
        null,
        2,
      )}\n`,
      'utf8',
    );
    await writeFile(statusPath, statusBytes);

    const runner = fileURLToPath(new URL('./Invoke-TrainingJob.ps1', import.meta.url));
    const result = await run('pwsh.exe', [
      '-NoLogo',
      '-NoProfile',
      '-File',
      runner,
      '-JobPath',
      jobPath,
      '-ExpectedJobSha256',
      sha256(jobBytes),
      '-TrainingPythonPath',
      pythonPath,
      '-ExpectedTrainingPythonSha256',
      sha256(await readFile(pythonPath)),
      '-GitPath',
      gitPath,
      '-ExpectedGitSha256',
      sha256(await readFile(gitPath)),
      '-WorkspaceRoot',
      root,
      '-StateRoot',
      stateRoot,
    ]);

    expect(result.exitCode, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ jobId: job.jobId, status: 'completed' });
    expect(await readFile(statusPath)).toEqual(statusBytes);
    await expect(readFile(path.join(stateRoot, job.output.heartbeatPath))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('rejects archive traversal before extracting a matrix workspace', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'jotluck-matrix-install-'));
    temporaryRoots.push(root);
    const sourceArchive = path.join(root, 'source.tar.gz');
    const corpusArchive = path.join(root, 'corpus.tar.gz');
    const archiveBuilder = [
      'import io,sys,tarfile',
      'def write(path,name):',
      ' data=b"payload"',
      ' with tarfile.open(path,"w:gz") as archive:',
      '  item=tarfile.TarInfo(name); item.size=len(data); archive.addfile(item,io.BytesIO(data))',
      'write(sys.argv[1],"safe.txt")',
      'write(sys.argv[2],"../escape.txt")',
    ].join('\n');
    const built = await run('python.exe', ['-c', archiveBuilder, sourceArchive, corpusArchive]);
    expect(built.exitCode, built.stderr).toBe(0);
    const installer = fileURLToPath(new URL('./Install-MatrixWorkspace.ps1', import.meta.url));
    const staging = path.join(root, 'workspace.install.tmp');
    const installed = await run('pwsh.exe', [
      '-NoLogo',
      '-NoProfile',
      '-File',
      installer,
      '-Phase',
      'Extract',
      '-StagingRoot',
      staging,
      '-FinalWorkspaceRoot',
      path.join(root, 'workspace'),
      '-SourceArchive',
      sourceArchive,
      '-ExpectedSourceArchiveSha256',
      sha256(await readFile(sourceArchive)),
      '-CorpusArchive',
      corpusArchive,
      '-ExpectedCorpusArchiveSha256',
      sha256(await readFile(corpusArchive)),
      '-SelectionRelativePath',
      'selection.json',
      '-ExpectedSelectionSha256',
      '1'.repeat(64),
      '-PlanRelativePath',
      'plan.json',
      '-ExpectedPlanSha256',
      '2'.repeat(64),
      '-StageReceiptRelativePath',
      'stage.json',
      '-ExpectedStageReceiptSha256',
      '3'.repeat(64),
      '-FingerprintAuditRelativePath',
      'fingerprint.json',
      '-ExpectedFingerprintAuditSha256',
      '6'.repeat(64),
      '-ExpectedCommit',
      '4'.repeat(40),
      '-ExpectedTree',
      '5'.repeat(40),
      '-GitPath',
      'git.exe',
    ]);
    expect(installed.exitCode).not.toBe(0);
    expect(installed.stderr).toMatch(/unsafe path/u);
    await expect(access(staging)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(access(path.join(root, 'escape.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('extracts, verifies, and atomically installs a small matrix workspace', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'jotluck-matrix-install-ok-'));
    temporaryRoots.push(root);
    const sourceTree = path.join(root, 'source-tree');
    await mkdir(sourceTree);
    await writeFile(path.join(sourceTree, 'README.md'), 'source\n');
    for (const args of [
      ['init', sourceTree],
      ['-C', sourceTree, 'config', 'user.email', 'test@example.invalid'],
      ['-C', sourceTree, 'config', 'user.name', 'Test'],
      ['-C', sourceTree, 'add', 'README.md'],
      ['-C', sourceTree, 'commit', '-m', 'fixture'],
    ]) {
      const result = await run('git.exe', args);
      expect(result.exitCode, result.stderr).toBe(0);
    }
    const commit = (
      await run('git.exe', ['-C', sourceTree, 'rev-parse', 'HEAD^{commit}'])
    ).stdout.trim();
    const tree = (
      await run('git.exe', ['-C', sourceTree, 'rev-parse', 'HEAD^{tree}'])
    ).stdout.trim();
    const sourceArchive = path.join(root, 'source.tar.gz');
    expect((await run('tar.exe', ['-czf', sourceArchive, '-C', sourceTree, '.'])).exitCode).toBe(0);

    const corpusRoot = path.join(root, 'corpus-root');
    await mkdir(path.join(corpusRoot, 'corpus'), { recursive: true });
    const documentBytes = Buffer.from('hello corpus\n', 'utf8');
    await writeFile(path.join(corpusRoot, 'corpus/doc.md'), documentBytes);
    const selectionBytes = Buffer.from(
      `${JSON.stringify({
        schema: 'jotluck.autocomplete.v2-free-licensed-corpus.v1',
        schemaVersion: 1,
        selectedBytes: documentBytes.byteLength,
        documents: [
          {
            relativePath: 'corpus/doc.md',
            sha256: sha256(documentBytes),
            licenseApproved: true,
          },
        ],
      })}\n`,
      'utf8',
    );
    await writeFile(path.join(corpusRoot, 'corpus/selection.json'), selectionBytes);
    const corpusArchive = path.join(root, 'corpus.tar.gz');
    expect(
      (
        await run('tar.exe', [
          '-czf',
          corpusArchive,
          '-C',
          corpusRoot,
          'corpus/doc.md',
          'corpus/selection.json',
        ])
      ).exitCode,
    ).toBe(0);

    const stageBytes = Buffer.from('{"stage":"passed"}\n', 'utf8');
    const auditBytes = Buffer.from('{"audit":"passed"}\n', 'utf8');
    const plan = {
      schema: 'jotluck.autocomplete.v2-free.remote-matrix-plan.v1',
      files: [
        fileRecord('selection-stage-receipt', 'evidence/stage.json', stageBytes),
        fileRecord('fingerprint-audit', 'evidence/audit.json', auditBytes),
      ],
    };
    const planBytes = Buffer.from(`${JSON.stringify(plan)}\n`, 'utf8');
    const staging = path.join(root, 'workspace.install.tmp');
    const final = path.join(root, 'workspace');
    const installer = fileURLToPath(new URL('./Install-MatrixWorkspace.ps1', import.meta.url));
    const commonArguments = [
      '-StagingRoot',
      staging,
      '-FinalWorkspaceRoot',
      final,
      '-SourceArchive',
      sourceArchive,
      '-ExpectedSourceArchiveSha256',
      sha256(await readFile(sourceArchive)),
      '-CorpusArchive',
      corpusArchive,
      '-ExpectedCorpusArchiveSha256',
      sha256(await readFile(corpusArchive)),
      '-SelectionRelativePath',
      'corpus/selection.json',
      '-ExpectedSelectionSha256',
      sha256(selectionBytes),
      '-PlanRelativePath',
      'jobs/matrix-plan.json',
      '-ExpectedPlanSha256',
      sha256(planBytes),
      '-StageReceiptRelativePath',
      'evidence/stage.json',
      '-ExpectedStageReceiptSha256',
      sha256(stageBytes),
      '-FingerprintAuditRelativePath',
      'evidence/audit.json',
      '-ExpectedFingerprintAuditSha256',
      sha256(auditBytes),
      '-ExpectedCommit',
      commit,
      '-ExpectedTree',
      tree,
      '-GitPath',
      'git.exe',
    ];
    const extracted = await run('pwsh.exe', [
      '-NoLogo',
      '-NoProfile',
      '-File',
      installer,
      '-Phase',
      'Extract',
      ...commonArguments,
    ]);
    expect(extracted.exitCode, extracted.stderr).toBe(0);
    await mkdir(path.join(staging, 'jobs'), { recursive: true });
    await mkdir(path.join(staging, 'evidence'), { recursive: true });
    await writeFile(path.join(staging, 'jobs/matrix-plan.json'), planBytes);
    await writeFile(path.join(staging, 'evidence/stage.json'), stageBytes);
    await writeFile(path.join(staging, 'evidence/audit.json'), auditBytes);
    const finalized = await run('pwsh.exe', [
      '-NoLogo',
      '-NoProfile',
      '-File',
      installer,
      '-Phase',
      'Finalize',
      ...commonArguments,
    ]);
    expect(finalized.exitCode, finalized.stderr).toBe(0);
    expect(await readFile(path.join(final, 'corpus/doc.md'))).toEqual(documentBytes);
    expect(
      JSON.parse(await readFile(path.join(final, '.jotluck-matrix-install.json'), 'utf8')),
    ).toMatchObject({
      sourceCommit: commit,
      sourceTree: tree,
      fingerprintAuditSha256: sha256(auditBytes),
    });
    await expect(access(staging)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

function reference(
  id: string,
  relativePath: string,
  role: RemoteContentReference['role'],
): RemoteContentReference {
  return { id, role, relativePath, bytes: 1, sha256: sha256(Buffer.from(id)) };
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function fileRecord(role: string, relativePath: string, bytes: Buffer) {
  return {
    role,
    localRelativePath: relativePath,
    remoteRelativePath: relativePath,
    bytes: bytes.byteLength,
    sha256: sha256(bytes),
  };
}

async function run(executable: string, args: readonly string[]) {
  return new Promise<{ exitCode: number; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(executable, [...args], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.once('error', reject);
    child.once('exit', (code) =>
      resolve({
        exitCode: code ?? -1,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
      }),
    );
  });
}
