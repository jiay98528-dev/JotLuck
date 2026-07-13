import {
  type NGramTable,
  type ParseDiagnostics,
  type PredictionResult,
  createParseDiagnostics,
  scanDocument,
  learn as ngramLearn,
  rejectPrediction,
  mergeInto,
  mergeTables,
  serialize,
  deserialize,
} from '@/utils/ngram-engine';
import {
  deserializeBaselineTablesAsync,
  type BaselineTables,
  type WordNGramTable,
} from '@/utils/word-ngram-engine';
import type { CompletionSettings } from './CompletionSettings';
import { DEFAULT_COMPLETION_SETTINGS } from './CompletionSettings';
import {
  buildCompletionContext,
  detectOpenFormat,
  detectSyntaxContext,
  getLocalLanguageHint,
  getLineAt,
  isDisabledContext,
  isInFencedCode,
  isInFrontmatter,
} from './completion/context';
import {
  FilePathProvider,
  FormatClosureProvider,
  LexiconProvider,
  LineEchoProvider,
  MarkdownStructureProvider,
  NgramProvider,
  PhraseSlotProvider,
  RecentPhraseProvider,
  SequencePatternProvider,
  ShortChineseProvider,
  ShortEnglishProvider,
  TagProvider,
  WikiLinkProvider,
  type NgramProviderState,
} from './completion/providers';
import {
  clearCompletionMetrics,
  loadCompletionMetrics,
  type MetricsStore,
  recordProviderAccepted,
  recordProviderRejected,
  recordProviderShown,
} from './completion/metrics';
import { evaluatePredictionQualityGate } from './completion/quality-gate';
import {
  clearLearningSignals,
  createLearningSignalStore,
  getLearningSignalAdjustment,
  getLearningSignalKey,
  isWeakLearningSource,
  learningSignalsStorageKey,
  loadLearningSignals,
  persistLearningSignalEvent,
  type LearningSignalStore,
  recordSignalAccepted,
  recordSignalRejected,
  recordSignalShown,
} from './completion/learning-signals';
import {
  collectProviderCandidates,
  createCompletionResolverTrace,
  resolveCompletion,
  resolveCompletionCandidates,
  type CompletionResolverTrace,
} from './completion/resolver';
import {
  CompletionEngineRouter,
  createCompletionCandidateBatch,
  takeLastUtf8Bytes,
} from './completion/engine-router';
import { HybridRetrievalService } from './completion/hybrid-retrieval-backend';
import type {
  HybridRetrievalCandidate,
  HybridRetrievalHealthDiagnostics,
} from './completion/hybrid-retrieval-types';
import {
  PUBLIC_ENGINE_CONTEXT_MAX_UTF8_BYTES,
  PUBLIC_ENGINE_MAX_CANDIDATES,
  type CompletionPublicEngine,
  type PublicCompletionCandidate,
  type PublicEngineDiagnostics,
  type PublicEngineCursorBoundary,
} from './completion/public-engine-types';
import type {
  CompletionAblationMode,
  CompletionCandidate,
  CompletionContext,
  CompletionProvider,
  CompletionSourceLayer,
  PredictorIndexData,
  SyntaxContext,
  SyntaxType,
} from './completion/types';
import {
  normalizeCompletionScope,
  getStorageKeyRevision,
  hasPendingCompletionStorageMutation,
  readStorage,
  removeStorage,
  runCompletionStorageMutation,
  scopedCompletionStorageKey,
  writeStorage,
} from './completion/learning-repository';

export type { PredictorIndexData, SyntaxContext, SyntaxType };

const LEGACY_L2_STORAGE_KEY = 'jotluck:ngram:v2';
const LEGACY_L2_META_KEY = 'jotluck:ngram:meta';
const LEGACY_SHORT_L2_STORAGE_KEY = 'jotluck:ngram:short:v1';
export const ACCEPTED_LEXICON_STORAGE_KEY = 'jotluck:autocomplete:acceptedLexicon:v1';
const PERSONAL_MODEL_HEADER = '# jotluck-personal-ngram-v4';
const PERSONAL_MODEL_MAX_BYTES = 4.5 * 1024 * 1024;
const PERSONAL_MODEL_TARGET_BYTES = 3.5 * 1024 * 1024;
const BASELINE_MAX_BYTES = 6 * 1024 * 1024;
const BASELINE_CACHE_NAME = 'jotluck-autocomplete-baselines-v1';

interface L2Meta {
  v?: number;
  schemaVersion: number;
  docs: number;
  totalEntries: number;
  lastSave: number;
  lastError?: string;
  migratedFrom?: number;
}

interface DocumentContribution {
  fingerprint: string;
  long: NGramTable;
  short2: NGramTable;
  short3: NGramTable;
  inputBytes: number;
  entryCount: number;
  buildMs: number;
}

const MAX_NOTEBOOK_DOCUMENT_BYTES = 64 * 1024;
const MAX_NOTEBOOK_DOCUMENTS = 2_000;
const MAX_NOTEBOOK_INPUT_BYTES = 16 * 1024 * 1024;
const MAX_NOTEBOOK_ENTRIES = 300_000;

export interface NotebookModelDiagnostics {
  documentCount: number;
  inputBytes: number;
  entryCount: number;
  estimatedIndexBytes: number;
  lastBuildMs: number;
  totalBuildMs: number;
  longTasksOver50Ms: number;
  budgetRejections: number;
}

export interface BaselineManifest {
  schemaVersion: 1 | 2;
  profile: 'web-local' | 'release';
  modelFile: string;
  serialization: 'jsonl-hex-v3-fixed-int' | 'sectioned-jsonl-hex-v4';
  order: 'lexicographic-context-hex' | 'section-profile-context-hex';
  ngramN: number;
  minNgramN?: number;
  wordNgramOrders?: number[];
  countScale?: number;
  modelBytes: number;
  entryCount: number;
  characterEntryCount?: number;
  wordEntryCount?: number;
  sha256: string;
  trainingInputHash: string;
  verifiedOnly: true;
  runtimeEligible: true;
  qualityGatePassed: boolean;
  releaseEligible: boolean;
  rcRuntimeCandidateTier?: string;
  hardLimitPassed: true;
}

export interface BaselineCacheAdapter {
  read(manifestUrl: string, modelUrl: string): Promise<{ manifest: string; model: string } | null>;
  write(manifestUrl: string, modelUrl: string, manifest: string, model: string): Promise<void>;
}

export interface BaselineLoaderDependencies {
  fetcher?: typeof fetch;
  cache?: BaselineCacheAdapter | null;
  sha256?: (text: string) => Promise<string>;
  minEntryCount?: number;
}

interface BaselineSingletonState {
  fetcher: typeof fetch;
  n: number;
  promise: Promise<BaselineTables>;
}

export interface LoadedBaselineIdentity {
  modelUrl: string;
  modelSha256: string;
  modelBytes: number;
  profile: BaselineManifest['profile'];
  trainingInputHash: string;
}

let baselineLoaderOverrides: BaselineLoaderDependencies | null = null;
let baselineSingleton: BaselineSingletonState | null = null;
let baselineParseDiagnostics = createParseDiagnostics();
let loadedBaselineIdentity: LoadedBaselineIdentity | null = null;

export function configureBaselineLoaderForTests(
  dependencies: BaselineLoaderDependencies | null,
): void {
  baselineLoaderOverrides = dependencies;
  baselineSingleton = null;
  baselineParseDiagnostics = createParseDiagnostics();
  loadedBaselineIdentity = null;
}

export function resetBaselineLoaderForTests(): void {
  baselineLoaderOverrides = null;
  baselineSingleton = null;
  baselineParseDiagnostics = createParseDiagnostics();
  loadedBaselineIdentity = null;
}

interface CompletionFeedbackOptions {
  learn?: boolean;
  feedbackToken?: string;
}

export interface CompletionRequestOptions {
  signal?: AbortSignal;
  deadlineMs?: number;
  documentVersion?: string;
}

export interface CompletionRequestDiagnostics {
  result: PredictionResult | null;
  rankedCandidates: CompletionCandidate[];
  elapsedMs: number;
  hybrid: {
    attempted: boolean;
    timedOut: boolean;
    fellBack: boolean;
    health: HybridRetrievalHealthDiagnostics;
  };
  ranker: {
    usedRankerId: string | null;
    fellBack: boolean;
  };
  publicEngine: {
    attempted: boolean;
    timedOut: boolean;
    fellBack: boolean;
    usedEngineId: string | null;
    candidates: PublicCompletionCandidate[];
    health: PublicEngineDiagnostics | null;
  };
  resolverTrace: CompletionResolverTrace;
  baselineParse: ParseDiagnostics;
  baselineModel: LoadedBaselineIdentity | null;
}

interface PredictionFeedbackSnapshot {
  providerId: string | null;
  sourceLayer: CompletionSourceLayer | undefined;
  syntaxType: string | undefined;
  informationScore: number | undefined;
  feedbackKey: string | null;
  rejectionKey: string | null;
  learningKey: string | null;
  storageScope: string;
}

function normalizeL2Meta(meta: Partial<L2Meta>): L2Meta {
  return {
    schemaVersion: 4,
    docs: normalizeNonNegativeInteger(meta.docs),
    totalEntries: normalizeNonNegativeInteger(meta.totalEntries),
    lastSave: normalizeNonNegativeInteger(meta.lastSave),
    migratedFrom: normalizeOptionalPositiveInteger(meta.migratedFrom),
    lastError: typeof meta.lastError === 'string' ? meta.lastError : undefined,
  };
}

function removeLegacyLearningStorage(): void {
  removeStorage(
    LEGACY_L2_STORAGE_KEY,
    LEGACY_SHORT_L2_STORAGE_KEY,
    LEGACY_L2_META_KEY,
    ACCEPTED_LEXICON_STORAGE_KEY,
  );
}

function migrateLegacyAcceptedLexicon(targetKey: string): void {
  if (readStorage(targetKey) === null) {
    const legacy = readStorage(ACCEPTED_LEXICON_STORAGE_KEY);
    if (isValidAcceptedLexiconJson(legacy)) writeStorage(targetKey, legacy!);
  }
  removeLegacyLearningStorage();
}

