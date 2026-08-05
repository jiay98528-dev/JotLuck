import { createHash } from 'node:crypto';

export const REMOTE_TRAINING_JOB_SCHEMA =
  'jotluck.autocomplete.v2-free.remote-training-job.v1' as const;
export const TRAINING_RESULT_SCHEMA =
  'jotluck.autocomplete.v2-free.remote-training-result.v1' as const;
export const REMOTE_BUNDLE_SCHEMA = 'jotluck.autocomplete.v2-free.remote-bundle.v1' as const;
export const REMOTE_TRAINING_STATUSES = [
  'queued',
  'running',
  'checkpointed',
  'completed',
  'failed',
] as const;

export type RemoteTrainingStatus = (typeof REMOTE_TRAINING_STATUSES)[number];
export type V2FreeMatrixId = '16m-q4' | '24m-q4' | '32m-q4' | '16m-q8';
export type V2FreeTrainingMatrixId = Exclude<V2FreeMatrixId, '16m-q8'>;

export interface RemoteContentReference {
  id: string;
  role: 'training-corpus' | 'validation' | 'tokenizer-seed' | 'recipe-config';
  relativePath: string;
  bytes: number;
  sha256: string;
}

export interface RemoteTrainingJob {
  schema: typeof REMOTE_TRAINING_JOB_SCHEMA;
  jobId: string;
  sourceTree: {
    commit: string;
    tree: string;
    bundleSha256: string;
  };
  recipe: {
    id: string;
    relativePath: string;
    sha256: string;
    arguments: string[];
  };
  selection: {
    matrixId: V2FreeTrainingMatrixId;
    parameterCount: 16_000_000 | 24_000_000 | 32_000_000;
    quantization: 'q4';
    candidateMatrixIds: V2FreeMatrixId[];
  };
  model: {
    engine: 'public-v2-free-decoder-v1';
    candidateId: string;
    format: 'JLFDQ02';
  };
  seed: number;
  inputs: RemoteContentReference[];
  resume: {
    mode: 'never' | 'if-available' | 'required';
    checkpointDirectory: string;
    checkpointBundleSha256?: string;
  };
  output: {
    rootDirectory: string;
    bundleName: string;
    statusPath: string;
    heartbeatPath: string;
  };
  deadlineAt: string;
}

export interface RemoteCheckpointRecord {
  relativePath: string;
  step: number;
  score: number;
  bytes: number;
  sha256: string;
  createdAt: string;
}

export interface RemoteBundleReference {
  manifestPath: string;
  bytes: number;
  sha256: string;
}

export interface TrainingResult {
  schema: typeof TRAINING_RESULT_SCHEMA;
  jobId: string;
  jobFileSha256: string;
  status: RemoteTrainingStatus;
  createdAt: string;
  heartbeatAt: string;
  startedAt?: string;
  finishedAt?: string;
  latestCheckpoint?: RemoteCheckpointRecord;
  outputBundle?: RemoteBundleReference;
  failure?: {
    code: string;
    message: string;
    retryable: boolean;
  };
}

export interface RemoteBundleFile {
  relativePath: string;
  role: 'model' | 'tokenizer' | 'checkpoint' | 'log' | 'evidence' | 'metadata';
  bytes: number;
  sha256: string;
}

export interface RemoteBundleManifest {
  schema: typeof REMOTE_BUNDLE_SCHEMA;
  jobId: string;
  sourceJobSha256: string;
  createdAt: string;
  files: RemoteBundleFile[];
  totalBytes: number;
  bundleSha256: string;
}

