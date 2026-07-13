import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { DEFAULT_COMPLETION_SETTINGS } from '../../packages/app/src/services/CompletionSettings';
import { MarkdownPredictor } from '../../packages/app/src/services/MarkdownPredictor';
import {
  parsePublicV2sModel,
  PUBLIC_V2S_ENGINE_ID,
  type PublicV2sRuntimeModel,
} from '../../packages/app/src/services/completion/public-v2s-binary';
import {
  PUBLIC_ENGINE_MAX_CANDIDATES,
  PUBLIC_ENGINE_MAX_OUTPUT_CODE_POINTS,
  PUBLIC_ENGINE_PROTOCOL_VERSION,
  createEmptyPublicEngineAssetDiagnostics,
  type CompletionPublicEngine,
  type PublicEngineDiagnostics,
  type PublicEngineGenerateRequest,
  type PublicEngineGenerateResponse,
} from '../../packages/app/src/services/completion/public-engine-types';
import { takeLastUtf8Bytes } from '../../packages/app/src/services/completion/engine-router';
import { buildCompletionContext } from '../../packages/app/src/services/completion/context';
import type {
  CompletionCandidate,
  PredictorIndexData,
} from '../../packages/app/src/services/completion/types';
import { canonicalJson, resolveInside, sha256 } from './common';
import { validateV2SHoldout, type V2SHoldout, type V2STargetDocument } from './holdout';

export interface V2SReplayCandidate {
  text: string;
  providerId: string;
  sourceLayer: string;
}

export interface V2SReplayObservation {
  checkpointId: string;
  b0Top1: V2SReplayCandidate | null;
  publicCandidates: V2SReplayCandidate[];
  gatedPublicCandidates: V2SReplayCandidate[];
  combinedTop1: V2SReplayCandidate | null;
  fallback: boolean;
  timeout: boolean;
  rejectionReasons: string[];
}

export interface V2SReplayReport {
  schema: 'jotluck.autocomplete.v2s-deterministic-replay.v1';
  schemaVersion: 1;
  modelSha256: string;
  holdoutSha256: string;
  evaluatorTreeSha256: string;
  observations: V2SReplayObservation[];
  replaySha256: string;
}

export async function replayV2SHoldout(options: {
  workspaceRoot: string;
  modelPath: string;
  holdoutPath: string;
  expectedModelSha256?: string;
  expectedContainerHeaderSha256?: string;
  evaluatorTreeSha256: string;
}): Promise<V2SReplayReport> {
  if (!/^[a-f0-9]{64}$/u.test(options.evaluatorTreeSha256)) {
    throw new Error('V2S replay evaluator tree SHA-256 is invalid.');
  }
  const modelFile = resolveInside(options.workspaceRoot, options.modelPath, 'V2S replay model');
  const holdoutFile = resolveInside(
    options.workspaceRoot,
    options.holdoutPath,
    'V2S replay holdout',
  );
  const [modelBytes, holdoutBytes] = await Promise.all([
    readFile(modelFile),
    readFile(holdoutFile),
  ]);
  const modelSha256 = sha256(modelBytes);
  if (options.expectedModelSha256 && modelSha256 !== options.expectedModelSha256) {
    throw new Error('V2S replay model SHA-256 does not match the release binding.');
  }
  const holdout = JSON.parse(
    new TextDecoder('utf-8', { fatal: true }).decode(holdoutBytes),
  ) as V2SHoldout;
  validateV2SHoldout(holdout);
  const model = await parsePublicV2sModel(modelBytes, options.expectedContainerHeaderSha256);
  const b0 = createPredictor(null, holdout);
  const combined = createPredictor(new InProcessV2SEngine(model, modelBytes.byteLength), holdout);
  await combined.warmupPublicEngine();

  const observations: V2SReplayObservation[] = [];
  for (const target of holdout.targets) {
    for (const checkpoint of target.checkpoints) {
      const request = createPublicRequest(target, checkpoint.cursorOffset);
      const publicCandidates = model
        .generateUngatedForEvaluation(request)
        .slice(0, PUBLIC_ENGINE_MAX_CANDIDATES)
        .map(toPublicCandidate);
      const gatedPublicCandidates = model
        .generate(request)
        .slice(0, PUBLIC_ENGINE_MAX_CANDIDATES)
        .map(toPublicCandidate);
      const [b0Diagnostics, combinedDiagnostics] = await Promise.all([
        b0.requestGhostTextWithDiagnostics(checkpoint.cursorOffset, target.text, {
          deadlineMs: 10_000,
          documentVersion: checkpoint.id,
        }),
        combined.requestGhostTextWithDiagnostics(checkpoint.cursorOffset, target.text, {
          deadlineMs: 10_000,
          documentVersion: checkpoint.id,
        }),
      ]);
      observations.push({
        checkpointId: checkpoint.id,
        b0Top1: toCompletionCandidate(b0Diagnostics.rankedCandidates[0] ?? null),
        publicCandidates,
        gatedPublicCandidates,
        combinedTop1: toCompletionCandidate(combinedDiagnostics.rankedCandidates[0] ?? null),
        fallback: combinedDiagnostics.publicEngine.fellBack,
        timeout: combinedDiagnostics.publicEngine.timedOut,
        rejectionReasons: Object.keys(combinedDiagnostics.resolverTrace.rejectionReasons).sort(),
      });
    }
  }
  await Promise.all([b0.dispose(), combined.dispose()]);
  const unsigned = {
    schema: 'jotluck.autocomplete.v2s-deterministic-replay.v1' as const,
    schemaVersion: 1 as const,
    modelSha256,
    holdoutSha256: sha256(holdoutBytes),
    evaluatorTreeSha256: options.evaluatorTreeSha256,
    observations,
  };
  return { ...unsigned, replaySha256: sha256(canonicalJson(unsigned)) };
}