export class MarkdownPredictor {
  private l1: NGramTable = new Map();
  /** Personal L2: only explicit accept/reject feedback, persisted per notebook. */
  private l2: NGramTable = new Map();
  private l3: NGramTable = new Map();
  private l3Word: WordNGramTable = new Map();
  private l3CountScale = 1;
  private shortL1: NGramTable = new Map();
  /** Provider-facing combined personal short2/short3 table. */
  private shortL2: NGramTable = new Map();
  private personalShort2: NGramTable = new Map();
  private personalShort3: NGramTable = new Map();
  private documentContributions = new Map<string, DocumentContribution>();
  private notebookLong: NGramTable = new Map();
  private notebookShort2: NGramTable = new Map();
  private notebookShort3: NGramTable = new Map();
  private notebookLongSupport: NGramTable = new Map();
  private notebookShort2Support: NGramTable = new Map();
  private notebookShort3Support: NGramTable = new Map();
  private notebookLongCache: NGramTable | null = null;
  private notebookShortCache: NGramTable | null = null;
  private notebookInputBytes = 0;
  private notebookEntryCount = 0;
  private notebookLastBuildMs = 0;
  private notebookTotalBuildMs = 0;
  private notebookLongTasksOver50Ms = 0;
  private notebookBudgetRejections = 0;
  private l2Meta: L2Meta = { schemaVersion: 4, docs: 0, totalEntries: 0, lastSave: 0 };
  private indexData: PredictorIndexData | null = null;
  private accessTimestamps = new Map<string, number>();
  private entryFlags = new Map<string, 'b' | 'u'>();
  private initialized: Promise<void> | null = null;
  private settings: CompletionSettings = { ...DEFAULT_COMPLETION_SETTINGS };
  private recentPhrases: string[] = [];
  private documentLexicon: string[] = [];
  private excerptLexicon: string[] = [];
  private acceptedLexicon: string[] = [];
  private learningSignals: LearningSignalStore = loadLearningSignals();
  private rejectionCounts = new Map<string, number>();
  private acceptedBoosts = new Map<string, number>();
  private ablationMode: CompletionAblationMode = 'full-stack';
  private lastPredictionProviderId: string | null = null;
  private lastPredictionSourceLayer: CompletionSourceLayer | undefined;
  private lastPredictionSyntaxType: string | undefined;
  private lastPredictionInformationScore: number | undefined;
  private lastPredictionFeedbackKey: string | null = null;
  private lastPredictionRejectionKey: string | null = null;
  private lastPredictionLearningKey: string | null = null;
  private predictionSequence = 0;
  private predictionFeedback = new Map<string, PredictionFeedbackSnapshot>();
  private engineRequestSequence = 0;
  private readonly engineRouter = new CompletionEngineRouter();
  private readonly retrievalService: HybridRetrievalService;
  private readonly initialPublicEngine: CompletionPublicEngine | null;
  private publicEngineWarmup: Promise<boolean> | null = null;
  private storageScope = 'unscoped';
  private observedStorageRevisions = new Map<string, number>();

  constructor(
    private readonly n: number = 4,
    retrievalService?: HybridRetrievalService,
    publicEngine?: CompletionPublicEngine,
  ) {
    this.retrievalService = retrievalService ?? new HybridRetrievalService();
    // Architecture-stop builds leave the public L3 slot unbound. Tests and
    // isolated evaluators may explicitly inject an evidence-gated engine.
    this.initialPublicEngine = publicEngine ?? null;
  }

  setIndexData(data: PredictorIndexData): void {
    this.indexData = data;
  }

  configure(settings: Partial<CompletionSettings>): void {
    this.settings = { ...this.settings, ...settings };
  }

  setAblationMode(mode: CompletionAblationMode): void {
    this.ablationMode = mode;
  }

  getSettings(): CompletionSettings {
    return { ...this.settings };
  }

  setStorageScope(scope: string): void {
    const normalized = normalizeCompletionScope(scope);
    if (normalized === this.storageScope) return;
    this.retrievalService.setWorkspaceScope(normalized);
    this.storageScope = normalized;
    this.resetNotebookContributions();
    this.resetPersistentLearningState();
    this.loadFromLocalStorage();
    this.learningSignals = loadLearningSignals(this.storageScope);
    this.recentPhrases = [];
    this.excerptLexicon = [];
    this.rejectionCounts.clear();
    this.acceptedBoosts.clear();
    this.predictionFeedback.clear();
    this.resetLastPredictionFeedback();
    this.engineRouter.bumpEpoch();
    this.captureStorageRevisions();
  }

  getStorageScope(): string {
    return this.storageScope;
  }

  getNotebookModelDiagnostics(): NotebookModelDiagnostics {
    return {
      documentCount: this.documentContributions.size,
      inputBytes: this.notebookInputBytes,
      entryCount: this.notebookEntryCount,
      estimatedIndexBytes: this.notebookEntryCount * 96,
      lastBuildMs: this.notebookLastBuildMs,
      totalBuildMs: this.notebookTotalBuildMs,
      longTasksOver50Ms: this.notebookLongTasksOver50Ms,
      budgetRejections: this.notebookBudgetRejections,
    };
  }

  setHybridRetrievalReplayProvider(
    provider: (
      workspaceScope: string,
      signal: AbortSignal,
    ) =>
      | Iterable<{ path: string; content: string }>
      | Promise<Iterable<{ path: string; content: string }>>,
  ): void {
    this.retrievalService.setReplayDocumentsProvider(provider);
  }

  getHybridRetrievalHealth(): HybridRetrievalHealthDiagnostics {
    return this.retrievalService.getHealthDiagnostics();
  }

  refreshHybridRetrievalHealth(): Promise<HybridRetrievalHealthDiagnostics> {
    return this.retrievalService.refreshHealthDiagnostics();
  }

  flushHybridRetrievalMutations(): Promise<void> {
    return this.retrievalService.flushMutations();
  }

  getBaselineParseDiagnostics(): ParseDiagnostics {
    return { ...baselineParseDiagnostics };
  }

  getLoadedBaselineIdentity(): LoadedBaselineIdentity | null {
    return loadedBaselineIdentity ? { ...loadedBaselineIdentity } : null;
  }

  getPublicEngineDiagnostics(): PublicEngineDiagnostics | null {
    return this.engineRouter.getPublicEngineDiagnostics();
  }

  warmupPublicEngine(): Promise<boolean> {
    this.publicEngineWarmup ??= this.installInitialPublicEngine();
    return this.publicEngineWarmup;
  }

  private async installInitialPublicEngine(): Promise<boolean> {
    const engine = this.initialPublicEngine;
    return engine ? this.engineRouter.installPublicEngine(engine) : false;
  }

  async initialize(): Promise<void> {
    this.initialized ??= this.initializeOnce();
    return this.initialized;
  }

  async loadBaseline(): Promise<void> {
    const baseline = await loadSharedBaseline(this.n);
    this.l3 = baseline.character;
    this.l3Word = baseline.word;
    this.l3CountScale = baseline.countScale ?? 1;
  }

  getGhostText(cursorPos: number, doc: string): PredictionResult | null {
    if (!this.settings.enabled) return null;
    this.refreshExternalLearningState();
    const start = performance.now();
    const context = buildCompletionContext({
      doc,
      cursorPos,
      settings: this.settings,
      indexData: this.indexData,
      n: this.n,
    });
    if (context.disabled) return null;
    if (
      !context.emptyLine &&
      this.extractContext(cursorPos, doc).length < 2 &&
      context.syntax.type === 'general'
    ) {
      return null;
    }

    const metrics = loadCompletionMetrics(this.storageScope);
    const { candidate } = resolveCompletion(context, this.createProviders(), {
      getRejectionCount: (item, itemContext) =>
        this.rejectionCounts.get(this.getRejectionKey(item, itemContext)) ?? 0,
      getBoost: (item, itemContext) =>
        Math.min(
          0.12,
          (this.acceptedBoosts.get(this.getFeedbackKey(item, itemContext)) ?? 0) * 0.04,
        ) +
        this.getMetricAdjustment(item, metrics) +
        getLearningSignalAdjustment(
          this.learningSignals,
          getLearningSignalKey(item, itemContext),
          item,
        ),
    });
    return this.commitPrediction(candidate, context, start);
  }

  async requestGhostText(
    cursorPos: number,
    doc: string,
    options: CompletionRequestOptions = {},
  ): Promise<PredictionResult | null> {
    const diagnostics = await this.requestGhostTextWithDiagnostics(cursorPos, doc, options);
    const candidate = diagnostics.rankedCandidates[0] ?? null;
    if (!candidate || !diagnostics.result) return null;
    const context = buildCompletionContext({
      doc,
      cursorPos,
      settings: this.settings,
      indexData: this.indexData,
      n: this.n,
    });
    return this.commitPrediction(
      candidate,
      context,
      Math.max(0, performance.now() - diagnostics.elapsedMs),
    );
  }