export function parseRemoteTrainingJob(value: unknown): RemoteTrainingJob {
  const root = requireRecord(value, 'remote training job');
  requireExactKeys(root, [
    'schema',
    'jobId',
    'sourceTree',
    'recipe',
    'selection',
    'model',
    'seed',
    'inputs',
    'resume',
    'output',
    'deadlineAt',
  ]);
  if (root.schema !== REMOTE_TRAINING_JOB_SCHEMA) fail('job schema');
  const jobId = requireIdentifier(root.jobId, 'jobId');

  const sourceTree = requireRecord(root.sourceTree, 'sourceTree');
  requireExactKeys(sourceTree, ['commit', 'tree', 'bundleSha256']);
  const commit = requireGitObjectId(sourceTree.commit, 'sourceTree.commit');
  const tree = requireGitObjectId(sourceTree.tree, 'sourceTree.tree');
  const sourceBundleSha256 = requireSha256(sourceTree.bundleSha256, 'sourceTree.bundleSha256');

  const recipe = requireRecord(root.recipe, 'recipe');
  requireExactKeys(recipe, ['id', 'relativePath', 'sha256', 'arguments']);
  const recipeArguments = requireStringArray(recipe.arguments, 'recipe.arguments');
  if (recipeArguments.some((argument) => argument.includes('\0'))) fail('recipe.arguments');

  const selection = parseSelection(root.selection);
  const model = requireRecord(root.model, 'model');
  requireExactKeys(model, ['engine', 'candidateId', 'format']);
  if (model.engine !== 'public-v2-free-decoder-v1' || model.format !== 'JLFDQ02') {
    fail('model');
  }

  const seed = requireSafeInteger(root.seed, 'seed', 0, 0xffff_ffff);
  if (!Array.isArray(root.inputs) || root.inputs.length === 0) fail('inputs');
  const inputs = root.inputs.map((input, index) => parseContentReference(input, index));
  if (new Set(inputs.map((input) => input.id)).size !== inputs.length) fail('inputs.id');
  if (new Set(inputs.map((input) => input.relativePath)).size !== inputs.length) {
    fail('inputs.relativePath');
  }

  const resume = requireRecord(root.resume, 'resume');
  const resumeKeys = ['mode', 'checkpointDirectory'];
  if (resume.checkpointBundleSha256 !== undefined) resumeKeys.push('checkpointBundleSha256');
  requireExactKeys(resume, resumeKeys);
  if (!['never', 'if-available', 'required'].includes(String(resume.mode))) fail('resume.mode');
  const checkpointBundleSha256 =
    resume.checkpointBundleSha256 === undefined
      ? undefined
      : requireSha256(resume.checkpointBundleSha256, 'resume.checkpointBundleSha256');
  if (resume.mode === 'required' && !checkpointBundleSha256) {
    fail('resume.checkpointBundleSha256');
  }
  if (resume.mode === 'never' && checkpointBundleSha256) fail('resume');

  const output = requireRecord(root.output, 'output');
  requireExactKeys(output, ['rootDirectory', 'bundleName', 'statusPath', 'heartbeatPath']);
  const bundleName = requireIdentifier(output.bundleName, 'output.bundleName');
  const statusPath = requireSafeRelativePath(output.statusPath, 'output.statusPath');
  const heartbeatPath = requireSafeRelativePath(output.heartbeatPath, 'output.heartbeatPath');
  if (statusPath === heartbeatPath) fail('output state paths');

  return {
    schema: REMOTE_TRAINING_JOB_SCHEMA,
    jobId,
    sourceTree: { commit, tree, bundleSha256: sourceBundleSha256 },
    recipe: {
      id: requireIdentifier(recipe.id, 'recipe.id'),
      relativePath: requireSafeRelativePath(recipe.relativePath, 'recipe.relativePath'),
      sha256: requireSha256(recipe.sha256, 'recipe.sha256'),
      arguments: recipeArguments,
    },
    selection,
    model: {
      engine: 'public-v2-free-decoder-v1',
      candidateId: requireIdentifier(model.candidateId, 'model.candidateId'),
      format: 'JLFDQ02',
    },
    seed,
    inputs,
    resume: {
      mode: resume.mode as RemoteTrainingJob['resume']['mode'],
      checkpointDirectory: requireSafeRelativePath(
        resume.checkpointDirectory,
        'resume.checkpointDirectory',
      ),
      ...(checkpointBundleSha256 ? { checkpointBundleSha256 } : {}),
    },
    output: {
      rootDirectory: requireSafeRelativePath(output.rootDirectory, 'output.rootDirectory'),
      bundleName,
      statusPath,
      heartbeatPath,
    },
    deadlineAt: requireIsoTimestamp(root.deadlineAt, 'deadlineAt'),
  };
}

