import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, realpath, readdir, rename, rm, stat } from 'node:fs/promises';
import * as path from 'node:path';

import {
  REMOTE_TRAINING_JOB_SCHEMA,
  computeRemoteTrainingJobSha256,
  computeSharedTokenizerBindingSha256,
  isSafeRelativePath,
  parseRemoteBundleManifest,
  parseRemoteTrainingJob,
  parseTrainingResult,
  type RemoteContentReference,
  type RemoteTrainingJob,
  type TrainingResult,
  type V2FreeTrainingMatrixId,
} from './contract';

export const REMOTE_MATRIX_PLAN_SCHEMA =
  'jotluck.autocomplete.v2-free.remote-matrix-plan.v1' as const;

const MATRIX = Object.freeze([
  {
    id: '16m-q4' as const,
    parameterCount: 16_000_000 as const,
    candidates: ['16m-q4', '16m-q8'] as const,
  },
  { id: '24m-q4' as const, parameterCount: 24_000_000 as const, candidates: ['24m-q4'] as const },
  { id: '32m-q4' as const, parameterCount: 32_000_000 as const, candidates: ['32m-q4'] as const },
]);

type MatrixFileRole =
  | 'source-bundle'
  | 'training-corpus'
  | 'recipe-config'
  | 'recipe'
  | 'selection-stage-receipt'
  | 'fingerprint-audit'
  | 'tokenizer-model'
  | 'tokenizer-runtime'
  | 'job'
  | 'plan';

export interface RemoteMatrixFile {
  role: MatrixFileRole;
  localRelativePath: string;
  remoteRelativePath: string;
  bytes: number;
  sha256: string;
}

export interface RemoteMatrixJobRecord {
  matrixId: V2FreeTrainingMatrixId;
  candidateId: string;
  jobLocalRelativePath: string;
  jobRemoteRelativePath: string;
  jobCanonicalSha256: string;
  jobFileSha256: string;
  scheduledTaskName: string;
}

export interface RemoteMatrixPlan {
  schema: typeof REMOTE_MATRIX_PLAN_SCHEMA;
  matrixRunId: string;
  createdAt: string;
  sourceTree: RemoteTrainingJob['sourceTree'];
  tokenizerBindingSha256: string;
  resumeMode: 'if-available';
  files: RemoteMatrixFile[];
  jobs: RemoteMatrixJobRecord[];
}

export interface PrepareRemoteMatrixOptions {
  workspaceRoot: string;
  outputDirectory: string;
  matrixRunId: string;
  sourceBundlePath: string;
  trainingCorpusPath: string;
  selectionPath: string;
  selectionStageReceiptPath: string;
  fingerprintAuditPath: string;
  tokenizerModelPath: string;
  tokenizerRuntimePath: string;
  recipePath?: string;
  remoteJobsDirectory: string;
  remoteOutputDirectory: string;
  remoteStateDirectory: string;
  scheduledTaskPrefix: string;
  deadlineAt: string;
  seed?: number;
  createdAt?: string;
  sourceCommit?: string;
  sourceTree?: string;
}

export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface CommandExecutor {
  run(executable: string, args: readonly string[]): Promise<CommandResult>;
}

export interface UploadRemoteMatrixOptions {
  workspaceRoot: string;
  planPath: string;
  host: string;
  remoteWorkspaceRoot: string;
  remoteGitPath: string;
  transferId: string;
}

export interface SubmitRemoteMatrixOptions {
  planPath: string;
  host: string;
  matrixId: V2FreeTrainingMatrixId;
  remoteWorkspaceRoot: string;
  remoteGitPath: string;
  remoteStateRoot: string;
}

export interface QueryRemoteMatrixStatusOptions {
  planPath: string;
  host: string;
  remoteStateRoot: string;
}

export interface PullRemoteMatrixOptions {
  workspaceRoot: string;
  planPath: string;
  host: string;
  remoteWorkspaceRoot: string;
  remoteStateRoot: string;
  matrixId: V2FreeTrainingMatrixId;
  localOutputDirectory: string;
}