class InProcessV2SEngine implements CompletionPublicEngine {
  readonly id = PUBLIC_V2S_ENGINE_ID;
  readonly protocolVersion = PUBLIC_ENGINE_PROTOCOL_VERSION;
  readonly sourceKind = 'ngram' as const;
  readonly maxOutputCodePoints = PUBLIC_ENGINE_MAX_OUTPUT_CODE_POINTS;
  private epoch = 0;
  private disposed = false;

  constructor(
    private readonly model: PublicV2sRuntimeModel,
    private readonly modelBytes: number,
  ) {}

  async warmup(signal?: AbortSignal): Promise<boolean> {
    if (signal?.aborted || this.disposed) return false;
    this.epoch += 1;
    return true;
  }

  async generate(
    request: PublicEngineGenerateRequest,
    signal?: AbortSignal,
  ): Promise<PublicEngineGenerateResponse> {
    if (signal?.aborted || this.disposed) throw new DOMException('Aborted', 'AbortError');
    return {
      protocolVersion: this.protocolVersion,
      engineEpoch: request.engineEpoch,
      workspaceScope: request.workspaceScope,
      documentVersion: request.documentVersion,
      cursorPos: request.cursorPos,
      candidates: this.model.generate(request),
    };
  }

  diagnostics(): PublicEngineDiagnostics {
    return {
      engineId: this.id,
      backendKind: 'evaluation-in-process',
      status: this.disposed ? 'disposed' : 'ready',
      epoch: this.epoch,
      profile: 'evaluation-only',
      lastError: null,
      warmupDurationMs: 0,
      lastInferenceDurationMs: 0,
      visibleInferenceP90Ms: 0,
      generateRequests: 0,
      generatedCandidates: 0,
      cancellations: 0,
      deadlineExpirations: 0,
      lateResponses: 0,
      invalidResponses: 0,
      workerErrors: 0,
      assets: { ...createEmptyPublicEngineAssetDiagnostics(), modelBytes: this.modelBytes },
    };
  }

  dispose(): void {
    this.disposed = true;
  }
}