  async requestGhostTextWithDiagnostics(
    cursorPos: number,
    doc: string,
    options: CompletionRequestOptions = {},
  ): Promise<CompletionRequestDiagnostics> {
    const start = performance.now();
    const resolverTrace = createCompletionResolverTrace();
    let rankedCandidates: CompletionCandidate[] = [];
    let hybridAttempted = false;
    let hybridTimedOut = false;
    let hybridFellBack = false;
    let publicEngineAttempted = false;
    let publicEngineTimedOut = false;
    let publicEngineFellBack = false;
    let usedPublicEngineId: string | null = null;
    let publicEngineCandidates: PublicCompletionCandidate[] = [];
    let rankerFellBack = false;
    let usedRankerId: string | null = null;
    const finish = (result: PredictionResult | null): CompletionRequestDiagnostics => ({
      result,
      rankedCandidates: rankedCandidates.slice(0, 8).map((candidate) => ({ ...candidate })),
      elapsedMs: Math.max(0, performance.now() - start),
      hybrid: {
        attempted: hybridAttempted,
        timedOut: hybridTimedOut,
        fellBack: hybridFellBack,
        health: this.retrievalService.getHealthDiagnostics(),
      },
      ranker: { usedRankerId, fellBack: rankerFellBack },
      publicEngine: {
        attempted: publicEngineAttempted,
        timedOut: publicEngineTimedOut,
        fellBack: publicEngineFellBack,
        usedEngineId: usedPublicEngineId,
        candidates: publicEngineCandidates.map((candidate) => ({ ...candidate })),
        health: this.getPublicEngineDiagnostics(),
      },
      resolverTrace,
      baselineParse: this.getBaselineParseDiagnostics(),
      baselineModel: this.getLoadedBaselineIdentity(),
    });

    if (!this.settings.enabled || options.signal?.aborted) return finish(null);
    const requestScope = this.storageScope;
    const engineEpoch = this.engineRouter.getEpoch();
    const retrievalEpoch = this.retrievalService.getEpoch();
    this.refreshExternalLearningState();
    const context = buildCompletionContext({
      doc,
      cursorPos,
      settings: this.settings,
      indexData: this.indexData,
      n: this.n,
    });
    if (context.disabled) return finish(null);
    if (
      !context.emptyLine &&
      this.extractContext(cursorPos, doc).length < 2 &&
      context.syntax.type === 'general'
    ) {
      return finish(null);
    }

    const deadlineAt = start + Math.max(0, options.deadlineMs ?? 110);
    const metrics = loadCompletionMetrics(this.storageScope);
    const providers = this.createProviders();
    const rawCandidates = collectProviderCandidates(context, providers);
    const hasStructuredCandidate = rawCandidates.some(
      (candidate) => candidate.source === 'structured',
    );
    hybridAttempted = this.isHybridRetrievalEnabled(context) && !hasStructuredCandidate;
    publicEngineAttempted =
      this.isPublicEngineEnabled(context) &&
      !hasStructuredCandidate &&
      this.engineRouter.getActivePublicEngineId() !== null;

    const documentVersion = options.documentVersion ?? fingerprintText(doc);
    const publicDeadlineAt = Date.now() + Math.max(0, deadlineAt - performance.now());
    const [retrieval, publicGeneration] = await Promise.all([
      hybridAttempted
        ? this.retrieveCandidates(context, deadlineAt, options.signal)
        : Promise.resolve({
            candidates: [] as HybridRetrievalCandidate[],
            timedOut: false,
            fellBack: false,
          }),
      publicEngineAttempted
        ? this.engineRouter.generatePublic(
            {
              workspaceScope: requestScope,
              documentVersion,
              cursorPos,
              contextTail: takeLastUtf8Bytes(
                doc.slice(0, cursorPos),
                PUBLIC_ENGINE_CONTEXT_MAX_UTF8_BYTES,
              ),
              languageHint: context.languageHint,
              blockType: context.blockType,
              cursorBoundary: detectPublicCursorBoundary(doc, cursorPos),
              maxCandidates: PUBLIC_ENGINE_MAX_CANDIDATES,
              deadlineAt: publicDeadlineAt,
            },
            engineEpoch,
            deadlineAt,
            options.signal,
          )
        : Promise.resolve({
            candidates: [],
            usedEngineId: null,
            fellBack: false,
            timedOut: false,
          }),
    ]);

    hybridTimedOut = retrieval.timedOut;
    hybridFellBack = retrieval.fellBack;
    publicEngineTimedOut = publicGeneration.timedOut;
    publicEngineFellBack = publicGeneration.fellBack;
    usedPublicEngineId = publicGeneration.usedEngineId;
    publicEngineCandidates = [...publicGeneration.candidates];
    if (
      options.signal?.aborted ||
      requestScope !== this.storageScope ||
      engineEpoch !== this.engineRouter.getEpoch() ||
      retrievalEpoch !== this.retrievalService.getEpoch()
    ) {
      return finish(null);
    }
    if (hybridAttempted) {
      rawCandidates.push(
        ...retrieval.candidates.map((candidate) => this.toRetrievalCandidate(candidate, cursorPos)),
      );
    }
    if (publicEngineAttempted) rawCandidates.push(...publicGeneration.candidates);
    if (options.signal?.aborted) return finish(null);
    const resolved = resolveCompletionCandidates(
      context,
      rawCandidates,
      {
        getRejectionCount: (item, itemContext) =>
          this.rejectionCounts.get(this.getRejectionKey(item, itemContext)) ?? 0,
        getBoost: (item, itemContext) =>
          Math.min(
            0.12,
            (this.acceptedBoosts.get(this.getFeedbackKey(item, itemContext)) ?? 0) * 0.04,
          ) +
          this.getMetricAdjustment(item, metrics) +
          getLearningSignalAdjustment(
            this.learningSignals,
            getLearningSignalKey(item, itemContext),
            item,
          ),
        trace: resolverTrace,
      },
      providers.length,
    );
    if (options.signal?.aborted || resolved.rankedCandidates.length === 0) {
      return finish(null);
    }

    const batch = createCompletionCandidateBatch({
      requestId: `${this.storageScope}:${++this.engineRequestSequence}`,
      engineEpoch,
      workspaceScope: requestScope,
      documentVersion,
      cursorPos,
      contextBeforeCursor: doc.slice(0, cursorPos),
      languageHint: context.languageHint,
      blockType: context.blockType,
      deadlineAt,
      candidates: resolved.rankedCandidates,
    });
    const ranked = await this.engineRouter.rank(
      batch,
      resolved.rankedCandidates.slice(0, batch.candidates.length),
      options.signal,
    );
    rankerFellBack = ranked.fellBack;
    usedRankerId = ranked.usedRankerId;
    rankedCandidates = ranked.orderedCandidates.slice(0, 8);
    if (
      options.signal?.aborted ||
      requestScope !== this.storageScope ||
      engineEpoch !== this.engineRouter.getEpoch() ||
      retrievalEpoch !== this.retrievalService.getEpoch() ||
      batch.request.documentVersion !== documentVersion
    ) {
      return finish(null);
    }
    const winner = ranked.orderedCandidates[0] ?? null;
    return finish(winner ? this.toPredictionResult(winner) : null);
  }

  acceptCompletion(
    ctx: string,
    acceptedText: string,
    options: CompletionFeedbackOptions = {},
  ): void {
    const feedback = this.consumePredictionFeedback(options.feedbackToken);
    const feedbackValid = feedback.storageScope === this.storageScope;
    const shouldLearn = (options.learn ?? true) && feedbackValid;
    const shouldWriteNgram = shouldLearn && this.shouldWriteAcceptedNgram(feedback);
    if (shouldLearn) {
      const now = Date.now();
      this.accessTimestamps.set(ctx, now);
      this.entryFlags.set(ctx, 'u');
      this.rememberAcceptedLexicon(acceptedText);
    }
    if (shouldWriteNgram) {
      ngramLearn(this.l1, ctx, acceptedText, this.n);
      ngramLearn(this.l2, ctx, acceptedText, this.n);
      const short2Context = takeLastCodePoints(ctx, 2);
      const short3Context = takeLastCodePoints(ctx, 3);
      const shortAccepted = takeFirstCodePoints(acceptedText, 6);
      if (codePointLength(short2Context) === 2) {
        ngramLearn(this.personalShort2, short2Context, shortAccepted, 2);
      }
      if (codePointLength(short3Context) === 3) {
        ngramLearn(this.personalShort3, short3Context, shortAccepted, 3);
      }
      this.rebuildPersonalShortTable();
      this.invalidatePredictionCaches();
      this.rememberRecentPhrase(ctx + acceptedText);
      this.markPersonalContextsAccessed(ctx, acceptedText, Date.now());
      this.maybeEliminate();
    }
    if (shouldLearn) this.persistPersonalFeedback(ctx, acceptedText, 'accepted', shouldWriteNgram);
    if (feedback.rejectionKey) {
      this.rejectionCounts.delete(feedback.rejectionKey);
    }
    if (feedback.feedbackKey) {
      this.acceptedBoosts.set(
        feedback.feedbackKey,
        (this.acceptedBoosts.get(feedback.feedbackKey) ?? 0) + 1,
      );
    }
    if (feedbackValid) {
      recordProviderAccepted(
        feedback.providerId,
        feedback.sourceLayer,
        feedback.syntaxType,
        acceptedText.length,
        feedback.storageScope,
      );
      this.recordLearningSignalAccepted(acceptedText.length, feedback);
    }
  }

  rejectCompletion(
    ctx: string,
    rejectedText: string,
    options: CompletionFeedbackOptions = {},
  ): void {
    const feedback = this.consumePredictionFeedback(options.feedbackToken);
    const feedbackValid = feedback.storageScope === this.storageScope;
    if ((options.learn ?? true) && feedbackValid) {
      rejectPrediction(this.l1, ctx, rejectedText);
      rejectPrediction(this.l2, ctx, rejectedText);
      rejectPrediction(this.personalShort2, takeLastCodePoints(ctx, 2), rejectedText);
      rejectPrediction(this.personalShort3, takeLastCodePoints(ctx, 3), rejectedText);
      this.rebuildPersonalShortTable();
      this.invalidatePredictionCaches();
      this.persistPersonalFeedback(ctx, rejectedText, 'rejected', true);
    }
    if (feedback.rejectionKey) {
      this.rejectionCounts.set(
        feedback.rejectionKey,
        (this.rejectionCounts.get(feedback.rejectionKey) ?? 0) + 1,
      );
    }
    if (feedbackValid) {
      recordProviderRejected(
        feedback.providerId,
        feedback.sourceLayer,
        feedback.syntaxType,
        feedback.storageScope,
      );
      this.recordLearningSignalRejected(feedback);
    }
  }

  scanOpenedDocument(text: string): void {
    this.l1 = scanDocument(text, this.n);
    this.shortL1 = this.scanShortDocument(text);
    this.documentLexicon = extractLexiconTerms(text);
  }

  ingestDocument(path: string, text: string, _persist = true): void {
    this.replaceDocumentContribution(path, text);
  }

  replaceDocumentContribution(path: string, text: string): boolean {
    const normalizedPath = normalizeContributionPath(path);
    if (!normalizedPath) return false;
    const fingerprint = fingerprintText(text);
    const previous = this.documentContributions.get(normalizedPath);
    if (previous?.fingerprint === fingerprint) return false;
    if (!previous && this.documentContributions.size >= MAX_NOTEBOOK_DOCUMENTS) {
      this.notebookBudgetRejections++;
      this.retrievalService.replaceDocument(normalizedPath, text);
      return true;
    }
    if (previous) this.subtractNotebookContribution(previous);
    let next = this.createDocumentContribution(text, fingerprint);
    this.notebookLastBuildMs = next.buildMs;
    this.notebookTotalBuildMs += next.buildMs;
    if (next.buildMs > 50) this.notebookLongTasksOver50Ms++;
    if (
      next.inputBytes > MAX_NOTEBOOK_DOCUMENT_BYTES ||
      this.notebookInputBytes + next.inputBytes > MAX_NOTEBOOK_INPUT_BYTES ||
      this.notebookEntryCount + next.entryCount > MAX_NOTEBOOK_ENTRIES
    ) {
      this.notebookBudgetRejections++;
      next = emptyDocumentContribution(fingerprint, next.buildMs);
    }
    this.documentContributions.set(normalizedPath, next);
    this.addNotebookContribution(next);
    this.retrievalService.replaceDocument(normalizedPath, text);
    this.invalidatePredictionCaches();
    return true;
  }