export function parseTrainingResult(value: unknown): TrainingResult {
  const root = requireRecord(value, 'training result');
  const optionalKeys = ['startedAt', 'finishedAt', 'latestCheckpoint', 'outputBundle', 'failure'];
  requireExactKeys(root, [
    'schema',
    'jobId',
    'jobFileSha256',
    'status',
    'createdAt',
    'heartbeatAt',
    ...optionalKeys.filter((key) => root[key] !== undefined),
  ]);
  if (root.schema !== TRAINING_RESULT_SCHEMA) fail('result schema');
  if (!REMOTE_TRAINING_STATUSES.includes(root.status as RemoteTrainingStatus)) {
    fail('result status');
  }
  const status = root.status as RemoteTrainingStatus;
  const startedAt = optionalTimestamp(root.startedAt, 'startedAt');
  const finishedAt = optionalTimestamp(root.finishedAt, 'finishedAt');
  const latestCheckpoint =
    root.latestCheckpoint === undefined
      ? undefined
      : parseCheckpoint(root.latestCheckpoint, 'latestCheckpoint');
  const outputBundle =
    root.outputBundle === undefined ? undefined : parseBundleReference(root.outputBundle);
  const failure = root.failure === undefined ? undefined : parseFailure(root.failure);
  if (
    status === 'queued' &&
    (startedAt || finishedAt || latestCheckpoint || outputBundle || failure)
  ) {
    fail('queued result state');
  }
  if (['running', 'checkpointed', 'completed', 'failed'].includes(status) && !startedAt) {
    fail('startedAt');
  }
  if (status === 'checkpointed' && !latestCheckpoint) fail('latestCheckpoint');
  if (status === 'completed' && (!finishedAt || !outputBundle || failure)) {
    fail('completed result state');
  }
  if (status === 'failed' && (!finishedAt || !failure || outputBundle)) {
    fail('failed result state');
  }
  if (
    (status === 'running' || status === 'checkpointed') &&
    (finishedAt || outputBundle || failure)
  ) {
    fail('active result state');
  }
  return {
    schema: TRAINING_RESULT_SCHEMA,
    jobId: requireIdentifier(root.jobId, 'jobId'),
    jobFileSha256: requireSha256(root.jobFileSha256, 'jobFileSha256'),
    status,
    createdAt: requireIsoTimestamp(root.createdAt, 'createdAt'),
    heartbeatAt: requireIsoTimestamp(root.heartbeatAt, 'heartbeatAt'),
    ...(startedAt ? { startedAt } : {}),
    ...(finishedAt ? { finishedAt } : {}),
    ...(latestCheckpoint ? { latestCheckpoint } : {}),
    ...(outputBundle ? { outputBundle } : {}),
    ...(failure ? { failure } : {}),
  };
}

export function createRemoteBundleManifest(
  input: Omit<RemoteBundleManifest, 'files' | 'totalBytes' | 'bundleSha256'> & {
    files: readonly RemoteBundleFile[];
  },
): RemoteBundleManifest {
  const files = input.files.map((file, index) => parseBundleFile(file, `files[${index}]`));
  files.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  if (files.length === 0 || new Set(files.map((file) => file.relativePath)).size !== files.length) {
    fail('bundle files');
  }
  const base = {
    schema: REMOTE_BUNDLE_SCHEMA,
    jobId: requireIdentifier(input.jobId, 'jobId'),
    sourceJobSha256: requireSha256(input.sourceJobSha256, 'sourceJobSha256'),
    createdAt: requireIsoTimestamp(input.createdAt, 'createdAt'),
    files,
    totalBytes: files.reduce((total, file) => total + file.bytes, 0),
  };
  return { ...base, bundleSha256: sha256Canonical(base) };
}