function createPredictor(
  engine: CompletionPublicEngine | null,
  holdout: V2SHoldout,
): MarkdownPredictor {
  const predictor = new MarkdownPredictor(4, undefined, engine ?? undefined);
  predictor.setStorageScope(`v2s-replay:${holdout.datasetId}:${engine ? 'combined' : 'b0'}`);
  predictor.configure({ ...DEFAULT_COMPLETION_SETTINGS, backgroundTraining: false });
  predictor.setIndexData(createIndexData(holdout));
  if (holdout.classification.startsWith('workspace-')) {
    for (const support of holdout.supportDocuments) {
      predictor.replaceDocumentContribution(support.path, support.text);
    }
  }
  return predictor;
}

function createIndexData(holdout: V2SHoldout): PredictorIndexData {
  const paths = [
    ...holdout.supportDocuments.map((document) => document.path),
    ...holdout.targets.map((target) => target.path),
  ].sort();
  const titles = paths.map((item) => path.posix.basename(item).replace(/\.[^.]+$/u, ''));
  return {
    getAllNoteTitles: () => [...titles],
    getAllTags: () => [],
    getRecentNoteTitles: () => [],
    matchFilePaths: (prefix) => paths.filter((item) => item.startsWith(prefix)).slice(0, 32),
  };
}

function createPublicRequest(
  target: V2STargetDocument,
  cursorOffset: number,
): PublicEngineGenerateRequest {
  const settings = { ...DEFAULT_COMPLETION_SETTINGS, backgroundTraining: false };
  const context = buildCompletionContext({
    doc: target.text,
    cursorPos: cursorOffset,
    settings,
    indexData: null,
    n: 4,
  });
  const contextTail = takeLastUtf8Bytes(target.text.slice(0, cursorOffset), 256);
  return {
    engineEpoch: 1,
    workspaceScope: 'v2s-deterministic-replay',
    documentVersion: target.id,
    cursorPos: cursorOffset,
    contextTail,
    contextTailUtf8Bytes: new TextEncoder().encode(contextTail).byteLength,
    languageHint: target.language,
    blockType: context.blockType,
    cursorBoundary: detectBoundary(target.text, cursorOffset),
    maxCandidates: PUBLIC_ENGINE_MAX_CANDIDATES,
    deadlineAt: Date.now() + 60_000,
  };
}

function detectBoundary(
  text: string,
  cursorOffset: number,
): PublicEngineGenerateRequest['cursorBoundary'] {
  const previous = Array.from(text.slice(0, cursorOffset)).at(-1) ?? '';
  if (/^[\p{L}\p{N}_]$/u.test(previous)) return 'word';
  if (/^\s$/u.test(previous)) return 'space';
  if (/^[\p{P}\p{S}]$/u.test(previous)) return 'punctuation';
  return 'other';
}

function toPublicCandidate(candidate: { text: string }): V2SReplayCandidate {
  return { text: candidate.text, providerId: PUBLIC_V2S_ENGINE_ID, sourceLayer: 'l3' };
}

function toCompletionCandidate(candidate: CompletionCandidate | null): V2SReplayCandidate | null {
  return candidate
    ? {
        text: candidate.text,
        providerId: candidate.providerId,
        sourceLayer: candidate.sourceLayer ?? 'l1',
      }
    : null;
}

function readArg(argv: readonly string[], name: string): string | undefined {
  const inline = argv.find((item) => item.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const workspaceRoot = path.resolve(readArg(process.argv.slice(2), '--root') ?? process.cwd());
  const modelPath = readArg(process.argv.slice(2), '--model');
  const holdoutPath = readArg(process.argv.slice(2), '--holdout');
  if (!modelPath || !holdoutPath) {
    throw new Error(
      'Usage: replay-evidence --model <path> --holdout <path> --evaluator-tree-sha256 <sha> [--root <path>].',
    );
  }
  replayV2SHoldout({
    workspaceRoot,
    modelPath,
    holdoutPath,
    expectedModelSha256: readArg(process.argv.slice(2), '--model-sha256'),
    expectedContainerHeaderSha256: readArg(process.argv.slice(2), '--header-sha256'),
    evaluatorTreeSha256:
      readArg(process.argv.slice(2), '--evaluator-tree-sha256') ??
      (() => {
        throw new Error('replay-evidence requires --evaluator-tree-sha256.');
      })(),
  })
    .then((report) => process.stdout.write(`${canonicalJson(report)}\n`))
    .catch((error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