  hasDocumentContribution(path: string): boolean {
    return this.documentContributions.has(normalizeContributionPath(path));
  }

  removeDocumentContribution(path: string): boolean {
    const normalizedPath = normalizeContributionPath(path);
    const contribution = this.documentContributions.get(normalizedPath);
    if (!contribution) return false;
    this.documentContributions.delete(normalizedPath);
    this.subtractNotebookContribution(contribution);
    this.retrievalService.removeDocument(normalizedPath);
    this.invalidatePredictionCaches();
    return true;
  }

  renameDocumentContribution(oldPath: string, newPath: string): boolean {
    const oldKey = normalizeContributionPath(oldPath);
    const newKey = normalizeContributionPath(newPath);
    const contribution = this.documentContributions.get(oldKey);
    if (!contribution || !newKey) return false;
    if (oldKey === newKey) return true;
    const overwritten = this.documentContributions.get(newKey);
    if (overwritten) this.subtractNotebookContribution(overwritten);
    this.documentContributions.delete(oldKey);
    this.documentContributions.set(newKey, contribution);
    this.retrievalService.renameDocument(oldKey, newKey);
    this.invalidatePredictionCaches();
    return true;
  }

  retainDocumentContributions(paths: Iterable<string>): void {
    const retained = new Set([...paths].map(normalizeContributionPath));
    let changed = false;
    for (const path of this.documentContributions.keys()) {
      if (retained.has(path)) continue;
      const contribution = this.documentContributions.get(path);
      this.documentContributions.delete(path);
      if (contribution) this.subtractNotebookContribution(contribution);
      this.retrievalService.removeDocument(path);
      changed = true;
    }
    if (changed) this.invalidatePredictionCaches();
  }

  resetNotebookContributions(): void {
    this.documentContributions.clear();
    this.notebookLong = new Map();
    this.notebookShort2 = new Map();
    this.notebookShort3 = new Map();
    this.notebookLongSupport = new Map();
    this.notebookShort2Support = new Map();
    this.notebookShort3Support = new Map();
    this.notebookInputBytes = 0;
    this.notebookEntryCount = 0;
    this.notebookLastBuildMs = 0;
    this.notebookTotalBuildMs = 0;
    this.notebookLongTasksOver50Ms = 0;
    this.notebookBudgetRejections = 0;
    this.retrievalService.clearWorkspace();
    this.invalidatePredictionCaches();
  }

  closeDocument(): void {
    this.l1.clear();
    this.shortL1.clear();
    this.documentLexicon = [];
  }

  async dispose(): Promise<void> {
    this.closeDocument();
    await Promise.all([this.retrievalService.dispose(), this.engineRouter.dispose()]);
  }

  clearLearningData(): void {
    this.resetPersistentLearningState();
    this.recentPhrases = [];
    this.rejectionCounts.clear();
    this.acceptedBoosts.clear();
    this.accessTimestamps.clear();
    this.resetLastPredictionFeedback();
    this.predictionFeedback.clear();
    const keys = this.storageKeys();
    const scope = this.storageScope;
    runCompletionStorageMutation(`personal:${scope}`, () => {
      removeStorage(keys.model, keys.meta, keys.acceptedLexicon, ...keys.legacyScoped);
    });
    removeLegacyLearningStorage();
    clearCompletionMetrics(this.storageScope);
    clearLearningSignals(this.storageScope);
    this.learningSignals = createLearningSignalStore();
    this.resetNotebookContributions();
  }

  detectSyntaxContext(cursorPos: number, doc: string): SyntaxContext {
    return detectSyntaxContext(cursorPos, doc);
  }

  isDisabledContext(cursorPos: number, doc: string): boolean {
    return isDisabledContext(cursorPos, doc);
  }

  ingestExcerpts(excerpts: string[]): void {
    const titles = excerpts.map((item) => item.trim()).filter((item) => item.length >= 2);
    this.excerptLexicon = [
      ...new Set([...titles, ...extractLexiconTerms(titles.join('\n'))]),
    ].slice(0, 120);
  }

  private async initializeOnce(): Promise<void> {
    this.loadFromLocalStorage();
    // Warmup is independent of Personal L2 restoration. The canonical factory
    // keeps the slot empty until a model is release-eligible.
    void this.warmupPublicEngine();
    await this.loadBaseline();
  }

  private storageKeys(): {
    model: string;
    meta: string;
    acceptedLexicon: string;
    legacyScoped: string[];
  } {
    return {
      model: scopedCompletionStorageKey(this.storageScope, 'ngram:v4'),
      meta: scopedCompletionStorageKey(this.storageScope, 'meta:v4'),
      acceptedLexicon: scopedCompletionStorageKey(this.storageScope, 'acceptedLexicon:v1'),
      legacyScoped: [
        `jotluck:scope:${this.storageScope}:ngram:v2`,
        `jotluck:scope:${this.storageScope}:ngram:short:v1`,
        `jotluck:scope:${this.storageScope}:ngram:meta`,
      ],
    };
  }

  private captureStorageRevisions(): void {
    const keys = this.storageKeys();
    for (const key of [
      keys.model,
      keys.meta,
      keys.acceptedLexicon,
      learningSignalsStorageKey(this.storageScope),
    ]) {
      this.observedStorageRevisions.set(key, getStorageKeyRevision(key));
    }
  }

  private refreshExternalLearningState(): void {
    const keys = this.storageKeys();
    const persistentKeys = [keys.model, keys.meta, keys.acceptedLexicon];
    const personalChanged =
      !hasPendingCompletionStorageMutation(`personal:${this.storageScope}`) &&
      persistentKeys.some(
        (key) => getStorageKeyRevision(key) !== (this.observedStorageRevisions.get(key) ?? 0),
      );
    const signalsKey = learningSignalsStorageKey(this.storageScope);
    const signalsChanged =
      !hasPendingCompletionStorageMutation(`signals:${this.storageScope}`) &&
      getStorageKeyRevision(signalsKey) !== (this.observedStorageRevisions.get(signalsKey) ?? 0);

    if (personalChanged) this.loadFromLocalStorage();
    if (signalsChanged) this.learningSignals = loadLearningSignals(this.storageScope);
    this.captureStorageRevisions();
  }

  private resetPersistentLearningState(): void {
    this.l2 = new Map();
    this.personalShort2 = new Map();
    this.personalShort3 = new Map();
    this.shortL2 = new Map();
    this.acceptedLexicon = [];
    this.accessTimestamps.clear();
    this.entryFlags.clear();
    this.invalidatePredictionCaches();
    this.l2Meta = { schemaVersion: 4, docs: 0, totalEntries: 0, lastSave: Date.now() };
  }

  private createProviders(): CompletionProvider[] {
    return [
      new FormatClosureProvider(),
      new MarkdownStructureProvider(),
      new WikiLinkProvider(),
      new TagProvider(),
      new FilePathProvider(),
      ...(this.ablationMode === 'full-stack' || this.ablationMode === 'provider-only'
        ? [
            new SequencePatternProvider(),
            new LineEchoProvider(),
            new LexiconProvider(() => this.getNgramProviderState()),
            new PhraseSlotProvider(),
            new RecentPhraseProvider(() => this.getNgramProviderState()),
          ]
        : []),
      ...(this.ablationMode === 'provider-only'
        ? [new ShortEnglishProvider()]
        : [
            new ShortChineseProvider(() => this.getNgramProviderState()),
            ...(this.ablationMode === 'full-stack' ? [new ShortEnglishProvider()] : []),
            new NgramProvider(() => this.getNgramProviderState()),
          ]),
    ];
  }

  private getNgramProviderState(): NgramProviderState {
    return {
      n: this.n,
      l1: this.l1,
      personalL2: this.l2,
      notebook: this.getNotebookLongTable(),
      l3: this.l3,
      wordL3: this.l3Word,
      l3CountScale: this.l3CountScale,
      shortL1: this.shortL1,
      shortPersonalL2: this.shortL2,
      shortNotebook: this.getNotebookShortTable(),
      ablationMode: this.ablationMode,
      recentPhrases: this.recentPhrases,
      lexiconTerms: [...this.documentLexicon, ...this.excerptLexicon, ...this.acceptedLexicon],
      qualityGate: (result, cursorPos, doc) => this.applyQualityGate(result, cursorPos, doc),
    };
  }