export function parseRemoteBundleManifest(value: unknown): RemoteBundleManifest {
  const root = requireRecord(value, 'remote bundle manifest');
  requireExactKeys(root, [
    'schema',
    'jobId',
    'sourceJobSha256',
    'createdAt',
    'files',
    'totalBytes',
    'bundleSha256',
  ]);
  if (root.schema !== REMOTE_BUNDLE_SCHEMA || !Array.isArray(root.files)) fail('bundle schema');
  const expected = createRemoteBundleManifest({
    schema: REMOTE_BUNDLE_SCHEMA,
    jobId: requireIdentifier(root.jobId, 'jobId'),
    sourceJobSha256: requireSha256(root.sourceJobSha256, 'sourceJobSha256'),
    createdAt: requireIsoTimestamp(root.createdAt, 'createdAt'),
    files: root.files as RemoteBundleFile[],
  });
  if (root.totalBytes !== expected.totalBytes || root.bundleSha256 !== expected.bundleSha256) {
    fail('bundle identity');
  }
  return expected;
}

export function computeRemoteTrainingJobSha256(job: RemoteTrainingJob): string {
  return sha256Canonical(parseRemoteTrainingJob(job));
}

export function isSafeRelativePath(value: string): boolean {
  if (!value || value.includes('\0') || value.includes('\\') || value.startsWith('/')) return false;
  if (/^[A-Za-z]:/u.test(value)) return false;
  const parts = value.split('/');
  return parts.every((part) => part !== '' && part !== '.' && part !== '..');
}

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(',')}}`;
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined) fail('canonical JSON');
  return encoded;
}

function parseSelection(value: unknown): RemoteTrainingJob['selection'] {
  const selection = requireRecord(value, 'selection');
  requireExactKeys(selection, ['matrixId', 'parameterCount', 'quantization', 'candidateMatrixIds']);
  const allowed: Record<
    V2FreeTrainingMatrixId,
    readonly [number, 'q4', readonly V2FreeMatrixId[]]
  > = {
    '16m-q4': [16_000_000, 'q4', ['16m-q4', '16m-q8']],
    '24m-q4': [24_000_000, 'q4', ['24m-q4']],
    '32m-q4': [32_000_000, 'q4', ['32m-q4']],
  };
  if (typeof selection.matrixId !== 'string' || !(selection.matrixId in allowed)) {
    fail('selection.matrixId');
  }
  const matrixId = selection.matrixId as V2FreeTrainingMatrixId;
  const expected = allowed[matrixId];
  if (
    selection.parameterCount !== expected[0] ||
    selection.quantization !== expected[1] ||
    !Array.isArray(selection.candidateMatrixIds) ||
    selection.candidateMatrixIds.length !== expected[2].length ||
    selection.candidateMatrixIds.some((value, index) => value !== expected[2][index])
  ) {
    fail('selection matrix');
  }
  return {
    matrixId,
    parameterCount: expected[0] as RemoteTrainingJob['selection']['parameterCount'],
    quantization: expected[1],
    candidateMatrixIds: [...expected[2]],
  };
}

function parseContentReference(value: unknown, index: number): RemoteContentReference {
  const item = requireRecord(value, `inputs[${index}]`);
  requireExactKeys(item, ['id', 'role', 'relativePath', 'bytes', 'sha256']);
  const roles: RemoteContentReference['role'][] = [
    'training-corpus',
    'validation',
    'tokenizer-seed',
    'recipe-config',
  ];
  if (!roles.includes(item.role as RemoteContentReference['role'])) fail(`inputs[${index}].role`);
  return {
    id: requireIdentifier(item.id, `inputs[${index}].id`),
    role: item.role as RemoteContentReference['role'],
    relativePath: requireSafeRelativePath(item.relativePath, `inputs[${index}].relativePath`),
    bytes: requireSafeInteger(item.bytes, `inputs[${index}].bytes`, 1),
    sha256: requireSha256(item.sha256, `inputs[${index}].sha256`),
  };
}

function parseCheckpoint(value: unknown, label: string): RemoteCheckpointRecord {
  const item = requireRecord(value, label);
  requireExactKeys(item, ['relativePath', 'step', 'score', 'bytes', 'sha256', 'createdAt']);
  if (typeof item.score !== 'number' || !Number.isFinite(item.score)) fail(`${label}.score`);
  return {
    relativePath: requireSafeRelativePath(item.relativePath, `${label}.relativePath`),
    step: requireSafeInteger(item.step, `${label}.step`, 0),
    score: item.score,
    bytes: requireSafeInteger(item.bytes, `${label}.bytes`, 1),
    sha256: requireSha256(item.sha256, `${label}.sha256`),
    createdAt: requireIsoTimestamp(item.createdAt, `${label}.createdAt`),
  };
}

function parseBundleReference(value: unknown): RemoteBundleReference {
  const item = requireRecord(value, 'outputBundle');
  requireExactKeys(item, ['manifestPath', 'bytes', 'sha256']);
  return {
    manifestPath: requireSafeRelativePath(item.manifestPath, 'outputBundle.manifestPath'),
    bytes: requireSafeInteger(item.bytes, 'outputBundle.bytes', 1),
    sha256: requireSha256(item.sha256, 'outputBundle.sha256'),
  };
}

function parseFailure(value: unknown): NonNullable<TrainingResult['failure']> {
  const item = requireRecord(value, 'failure');
  requireExactKeys(item, ['code', 'message', 'retryable']);
  if (
    typeof item.message !== 'string' ||
    item.message.length === 0 ||
    item.message.length > 2_000
  ) {
    fail('failure.message');
  }
  if (typeof item.retryable !== 'boolean') fail('failure.retryable');
  return {
    code: requireIdentifier(item.code, 'failure.code'),
    message: item.message,
    retryable: item.retryable,
  };
}

function parseBundleFile(value: unknown, label: string): RemoteBundleFile {
  const item = requireRecord(value, label);
  requireExactKeys(item, ['relativePath', 'role', 'bytes', 'sha256']);
  const roles: RemoteBundleFile['role'][] = [
    'model',
    'tokenizer',
    'checkpoint',
    'log',
    'evidence',
    'metadata',
  ];
  if (!roles.includes(item.role as RemoteBundleFile['role'])) fail(`${label}.role`);
  return {
    relativePath: requireSafeRelativePath(item.relativePath, `${label}.relativePath`),
    role: item.role as RemoteBundleFile['role'],
    bytes: requireSafeInteger(item.bytes, `${label}.bytes`, 1),
    sha256: requireSha256(item.sha256, `${label}.sha256`),
  };
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) fail(label);
  return value;
}

function requireExactKeys(record: Record<string, unknown>, keys: readonly string[]): void {
  const expected = [...keys].sort();
  const actual = Object.keys(record).sort();
  if (expected.length !== actual.length || expected.some((key, index) => key !== actual[index])) {
    fail(`keys(${expected.join(',')})`);
  }
}

function requireIdentifier(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(value)) {
    fail(label);
  }
  return value;
}

function requireSafeRelativePath(value: unknown, label: string): string {
  if (typeof value !== 'string' || !isSafeRelativePath(value)) fail(label);
  return value;
}

function requireSha256(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) fail(label);
  return value;
}

function requireGitObjectId(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(value)) fail(label);
  return value;
}

function requireSafeInteger(
  value: unknown,
  label: string,
  minimum: number,
  maximum = Number.MAX_SAFE_INTEGER,
): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    fail(label);
  }
  return value as number;
}

function requireStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) fail(label);
  return [...value] as string[];
}

function requireIsoTimestamp(value: unknown, label: string): string {
  if (typeof value !== 'string') fail(label);
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) fail(label);
  return value;
}

function optionalTimestamp(value: unknown, label: string): string | undefined {
  return value === undefined ? undefined : requireIsoTimestamp(value, label);
}

function sha256Canonical(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fail(label: string): never {
  throw new Error(`Invalid ${label}.`);
}
