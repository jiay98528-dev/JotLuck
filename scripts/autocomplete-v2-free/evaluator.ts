import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { readFile, realpath } from 'node:fs/promises';
import * as path from 'node:path';

import type { V2FreeSha256 } from './contract';
import {
  computeV2FreeEvaluatorTreeSha256,
  writeV2FreeEvaluationArtifacts,
  type V2FreeEvaluationObservation,
  type V2FreeEvaluationReport,
} from './evaluation-manifest';
import {
  assertV2FreeFinalPairClaim,
  readV2FreeFinalPairClaim,
  type V2FreeFinalPairClaim,
} from './holdout-ledger';
import {
  loadV2FreeHoldoutContent,
  validateV2FreeHoldoutDescriptor,
  type V2FreeHoldoutCheckpoint,
  type V2FreeHoldoutDescriptor,
  type V2FreeHoldoutSupportDocument,
  type V2FreeHoldoutTarget,
  type V2FreeHoldoutValidationPolicy,
} from './holdout-validator';

const PROTOCOL_VERSION = 1;
const MAX_FRAME_BYTES = 128 * 1024;
const ENGINE_ID = 'public-v2-free-decoder-v1';

interface CandidateManifestIdentity {
  engine: typeof ENGINE_ID;
  candidateId: string;
  candidateArtifactSha256: V2FreeSha256;
}

interface WorkerCandidate {
  candidateId: string;
  text: string;
  confidence: number;
  modelScore: number;
  gateScore: number;
  language: 'zh' | 'en';
}

interface WorkerGenerateResponse {
  protocolVersion: number;
  engineEpoch: number;
  workspaceScope: string;
  documentVersion: string;
  cursorPos: number;
  candidates: WorkerCandidate[];
}

interface WorkerFrame {
  protocolVersion: number;
  requestId: number;
  event:
    | { type: 'ready'; engineId: string; candidateId: string }
    | { type: 'generated'; requestId: number; response: WorkerGenerateResponse }
    | { type: 'error'; code: string; message: string };
}

export interface EvaluateV2FreeHoldoutOptions {
  workspaceRoot: string;
  workerExecutablePath: string;
  candidateManifestPath: string;
  descriptor: V2FreeHoldoutDescriptor;
  contentPath: string;
  outputDirectory: string;
  finalClaimPath?: string;
  workerArgumentPrefix?: readonly string[];
  requestDeadlineMs?: number;
  createdAt?: string;
  validationPolicy?: V2FreeHoldoutValidationPolicy;
}