  private async retrieveCandidates(
    context: CompletionContext,
    deadlineAt: number,
    externalSignal?: AbortSignal,
  ): Promise<{
    candidates: HybridRetrievalCandidate[];
    timedOut: boolean;
    fellBack: boolean;
  }> {
    const remaining = deadlineAt - performance.now();
    if (remaining <= 0) return { candidates: [], timedOut: true, fellBack: true };
    if (externalSignal?.aborted) return { candidates: [], timedOut: false, fellBack: true };
    const controller = new AbortController();
    let timedOut = false;
    const onAbort = () => controller.abort(externalSignal?.reason);
    externalSignal?.addEventListener('abort', onAbort, { once: true });
    if (externalSignal?.aborted) controller.abort(externalSignal.reason);
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort('deadline');
    }, remaining);
    try {
      const candidates = await this.retrievalService.query(
        context.doc.slice(0, context.cursorPos),
        getLocalLanguageHint(context),
        8,
        controller.signal,
      );
      if (controller.signal.aborted || performance.now() > deadlineAt) {
        return { candidates: [], timedOut: timedOut || !externalSignal?.aborted, fellBack: true };
      }
      return { candidates, timedOut: false, fellBack: candidates.length === 0 };
    } finally {
      clearTimeout(timeout);
      externalSignal?.removeEventListener('abort', onAbort);
    }
  }

  private isHybridRetrievalEnabled(context: CompletionContext): boolean {
    return (
      !context.emptyLine && (this.ablationMode === 'full-stack' || this.ablationMode === 'l2-only')
    );
  }

  private isPublicEngineEnabled(context: CompletionContext): boolean {
    return (
      !context.emptyLine &&
      context.atEndOfLine &&
      context.syntax.type === 'general' &&
      (context.blockType === 'paragraph' ||
        context.blockType === 'list' ||
        context.blockType === 'quote') &&
      (this.ablationMode === 'full-stack' || this.ablationMode === 'l3-only')
    );
  }

  private toRetrievalCandidate(
    candidate: HybridRetrievalCandidate,
    cursorPos: number,
  ): CompletionCandidate {
    return {
      text: candidate.text,
      confidence: candidate.confidence,
      from: cursorPos,
      providerId: candidate.providerId,
      source: 'recent',
      sourceLayer: 'notebook',
      syntaxType: 'phrase-retrieval',
      learnable: true,
      priority: 73,
    };
  }

  private commitPrediction(
    candidate: CompletionCandidate | null,
    context: CompletionContext,
    startedAt: number,
  ): PredictionResult | null {
    this.lastPredictionProviderId = candidate?.providerId ?? null;
    this.lastPredictionSourceLayer = candidate?.sourceLayer;
    this.lastPredictionSyntaxType = candidate?.syntaxType;
    this.lastPredictionInformationScore = candidate?.informationScore;
    this.lastPredictionFeedbackKey = candidate ? this.getFeedbackKey(candidate, context) : null;
    this.lastPredictionRejectionKey = candidate ? this.getRejectionKey(candidate, context) : null;
    this.lastPredictionLearningKey = candidate ? getLearningSignalKey(candidate, context) : null;
    if (!candidate) return null;

    const feedbackToken = this.capturePredictionFeedback(candidate, context);
    const result = this.toPredictionResult(candidate, feedbackToken);
    recordProviderShown(candidate, performance.now() - startedAt, this.storageScope);
    this.recordLearningSignalShown(candidate, context);
    return result;
  }

  private toPredictionResult(
    candidate: CompletionCandidate,
    feedbackToken?: string,
  ): PredictionResult {
    return {
      text: candidate.text,
      confidence: candidate.confidence,
      from: candidate.from,
      source: candidate.source === 'recent' ? 'ngram' : candidate.source,
      sourceLayer: candidate.sourceLayer,
      syntaxType: candidate.syntaxType,
      providerId: candidate.providerId,
      learnable: candidate.learnable,
      informationScore: candidate.informationScore,
      learningBoost: candidate.learningBoost,
      learningPenalty: candidate.learningPenalty,
      feedbackToken,
    };
  }

  private shouldWriteAcceptedNgram(feedback = this.currentPredictionFeedback()): boolean {
    if (
      !feedback.providerId ||
      !feedback.sourceLayer ||
      feedback.syntaxType === 'markdown-structure'
    ) {
      return true;
    }
    const candidate: CompletionCandidate = {
      text: '',
      confidence: 0,
      from: 0,
      providerId: feedback.providerId,
      source: 'ngram',
      sourceLayer: feedback.sourceLayer,
      syntaxType: feedback.syntaxType ?? 'general',
      informationScore: feedback.informationScore,
      learnable: true,
      priority: 0,
    };
    return !(isWeakLearningSource(candidate) && (feedback.informationScore ?? 0) < 0.5);
  }

  private capturePredictionFeedback(
    candidate: CompletionCandidate,
    context: CompletionContext,
  ): string {
    const token = `${this.storageScope}:${++this.predictionSequence}`;
    this.predictionFeedback.set(token, {
      providerId: candidate.providerId,
      sourceLayer: candidate.sourceLayer,
      syntaxType: candidate.syntaxType,
      informationScore: candidate.informationScore,
      feedbackKey: this.getFeedbackKey(candidate, context),
      rejectionKey: this.getRejectionKey(candidate, context),
      learningKey: getLearningSignalKey(candidate, context),
      storageScope: this.storageScope,
    });
    while (this.predictionFeedback.size > 32) {
      const oldest = this.predictionFeedback.keys().next().value as string | undefined;
      if (!oldest) break;
      this.predictionFeedback.delete(oldest);
    }
    return token;
  }

  private consumePredictionFeedback(token?: string): PredictionFeedbackSnapshot {
    if (token) {
      const snapshot = this.predictionFeedback.get(token);
      this.predictionFeedback.delete(token);
      if (snapshot && snapshot.storageScope === this.storageScope) return snapshot;
      return this.emptyPredictionFeedback();
    }
    return this.currentPredictionFeedback();
  }

  private emptyPredictionFeedback(): PredictionFeedbackSnapshot {
    return {
      providerId: null,
      sourceLayer: undefined,
      syntaxType: undefined,
      informationScore: undefined,
      feedbackKey: null,
      rejectionKey: null,
      learningKey: null,
      storageScope: '',
    };
  }

  private resetLastPredictionFeedback(): void {
    this.lastPredictionProviderId = null;
    this.lastPredictionSourceLayer = undefined;
    this.lastPredictionSyntaxType = undefined;
    this.lastPredictionInformationScore = undefined;
    this.lastPredictionFeedbackKey = null;
    this.lastPredictionRejectionKey = null;
    this.lastPredictionLearningKey = null;
  }

  private currentPredictionFeedback(): PredictionFeedbackSnapshot {
    return {
      providerId: this.lastPredictionProviderId,
      sourceLayer: this.lastPredictionSourceLayer,
      syntaxType: this.lastPredictionSyntaxType,
      informationScore: this.lastPredictionInformationScore,
      feedbackKey: this.lastPredictionFeedbackKey,
      rejectionKey: this.lastPredictionRejectionKey,
      learningKey: this.lastPredictionLearningKey,
      storageScope: this.storageScope,
    };
  }

  private recordLearningSignalShown(
    candidate: CompletionCandidate,
    context: CompletionContext,
  ): void {
    const key = getLearningSignalKey(candidate, context);
    this.learningSignals = recordSignalShown(this.learningSignals, key);
    persistLearningSignalEvent(this.storageScope, key, 'shown');
  }

  private recordLearningSignalAccepted(
    savedChars: number,
    feedback = this.currentPredictionFeedback(),
  ): void {
    if (!feedback.learningKey || feedback.storageScope !== this.storageScope) return;
    this.learningSignals = recordSignalAccepted(
      this.learningSignals,
      feedback.learningKey,
      savedChars,
    );
    persistLearningSignalEvent(feedback.storageScope, feedback.learningKey, 'accepted', savedChars);
  }

  private recordLearningSignalRejected(feedback = this.currentPredictionFeedback()): void {
    if (!feedback.learningKey || feedback.storageScope !== this.storageScope) return;
    this.learningSignals = recordSignalRejected(this.learningSignals, feedback.learningKey);
    persistLearningSignalEvent(feedback.storageScope, feedback.learningKey, 'rejected');
  }

  private rememberRecentPhrase(text: string): void {
    const phrase = text.trim();
    if (phrase.length < 4) return;
    this.recentPhrases = [phrase, ...this.recentPhrases.filter((item) => item !== phrase)].slice(
      0,
      50,
    );
  }

  private rememberAcceptedLexicon(text: string): void {
    const terms = extractLexiconTerms(text);
    if (terms.length === 0) return;
    this.acceptedLexicon = [
      ...terms,
      ...this.acceptedLexicon.filter((item) => !terms.includes(item)),
    ].slice(0, 80);
  }

  private getFeedbackKey(candidate: CompletionCandidate, context: CompletionContext): string {
    const prefix = (context.sentencePrefix || context.line?.beforeCursor || '').slice(-12);
    const paragraphKey = hashFeedbackParagraph(context.paragraphBeforeCursor);
    return `${candidate.providerId}|${candidate.syntaxType}|${context.blockType}|${paragraphKey}|${prefix}`;
  }

  private getRejectionKey(candidate: CompletionCandidate, context: CompletionContext): string {
    const normalizedSuggestion = candidate.text
      .normalize('NFKC')
      .trim()
      .replace(/\s+/gu, ' ')
      .toLocaleLowerCase('en-US');
    return `${context.blockType}|${context.paragraphStart}|${hashFeedbackParagraph(normalizedSuggestion)}`;
  }

  private getMetricAdjustment(candidate: CompletionCandidate, metrics: MetricsStore): number {
    const layerKey = `${candidate.providerId}:${candidate.sourceLayer ?? 'unknown'}`;
    const syntaxKey = `${layerKey}:${candidate.syntaxType ?? 'unknown'}`;
    const entries = [metrics.syntaxTypes[syntaxKey], metrics.layers[layerKey]].filter(
      (item): item is NonNullable<typeof item> => Boolean(item),
    );
    if (entries.length === 0) return 0;

    const shown = entries.reduce((sum, item) => sum + item.shown, 0);
    if (shown < 6) return 0;
    const accepted = entries.reduce((sum, item) => sum + item.accepted, 0);
    const rejected = entries.reduce((sum, item) => sum + item.rejected, 0);
    const acceptRate = accepted / shown;
    const rejectRate = rejected / shown;
    const weakSource =
      candidate.sourceLayer === 'fallback' ||
      candidate.sourceLayer === 'l3' ||
      candidate.providerId === 'short-chinese-fallback' ||
      candidate.providerId === 'short-english';

    if (weakSource && acceptRate < 0.12 && rejectRate >= 0.25) return -0.12;
    if (weakSource && acceptRate < 0.1) return -0.06;
    if (!weakSource && acceptRate >= 0.45) return 0.04;
    return 0;
  }

  private applyQualityGate(
    result: PredictionResult,
    cursorPos: number,
    doc: string,
  ): PredictionResult | null {
    return evaluatePredictionQualityGate(result, cursorPos, doc, this.settings.maxSuggestionLength)
      .result;
  }

  private scanShortDocument(text: string): NGramTable {
    const { short2, short3 } = scanShortTables(text);
    return mergeTables(short2, short3);
  }

  private persistPersonalFeedback(
    ctx: string,
    text: string,
    event: 'accepted' | 'rejected',
    writeNgram: boolean,
  ): void {
    const scope = this.storageScope;
    const keys = this.storageKeys();
    const n = this.n;
    const acceptedTerms = event === 'accepted' ? extractLexiconTerms(text) : [];
    runCompletionStorageMutation(`personal:${scope}`, () => {
      const stored = deserializePersonalModel(readStorage(keys.model), n) ?? {
        long: new Map(),
        short2: new Map(),
        short3: new Map(),
      };

      if (writeNgram) {
        const short2Context = takeLastCodePoints(ctx, 2);
        const short3Context = takeLastCodePoints(ctx, 3);
        if (event === 'accepted') {
          ngramLearn(stored.long, ctx, text, n);
          const shortAccepted = takeFirstCodePoints(text, 6);
          if (codePointLength(short2Context) === 2) {
            ngramLearn(stored.short2, short2Context, shortAccepted, 2);
          }
          if (codePointLength(short3Context) === 3) {
            ngramLearn(stored.short3, short3Context, shortAccepted, 3);
          }
        } else {
          rejectPrediction(stored.long, ctx, text);
          rejectPrediction(stored.short2, short2Context, text);
          rejectPrediction(stored.short3, short3Context, text);
        }
      }

      prunePersonalTablesToBudget(stored.long, stored.short2, stored.short3);
      const acceptedLexicon = mergeAcceptedLexicon(
        parseAcceptedLexicon(readStorage(keys.acceptedLexicon)) ?? [],
        acceptedTerms,
      );
      const previousMeta = parseL2Meta(readStorage(keys.meta));
      const nextMeta: L2Meta = {
        schemaVersion: 4,
        docs: previousMeta?.docs ?? 0,
        totalEntries: personalEntryCount(stored.long, stored.short2, stored.short3),
        lastSave: Date.now(),
        migratedFrom: previousMeta?.migratedFrom,
      };
      writeStorage(keys.model, serializePersonalModel(stored.long, stored.short2, stored.short3));
      writeStorage(keys.acceptedLexicon, JSON.stringify(acceptedLexicon));
      writeStorage(keys.meta, JSON.stringify(nextMeta));
      removeStorage(...keys.legacyScoped);
    });
  }

  private loadFromLocalStorage(): void {
    const keys = this.storageKeys();
    this.resetPersistentLearningState();
    migrateLegacyAcceptedLexicon(keys.acceptedLexicon);
    removeStorage(...keys.legacyScoped);

    const model = deserializePersonalModel(readStorage(keys.model), this.n);
    if (model) {
      this.l2 = model.long;
      this.personalShort2 = model.short2;
      this.personalShort3 = model.short3;
      this.rebuildPersonalShortTable();
      for (const ctx of this.l2.keys()) this.entryFlags.set(ctx, 'u');
    } else if (readStorage(keys.model) !== null) {
      removeStorage(keys.model);
      this.l2Meta.lastError = 'storage-read-failed';
    }

    const meta = parseL2Meta(readStorage(keys.meta));
    if (meta) this.l2Meta = meta;
    else if (readStorage(keys.meta) !== null) removeStorage(keys.meta);

    const acceptedLexicon = parseAcceptedLexicon(readStorage(keys.acceptedLexicon));
    this.acceptedLexicon = acceptedLexicon ?? [];
    if (acceptedLexicon === null && readStorage(keys.acceptedLexicon) !== null) {
      removeStorage(keys.acceptedLexicon);
    }
    this.l2Meta.totalEntries = personalEntryCount(
      this.l2,
      this.personalShort2,
      this.personalShort3,
    );
    this.invalidatePredictionCaches();
    this.captureStorageRevisions();
  }

  private maybeEliminate(): void {
    const model = serializePersonalModel(this.l2, this.personalShort2, this.personalShort3);
    const size = utf8ByteLength(model);
    if (size > PERSONAL_MODEL_MAX_BYTES) this.forceEliminate(PERSONAL_MODEL_TARGET_BYTES, size);
  }

  private forceEliminate(targetSize?: number, currentSize?: number): void {
    const target = targetSize ?? PERSONAL_MODEL_TARGET_BYTES;
    let projectedSize =
      currentSize ??
      utf8ByteLength(serializePersonalModel(this.l2, this.personalShort2, this.personalShort3));
    if (projectedSize <= target) return;
    const scored: Array<{
      table: NGramTable;
      ctx: string;
      score: number;
      estimatedBytes: number;
    }> = [];
    const now = Date.now();

    for (const table of [this.l2, this.personalShort2, this.personalShort3]) {
      for (const [ctx, preds] of table) {
        const totalFreq = [...preds.values()].reduce((a, b) => a + b, 0);
        const lastAccess = this.accessTimestamps.get(ctx) ?? 0;
        const daysSinceAccess = lastAccess > 0 ? Math.max(0, (now - lastAccess) / 86400000) : 365;
        const recencyDecay = 1 / (1 + daysSinceAccess / 30);
        scored.push({
          table,
          ctx,
          score: totalFreq * recencyDecay,
          estimatedBytes: estimateSerializedEntryBytes(ctx, preds),
        });
      }
    }

    scored.sort((a, b) => a.score - b.score);
    for (const { table, ctx, estimatedBytes } of scored) {
      if (projectedSize <= target) break;
      table.delete(ctx);
      this.accessTimestamps.delete(ctx);
      this.entryFlags.delete(ctx);
      projectedSize -= estimatedBytes;
    }
    this.rebuildPersonalShortTable();
    this.invalidatePredictionCaches();
  }

  private createDocumentContribution(
    text: string,
    fingerprint = fingerprintText(text),
  ): DocumentContribution {
    const started = performance.now();
    const inputBytes = new TextEncoder().encode(text).byteLength;
    if (inputBytes > MAX_NOTEBOOK_DOCUMENT_BYTES) {
      return emptyDocumentContribution(fingerprint, performance.now() - started, inputBytes);
    }
    const { short2, short3 } = scanShortTables(text);
    const long = scanDocument(text, this.n);
    return {
      fingerprint,
      // Keep count=1 transitions until workspace aggregation. Pruning here would
      // erase phrases that occur once per note but consistently across notes.
      long,
      short2,
      short3,
      inputBytes,
      entryCount: personalEntryCount(long, short2, short3),
      buildMs: performance.now() - started,
    };
  }

  private addNotebookContribution(contribution: DocumentContribution): void {
    this.notebookInputBytes += contribution.inputBytes;
    this.notebookEntryCount += contribution.entryCount;
    mergeInto(this.notebookLong, contribution.long);
    mergeInto(this.notebookShort2, contribution.short2);
    mergeInto(this.notebookShort3, contribution.short3);
    mergePresenceInto(this.notebookLongSupport, contribution.long);
    mergePresenceInto(this.notebookShort2Support, contribution.short2);
    mergePresenceInto(this.notebookShort3Support, contribution.short3);
  }

  private subtractNotebookContribution(contribution: DocumentContribution): void {
    this.notebookInputBytes = Math.max(0, this.notebookInputBytes - contribution.inputBytes);
    this.notebookEntryCount = Math.max(0, this.notebookEntryCount - contribution.entryCount);
    subtractFrom(this.notebookLong, contribution.long);
    subtractFrom(this.notebookShort2, contribution.short2);
    subtractFrom(this.notebookShort3, contribution.short3);
    subtractPresenceFrom(this.notebookLongSupport, contribution.long);
    subtractPresenceFrom(this.notebookShort2Support, contribution.short2);
    subtractPresenceFrom(this.notebookShort3Support, contribution.short3);
  }

  private rebuildPersonalShortTable(): void {
    this.shortL2 = mergeTables(this.personalShort2, this.personalShort3);
  }

  private getNotebookLongTable(): NGramTable {
    return (this.notebookLongCache ??= filterNotebookTable(
      this.notebookLong,
      this.notebookLongSupport,
    ));
  }

  private getNotebookShortTable(): NGramTable {
    if (!this.notebookShortCache) {
      this.notebookShortCache = mergeTables(
        filterNotebookTable(this.notebookShort2, this.notebookShort2Support),
        filterNotebookTable(this.notebookShort3, this.notebookShort3Support),
      );
    }
    return this.notebookShortCache;
  }

  private invalidatePredictionCaches(): void {
    this.notebookLongCache = null;
    this.notebookShortCache = null;
  }

  private markPersonalContextsAccessed(ctx: string, acceptedText: string, timestamp: number): void {
    const points = Array.from(`${takeLastCodePoints(ctx, this.n)}${acceptedText}`);
    for (let index = 0; index < points.length - this.n; index++) {
      const context = points.slice(index, index + this.n).join('');
      this.accessTimestamps.set(context, timestamp);
      this.entryFlags.set(context, 'u');
    }
  }

  private extractContext(cursorPos: number, doc: string): string {
    return takeLastCodePoints(doc.slice(0, cursorPos), this.n);
  }

  getLineAt(pos: number, doc: string): { text: string; from: number; to: number } | null {
    return getLineAt(pos, doc);
  }

  isInFencedCode(cursorPos: number, doc: string): boolean {
    return isInFencedCode(cursorPos, doc);
  }

  isInFrontmatter(cursorPos: number, doc: string): boolean {
    return isInFrontmatter(cursorPos, doc);
  }

  detectOpenFormat(lineText: string, colInLine: number): string | null {
    return detectOpenFormat(lineText, colInLine);
  }
}

