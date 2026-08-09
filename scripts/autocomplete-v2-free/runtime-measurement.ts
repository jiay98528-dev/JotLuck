import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createHash } from 'node:crypto';
import { open, readFile, realpath, stat } from 'node:fs/promises';
import * as path from 'node:path';
import { performance } from 'node:perf_hooks';

import { V2_FREE_ENGINE_ID, type V2FreeSha256 } from './contract';
import { computeV2FreeEvaluatorTreeSha256 } from './evaluation-manifest';

const MEASUREMENT_SCHEMA = 'jotluck.autocomplete.v2-free-runtime-measurement.v1';
const PROTOCOL_VERSION = 1;
const MAX_FRAME_BYTES = 128 * 1024;
const WARMUP_REQUESTS = 10;
const MEASURED_REQUESTS = 100;

interface CandidateIdentity {
  engine: typeof V2_FREE_ENGINE_ID;
  candidateId: string;
  candidateArtifactSha256: V2FreeSha256;
}

interface WorkerReady {
  protocolVersion: number;
  engineId: string;
  candidateId: string;
  workerPid: number;
  manifestBytes: number;
  modelBytes: number;
  tokenizerBytes: number;
  runtimeStaticDeltaBytes: number;
  peakMemoryLimitBytes: number;
}

export interface RuntimeMeasurementSession {
  ready: WorkerReady;
  generate(requestId: number, request: unknown): Promise<void>;
  close(): Promise<void>;
}

export interface RuntimeMemorySampler {
  stop(): Promise<number[]>;
}

export interface RuntimeMeasurementDependencies {
  openSession(workerPath: string, manifestPath: string): Promise<RuntimeMeasurementSession>;
  startMemorySampler(processId: number): Promise<RuntimeMemorySampler>;
  now(): number;
  wallNow(): number;
  platform: NodeJS.Platform;
}

export interface MeasureV2FreeRuntimeOptions {
  workspaceRoot: string;
  workerExecutablePath: string;
  runtimeBaselineExecutablePath?: string;
  candidateManifestPath: string;
  outputPath: string;
  createdAt?: string;
}

export interface V2FreeRuntimeMeasurementArtifact {
  schema: typeof MEASUREMENT_SCHEMA;
  schemaVersion: 1;
  engine: typeof V2_FREE_ENGINE_ID;
  candidateId: string;
  candidateArtifactSha256: V2FreeSha256;
  workerExecutableSha256: V2FreeSha256;
  evaluatorTreeSha256: V2FreeSha256;
  runtimeStaticDeltaBytes: number;
  peakMemoryBytes: number;
  modelP90Ms: number;
  modelInferenceSamplesMs: number[];
  peakMemorySamplesBytes: number[];
  measurement: {
    createdAt: string;
    warmupRequests: 10;
    measuredRequests: 100;
    workerExecutableBytes: number;
    runtimeBaselineExecutableBytes: number;
    runtimeBaselineExecutableSha256: V2FreeSha256;
    runtimeStaticAccounting: 'worker-minus-baseline' | 'full-worker-conservative';
    memorySampleIntervalMs: 5;
    memoryAccounting: 'isolated-worker-absolute-working-set';
    memoryBaselineBytes: 0;
  };
}