export async function evaluateV2FreeHoldout(options: EvaluateV2FreeHoldoutOptions): Promise<{
  report: V2FreeEvaluationReport;
  observations: readonly V2FreeEvaluationObservation[];
  evaluationManifestSha256: V2FreeSha256;
  outputDirectory: string;
}> {
  const descriptor = validateV2FreeHoldoutDescriptor(options.descriptor, options.validationPolicy);
  const root = await realpath(path.resolve(options.workspaceRoot));
  const manifestPath = await resolveWorkspaceInput(root, options.candidateManifestPath);
  const candidate = parseCandidateManifest(await readFile(manifestPath));
  const evaluatorTreeSha256 = await computeV2FreeEvaluatorTreeSha256(root);
  const final = descriptor.classification.endsWith('-final-v1');
  const claim = final
    ? await requireMatchingFinalClaim({
        workspaceRoot: root,
        claimPath: options.finalClaimPath,
        descriptor,
        candidateArtifactSha256: candidate.candidateArtifactSha256,
        evaluatorTreeSha256,
      })
    : undefined;
  const holdout = await loadV2FreeHoldoutContent({
    workspaceRoot: root,
    descriptor,
    contentPath: options.contentPath,
    allowFinalRead: final,
    ...(options.validationPolicy ? { policy: options.validationPolicy } : {}),
  });
  const executablePath = await resolveExecutable(options.workerExecutablePath);
  const worker = spawnWorker(executablePath, manifestPath, options.workerArgumentPrefix ?? []);
  const reader = new FrameReader(worker);
  const observations: V2FreeEvaluationObservation[] = [];
  try {
    const ready = await withTimeout(reader.readFrame(), 10_000, 'completion worker warmup');
    if (
      ready.requestId !== 0 ||
      ready.protocolVersion !== PROTOCOL_VERSION ||
      ready.event.type !== 'ready' ||
      ready.event.engineId !== ENGINE_ID ||
      ready.event.candidateId !== candidate.candidateId
    ) {
      throw new Error('Completion worker ready identity is invalid.');
    }
    const supportById = new Map(holdout.supportDocuments.map((item) => [item.id, item]));
    let requestId = 0;
    for (const target of holdout.targets) {
      for (const checkpoint of target.checkpoints) {
        requestId++;
        observations.push(
          await evaluateCheckpoint({
            worker,
            reader,
            requestId,
            target,
            checkpoint,
            supportById,
            workspaceScope: descriptor.datasetId,
            deadlineMs: options.requestDeadlineMs ?? 5_000,
          }),
        );
      }
    }
  } finally {
    await shutdownWorker(worker).catch(() => {});
  }

  const reportBase = buildReport({
    descriptor,
    candidate,
    evaluatorTreeSha256,
    observations,
    ...(claim ? { claim } : {}),
  });
  const written = await writeV2FreeEvaluationArtifacts({
    workspaceRoot: root,
    outputDirectory: options.outputDirectory,
    observations,
    report: reportBase,
    workerExecutablePath: executablePath,
    candidateManifestPath: options.candidateManifestPath,
    ...(options.createdAt ? { createdAt: options.createdAt } : {}),
  });
  const report = JSON.parse(
    await readFile(path.join(written.outputDirectory, 'evaluation-report.json'), 'utf8'),
  ) as V2FreeEvaluationReport;
  return {
    report,
    observations,
    evaluationManifestSha256: written.manifest.manifestSha256,
    outputDirectory: written.outputDirectory,
  };
}

async function evaluateCheckpoint(options: {
  worker: ChildProcessWithoutNullStreams;
  reader: FrameReader;
  requestId: number;
  target: V2FreeHoldoutTarget;
  checkpoint: V2FreeHoldoutCheckpoint;
  supportById: ReadonlyMap<string, V2FreeHoldoutSupportDocument>;
  workspaceScope: string;
  deadlineMs: number;
}): Promise<V2FreeEvaluationObservation> {
  const prefix = options.target.text.slice(0, options.checkpoint.cursorOffset);
  const { currentParagraph, previousParagraphTail } = paragraphContext(prefix);
  const retrievalSnippet = selectRetrievalSnippet(
    options.checkpoint,
    options.target,
    options.supportById,
  );
  const deadlineAt = Date.now() + options.deadlineMs;
  const request = {
    protocolVersion: PROTOCOL_VERSION,
    requestId: options.requestId,
    command: {
      type: 'generate',
      request: {
        engineEpoch: 1,
        workspaceScope: options.workspaceScope,
        documentVersion: `holdout:${options.checkpoint.id}`,
        cursorPos: options.checkpoint.cursorOffset,
        contextTail: trimUtf8Tail(prefix, 256),
        contextTailUtf8Bytes: Buffer.byteLength(trimUtf8Tail(prefix, 256), 'utf8'),
        contextCapsule: {
          schemaVersion: 1,
          maxTokens: 256,
          languageHint: options.target.language,
          headingTrail: options.target.headingTrail ?? [],
          currentParagraph,
          previousParagraphTail,
          retrievalSnippet,
        },
        languageHint: options.target.language,
        blockType: options.checkpoint.blockType ?? 'paragraph',
        cursorBoundary: cursorBoundary(prefix),
        maxCandidates: 32,
        deadlineAt,
      },
    },
  };
  const started = performance.now();
  writeFrame(options.worker, request);
  const frame = await withTimeout(
    options.reader.readFrame(),
    options.deadlineMs + 250,
    `checkpoint ${options.checkpoint.id}`,
  );
  const elapsedMs = Math.max(0, performance.now() - started);
  if (frame.event.type === 'error') {
    throw new Error(`Completion worker ${frame.event.code}: ${frame.event.message}`);
  }
  if (
    frame.protocolVersion !== PROTOCOL_VERSION ||
    frame.requestId !== options.requestId ||
    frame.event.type !== 'generated' ||
    frame.event.requestId !== options.requestId ||
    frame.event.response.protocolVersion !== PROTOCOL_VERSION ||
    frame.event.response.documentVersion !== `holdout:${options.checkpoint.id}` ||
    frame.event.response.cursorPos !== options.checkpoint.cursorOffset
  ) {
    throw new Error(`Completion worker response identity mismatch: ${options.checkpoint.id}.`);
  }
  const candidates = frame.event.response.candidates.slice(0, 32).map((candidate) => ({
    ...candidate,
    usable: candidateUsable(candidate, options.target, options.checkpoint),
  }));
  return {
    checkpointId: options.checkpoint.id,
    targetId: options.target.id,
    expectedBehavior: options.checkpoint.expectedBehavior,
    language: options.target.language,
    category: options.target.category,
    cursorOffset: options.checkpoint.cursorOffset,
    elapsedMs,
    triggered: candidates.length > 0,
    top1Usable: candidates[0]?.usable === true,
    oracleAt8Usable: candidates.slice(0, 8).some((candidate) => candidate.usable),
    oracleAt32Usable: candidates.some((candidate) => candidate.usable),
    candidates,
  };
}