function getBaselineUrls(): string[] {
  const configured =
    import.meta.env.DEV || import.meta.env.MODE === 'e2e'
      ? import.meta.env.VITE_AUTOCOMPLETE_BASELINE_URL
      : '';
  // Public v4 is no longer a production fallback. Tests retain an explicit
  // loader hook for frozen-v4 diagnostics, and E2E may install one exact
  // candidate URL; neither path is reachable in an ordinary build.
  if (!baselineLoaderOverrides && !configured) return [];
  const urls = [
    configured,
    ...(baselineLoaderOverrides ? ['/baseline-ngram.web-local.compact.txt'] : []),
  ].filter(Boolean);
  return [...new Set(urls)];
}

async function loadSharedBaseline(n: number): Promise<BaselineTables> {
  const fetcher = baselineLoaderOverrides?.fetcher ?? globalThis.fetch;
  if (typeof fetcher !== 'function') return emptyBaselineTables();
  if (baselineSingleton?.fetcher === fetcher && baselineSingleton.n === n) {
    return baselineSingleton.promise;
  }

  const dependencies: Required<
    Pick<BaselineLoaderDependencies, 'fetcher' | 'sha256' | 'minEntryCount'>
  > & {
    cache: BaselineCacheAdapter | null;
  } = {
    fetcher,
    cache:
      baselineLoaderOverrides && 'cache' in baselineLoaderOverrides
        ? (baselineLoaderOverrides.cache ?? null)
        : createCacheStorageAdapter(),
    sha256: baselineLoaderOverrides?.sha256 ?? sha256Text,
    minEntryCount: baselineLoaderOverrides?.minEntryCount ?? 100,
  };
  baselineParseDiagnostics = createParseDiagnostics();
  loadedBaselineIdentity = null;
  const promise = loadBaselineWithFallback(n, dependencies);
  baselineSingleton = { fetcher, n, promise };
  return promise;
}