export async function measureV2FreeRuntime(
  options: MeasureV2FreeRuntimeOptions,
  dependencies: RuntimeMeasurementDependencies = systemDependencies,
): Promise<{ artifact: V2FreeRuntimeMeasurementArtifact; outputPath: string; sha256: string }> {
  if (dependencies.platform !== 'win32') {
    throw new Error('V2 runtime measurement must run on the Windows worker host.');
  }
  const root = await realpath(path.resolve(options.workspaceRoot));
  const manifestPath = await resolveWorkspaceFile(root, options.candidateManifestPath);
  const workerPath = await resolveWorkspaceFile(root, options.workerExecutablePath);
  const outputPath = resolveWorkspaceOutput(root, options.outputPath);
  const candidate = parseCandidateIdentity(await readFile(manifestPath));
  const workerBytes = await readFile(workerPath);
  const baselineBytes = options.runtimeBaselineExecutablePath
    ? await readFile(await resolveWorkspaceFile(root, options.runtimeBaselineExecutablePath))
    : Buffer.alloc(0);
  const runtimeStaticDeltaBytes = workerBytes.byteLength - baselineBytes.byteLength;
  if (runtimeStaticDeltaBytes <= 0) {
    throw new Error('Worker executable must be larger than the bound runtime baseline.');
  }
  const evaluatorTreeSha256 = await computeV2FreeEvaluatorTreeSha256(root);
  const session = await dependencies.openSession(workerPath, manifestPath);
  assertReady(session.ready, candidate);
  const sampler = await dependencies.startMemorySampler(session.ready.workerPid);
  const modelInferenceSamplesMs: number[] = [];
  let peakMemorySamplesBytes: number[] = [];
  try {
    for (let index = 0; index < WARMUP_REQUESTS + MEASURED_REQUESTS; index++) {
      const requestId = index + 1;
      const request = measurementRequest(requestId, index, dependencies.wallNow() + 5_000);
      const started = dependencies.now();
      await session.generate(requestId, request);
      const elapsedMs = dependencies.now() - started;
      if (index >= WARMUP_REQUESTS) {
        if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) {
          throw new Error('Worker returned a non-positive inference duration.');
        }
        modelInferenceSamplesMs.push(elapsedMs);
      }
    }
  } finally {
    peakMemorySamplesBytes = await sampler.stop().catch(() => []);
    await session.close().catch(() => {});
  }
  if (modelInferenceSamplesMs.length !== MEASURED_REQUESTS) {
    throw new Error('Runtime measurement did not complete exactly 100 measured requests.');
  }
  if (
    peakMemorySamplesBytes.length === 0 ||
    peakMemorySamplesBytes.some((value) => !Number.isSafeInteger(value) || value <= 0)
  ) {
    throw new Error('Windows worker memory sampler returned no valid working-set observations.');
  }
  const artifact: V2FreeRuntimeMeasurementArtifact = {
    schema: MEASUREMENT_SCHEMA,
    schemaVersion: 1,
    engine: V2_FREE_ENGINE_ID,
    candidateId: candidate.candidateId,
    candidateArtifactSha256: candidate.candidateArtifactSha256,
    workerExecutableSha256: sha256(workerBytes),
    evaluatorTreeSha256,
    runtimeStaticDeltaBytes,
    peakMemoryBytes: Math.max(...peakMemorySamplesBytes),
    modelP90Ms: percentile90(modelInferenceSamplesMs),
    modelInferenceSamplesMs,
    peakMemorySamplesBytes,
    measurement: {
      createdAt: requireIsoTimestamp(options.createdAt ?? new Date().toISOString()),
      warmupRequests: WARMUP_REQUESTS,
      measuredRequests: MEASURED_REQUESTS,
      workerExecutableBytes: workerBytes.byteLength,
      runtimeBaselineExecutableBytes: baselineBytes.byteLength,
      runtimeBaselineExecutableSha256: sha256(baselineBytes),
      runtimeStaticAccounting: options.runtimeBaselineExecutablePath
        ? 'worker-minus-baseline'
        : 'full-worker-conservative',
      memorySampleIntervalMs: 5,
      memoryAccounting: 'isolated-worker-absolute-working-set',
      memoryBaselineBytes: 0,
    },
  };
  const outputBytes = Buffer.from(`${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
  await writeExclusive(outputPath, outputBytes);
  return { artifact, outputPath: relativePosix(root, outputPath), sha256: sha256(outputBytes) };
}

function measurementRequest(requestId: number, index: number, deadlineAt: number): unknown {
  const chinese = index % 2 === 0;
  const currentParagraph = chinese
    ? '在离线笔记里，清晰的上下文能够帮助我们继续写下'
    : 'A small local-first writing tool should help the author continue';
  const previousParagraphTail = chinese
    ? '所有内容都保存在本地纯文本文件中。'
    : 'Every note remains an ordinary text file on disk.';
  return {
    engineEpoch: 1,
    workspaceScope: 'runtime-measurement',
    documentVersion: `measurement:${requestId}`,
    cursorPos: currentParagraph.length,
    contextTail: currentParagraph,
    contextTailUtf8Bytes: Buffer.byteLength(currentParagraph, 'utf8'),
    contextCapsule: {
      schemaVersion: 1,
      maxTokens: 256,
      languageHint: chinese ? 'zh' : 'en',
      headingTrail: chinese ? ['写作'] : ['Writing'],
      currentParagraph,
      previousParagraphTail,
      retrievalSnippet: '',
    },
    languageHint: chinese ? 'zh' : 'en',
    blockType: 'paragraph',
    cursorBoundary: 'word',
    maxCandidates: 32,
    deadlineAt,
  };
}

function assertReady(ready: WorkerReady, candidate: CandidateIdentity): void {
  if (
    ready.protocolVersion !== PROTOCOL_VERSION ||
    ready.engineId !== V2_FREE_ENGINE_ID ||
    ready.candidateId !== candidate.candidateId ||
    !Number.isSafeInteger(ready.workerPid) ||
    ready.workerPid <= 0 ||
    !Number.isSafeInteger(ready.manifestBytes) ||
    ready.manifestBytes <= 0 ||
    !Number.isSafeInteger(ready.modelBytes) ||
    ready.modelBytes <= 0 ||
    !Number.isSafeInteger(ready.tokenizerBytes) ||
    ready.tokenizerBytes <= 0 ||
    !Number.isSafeInteger(ready.peakMemoryLimitBytes) ||
    ready.peakMemoryLimitBytes <= 0
  ) {
    throw new Error('Completion worker ready identity is invalid for runtime measurement.');
  }
}

const systemDependencies: RuntimeMeasurementDependencies = {
  platform: process.platform,
  now: () => performance.now(),
  wallNow: () => Date.now(),
  openSession: openSystemSession,
  startMemorySampler: startWindowsMemorySampler,
};

async function openSystemSession(
  workerPath: string,
  manifestPath: string,
): Promise<RuntimeMeasurementSession> {
  const worker = spawn(workerPath, ['--jotluck-completion-worker', manifestPath], {
    env: { ...process.env, JOTLUCK_AUTOCOMPLETE_EVALUATION: '1' },
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const reader = new FrameReader(worker);
  const readyFrame = await withTimeout(reader.readFrame(), 10_000, 'completion worker ready');
  if (readyFrame.requestId !== 0 || readyFrame.event.type !== 'ready') {
    await closeWorker(worker).catch(() => {});
    throw new Error('Completion worker did not return a ready frame.');
  }
  return {
    ready: readyFrame.event,
    async generate(requestId, request) {
      writeFrame(worker, {
        protocolVersion: PROTOCOL_VERSION,
        requestId,
        command: { type: 'generate', request },
      });
      const frame = await withTimeout(reader.readFrame(), 5_250, `runtime request ${requestId}`);
      if (frame.event.type === 'error') {
        throw new Error(`Completion worker ${frame.event.code}: ${frame.event.message}`);
      }
      if (
        frame.protocolVersion !== PROTOCOL_VERSION ||
        frame.requestId !== requestId ||
        frame.event.type !== 'generated' ||
        frame.event.requestId !== requestId
      ) {
        throw new Error(`Completion worker response identity mismatch: ${requestId}.`);
      }
    },
    close: () => closeWorker(worker),
  };
}

async function startWindowsMemorySampler(processId: number): Promise<RuntimeMemorySampler> {
  const script = [
    "$ErrorActionPreference='Stop'",
    `$processId=${processId}`,
    'while ($true) {',
    '  try {',
    '    $process=Get-Process -Id $processId -ErrorAction Stop',
    '    $process.Refresh()',
    '    [Console]::Out.WriteLine([string][int64]$process.WorkingSet64)',
    '    [Console]::Out.Flush()',
    '    Start-Sleep -Milliseconds 5',
    '  } catch { break }',
    '}',
  ].join('\n');
  const executable = process.env.PWSH_EXE || 'pwsh.exe';
  const child = spawn(
    executable,
    [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-EncodedCommand',
      Buffer.from(script, 'utf16le').toString('base64'),
    ],
    { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true },
  );
  const samples: number[] = [];
  let pending = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    pending += chunk;
    const lines = pending.split(/\r?\n/u);
    pending = lines.pop() ?? '';
    for (const line of lines) {
      const value = Number(line.trim());
      if (Number.isSafeInteger(value) && value > 0) samples.push(value);
    }
  });
  await withTimeout(waitForFirstSample(samples, child), 5_000, 'Windows memory sampler');
  return {
    async stop() {
      if (pending.trim()) {
        const value = Number(pending.trim());
        if (Number.isSafeInteger(value) && value > 0) samples.push(value);
      }
      child.kill();
      await withTimeout(
        new Promise<void>((resolve) => child.once('exit', () => resolve())),
        1_000,
        'Windows memory sampler shutdown',
      ).catch(() => child.kill());
      return samples;
    },
  };
}

async function waitForFirstSample(
  samples: readonly number[],
  child: ChildProcessWithoutNullStreams,
): Promise<void> {
  while (samples.length === 0) {
    if (child.exitCode !== null) throw new Error('Windows memory sampler exited before sampling.');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

interface WorkerFrame {
  protocolVersion: number;
  requestId: number;
  event:
    | ({ type: 'ready' } & WorkerReady)
    | { type: 'generated'; requestId: number; response: unknown }
    | { type: 'error'; code: string; message: string };
}

class FrameReader {
  private buffer = Buffer.alloc(0);
  private endedError: Error | null = null;
  private readonly waiters = new Set<() => void>();

  constructor(worker: ChildProcessWithoutNullStreams) {
    worker.stdout.on('data', (chunk: Buffer) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      this.notify();
    });
    worker.stdout.on('end', () => {
      this.endedError = new Error('Completion worker closed stdout.');
      this.notify();
    });
    worker.on('error', (error) => {
      this.endedError = error;
      this.notify();
    });
    worker.on('exit', (code, signal) => {
      this.endedError ??= new Error(
        `Completion worker exited (${String(code)}/${String(signal)}).`,
      );
      this.notify();
    });
  }

  async readFrame(): Promise<WorkerFrame> {
    while (true) {
      if (this.buffer.byteLength >= 4) {
        const length = this.buffer.readUInt32LE(0);
        if (length < 1 || length > MAX_FRAME_BYTES) {
          throw new Error('Completion worker returned an invalid frame length.');
        }
        if (this.buffer.byteLength >= length + 4) {
          const body = this.buffer.subarray(4, length + 4);
          this.buffer = this.buffer.subarray(length + 4);
          return JSON.parse(body.toString('utf8')) as WorkerFrame;
        }
      }
      if (this.endedError) throw this.endedError;
      await new Promise<void>((resolve) => this.waiters.add(resolve));
    }
  }

  private notify(): void {
    for (const waiter of this.waiters) waiter();
    this.waiters.clear();
  }
}

function writeFrame(worker: ChildProcessWithoutNullStreams, value: unknown): void {
  const body = Buffer.from(JSON.stringify(value), 'utf8');
  if (body.byteLength < 1 || body.byteLength > MAX_FRAME_BYTES) {
    throw new Error('Completion runtime measurement request exceeds its frame limit.');
  }
  const header = Buffer.allocUnsafe(4);
  header.writeUInt32LE(body.byteLength, 0);
  worker.stdin.write(Buffer.concat([header, body]));
}

async function closeWorker(worker: ChildProcessWithoutNullStreams): Promise<void> {
  if (worker.exitCode !== null) return;
  writeFrame(worker, {
    protocolVersion: PROTOCOL_VERSION,
    requestId: 0,
    command: { type: 'shutdown' },
  });
  worker.stdin.end();
  await withTimeout(
    new Promise<void>((resolve) => worker.once('exit', () => resolve())),
    1_000,
    'completion worker shutdown',
  ).catch(() => worker.kill());
}

function parseCandidateIdentity(bytes: Buffer): CandidateIdentity {
  const value = JSON.parse(bytes.toString('utf8')) as Partial<CandidateIdentity>;
  if (
    value.engine !== V2_FREE_ENGINE_ID ||
    typeof value.candidateId !== 'string' ||
    !/^[a-z0-9][a-z0-9._-]{0,95}$/u.test(value.candidateId) ||
    !isSha256(value.candidateArtifactSha256)
  ) {
    throw new Error('Candidate manifest identity is invalid.');
  }
  return value as CandidateIdentity;
}

async function resolveWorkspaceFile(root: string, value: string): Promise<string> {
  if (!value || path.isAbsolute(value))
    throw new Error('Measurement input paths must be relative.');
  const resolved = await realpath(path.join(root, value));
  if (!isWithin(resolved, root) || !(await stat(resolved)).isFile()) {
    throw new Error('Measurement input escaped the workspace or is not a file.');
  }
  return resolved;
}

function resolveWorkspaceOutput(root: string, value: string): string {
  if (!value || path.isAbsolute(value))
    throw new Error('Measurement output path must be relative.');
  const resolved = path.resolve(root, value);
  if (!isWithin(resolved, root)) throw new Error('Measurement output escaped the workspace.');
  return resolved;
}

function isWithin(target: string, root: string): boolean {
  const relative = path.relative(root, target);
  return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function relativePosix(root: string, target: string): string {
  return path.relative(root, target).replaceAll('\\', '/');
}

function percentile90(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.9) - 1)] ?? 0;
}

function requireIsoTimestamp(value: string): string {
  if (new Date(value).toISOString() !== value) throw new Error('Measurement timestamp is invalid.');
  return value;
}

function isSha256(value: unknown): value is V2FreeSha256 {
  return typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
}

function sha256(bytes: Uint8Array): V2FreeSha256 {
  return createHash('sha256').update(bytes).digest('hex') as V2FreeSha256;
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

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out.`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