function buildReport(options: {
  descriptor: V2FreeHoldoutDescriptor;
  candidate: CandidateManifestIdentity;
  evaluatorTreeSha256: V2FreeSha256;
  observations: readonly V2FreeEvaluationObservation[];
  claim?: V2FreeFinalPairClaim;
}): Omit<V2FreeEvaluationReport, 'observationsSha256' | 'reportSha256'> {
  const complete = options.observations.filter((item) => item.expectedBehavior === 'complete');
  const silence = options.observations.filter((item) => item.expectedBehavior === 'silence');
  const byLanguage = {
    zh: aggregateGroup(options.observations.filter((item) => item.language === 'zh')),
    en: aggregateGroup(options.observations.filter((item) => item.language === 'en')),
  };
  const byCategory: Record<string, { checkpoints: number; top1Hits: number }> = {};
  for (const observation of options.observations) {
    const value = byCategory[observation.category] ?? { checkpoints: 0, top1Hits: 0 };
    value.checkpoints++;
    if (observation.top1Usable) value.top1Hits++;
    byCategory[observation.category] = value;
  }
  return {
    schema: 'jotluck.autocomplete.v2-free-evaluation-report.v1',
    schemaVersion: 1,
    engine: ENGINE_ID,
    mode: options.claim ? 'final' : 'oracle',
    suite: options.descriptor.classification.startsWith('cold-') ? 'cold' : 'workspace',
    classification: options.descriptor.classification,
    candidateId: options.candidate.candidateId,
    candidateArtifactSha256: options.candidate.candidateArtifactSha256,
    holdoutSha256: options.descriptor.content.sha256,
    evaluatorTreeSha256: options.evaluatorTreeSha256,
    checkpoints: options.observations.length,
    completeCheckpoints: complete.length,
    silenceCheckpoints: silence.length,
    oracleAt8: rate(options.observations, (item) => item.oracleAt8Usable),
    oracleAt32: rate(options.observations, (item) => item.oracleAt32Usable),
    top1: rate(options.observations, (item) => item.top1Usable),
    triggers: rate(options.observations, (item) => item.triggered),
    silenceFalseTriggers: rate(silence, (item) => item.triggered),
    byLanguage,
    byCategory,
    requestP90Ms: percentile90(options.observations.map((item) => item.elapsedMs)),
    ...(options.claim ? { finalClaimSha256: options.claim.claimSha256 } : {}),
    finalHoldoutsRead: Boolean(options.claim),
    passed: false,
  };
}