async function loadBaselineWithFallback(
  n: number,
  dependencies: Required<
    Pick<BaselineLoaderDependencies, 'fetcher' | 'sha256' | 'minEntryCount'>
  > & {
    cache: BaselineCacheAdapter | null;
  },
): Promise<BaselineTables> {
  for (const modelUrl of getBaselineUrls()) {
    const manifestUrl = getBaselineManifestUrl(modelUrl);
    const network = await readNetworkBaseline(manifestUrl, modelUrl, n, dependencies.fetcher);
    if (network) {
      const validated = await validateBaseline(network, n, dependencies);
      if (validated) {
        loadedBaselineIdentity = createLoadedBaselineIdentity(modelUrl, network.manifest);
        await safeWriteBaselineCache(dependencies.cache, manifestUrl, modelUrl, network);
        return validated;
      }
    }

    const cached = await safeReadBaselineCache(dependencies.cache, manifestUrl, modelUrl);
    if (cached) {
      const validated = await validateBaseline(cached, n, dependencies);
      if (validated) {
        loadedBaselineIdentity = createLoadedBaselineIdentity(modelUrl, cached.manifest);
        return validated;
      }
    }
  }
  return emptyBaselineTables();
}

function createLoadedBaselineIdentity(
  modelUrl: string,
  rawManifest: string,
): LoadedBaselineIdentity | null {
  const manifest = parseBaselineManifest(rawManifest);
  if (!manifest) return null;
  return {
    modelUrl,
    modelSha256: manifest.sha256,
    modelBytes: manifest.modelBytes,
    profile: manifest.profile,
    trainingInputHash: manifest.trainingInputHash,
  };
}

async function readNetworkBaseline(
  manifestUrl: string,
  modelUrl: string,
  n: number,
  fetcher: typeof fetch,
): Promise<{ manifest: string; model: string } | null> {
  try {
    const manifestResponse = await fetcher(manifestUrl);
    if (!manifestResponse.ok) return null;
    const manifest = await manifestResponse.text();
    const parsed = parseBaselineManifest(manifest);
    if (!parsed || parsed.ngramN !== n || parsed.modelBytes > BASELINE_MAX_BYTES) return null;
    const modelResponse = await fetcher(modelUrl);
    if (!modelResponse.ok) return null;
    const model = await modelResponse.text();
    return { manifest, model };
  } catch {
    return null;
  }
}

async function validateBaseline(
  input: { manifest: string; model: string },
  n: number,
  dependencies: Pick<BaselineLoaderDependencies, 'sha256' | 'minEntryCount'> & {
    sha256: (text: string) => Promise<string>;
    minEntryCount: number;
  },
): Promise<BaselineTables | null> {
  const manifest = parseBaselineManifest(input.manifest);
  if (!manifest || manifest.ngramN !== n) return null;
  const modelBytes = utf8ByteLength(input.model);
  if (
    modelBytes === 0 ||
    modelBytes > BASELINE_MAX_BYTES ||
    modelBytes !== manifest.modelBytes ||
    !isPlausibleBaselineAsset(input.model, manifest)
  ) {
    return null;
  }
  try {
    if ((await dependencies.sha256(input.model)).toLowerCase() !== manifest.sha256) return null;
  } catch {
    return null;
  }
  const tables = await deserializeBaselineTablesAsync(input.model, {
    diagnostics: baselineParseDiagnostics,
  });
  if (!tables) return null;
  const totalEntries = tables.character.size + tables.word.size;
  if (
    totalEntries !== manifest.entryCount ||
    totalEntries < Math.max(1, dependencies.minEntryCount) ||
    (manifest.schemaVersion === 2 &&
      (tables.character.size !== manifest.characterEntryCount ||
        tables.word.size !== manifest.wordEntryCount))
  ) {
    return null;
  }
  const minN = manifest.schemaVersion === 2 ? (manifest.minNgramN ?? n) : n;
  if (
    [...tables.character.keys()].some((ctx) => {
      const length = codePointLength(ctx);
      return length < minN || length > n;
    })
  ) {
    return null;
  }
  tables.countScale = manifest.countScale ?? 1;
  return tables;
}

function parseBaselineManifest(raw: string): BaselineManifest | null {
  try {
    const value = JSON.parse(raw) as Partial<BaselineManifest>;
    if (
      (value.schemaVersion !== 1 && value.schemaVersion !== 2) ||
      (value.profile !== 'web-local' && value.profile !== 'release') ||
      typeof value.modelFile !== 'string' ||
      !/^baseline-ngram\.[a-z0-9.-]+\.compact\.txt$/u.test(value.modelFile) ||
      (value.serialization !== 'jsonl-hex-v3-fixed-int' &&
        value.serialization !== 'sectioned-jsonl-hex-v4') ||
      (value.order !== 'lexicographic-context-hex' &&
        value.order !== 'section-profile-context-hex') ||
      value.verifiedOnly !== true ||
      value.runtimeEligible !== true ||
      typeof value.qualityGatePassed !== 'boolean' ||
      typeof value.releaseEligible !== 'boolean' ||
      value.hardLimitPassed !== true ||
      !Number.isSafeInteger(value.ngramN) ||
      !Number.isSafeInteger(value.modelBytes) ||
      !Number.isSafeInteger(value.entryCount) ||
      Number(value.modelBytes) <= 0 ||
      Number(value.entryCount) <= 0 ||
      !/^[a-f0-9]{64}$/u.test(value.sha256 ?? '') ||
      !/^[a-f0-9]{64}$/u.test(value.trainingInputHash ?? '')
    ) {
      return null;
    }
    const isReleased = value.qualityGatePassed === true && value.releaseEligible === true;
    const isExplicitE2eCandidate =
      import.meta.env.MODE === 'e2e' &&
      value.qualityGatePassed === false &&
      value.releaseEligible === false &&
      typeof value.rcRuntimeCandidateTier === 'string' &&
      value.rcRuntimeCandidateTier.length > 0;
    if (!isReleased && !isExplicitE2eCandidate) return null;
    if (
      (value.schemaVersion === 1 &&
        (value.serialization !== 'jsonl-hex-v3-fixed-int' ||
          value.order !== 'lexicographic-context-hex')) ||
      (value.schemaVersion === 2 &&
        (value.serialization !== 'sectioned-jsonl-hex-v4' ||
          value.order !== 'section-profile-context-hex' ||
          !Number.isSafeInteger(value.minNgramN) ||
          Number(value.minNgramN) < 2 ||
          Number(value.minNgramN) > Number(value.ngramN) ||
          !Array.isArray(value.wordNgramOrders) ||
          value.wordNgramOrders.some(
            (order) => !Number.isSafeInteger(order) || Number(order) < 1 || Number(order) > 3,
          ) ||
          !Number.isSafeInteger(value.countScale) ||
          Number(value.countScale) <= 0 ||
          !Number.isSafeInteger(value.characterEntryCount) ||
          !Number.isSafeInteger(value.wordEntryCount) ||
          Number(value.characterEntryCount) <= 0 ||
          Number(value.wordEntryCount) < 0 ||
          Number(value.characterEntryCount) + Number(value.wordEntryCount) !==
            Number(value.entryCount)))
    ) {
      return null;
    }
    return value as BaselineManifest;
  } catch {
    return null;
  }
}

function isPlausibleBaselineAsset(model: string, manifest: BaselineManifest): boolean {
  const start = model.trimStart();
  return manifest.schemaVersion === 2
    ? start.startsWith('# jotluck-baseline-v4\n[character]\n')
    : start.startsWith('[');
}

function emptyBaselineTables(): BaselineTables {
  return { character: new Map(), word: new Map(), countScale: 1 };
}

function getBaselineManifestUrl(modelUrl: string): string {
  return modelUrl.endsWith('.txt')
    ? `${modelUrl.slice(0, -'.txt'.length)}.manifest.json`
    : `${modelUrl}.manifest.json`;
}

function createCacheStorageAdapter(): BaselineCacheAdapter | null {
  if (typeof globalThis.caches === 'undefined') return null;
  return {
    async read(manifestUrl, modelUrl) {
      const cache = await globalThis.caches.open(BASELINE_CACHE_NAME);
      const manifestResponse = await cache.match(manifestUrl);
      if (!manifestResponse) return null;
      const manifest = await manifestResponse.text();
      const parsed = parseBaselineManifest(manifest);
      if (!parsed) return null;
      const hashedManifestResponse = await cache.match(
        baselineManifestCacheKey(manifestUrl, parsed.sha256),
      );
      const verifiedManifest = hashedManifestResponse
        ? await hashedManifestResponse.text()
        : manifest;
      const verifiedParsed = parseBaselineManifest(verifiedManifest);
      if (!verifiedParsed || verifiedParsed.sha256 !== parsed.sha256) return null;
      const modelResponse = await cache.match(baselineModelCacheKey(modelUrl, parsed.sha256));
      if (!modelResponse) return null;
      return { manifest: verifiedManifest, model: await modelResponse.text() };
    },
    async write(manifestUrl, modelUrl, manifest, model) {
      const parsed = parseBaselineManifest(manifest);
      if (!parsed) return;
      const cache = await globalThis.caches.open(BASELINE_CACHE_NAME);
      await Promise.all([
        cache.put(
          manifestUrl,
          new Response(manifest, { headers: { 'content-type': 'application/json' } }),
        ),
        cache.put(
          baselineManifestCacheKey(manifestUrl, parsed.sha256),
          new Response(manifest, { headers: { 'content-type': 'application/json' } }),
        ),
        cache.put(
          baselineModelCacheKey(modelUrl, parsed.sha256),
          new Response(model, { headers: { 'content-type': 'text/plain; charset=utf-8' } }),
        ),
      ]);
    },
  };
}