export async function prepareRemoteTrainingMatrix(
  options: PrepareRemoteMatrixOptions,
  executor: CommandExecutor = systemCommandExecutor,
): Promise<{ plan: RemoteMatrixPlan; planPath: string }> {
  const root = await realpath(path.resolve(options.workspaceRoot));
  assertIdentifier(options.matrixRunId, 'matrix run ID');
  if (!/^[a-z0-9][a-z0-9._-]{0,79}$/u.test(options.matrixRunId)) {
    throw new Error('Matrix run ID must satisfy the trainer candidate ID contract.');
  }
  assertIdentifier(options.scheduledTaskPrefix, 'scheduled task prefix');
  requireIsoTimestamp(options.deadlineAt, 'deadline');
  const createdAt = requireIsoTimestamp(
    options.createdAt ?? new Date().toISOString(),
    'creation time',
  );
  const recipePath = options.recipePath ?? 'scripts/autocomplete-v2-free/train_decoder.py';
  const sourceBundle = await fileReference(root, options.sourceBundlePath, 'source-bundle');
  const corpus = await contentReference(
    root,
    options.trainingCorpusPath,
    'matrix-corpus',
    'training-corpus',
  );
  const selection = await contentReference(
    root,
    options.selectionPath,
    'matrix-selection',
    'recipe-config',
  );
  const selectionStageReceipt = await contentReference(
    root,
    options.selectionStageReceiptPath,
    'formal-selection-stage-receipt',
    'selection-stage-receipt',
  );
  const fingerprintAudit = await contentReference(
    root,
    options.fingerprintAuditPath,
    'formal-selection-fingerprint-audit',
    'fingerprint-audit',
  );
  const tokenizerModel = await contentReference(
    root,
    options.tokenizerModelPath,
    'shared-tokenizer-model',
    'tokenizer-seed',
  );
  const tokenizerRuntime = await contentReference(
    root,
    options.tokenizerRuntimePath,
    'shared-tokenizer-runtime',
    'tokenizer-seed',
  );
  await assertRuntimeTokenizer(root, tokenizerRuntime.relativePath);
  const recipe = await fileReference(root, recipePath, 'recipe-config');
  const commit = options.sourceCommit ?? (await gitObject(root, 'HEAD^{commit}', executor));
  const tree = options.sourceTree ?? (await gitObject(root, 'HEAD^{tree}', executor));
  assertGitObject(commit, 'source commit');
  assertGitObject(tree, 'source tree');
  const tokenizerBindingSha256 = computeSharedTokenizerBindingSha256({
    model: tokenizerModel,
    runtime: tokenizerRuntime,
  });
  const sourceTree: RemoteTrainingJob['sourceTree'] = {
    commit,
    tree,
    bundleSha256: sourceBundle.sha256,
  };
  const remoteOutputDirectory = normalizeSafeRelativePath(
    options.remoteOutputDirectory,
    'remote output directory',
  );
  if (
    !remoteOutputDirectory.startsWith('scripts/corpus/_web-cache/autocomplete-v2-free/candidates/')
  ) {
    throw new Error('Remote matrix outputs must remain under the isolated candidate root.');
  }
  const outputRelative = normalizeSafeRelativePath(options.outputDirectory, 'output directory');
  const output = path.resolve(root, outputRelative);
  assertWithin(output, root, 'output directory');
  const parent = path.dirname(output);
  await mkdir(parent, { recursive: true });
  const staging = path.join(parent, `.${path.basename(output)}.${randomUUID()}.tmp`);
  await mkdir(staging, { recursive: false });
  const jobs: RemoteMatrixJobRecord[] = [];
  const files: RemoteMatrixFile[] = [
    matrixFile(sourceBundle, options.sourceBundlePath, 'source-bundle'),
    matrixFile(corpus, corpus.relativePath, 'training-corpus'),
    matrixFile(selection, selection.relativePath, 'recipe-config'),
    matrixFile(
      selectionStageReceipt,
      selectionStageReceipt.relativePath,
      'selection-stage-receipt',
    ),
    matrixFile(fingerprintAudit, fingerprintAudit.relativePath, 'fingerprint-audit'),
    matrixFile(recipe, recipe.relativePath, 'recipe'),
    matrixFile(tokenizerModel, tokenizerModel.relativePath, 'tokenizer-model'),
    matrixFile(tokenizerRuntime, tokenizerRuntime.relativePath, 'tokenizer-runtime'),
  ];
  try {
    for (const matrix of MATRIX) {
      const candidateId = `${options.matrixRunId}-${matrix.id}`;
      assertIdentifier(candidateId, 'candidate ID');
      if (candidateId.length > 92) throw new Error('Candidate ID exceeds the trainer limit.');
      const jobId = candidateId;
      const jobRemoteRelativePath = joinRepositoryPath(
        options.remoteJobsDirectory,
        `${jobId}.json`,
      );
      const matrixOutputRoot = joinRepositoryPath(remoteOutputDirectory, matrix.id);
      const bundleName = jobId;
      const outputDirectory = joinRepositoryPath(matrixOutputRoot, bundleName);
      const checkpointDirectory = joinRepositoryPath(
        matrixOutputRoot,
        `.${candidateId}.checkpoints`,
      );
      const job = parseRemoteTrainingJob({
        schema: REMOTE_TRAINING_JOB_SCHEMA,
        jobId,
        sourceTree,
        recipe: {
          id: 'decoder-train-v1',
          relativePath: recipe.relativePath,
          sha256: recipe.sha256,
          arguments: [
            '--workspace-root',
            '.',
            '--selection',
            selection.relativePath,
            '--matrix-id',
            matrix.id,
            '--candidate-id',
            candidateId,
            '--output-dir',
            outputDirectory,
            '--device',
            'cuda',
            '--seed',
            String(options.seed ?? 20_260_805),
            '--epochs',
            '3',
            '--threads',
            '8',
            '--tokenizer-model',
            tokenizerModel.relativePath,
            '--tokenizer-runtime',
            tokenizerRuntime.relativePath,
            '--selection-stage-receipt',
            selectionStageReceipt.relativePath,
            '--fingerprint-audit',
            fingerprintAudit.relativePath,
          ],
        },
        selection: {
          matrixId: matrix.id,
          parameterCount: matrix.parameterCount,
          quantization: 'q4',
          candidateMatrixIds: [...matrix.candidates],
        },
        tokenizer: {
          kind: 'unigram',
          vocabularySize: 8_000,
          byteFallback: true,
          modelInputId: tokenizerModel.id,
          runtimeInputId: tokenizerRuntime.id,
          bindingSha256: tokenizerBindingSha256,
        },
        model: {
          engine: 'public-v2-free-decoder-v1',
          candidateId,
          format: 'JLFDQ02',
        },
        seed: options.seed ?? 20_260_805,
        inputs: [
          corpus,
          selection,
          selectionStageReceipt,
          fingerprintAudit,
          tokenizerModel,
          tokenizerRuntime,
        ],
        resume: { mode: 'if-available', checkpointDirectory },
        output: {
          rootDirectory: matrixOutputRoot,
          bundleName,
          statusPath: joinRepositoryPath(options.remoteStateDirectory, jobId, 'status.json'),
          heartbeatPath: joinRepositoryPath(options.remoteStateDirectory, jobId, 'heartbeat.json'),
        },
        deadlineAt: options.deadlineAt,
      });
      const jobFileName = `${jobId}.json`;
      const jobLocalRelativePath = joinRepositoryPath(outputRelative, jobFileName);
      const jobBytes = Buffer.from(`${JSON.stringify(job, null, 2)}\n`, 'utf8');
      await writeExclusive(path.join(staging, jobFileName), jobBytes);
      const jobFileSha256 = sha256(jobBytes);
      jobs.push({
        matrixId: matrix.id,
        candidateId,
        jobLocalRelativePath,
        jobRemoteRelativePath,
        jobCanonicalSha256: computeRemoteTrainingJobSha256(job),
        jobFileSha256,
        scheduledTaskName: `${options.scheduledTaskPrefix}-${matrix.id}`,
      });
      files.push({
        role: 'job',
        localRelativePath: jobLocalRelativePath,
        remoteRelativePath: jobRemoteRelativePath,
        bytes: jobBytes.byteLength,
        sha256: jobFileSha256,
      });
    }
    const plan: RemoteMatrixPlan = {
      schema: REMOTE_MATRIX_PLAN_SCHEMA,
      matrixRunId: options.matrixRunId,
      createdAt,
      sourceTree,
      tokenizerBindingSha256,
      resumeMode: 'if-available',
      files,
      jobs,
    };
    await writeExclusive(
      path.join(staging, 'matrix-plan.json'),
      Buffer.from(`${JSON.stringify(plan, null, 2)}\n`, 'utf8'),
    );
    await rename(staging, output);
    return { plan, planPath: joinRepositoryPath(outputRelative, 'matrix-plan.json') };
  } catch (error) {
    await rm(staging, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

export async function uploadRemoteTrainingMatrix(
  options: UploadRemoteMatrixOptions,
  executor: CommandExecutor = systemCommandExecutor,
): Promise<{ uploaded: number; alreadyPresent: number }> {
  assertHost(options.host);
  assertIdentifier(options.transferId, 'transfer ID');
  const root = await realpath(path.resolve(options.workspaceRoot));
  const {
    plan,
    bytes: planBytes,
    relativePath: planRelativePath,
  } = await loadPlan(root, options.planPath);
  const planFile: RemoteMatrixFile = {
    role: 'plan',
    localRelativePath: planRelativePath,
    remoteRelativePath: joinRepositoryPath(
      path.posix.dirname(plan.jobs[0]!.jobRemoteRelativePath),
      'matrix-plan.json',
    ),
    bytes: planBytes.byteLength,
    sha256: sha256(planBytes),
  };
  const allFiles = [...plan.files, planFile];
  const sourceBundle = requireMatrixFile(plan.files, 'source-bundle');
  const corpusBundle = requireMatrixFile(plan.files, 'training-corpus');
  const selection = requireMatrixFile(plan.files, 'recipe-config');
  const stageReceipt = requireMatrixFile(plan.files, 'selection-stage-receipt');
  const fingerprintAudit = requireMatrixFile(plan.files, 'fingerprint-audit');
  const remoteStagingRoot = `${options.remoteWorkspaceRoot}.install-${options.transferId}.tmp`;
  const remoteIngressRoot = `${options.remoteWorkspaceRoot}.ingress-${options.transferId}.tmp`;
  const installReceipt = remoteWindowsPath(
    options.remoteWorkspaceRoot,
    '.jotluck-matrix-install.json',
  );
  const installPreflight = await requireSuccess(
    runRemotePowerShell(
      executor,
      options.host,
      [
        `$final=${powerShellLiteral(options.remoteWorkspaceRoot)}`,
        `$receipt=${powerShellLiteral(installReceipt)}`,
        `$staging=${powerShellLiteral(remoteStagingRoot)}`,
        `$ingress=${powerShellLiteral(remoteIngressRoot)}`,
        `if ([IO.Directory]::Exists($final)) {`,
        `  if (-not [IO.File]::Exists($receipt)) { throw 'Final workspace exists without an install receipt.' }`,
        `  $value=[IO.File]::ReadAllText($receipt,[Text.UTF8Encoding]::new($false)) | ConvertFrom-Json`,
        `  if ($value.sourceArchiveSha256 -eq '${sourceBundle.sha256}' -and $value.corpusArchiveSha256 -eq '${corpusBundle.sha256}' -and $value.selectionSha256 -eq '${selection.sha256}' -and $value.stageReceiptSha256 -eq '${stageReceipt.sha256}' -and $value.fingerprintAuditSha256 -eq '${fingerprintAudit.sha256}' -and $value.planSha256 -eq '${planFile.sha256}' -and $value.sourceCommit -eq '${plan.sourceTree.commit}' -and $value.sourceTree -eq '${plan.sourceTree.tree}') { 'already-installed'; exit 0 }`,
        `  throw 'Final workspace belongs to a different matrix identity.'`,
        `}`,
        `if ([IO.Directory]::Exists($staging) -or [IO.Directory]::Exists($ingress)) { throw 'Transfer staging already exists; use a new transfer ID.' }`,
        `[IO.Directory]::CreateDirectory($ingress) | Out-Null`,
        `'install-required'`,
      ].join('\n'),
    ),
    'matrix workspace preflight',
  );
  if (installPreflight.stdout.trim().endsWith('already-installed')) {
    return { uploaded: 0, alreadyPresent: allFiles.length };
  }

  const sourceArchiveRemote = `${remoteIngressRoot}\\${path.win32.basename(sourceBundle.remoteRelativePath)}`;
  const corpusArchiveRemote = `${remoteIngressRoot}\\${path.win32.basename(corpusBundle.remoteRelativePath)}`;
  await uploadVerifiedRemoteFile(
    executor,
    options.host,
    await resolveWorkspaceFile(root, sourceBundle.localRelativePath),
    sourceArchiveRemote,
    sourceBundle,
    options.transferId,
  );
  await uploadVerifiedRemoteFile(
    executor,
    options.host,
    await resolveWorkspaceFile(root, corpusBundle.localRelativePath),
    corpusArchiveRemote,
    corpusBundle,
    options.transferId,
  );
  const installerLocal = await resolveWorkspaceFile(
    root,
    'scripts/autocomplete-v2-free/remote/Install-MatrixWorkspace.ps1',
  );
  const installerBytes = await readFile(installerLocal);
  const installerReference = {
    bytes: installerBytes.byteLength,
    sha256: sha256(installerBytes),
  };
  const installerRemote = `${remoteIngressRoot}\\Install-MatrixWorkspace.ps1`;
  await uploadVerifiedRemoteFile(
    executor,
    options.host,
    installerLocal,
    installerRemote,
    installerReference,
    options.transferId,
  );
  await runRemoteInstaller(executor, options.host, installerRemote, 'Extract', {
    stagingRoot: remoteStagingRoot,
    finalWorkspaceRoot: options.remoteWorkspaceRoot,
    sourceArchive: sourceArchiveRemote,
    sourceSha256: sourceBundle.sha256,
    corpusArchive: corpusArchiveRemote,
    corpusSha256: corpusBundle.sha256,
    selectionPath: selection.remoteRelativePath,
    selectionSha256: selection.sha256,
    planPath: planFile.remoteRelativePath,
    planSha256: planFile.sha256,
    stageReceiptPath: stageReceipt.remoteRelativePath,
    stageReceiptSha256: stageReceipt.sha256,
    fingerprintAuditPath: fingerprintAudit.remoteRelativePath,
    fingerprintAuditSha256: fingerprintAudit.sha256,
    sourceCommit: plan.sourceTree.commit,
    sourceTree: plan.sourceTree.tree,
    gitPath: options.remoteGitPath,
  });

  let uploaded = 2;
  let alreadyPresent = 0;
  for (const file of allFiles.filter(
    (item) => item.role !== 'source-bundle' && item.role !== 'training-corpus',
  )) {
    const local = await resolveWorkspaceFile(root, file.localRelativePath);
    await assertFileIdentity(local, file.bytes, file.sha256);
    const uploadStatus = await uploadVerifiedRemoteFile(
      executor,
      options.host,
      local,
      remoteWindowsPath(remoteStagingRoot, file.remoteRelativePath),
      file,
      options.transferId,
    );
    if (uploadStatus === 'already-present') {
      alreadyPresent++;
    } else uploaded++;
  }
  await runRemoteInstaller(executor, options.host, installerRemote, 'Finalize', {
    stagingRoot: remoteStagingRoot,
    finalWorkspaceRoot: options.remoteWorkspaceRoot,
    sourceArchive: sourceArchiveRemote,
    sourceSha256: sourceBundle.sha256,
    corpusArchive: corpusArchiveRemote,
    corpusSha256: corpusBundle.sha256,
    selectionPath: selection.remoteRelativePath,
    selectionSha256: selection.sha256,
    planPath: planFile.remoteRelativePath,
    planSha256: planFile.sha256,
    stageReceiptPath: stageReceipt.remoteRelativePath,
    stageReceiptSha256: stageReceipt.sha256,
    fingerprintAuditPath: fingerprintAudit.remoteRelativePath,
    fingerprintAuditSha256: fingerprintAudit.sha256,
    sourceCommit: plan.sourceTree.commit,
    sourceTree: plan.sourceTree.tree,
    gitPath: options.remoteGitPath,
  });
  return { uploaded, alreadyPresent };
}

export async function submitRemoteTrainingMatrixJob(
  options: SubmitRemoteMatrixOptions,
  executor: CommandExecutor = systemCommandExecutor,
): Promise<'submitted' | 'already-completed'> {
  assertHost(options.host);
  const resolvedPlanPath = await realpath(path.resolve(options.planPath));
  const planBytes = await readFile(resolvedPlanPath);
  const plan = parseRemoteMatrixPlan(JSON.parse(planBytes.toString('utf8')));
  const job = requireJob(plan, options.matrixId);
  const trainingJob = await readJobFromPlan(plan, job, options.planPath);
  const statusPath = remoteWindowsPath(options.remoteStateRoot, trainingJob.output.statusPath);
  const result = await runRemotePowerShell(
    executor,
    options.host,
    [
      `$workspace=${powerShellLiteral(options.remoteWorkspaceRoot)}`,
      `$installReceipt=[IO.Path]::Combine($workspace,'.jotluck-matrix-install.json')`,
      `if (-not [IO.File]::Exists($installReceipt)) { throw 'Verified matrix workspace is not installed.' }`,
      `$installation=[IO.File]::ReadAllText($installReceipt,[Text.UTF8Encoding]::new($false)) | ConvertFrom-Json`,
      `if ($installation.planSha256 -ne '${sha256(planBytes)}' -or $installation.sourceCommit -ne '${plan.sourceTree.commit}' -or $installation.sourceTree -ne '${plan.sourceTree.tree}') { throw 'Installed matrix workspace identity mismatch.' }`,
      `$actualCommit=(& ${powerShellLiteral(options.remoteGitPath)} -C $workspace rev-parse 'HEAD^{commit}').Trim()`,
      `if ($LASTEXITCODE -ne 0 -or $actualCommit -ne '${plan.sourceTree.commit}') { throw 'Installed source commit mismatch.' }`,
      `$actualTree=(& ${powerShellLiteral(options.remoteGitPath)} -C $workspace rev-parse 'HEAD^{tree}').Trim()`,
      `if ($LASTEXITCODE -ne 0 -or $actualTree -ne '${plan.sourceTree.tree}') { throw 'Installed source tree mismatch.' }`,
      `$statusPath=${powerShellLiteral(statusPath)}`,
      `if ([IO.File]::Exists($statusPath)) {`,
      `  $status=[IO.File]::ReadAllText($statusPath,[Text.UTF8Encoding]::new($false)) | ConvertFrom-Json`,
      `  if ($status.jobId -ne '${trainingJob.jobId}' -or $status.jobFileSha256 -ne '${job.jobFileSha256}') { throw 'Existing status identity mismatch.' }`,
      `  if ($status.status -eq 'completed') { 'already-completed'; exit 0 }`,
      `}`,
      `$taskName=${powerShellLiteral(job.scheduledTaskName)}`,
      `$task=Get-ScheduledTask -TaskName $taskName -ErrorAction Stop`,
      `$action=@($task.Actions)[0]`,
      `if ($null -eq $action -or [string]$action.Arguments -notlike ('*' + ${powerShellLiteral(options.remoteWorkspaceRoot)} + '*') -or [string]$action.Arguments -notlike ('*' + ${powerShellLiteral(job.jobRemoteRelativePath.replaceAll('/', '\\'))} + '*') -or [string]$action.Arguments -notlike '*${job.jobFileSha256}*') { throw 'Scheduled task is not bound to the prepared workspace and job identity.' }`,
      `if ($task.State -eq 'Running') { throw 'Training task is already running.' }`,
      `Start-ScheduledTask -TaskName $taskName`,
      `'submitted'`,
    ].join('\n'),
  );
  await requireSuccess(Promise.resolve(result), `submit ${options.matrixId}`);
  return result.stdout.trim().endsWith('already-completed') ? 'already-completed' : 'submitted';
}

export async function queryRemoteTrainingMatrixStatus(
  options: QueryRemoteMatrixStatusOptions,
  executor: CommandExecutor = systemCommandExecutor,
): Promise<Readonly<Record<V2FreeTrainingMatrixId, TrainingResult | null>>> {
  assertHost(options.host);
  const plan = await loadPlanWithoutWorkspace(options.planPath);
  const output = {} as Record<V2FreeTrainingMatrixId, TrainingResult | null>;
  for (const jobRecord of plan.jobs) {
    const job = await readJobFromPlan(plan, jobRecord, options.planPath);
    const statusPath = remoteWindowsPath(options.remoteStateRoot, job.output.statusPath);
    const result = await runRemotePowerShell(
      executor,
      options.host,
      [
        `$path=${powerShellLiteral(statusPath)}`,
        `if (-not [IO.File]::Exists($path)) { 'null'; exit 0 }`,
        `[IO.File]::ReadAllText($path,[Text.UTF8Encoding]::new($false))`,
      ].join('\n'),
    );
    await requireSuccess(Promise.resolve(result), `status ${jobRecord.matrixId}`);
    const raw = result.stdout.trim();
    if (raw === 'null') {
      output[jobRecord.matrixId] = null;
      continue;
    }
    const parsed = parseTrainingResult(JSON.parse(raw));
    if (parsed.jobId !== job.jobId || parsed.jobFileSha256 !== jobRecord.jobFileSha256) {
      throw new Error(`Remote status identity mismatch: ${jobRecord.matrixId}.`);
    }
    output[jobRecord.matrixId] = parsed;
  }
  return output;
}

export async function pullRemoteTrainingMatrixBundle(
  options: PullRemoteMatrixOptions,
  executor: CommandExecutor = systemCommandExecutor,
): Promise<{ status: 'pulled' | 'already-present'; bundleSha256: string; directory: string }> {
  assertHost(options.host);
  const root = await realpath(path.resolve(options.workspaceRoot));
  const planPath = await resolveWorkspaceFile(root, options.planPath);
  const plan = parseRemoteMatrixPlan(JSON.parse(await readFile(planPath, 'utf8')));
  const jobRecord = requireJob(plan, options.matrixId);
  const jobBytes = await readFile(await resolveWorkspaceFile(root, jobRecord.jobLocalRelativePath));
  const job = verifyPreparedJob(plan, jobRecord, jobBytes);
  const statusPath = remoteWindowsPath(options.remoteStateRoot, job.output.statusPath);
  const statusResult = await runRemotePowerShell(
    executor,
    options.host,
    [
      `$path=${powerShellLiteral(statusPath)}`,
      `if (-not [IO.File]::Exists($path)) { throw 'Remote status file is missing.' }`,
      `[IO.File]::ReadAllText($path,[Text.UTF8Encoding]::new($false))`,
    ].join('\n'),
  );
  await requireSuccess(Promise.resolve(statusResult), `read completed status ${options.matrixId}`);
  const status = parseTrainingResult(JSON.parse(statusResult.stdout.trim()));
  if (
    status.status !== 'completed' ||
    status.jobId !== job.jobId ||
    status.jobFileSha256 !== jobRecord.jobFileSha256 ||
    !status.outputBundle
  ) {
    throw new Error(`Remote job is not completed with the prepared identity: ${options.matrixId}.`);
  }
  const localOutputRelative = normalizeSafeRelativePath(
    options.localOutputDirectory,
    'local output directory',
  );
  const localOutputRoot = path.resolve(root, localOutputRelative);
  assertWithin(localOutputRoot, root, 'local output directory');
  await mkdir(localOutputRoot, { recursive: true });
  const final = path.join(localOutputRoot, job.output.bundleName);
  if (await exists(final)) {
    const existing = await verifyLocalBundle(
      final,
      status.outputBundle.sha256,
      job.jobId,
      jobRecord.jobFileSha256,
    );
    return { status: 'already-present', bundleSha256: existing.bundleSha256, directory: final };
  }
  const temporary = path.join(
    localOutputRoot,
    `.${job.output.bundleName}.${randomUUID()}.pull.tmp`,
  );
  const remoteBundle = remoteWindowsPath(
    options.remoteWorkspaceRoot,
    path.posix.dirname(status.outputBundle.manifestPath),
  ).replaceAll('\\', '/');
  try {
    await requireSuccess(
      executor.run('scp.exe', ['-r', `${options.host}:${remoteBundle}`, temporary]),
      `pull ${options.matrixId}`,
    );
    const verified = await verifyLocalBundle(
      temporary,
      status.outputBundle.sha256,
      job.jobId,
      jobRecord.jobFileSha256,
    );
    await rename(temporary, final);
    return { status: 'pulled', bundleSha256: verified.bundleSha256, directory: final };
  } catch (error) {
    await rm(temporary, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

export function parseRemoteMatrixPlan(value: unknown): RemoteMatrixPlan {
  if (!isRecord(value) || value.schema !== REMOTE_MATRIX_PLAN_SCHEMA) {
    throw new Error('Invalid remote matrix plan schema.');
  }
  assertIdentifier(value.matrixRunId, 'matrix run ID');
  const createdAt = requireIsoTimestamp(value.createdAt, 'creation time');
  const sourceTree = value.sourceTree;
  if (!isRecord(sourceTree)) throw new Error('Invalid matrix source tree.');
  assertGitObject(sourceTree.commit, 'source commit');
  assertGitObject(sourceTree.tree, 'source tree');
  assertSha256(sourceTree.bundleSha256, 'source bundle SHA-256');
  assertSha256(value.tokenizerBindingSha256, 'tokenizer binding SHA-256');
  if (
    value.resumeMode !== 'if-available' ||
    !Array.isArray(value.files) ||
    !Array.isArray(value.jobs)
  ) {
    throw new Error('Invalid matrix plan lifecycle.');
  }
  const files = value.files.map(parseMatrixFile);
  if (new Set(files.map((file) => file.remoteRelativePath)).size !== files.length) {
    throw new Error('Matrix plan has duplicate remote file paths.');
  }
  const jobs = value.jobs.map(parseMatrixJob);
  if (
    jobs.length !== MATRIX.length ||
    MATRIX.some((matrix) => jobs.filter((job) => job.matrixId === matrix.id).length !== 1)
  ) {
    throw new Error('Matrix plan must contain exactly one job for each trainable architecture.');
  }
  return {
    schema: REMOTE_MATRIX_PLAN_SCHEMA,
    matrixRunId: value.matrixRunId,
    createdAt,
    sourceTree: {
      commit: sourceTree.commit as string,
      tree: sourceTree.tree as string,
      bundleSha256: sourceTree.bundleSha256 as string,
    },
    tokenizerBindingSha256: value.tokenizerBindingSha256 as string,
    resumeMode: 'if-available',
    files,
    jobs,
  };
}

const systemCommandExecutor: CommandExecutor = {
  run(executable, args) {
    return new Promise((resolve, reject) => {
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
  },
};

async function loadPlan(
  root: string,
  value: string,
): Promise<{ plan: RemoteMatrixPlan; bytes: Buffer; relativePath: string }> {
  const relativePath = normalizeSafeRelativePath(value, 'matrix plan path');
  const resolved = await resolveWorkspaceFile(root, relativePath);
  const bytes = await readFile(resolved);
  return { plan: parseRemoteMatrixPlan(JSON.parse(bytes.toString('utf8'))), bytes, relativePath };
}

async function loadPlanWithoutWorkspace(value: string): Promise<RemoteMatrixPlan> {
  const resolved = await realpath(path.resolve(value));
  return parseRemoteMatrixPlan(JSON.parse(await readFile(resolved, 'utf8')));
}

async function readJobFromPlan(
  plan: RemoteMatrixPlan,
  record: RemoteMatrixJobRecord,
  planPath: string,
): Promise<RemoteTrainingJob> {
  const planDirectory = path.dirname(await realpath(path.resolve(planPath)));
  const jobPath = path.resolve(planDirectory, path.basename(record.jobLocalRelativePath));
  const bytes = await readFile(jobPath);
  return verifyPreparedJob(plan, record, bytes);
}

function verifyPreparedJob(
  plan: RemoteMatrixPlan,
  record: RemoteMatrixJobRecord,
  bytes: Uint8Array,
): RemoteTrainingJob {
  if (sha256(bytes) !== record.jobFileSha256) {
    throw new Error(`Prepared job file drifted: ${record.matrixId}.`);
  }
  const job = parseRemoteTrainingJob(JSON.parse(Buffer.from(bytes).toString('utf8')));
  if (
    computeRemoteTrainingJobSha256(job) !== record.jobCanonicalSha256 ||
    job.selection.matrixId !== record.matrixId ||
    job.model.candidateId !== record.candidateId ||
    job.tokenizer.bindingSha256 !== plan.tokenizerBindingSha256
  ) {
    throw new Error(`Prepared job identity does not match its matrix plan: ${record.matrixId}.`);
  }
  return job;
}

function requireJob(
  plan: RemoteMatrixPlan,
  matrixId: V2FreeTrainingMatrixId,
): RemoteMatrixJobRecord {
  const job = plan.jobs.find((item) => item.matrixId === matrixId);
  if (!job) throw new Error(`Matrix job is missing: ${matrixId}.`);
  return job;
}

async function verifyLocalBundle(
  directory: string,
  expectedBundleSha256: string,
  expectedJobId: string,
  expectedJobFileSha256: string,
): Promise<{ bundleSha256: string }> {
  const root = await realpath(directory);
  const manifestBytes = await readFile(path.join(root, 'manifest.json'));
  const manifest = parseRemoteBundleManifest(JSON.parse(manifestBytes.toString('utf8')));
  if (
    manifest.bundleSha256 !== expectedBundleSha256 ||
    manifest.jobId !== expectedJobId ||
    manifest.sourceJobSha256 !== expectedJobFileSha256
  ) {
    throw new Error('Pulled bundle identity does not match the completed job.');
  }
  const expectedPaths = new Set(['manifest.json']);
  for (const file of manifest.files) {
    expectedPaths.add(file.relativePath);
    const target = await resolveBundleFile(root, file.relativePath);
    await assertFileIdentity(target, file.bytes, file.sha256);
  }
  const actual = await listRelativeFiles(root);
  const unexpected = actual.filter((item) => !expectedPaths.has(item));
  if (unexpected.length > 0)
    throw new Error(`Pulled bundle contains unexpected files: ${unexpected.join(', ')}.`);
  return { bundleSha256: manifest.bundleSha256 };
}

async function listRelativeFiles(root: string, current = root): Promise<string[]> {
  const output: string[] = [];
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const target = path.join(current, entry.name);
    if (entry.isSymbolicLink()) throw new Error('Pulled bundle contains a symbolic link.');
    if (entry.isDirectory()) output.push(...(await listRelativeFiles(root, target)));
    else if (entry.isFile()) output.push(path.relative(root, target).replaceAll('\\', '/'));
    else throw new Error('Pulled bundle contains an unsupported filesystem entry.');
  }
  return output;
}

async function resolveBundleFile(root: string, relativePath: string): Promise<string> {
  const normalized = normalizeSafeRelativePath(relativePath, 'bundle file path');
  const target = await realpath(path.join(root, normalized));
  assertWithin(target, root, 'bundle file');
  return target;
}

async function runRemotePowerShell(
  executor: CommandExecutor,
  host: string,
  source: string,
): Promise<CommandResult> {
  const script = `$ErrorActionPreference='Stop'\n$ProgressPreference='SilentlyContinue'\n${source}`;
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  return executor.run('ssh.exe', [
    host,
    'powershell.exe',
    '-NoProfile',
    '-NonInteractive',
    '-EncodedCommand',
    encoded,
  ]);
}

function requireMatrixFile(
  files: readonly RemoteMatrixFile[],
  role: MatrixFileRole,
): RemoteMatrixFile {
  const matches = files.filter((file) => file.role === role);
  if (matches.length !== 1) throw new Error(`Matrix plan must bind exactly one ${role} file.`);
  return matches[0]!;
}

async function uploadVerifiedRemoteFile(
  executor: CommandExecutor,
  host: string,
  localPath: string,
  remoteFinal: string,
  identity: Pick<RemoteMatrixFile, 'bytes' | 'sha256'>,
  transferId: string,
): Promise<'uploaded' | 'already-present'> {
  await assertFileIdentity(localPath, identity.bytes, identity.sha256);
  const remoteTemporary = `${remoteFinal}.upload-${transferId}.tmp`;
  const preflight = await requireSuccess(
    runRemotePowerShell(
      executor,
      host,
      [
        `$final=${powerShellLiteral(remoteFinal)}`,
        `if ([IO.File]::Exists($final)) {`,
        `  $item=Get-Item -LiteralPath $final`,
        `  $hash=(Get-FileHash -LiteralPath $final -Algorithm SHA256).Hash.ToLowerInvariant()`,
        `  if ($item.Length -eq ${identity.bytes} -and $hash -eq '${identity.sha256}') { 'already-present'; exit 0 }`,
        `  throw 'Remote final file exists with a different identity.'`,
        `}`,
        `$parent=[IO.Path]::GetDirectoryName($final)`,
        `if (-not [IO.Directory]::Exists($parent)) { [IO.Directory]::CreateDirectory($parent) | Out-Null }`,
        `'upload-required'`,
      ].join('\n'),
    ),
    `preflight ${remoteFinal}`,
  );
  if (preflight.stdout.trim().endsWith('already-present')) return 'already-present';
  await requireSuccess(
    executor.run('scp.exe', [localPath, `${host}:${remoteTemporary.replaceAll('\\', '/')}`]),
    `upload ${remoteFinal}`,
  );
  await requireSuccess(
    runRemotePowerShell(
      executor,
      host,
      [
        `$temporary=${powerShellLiteral(remoteTemporary)}`,
        `$final=${powerShellLiteral(remoteFinal)}`,
        `if (-not [IO.File]::Exists($temporary)) { throw 'Uploaded temporary file is missing.' }`,
        `$item=Get-Item -LiteralPath $temporary`,
        `$hash=(Get-FileHash -LiteralPath $temporary -Algorithm SHA256).Hash.ToLowerInvariant()`,
        `if ($item.Length -ne ${identity.bytes} -or $hash -ne '${identity.sha256}') { throw 'Uploaded temporary file identity mismatch.' }`,
        `if ([IO.File]::Exists($final)) { throw 'Remote final file appeared during upload.' }`,
        `[IO.File]::Move($temporary,$final)`,
        `'uploaded'`,
      ].join('\n'),
    ),
    `finalize ${remoteFinal}`,
  );
  return 'uploaded';
}

interface RemoteInstallerIdentity {
  stagingRoot: string;
  finalWorkspaceRoot: string;
  sourceArchive: string;
  sourceSha256: string;
  corpusArchive: string;
  corpusSha256: string;
  selectionPath: string;
  selectionSha256: string;
  planPath: string;
  planSha256: string;
  stageReceiptPath: string;
  stageReceiptSha256: string;
  fingerprintAuditPath: string;
  fingerprintAuditSha256: string;
  sourceCommit: string;
  sourceTree: string;
  gitPath: string;
}

async function runRemoteInstaller(
  executor: CommandExecutor,
  host: string,
  installerPath: string,
  phase: 'Extract' | 'Finalize',
  identity: RemoteInstallerIdentity,
): Promise<void> {
  const result = await runRemotePowerShell(
    executor,
    host,
    [
      `& ${powerShellLiteral(installerPath)} -Phase '${phase}'`,
      `  -StagingRoot ${powerShellLiteral(identity.stagingRoot)}`,
      `  -FinalWorkspaceRoot ${powerShellLiteral(identity.finalWorkspaceRoot)}`,
      `  -SourceArchive ${powerShellLiteral(identity.sourceArchive)}`,
      `  -ExpectedSourceArchiveSha256 '${identity.sourceSha256}'`,
      `  -CorpusArchive ${powerShellLiteral(identity.corpusArchive)}`,
      `  -ExpectedCorpusArchiveSha256 '${identity.corpusSha256}'`,
      `  -SelectionRelativePath ${powerShellLiteral(identity.selectionPath)}`,
      `  -ExpectedSelectionSha256 '${identity.selectionSha256}'`,
      `  -PlanRelativePath ${powerShellLiteral(identity.planPath)}`,
      `  -ExpectedPlanSha256 '${identity.planSha256}'`,
      `  -StageReceiptRelativePath ${powerShellLiteral(identity.stageReceiptPath)}`,
      `  -ExpectedStageReceiptSha256 '${identity.stageReceiptSha256}'`,
      `  -FingerprintAuditRelativePath ${powerShellLiteral(identity.fingerprintAuditPath)}`,
      `  -ExpectedFingerprintAuditSha256 '${identity.fingerprintAuditSha256}'`,
      `  -ExpectedCommit '${identity.sourceCommit}'`,
      `  -ExpectedTree '${identity.sourceTree}'`,
      `  -GitPath ${powerShellLiteral(identity.gitPath)}`,
    ].join(' `\n'),
  );
  await requireSuccess(Promise.resolve(result), `${phase.toLowerCase()} remote matrix workspace`);
}

async function requireSuccess(
  resultPromise: Promise<CommandResult>,
  label: string,
): Promise<CommandResult> {
  const result = await resultPromise;
  if (result.exitCode !== 0) {
    throw new Error(
      `${label} failed (${result.exitCode}): ${result.stderr.trim() || result.stdout.trim()}`,
    );
  }
  return result;
}

async function gitObject(
  root: string,
  revision: string,
  executor: CommandExecutor,
): Promise<string> {
  const result = await requireSuccess(
    executor.run('git.exe', ['-C', root, 'rev-parse', revision]),
    `git ${revision}`,
  );
  return result.stdout.trim();
}

async function contentReference(
  root: string,
  value: string,
  id: string,
  role: RemoteContentReference['role'],
): Promise<RemoteContentReference> {
  const file = await fileReference(root, value, role);
  return { id, role, relativePath: file.relativePath, bytes: file.bytes, sha256: file.sha256 };
}

async function fileReference(
  root: string,
  value: string,
  _label: string,
): Promise<{ relativePath: string; bytes: number; sha256: string }> {
  const relativePath = normalizeSafeRelativePath(value, 'input file path');
  const resolved = await resolveWorkspaceFile(root, relativePath);
  const info = await stat(resolved);
  if (!info.isFile() || info.size < 1)
    throw new Error(`Input is not a non-empty file: ${relativePath}.`);
  return { relativePath, bytes: info.size, sha256: sha256(await readFile(resolved)) };
}

function matrixFile(
  reference: Pick<RemoteContentReference, 'relativePath' | 'bytes' | 'sha256'>,
  remoteRelativePath: string,
  role: MatrixFileRole,
): RemoteMatrixFile {
  return {
    role,
    localRelativePath: reference.relativePath,
    remoteRelativePath: normalizeSafeRelativePath(remoteRelativePath, 'remote file path'),
    bytes: reference.bytes,
    sha256: reference.sha256,
  };
}

async function assertRuntimeTokenizer(root: string, relativePath: string): Promise<void> {
  const value = JSON.parse(
    await readFile(await resolveWorkspaceFile(root, relativePath), 'utf8'),
  ) as Record<string, unknown>;
  if (
    value.schema !== 'jotluck.autocomplete.unigram-runtime.v1' ||
    value.vocabularySize !== 8_000
  ) {
    throw new Error('Shared tokenizer runtime is not the fixed 8K Unigram asset.');
  }
}

function parseMatrixFile(value: unknown): RemoteMatrixFile {
  if (!isRecord(value)) throw new Error('Invalid matrix file record.');
  const roles: MatrixFileRole[] = [
    'source-bundle',
    'training-corpus',
    'recipe-config',
    'recipe',
    'selection-stage-receipt',
    'fingerprint-audit',
    'tokenizer-model',
    'tokenizer-runtime',
    'job',
    'plan',
  ];
  if (!roles.includes(value.role as MatrixFileRole)) throw new Error('Invalid matrix file role.');
  const localRelativePath = normalizeSafeRelativePath(
    value.localRelativePath,
    'local matrix file path',
  );
  const remoteRelativePath = normalizeSafeRelativePath(
    value.remoteRelativePath,
    'remote matrix file path',
  );
  if (!Number.isSafeInteger(value.bytes) || (value.bytes as number) < 1)
    throw new Error('Invalid matrix file bytes.');
  assertSha256(value.sha256, 'matrix file SHA-256');
  return {
    role: value.role as MatrixFileRole,
    localRelativePath,
    remoteRelativePath,
    bytes: value.bytes as number,
    sha256: value.sha256 as string,
  };
}

function parseMatrixJob(value: unknown): RemoteMatrixJobRecord {
  if (!isRecord(value) || !MATRIX.some((matrix) => matrix.id === value.matrixId)) {
    throw new Error('Invalid matrix job record.');
  }
  assertIdentifier(value.candidateId, 'candidate ID');
  const jobLocalRelativePath = normalizeSafeRelativePath(
    value.jobLocalRelativePath,
    'local job path',
  );
  const jobRemoteRelativePath = normalizeSafeRelativePath(
    value.jobRemoteRelativePath,
    'remote job path',
  );
  assertSha256(value.jobCanonicalSha256, 'canonical job SHA-256');
  assertSha256(value.jobFileSha256, 'job file SHA-256');
  assertIdentifier(value.scheduledTaskName, 'scheduled task name');
  return {
    matrixId: value.matrixId as V2FreeTrainingMatrixId,
    candidateId: value.candidateId as string,
    jobLocalRelativePath,
    jobRemoteRelativePath,
    jobCanonicalSha256: value.jobCanonicalSha256 as string,
    jobFileSha256: value.jobFileSha256 as string,
    scheduledTaskName: value.scheduledTaskName as string,
  };
}

async function resolveWorkspaceFile(root: string, value: string): Promise<string> {
  const target = await realpath(
    path.join(root, normalizeSafeRelativePath(value, 'workspace file')),
  );
  assertWithin(target, root, 'workspace file');
  return target;
}

async function assertFileIdentity(
  target: string,
  bytes: number,
  expectedSha256: string,
): Promise<void> {
  const info = await stat(target);
  if (!info.isFile() || info.size !== bytes || sha256(await readFile(target)) !== expectedSha256) {
    throw new Error(`File identity mismatch: ${target}.`);
  }
}

async function writeExclusive(target: string, bytes: Uint8Array): Promise<void> {
  const handle = await open(target, 'wx');
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function normalizeSafeRelativePath(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`Invalid ${label}.`);
  const normalized = value.replaceAll('\\', '/');
  if (!isSafeRelativePath(normalized)) throw new Error(`Invalid ${label}.`);
  return normalized;
}

function joinRepositoryPath(...parts: string[]): string {
  return normalizeSafeRelativePath(
    path.posix.join(...parts.map((part) => part.replaceAll('\\', '/'))),
    'repository path',
  );
}

function remoteWindowsPath(root: string, relativePath: string): string {
  if (!/^[A-Za-z]:[\\/]/u.test(root))
    throw new Error('Remote workspace root must be an absolute Windows path.');
  return `${root.replace(/[\\/]+$/u, '')}\\${normalizeSafeRelativePath(relativePath, 'remote path').replaceAll('/', '\\')}`;
}

function powerShellLiteral(value: string): string {
  if (value.includes('\0')) throw new Error('PowerShell literal contains NUL.');
  return `'${value.replaceAll("'", "''")}'`;
}

function assertWithin(target: string, root: string, label: string): void {
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative))
    throw new Error(`${label} escaped the workspace.`);
}

function assertHost(value: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(value))
    throw new Error('Invalid SSH host alias.');
}

function assertIdentifier(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(value))
    throw new Error(`Invalid ${label}.`);
}

function assertGitObject(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(value))
    throw new Error(`Invalid ${label}.`);
}

function assertSha256(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value))
    throw new Error(`Invalid ${label}.`);
}

function requireIsoTimestamp(value: unknown, label: string): string {
  if (typeof value !== 'string' || new Date(value).toISOString() !== value)
    throw new Error(`Invalid ${label}.`);
  return value;
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function exists(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}