function aggregateGroup(items: readonly V2FreeEvaluationObservation[]): {
  checkpoints: number;
  oracleAt8Hits: number;
  top1Hits: number;
} {
  return {
    checkpoints: items.length,
    oracleAt8Hits: items.filter((item) => item.oracleAt8Usable).length,
    top1Hits: items.filter((item) => item.top1Usable).length,
  };
}

function rate(
  items: readonly V2FreeEvaluationObservation[],
  predicate: (item: V2FreeEvaluationObservation) => boolean,
): { hits: number; checkpoints: number; rate: number } {
  const hits = items.filter(predicate).length;
  return { hits, checkpoints: items.length, rate: items.length === 0 ? 0 : hits / items.length };
}

function candidateUsable(
  candidate: WorkerCandidate,
  target: V2FreeHoldoutTarget,
  checkpoint: V2FreeHoldoutCheckpoint,
): boolean {
  if (checkpoint.expectedBehavior !== 'complete' || candidate.language !== target.language) {
    return false;
  }
  const normalized = normalizeContinuation(candidate.text);
  if (!normalized || candidate.text.includes('\n') || candidate.text.includes('\r')) return false;
  if (target.language === 'zh') {
    if ((candidate.text.match(/[\p{Script=Han}]/gu)?.length ?? 0) < 3) return false;
  } else if (
    (candidate.text.match(/[A-Za-z]/gu)?.length ?? 0) < 5 ||
    !/^[\s\p{P}]*[A-Za-z]+(?:[\s\p{P}]+[A-Za-z]+)*[\s\p{P}]*$/u.test(candidate.text)
  ) {
    return false;
  }
  return checkpoint.acceptableSuffixes.some((suffix) =>
    normalizeContinuation(suffix).startsWith(normalized),
  );
}

async function requireMatchingFinalClaim(options: {
  workspaceRoot: string;
  claimPath: string | undefined;
  descriptor: V2FreeHoldoutDescriptor;
  candidateArtifactSha256: V2FreeSha256;
  evaluatorTreeSha256: V2FreeSha256;
}): Promise<V2FreeFinalPairClaim> {
  if (!options.claimPath) throw new Error('Final evaluation requires a global pair claim.');
  const claim = await readV2FreeFinalPairClaim({
    workspaceRoot: options.workspaceRoot,
    claimPath: options.claimPath,
  });
  assertV2FreeFinalPairClaim(claim);
  const expectedHoldout = options.descriptor.classification.startsWith('cold-')
    ? claim.coldHoldoutSha256
    : claim.workspaceHoldoutSha256;
  if (
    expectedHoldout !== options.descriptor.content.sha256 ||
    claim.candidateArtifactSha256 !== options.candidateArtifactSha256 ||
    claim.evaluatorTreeSha256 !== options.evaluatorTreeSha256
  ) {
    throw new Error('Final pair claim does not bind this evaluation identity.');
  }
  return claim;
}