function baselineManifestCacheKey(manifestUrl: string, sha256: string): string {
  const separator = manifestUrl.includes('?') ? '&' : '?';
  return `${manifestUrl}${separator}jotluck-sha256=${sha256}`;
}

function baselineModelCacheKey(modelUrl: string, sha256: string): string {
  const separator = modelUrl.includes('?') ? '&' : '?';
  return `${modelUrl}${separator}jotluck-sha256=${sha256}`;
}

async function safeReadBaselineCache(
  cache: BaselineCacheAdapter | null,
  manifestUrl: string,
  modelUrl: string,
): Promise<{ manifest: string; model: string } | null> {
  if (!cache) return null;
  try {
    return await cache.read(manifestUrl, modelUrl);
  } catch {
    return null;
  }
}

async function safeWriteBaselineCache(
  cache: BaselineCacheAdapter | null,
  manifestUrl: string,
  modelUrl: string,
  input: { manifest: string; model: string },
): Promise<void> {
  if (!cache) return;
  try {
    await cache.write(manifestUrl, modelUrl, input.manifest, input.model);
  } catch {
    // Cache Storage is an offline optimization, never a prediction dependency.
  }
}

async function sha256Text(text: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error('Web Crypto unavailable');
  const digest = await subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function serializePersonalModel(long: NGramTable, short2: NGramTable, short3: NGramTable): string {
  return [
    PERSONAL_MODEL_HEADER,
    '[long]',
    serialize(long),
    '[short2]',
    serialize(short2),
    '[short3]',
    serialize(short3),
  ].join('\n');
}

function deserializePersonalModel(
  raw: string | null,
  n: number,
): { long: NGramTable; short2: NGramTable; short3: NGramTable } | null {
  if (!raw || !raw.startsWith(`${PERSONAL_MODEL_HEADER}\n`)) return null;
  const longStart = raw.indexOf('[long]\n');
  const short2Start = raw.indexOf('\n[short2]\n');
  const short3Start = raw.indexOf('\n[short3]\n');
  if (
    longStart !== PERSONAL_MODEL_HEADER.length + 1 ||
    short2Start < 0 ||
    short3Start < short2Start
  ) {
    return null;
  }
  const long = deserialize(raw.slice(longStart + '[long]\n'.length, short2Start));
  const short2 = deserialize(raw.slice(short2Start + '\n[short2]\n'.length, short3Start));
  const short3 = deserialize(raw.slice(short3Start + '\n[short3]\n'.length));
  if (
    [...long.keys()].some((ctx) => codePointLength(ctx) !== n) ||
    [...short2.keys()].some((ctx) => codePointLength(ctx) !== 2) ||
    [...short3.keys()].some((ctx) => codePointLength(ctx) !== 3)
  ) {
    return null;
  }
  return { long, short2, short3 };
}

function parseL2Meta(raw: string | null): L2Meta | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<L2Meta>;
    return parsed.schemaVersion === 4 ? normalizeL2Meta(parsed) : null;
  } catch {
    return null;
  }
}

function parseAcceptedLexicon(raw: string | null): string[] | null {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return null;
    return parsed
      .filter((item): item is string => typeof item === 'string' && item.length <= 80)
      .slice(0, 80);
  } catch {
    return null;
  }
}

function isValidAcceptedLexiconJson(raw: string | null): boolean {
  return raw !== null && parseAcceptedLexicon(raw) !== null;
}

function scanShortTables(text: string): { short2: NGramTable; short3: NGramTable } {
  return { short2: scanDocument(text, 2), short3: scanDocument(text, 3) };
}

function subtractFrom(target: NGramTable, source: NGramTable): void {
  for (const [ctx, sourcePredictions] of source) {
    const targetPredictions = target.get(ctx);
    if (!targetPredictions) continue;
    for (const [next, count] of sourcePredictions) {
      const remaining = (targetPredictions.get(next) ?? 0) - count;
      if (remaining > 0) targetPredictions.set(next, remaining);
      else targetPredictions.delete(next);
    }
    if (targetPredictions.size === 0) target.delete(ctx);
  }
}

function mergePresenceInto(target: NGramTable, source: NGramTable): void {
  for (const [ctx, sourcePredictions] of source) {
    let targetPredictions = target.get(ctx);
    if (!targetPredictions) {
      targetPredictions = new Map();
      target.set(ctx, targetPredictions);
    }
    for (const next of sourcePredictions.keys()) {
      targetPredictions.set(next, (targetPredictions.get(next) ?? 0) + 1);
    }
  }
}

function subtractPresenceFrom(target: NGramTable, source: NGramTable): void {
  for (const [ctx, sourcePredictions] of source) {
    const targetPredictions = target.get(ctx);
    if (!targetPredictions) continue;
    for (const next of sourcePredictions.keys()) {
      const remaining = (targetPredictions.get(next) ?? 0) - 1;
      if (remaining > 0) targetPredictions.set(next, remaining);
      else targetPredictions.delete(next);
    }
    if (targetPredictions.size === 0) target.delete(ctx);
  }
}

function filterNotebookTable(
  counts: NGramTable,
  documentSupport: NGramTable,
  minDocumentSupport = 2,
): NGramTable {
  const filtered: NGramTable = new Map();
  for (const [ctx, predictions] of counts) {
    const support = documentSupport.get(ctx);
    if (!support) continue;
    const retained = [...predictions.entries()]
      .filter(([next]) => (support.get(next) ?? 0) >= minDocumentSupport)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 3);
    if (retained.length > 0) filtered.set(ctx, new Map(retained));
  }
  return filtered;
}

function personalEntryCount(...tables: NGramTable[]): number {
  return tables.reduce((sum, table) => sum + table.size, 0);
}

function emptyDocumentContribution(
  fingerprint: string,
  buildMs: number,
  inputBytes = 0,
): DocumentContribution {
  return {
    fingerprint,
    long: new Map(),
    short2: new Map(),
    short3: new Map(),
    inputBytes,
    entryCount: 0,
    buildMs,
  };
}

function mergeAcceptedLexicon(existing: string[], additions: string[]): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const term of [...additions, ...existing]) {
    const normalized = term.trim();
    const key = /[A-Za-z]/u.test(normalized) ? normalized.toLocaleLowerCase('en-US') : normalized;
    if (!normalized || seen.has(key)) continue;
    seen.add(key);
    merged.push(normalized);
    if (merged.length >= 80) break;
  }
  return merged;
}

function prunePersonalTablesToBudget(
  long: NGramTable,
  short2: NGramTable,
  short3: NGramTable,
): void {
  const initial = serializePersonalModel(long, short2, short3);
  let projectedSize = utf8ByteLength(initial);
  if (projectedSize <= PERSONAL_MODEL_MAX_BYTES) return;

  const entries: Array<{
    table: NGramTable;
    ctx: string;
    score: number;
    bytes: number;
  }> = [];
  for (const table of [long, short2, short3]) {
    for (const [ctx, predictions] of table) {
      entries.push({
        table,
        ctx,
        score: [...predictions.values()].reduce((sum, count) => sum + count, 0),
        bytes: estimateSerializedEntryBytes(ctx, predictions),
      });
    }
  }
  entries.sort((a, b) => a.score - b.score || a.ctx.localeCompare(b.ctx));
  for (const entry of entries) {
    if (projectedSize <= PERSONAL_MODEL_TARGET_BYTES) break;
    if (!entry.table.delete(entry.ctx)) continue;
    projectedSize -= entry.bytes;
  }
}

function estimateSerializedEntryBytes(ctx: string, preds: Map<string, number>): number {
  return utf8ByteLength(serialize(new Map([[ctx, preds]]))) + 1;
}

function utf8ByteLength(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

function normalizeNonNegativeInteger(value: unknown): number {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : 0;
}

function normalizeOptionalPositiveInteger(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : undefined;
}

function codePointLength(text: string): number {
  return Array.from(text).length;
}

function takeLastCodePoints(text: string, count: number): string {
  return Array.from(text).slice(-count).join('');
}

function takeFirstCodePoints(text: string, count: number): string {
  return Array.from(text).slice(0, count).join('');
}

function normalizeContributionPath(path: string): string {
  return path.trim().replace(/\\/gu, '/');
}

function detectPublicCursorBoundary(
  document: string,
  cursorPos: number,
): PublicEngineCursorBoundary {
  const previous = Array.from(document.slice(0, cursorPos)).at(-1) ?? '';
  if (/^[\p{L}\p{N}_]$/u.test(previous)) return 'word';
  if (/^\s$/u.test(previous)) return 'space';
  if (/^[\p{P}\p{S}]$/u.test(previous)) return 'punctuation';
  return 'other';
}

function fingerprintText(text: string): string {
  let hash = 2166136261;
  for (const point of text) {
    hash ^= point.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return `${text.length.toString(36)}-${(hash >>> 0).toString(36)}`;
}

function extractLexiconTerms(text: string): string[] {
  const counts = new Map<string, number>();
  const clean = text.replace(/```[\s\S]*?```/g, ' ').replace(/\[[^\]]+\]\([^)]+\)/g, ' ');

  for (const match of clean.matchAll(/[\u3400-\u9fff]{2,12}/gu)) {
    const segment = match[0];
    for (let size = 2; size <= Math.min(8, segment.length); size++) {
      for (let index = 0; index <= segment.length - size; index++) {
        const term = segment.slice(index, index + size);
        if (isLowValueLexiconTerm(term)) continue;
        counts.set(term, (counts.get(term) ?? 0) + 1);
      }
    }
  }

  for (const match of clean.matchAll(/[A-Za-z][A-Za-z0-9_-]{2,24}/g)) {
    const term = match[0];
    counts.set(term, (counts.get(term) ?? 0) + 1);
  }

  return [...counts]
    .filter(([term, count]) => count >= 2 || term.length >= 4)
    .sort((a, b) => b[1] - a[1] || a[0].length - b[0].length)
    .map(([term]) => term)
    .slice(0, 120);
}

function isLowValueLexiconTerm(term: string): boolean {
  return /^[的是了在和与及或而但并就都很更再也还又把被对为以中上下一个可以需要应该因为所以这里那里这种这个]+$/u.test(
    term,
  );
}

function hashFeedbackParagraph(text: string): string {
  let hash = 0;
  const sample = text.slice(-160);
  for (let index = 0; index < sample.length; index++) {
    hash = (hash * 31 + sample.charCodeAt(index)) >>> 0;
  }
  return hash.toString(36);
}