function spawnWorker(
  executablePath: string,
  manifestPath: string,
  argumentPrefix: readonly string[],
): ChildProcessWithoutNullStreams {
  const child = spawn(
    executablePath,
    [...argumentPrefix, '--jotluck-completion-worker', manifestPath],
    {
      env: { ...process.env, JOTLUCK_AUTOCOMPLETE_EVALUATION: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    },
  );
  child.stderr.setEncoding('utf8');
  return child;
}

function writeFrame(worker: ChildProcessWithoutNullStreams, value: unknown): void {
  const bytes = Buffer.from(JSON.stringify(value), 'utf8');
  if (bytes.byteLength < 1 || bytes.byteLength > MAX_FRAME_BYTES) {
    throw new Error('Completion evaluator request frame exceeds its protocol limit.');
  }
  const header = Buffer.allocUnsafe(4);
  header.writeUInt32LE(bytes.byteLength, 0);
  worker.stdin.write(Buffer.concat([header, bytes]));
}

class FrameReader {
  private buffer = Buffer.alloc(0);
  private endedError: Error | null = null;
  private readonly waiters = new Set<() => void>();

  constructor(private readonly worker: ChildProcessWithoutNullStreams) {
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
      if (!this.endedError) {
        this.endedError = new Error(
          `Completion worker exited (${String(code)}/${String(signal)}).`,
        );
      }
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

async function shutdownWorker(worker: ChildProcessWithoutNullStreams): Promise<void> {
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

function parseCandidateManifest(bytes: Buffer): CandidateManifestIdentity {
  const value = JSON.parse(bytes.toString('utf8')) as Partial<CandidateManifestIdentity>;
  if (
    value.engine !== ENGINE_ID ||
    typeof value.candidateId !== 'string' ||
    !/^[a-z0-9][a-z0-9._-]{0,95}$/u.test(value.candidateId) ||
    !isSha256(value.candidateArtifactSha256)
  ) {
    throw new Error('V2 free candidate manifest identity is invalid.');
  }
  return value as CandidateManifestIdentity;
}

async function resolveWorkspaceInput(root: string, value: string): Promise<string> {
  if (!value || path.isAbsolute(value)) throw new Error('Candidate manifest must be relative.');
  const resolved = await realpath(path.join(root, value));
  const relative = path.relative(root, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Candidate manifest escaped the workspace.');
  }
  return resolved;
}

async function resolveExecutable(value: string): Promise<string> {
  if (!value) throw new Error('Completion worker executable path is required.');
  return realpath(path.resolve(value));
}

function paragraphContext(prefix: string): {
  currentParagraph: string;
  previousParagraphTail: string;
} {
  const paragraphs = prefix.split(/\r?\n\s*\r?\n/u);
  return {
    currentParagraph: trimCodePoints(paragraphs.at(-1) ?? '', 1_024),
    previousParagraphTail: trimCodePoints(paragraphs.at(-2) ?? '', 512),
  };
}

function selectRetrievalSnippet(
  checkpoint: V2FreeHoldoutCheckpoint,
  target: V2FreeHoldoutTarget,
  supportById: ReadonlyMap<string, V2FreeHoldoutSupportDocument>,
): string {
  const supportId = checkpoint.supportDocumentIds?.[0] ?? target.workspaceSupportDocumentIds?.[0];
  return trimCodePoints(supportId ? (supportById.get(supportId)?.text ?? '') : '', 512);
}

function cursorBoundary(prefix: string): 'word' | 'space' | 'punctuation' | 'other' {
  const last = Array.from(prefix).at(-1) ?? '';
  if (/\s/u.test(last)) return 'space';
  if (/\p{P}/u.test(last)) return 'punctuation';
  if (/[\p{L}\p{N}_]/u.test(last)) return 'word';
  return 'other';
}

function trimUtf8Tail(value: string, maximumBytes: number): string {
  const output: string[] = [];
  let bytes = 0;
  for (const codePoint of Array.from(value).reverse()) {
    const size = Buffer.byteLength(codePoint, 'utf8');
    if (bytes + size > maximumBytes) break;
    output.push(codePoint);
    bytes += size;
  }
  return output.reverse().join('');
}

function trimCodePoints(value: string, maximum: number): string {
  return Array.from(value).slice(-maximum).join('');
}

function normalizeContinuation(value: string): string {
  return value.normalize('NFKC').replace(/\s+/gu, ' ').trim().toLocaleLowerCase('en-US');
}

function percentile90(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.9) - 1)] ?? 0;
}

function isSha256(value: unknown): value is V2FreeSha256 {
  return typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
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
