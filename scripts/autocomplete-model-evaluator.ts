import * as crypto from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { DEFAULT_COMPLETION_SETTINGS } from '../packages/app/src/services/CompletionSettings';
import {
  buildCompletionContext,
  getLocalLanguageHint,
} from '../packages/app/src/services/completion/context';
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
} from '../packages/app/src/services/completion/providers';
import {
  evaluatePredictionQualityGate,
  type PredictionQualityGateReason,
} from '../packages/app/src/services/completion/quality-gate';
import {
  createCompletionResolverTrace,
  resolveCompletion,
  type CompletionResolverRejectionReason,
  type CompletionResolverTrace,
} from '../packages/app/src/services/completion/resolver';
import type {
  CompletionCandidate,
  CompletionContext,
  CompletionProvider,
} from '../packages/app/src/services/completion/types';
import {
  createParseDiagnostics,
  predictMany,
  type NGramTable,
  type ParseDiagnostics,
  type PredictionResult,
} from '../packages/app/src/utils/ngram-engine';
import {
  deserializeBaselineTablesAsync,
  predictWordCompletions,
  tokenizeEnglishWords,
  wordContext,
  type BaselineTables,
} from '../packages/app/src/utils/word-ngram-engine';
import type { FormalHoldout, FormalHoldoutCheckpoint } from './train-baseline';

export const AUTOCOMPLETE_MODEL_EVALUATOR_VERSION = 'offline-completion-evaluator-v2';
const PARSE_CHUNK_LINES = 256;

export interface GateTraceSummary {
  evaluated: number;
  rejected: number;
  rejectionRate: number;
  reasons: Partial<Record<PredictionQualityGateReason, number>>;
}

export interface ResolverTraceSummary {
  rawCandidates: number;
  normalizedCandidates: number;
  deduplicatedCandidates: number;
  rejected: number;
  rejectionRate: number;
  reasons: Partial<Record<CompletionResolverRejectionReason, number>>;
}

export interface EvaluationLayerSummary {
  triggers: number;
  triggerRate: number;
  usable: number;
  usableRate: number;
  falseTriggers: number;
  falseTriggerRate: number;
  unusableTriggers: number;
  mixedCandidates: number;
  mixedOpportunities: number;
  /** @deprecated Use visiblePredictionP90Ms. */
  p90Ms: number;
  allRequestP90Ms: number;
  visiblePredictionP90Ms: number;
  fallbackRate: number;
  timeoutRate: number;
  qualityGate: GateTraceSummary;
  resolver: ResolverTraceSummary;
  attribution: Record<string, number>;
}

export interface AutocompleteModelEvaluation {
  schemaVersion: 2;
  evaluatorVersion: typeof AUTOCOMPLETE_MODEL_EVALUATOR_VERSION;
  model: {
    sha256: string;
    bytes: number;
    characterEntries: number;
    wordEntries: number;
    countScale: number;
    parse: ParseDiagnostics;
  };
  holdout: {
    datasetId: string;
    sha256: string;
    documents: number;
    opportunities: number;
    completeOpportunities: number;
    silenceOpportunities: number;
  };
  l3Raw: {
    contextHits: number;
    contextHitRate: number;
    top1Hits: number;
    top1Rate: number;
    top3Hits: number;
    top3Rate: number;
    top8Hits: number;
    top8Rate: number;
    oracleAt8Hits: number;
    oracleAt8Rate: number;
  };
  l3Only: EvaluationLayerSummary;
  fullStack: EvaluationLayerSummary;
  verdicts: {
    governance: EvaluationVerdict;
    runtimeSafety: EvaluationVerdict;
    modelQuality: EvaluationVerdict;
  };
  samples: EvaluationSample[];
}

export interface EvaluationVerdict {
  status: 'pass' | 'fail';
  reasons: string[];
}

interface EvaluationSample {
  checkpointId: string;
  behavior: FormalHoldoutCheckpoint['expectedBehavior'];
  contextHit: boolean;
  rawTopK: string[];
  l3Suggestion: string;
  fullStackSuggestion: string;
  fullStackProvider?: string;
  fullStackLayer?: string;
}

interface MutableGateTrace {
  evaluated: number;
  rejected: number;
  reasons: Partial<Record<PredictionQualityGateReason, number>>;
}

interface MutableEvaluationSummary {
  triggers: number;
  usable: number;
  falseTriggers: number;
  unusableTriggers: number;
  mixedCandidates: number;
  mixedOpportunities: number;
  allRequestLatencies: number[];
  visibleLatencies: number[];
  gate: MutableGateTrace;
  resolver: CompletionResolverTrace;
  attribution: Record<string, number>;
}

export async function evaluateAutocompleteModel(args: {
  serialized: string;
  countScale: number;
  holdout: FormalHoldout;
}): Promise<AutocompleteModelEvaluation> {
  const parse = createParseDiagnostics();
  const tables = await deserializeBaselineTablesAsync(args.serialized, {
    chunkLines: PARSE_CHUNK_LINES,
    diagnostics: parse,
  });
  if (!tables || tables.character.size === 0) {
    throw new Error('Candidate model could not be parsed into a non-empty character table.');
  }
  const countScale = normalizeCountScale(args.countScale);
  const l3Only = createMutableSummary();
  const fullStack = createMutableSummary();
  const l3Providers = createProviders(tables, countScale, 'l3-only', l3Only.gate);
  const fullStackProviders = createProviders(tables, countScale, 'full-stack', fullStack.gate);
  const samples: EvaluationSample[] = [];
  let contextHits = 0;
  let top1Hits = 0;
  let top3Hits = 0;
  let top8Hits = 0;
  let opportunities = 0;
  let completeOpportunities = 0;
  let silenceOpportunities = 0;

  for (const document of args.holdout.cases) {
    for (const checkpoint of document.checkpoints) {
      opportunities++;
      if (checkpoint.expectedBehavior === 'complete') completeOpportunities++;
      else silenceOpportunities++;
      const prefix = document.text.slice(0, checkpoint.cursorOffset);
      const context = buildCompletionContext({
        doc: prefix,
        cursorPos: prefix.length,
        settings: { ...DEFAULT_COMPLETION_SETTINGS, backgroundTraining: false },
        indexData: null,
        n: 4,
      });
      const contextHit = hasRawL3Context(tables, context);
      if (contextHit) contextHits++;
      const rawTopK = getRawL3TopK(tables, countScale, context);
      const usableRawCandidates = rawTopK.filter((candidate) =>
        checkpoint.expectedBehavior === 'complete'
          ? isUsable(candidate, checkpoint.expectedSuffix, document.language)
          : false,
      );
      if (
        checkpoint.expectedBehavior === 'complete' &&
        rawTopK[0] &&
        isUsable(rawTopK[0], checkpoint.expectedSuffix, document.language)
      ) {
        top1Hits++;
      }
      if (
        checkpoint.expectedBehavior === 'complete' &&
        rawTopK
          .slice(0, 3)
          .some((candidate) => isUsable(candidate, checkpoint.expectedSuffix, document.language))
      ) {
        top3Hits++;
      }
      if (usableRawCandidates.length > 0) top8Hits++;

      const l3Result = evaluateProviderStack(
        context,
        l3Providers,
        checkpoint,
        document.language,
        l3Only,
      );
      const fullStackResult = evaluateProviderStack(
        context,
        fullStackProviders,
        checkpoint,
        document.language,
        fullStack,
      );
      samples.push({
        checkpointId: checkpoint.id,
        behavior: checkpoint.expectedBehavior,
        contextHit,
        rawTopK,
        l3Suggestion: l3Result?.text ?? '',
        fullStackSuggestion: fullStackResult?.text ?? '',
        ...(fullStackResult?.providerId ? { fullStackProvider: fullStackResult.providerId } : {}),
        ...(fullStackResult?.sourceLayer ? { fullStackLayer: fullStackResult.sourceLayer } : {}),
      });
    }
  }

  return {
    schemaVersion: 2,
    evaluatorVersion: AUTOCOMPLETE_MODEL_EVALUATOR_VERSION,
    model: {
      sha256: sha256(args.serialized),
      bytes: Buffer.byteLength(args.serialized, 'utf8'),
      characterEntries: tables.character.size,
      wordEntries: tables.word.size,
      countScale,
      parse,
    },
    holdout: {
      datasetId: args.holdout.datasetId,
      sha256: sha256(canonicalJson(args.holdout)),
      documents: args.holdout.cases.length,
      opportunities,
      completeOpportunities,
      silenceOpportunities,
    },
    l3Raw: {
      contextHits,
      contextHitRate: rate(contextHits, opportunities),
      top1Hits,
      top1Rate: rate(top1Hits, completeOpportunities),
      top3Hits,
      top3Rate: rate(top3Hits, completeOpportunities),
      top8Hits,
      top8Rate: rate(top8Hits, completeOpportunities),
      oracleAt8Hits: top8Hits,
      oracleAt8Rate: rate(top8Hits, completeOpportunities),
    },
    l3Only: finalizeSummary(l3Only, opportunities, silenceOpportunities),
    fullStack: finalizeSummary(fullStack, opportunities, silenceOpportunities),
    verdicts: createEvaluationVerdicts(
      args.holdout,
      finalizeSummary(fullStack, opportunities, silenceOpportunities),
      parse,
      opportunities,
      completeOpportunities,
      silenceOpportunities,
    ),
    samples,
  };
}

function createProviders(
  tables: BaselineTables,
  countScale: number,
  mode: 'l3-only' | 'full-stack',
  gateTrace: MutableGateTrace,
): CompletionProvider[] {
  const empty: NGramTable = new Map();
  const state: NgramProviderState = {
    n: 4,
    l1: empty,
    personalL2: empty,
    notebook: empty,
    l3: tables.character,
    wordL3: tables.word,
    l3CountScale: countScale,
    shortL1: empty,
    shortPersonalL2: empty,
    shortNotebook: empty,
    ablationMode: mode,
    recentPhrases: [],
    lexiconTerms: [],
    qualityGate: (result, cursorPos, doc) => {
      gateTrace.evaluated++;
      const evaluated = evaluatePredictionQualityGate(
        result,
        cursorPos,
        doc,
        DEFAULT_COMPLETION_SETTINGS.maxSuggestionLength,
      );
      if (evaluated.reason) {
        gateTrace.rejected++;
        gateTrace.reasons[evaluated.reason] = (gateTrace.reasons[evaluated.reason] ?? 0) + 1;
      }
      return evaluated.result;
    },
  };
  const ngram = new NgramProvider(() => state);
  if (mode === 'l3-only') return [ngram];
  return [
    new FormatClosureProvider(),
    new MarkdownStructureProvider(),
    new WikiLinkProvider(),
    new TagProvider(),
    new FilePathProvider(),
    new SequencePatternProvider(),
    new LineEchoProvider(),
    new LexiconProvider(() => state),
    new PhraseSlotProvider(),
    new RecentPhraseProvider(() => state),
    new ShortChineseProvider(() => state),
    new ShortEnglishProvider(),
    ngram,
  ];
}

function evaluateProviderStack(
  context: CompletionContext,
  providers: CompletionProvider[],
  checkpoint: FormalHoldoutCheckpoint,
  language: 'zh' | 'en',
  summary: MutableEvaluationSummary,
): CompletionCandidate | null {
  const trace = createCompletionResolverTrace();
  const startedAt = performance.now();
  const { candidate, rankedCandidates } = resolveCompletion(context, providers, { trace });
  const latency = Math.max(0, performance.now() - startedAt);
  summary.allRequestLatencies.push(latency);
  mergeResolverTrace(summary.resolver, trace);
  if (!candidate) return null;

  summary.triggers++;
  summary.visibleLatencies.push(latency);
  const usable =
    checkpoint.expectedBehavior === 'complete' &&
    isUsable(candidate.text, checkpoint.expectedSuffix, language);
  if (usable) summary.usable++;
  else summary.unusableTriggers++;
  if (checkpoint.expectedBehavior === 'silence') summary.falseTriggers++;
  const mixedInBatch = rankedCandidates
    .slice(0, 8)
    .filter((item) => isMixedCandidate(item.text, language)).length;
  summary.mixedCandidates += mixedInBatch;
  if (mixedInBatch > 0) summary.mixedOpportunities++;
  const attributionKey = `${candidate.providerId}:${candidate.sourceLayer ?? 'unknown'}`;
  summary.attribution[attributionKey] = (summary.attribution[attributionKey] ?? 0) + 1;
  return candidate;
}

function hasRawL3Context(tables: BaselineTables, context: CompletionContext): boolean {
  const language = getLocalLanguageHint(context);
  const beforeCursor = context.doc.slice(0, context.cursorPos);
  if (language === 'zh') {
    const points = Array.from(beforeCursor);
    for (let order = Math.min(4, points.length); order >= 2; order--) {
      if (tables.character.has(points.slice(-order).join(''))) return true;
    }
    return false;
  }
  if (language !== 'en') return false;
  if (/[A-Za-z]$/u.test(beforeCursor)) {
    return tables.character.has(Array.from(beforeCursor).slice(-4).join(''));
  }
  if (!/\s$/u.test(beforeCursor)) return false;
  const tokens = tokenizeEnglishWords(beforeCursor.slice(-320));
  for (let order = Math.min(2, tokens.length); order >= 1; order--) {
    if (tables.word.has(wordContext(tokens.slice(-order)))) return true;
  }
  return false;
}

function getRawL3TopK(
  tables: BaselineTables,
  countScale: number,
  context: CompletionContext,
): string[] {
  const language = getLocalLanguageHint(context);
  if (language === 'zh') {
    return predictMany(
      tables.character,
      context.cursorPos,
      context.doc,
      4,
      context.settings.maxSuggestionLength,
      context.settings.minConfidence,
      2,
      8,
      countScale,
    ).map((item) => item.text);
  }
  if (language !== 'en') return [];
  const beforeCursor = context.doc.slice(0, context.cursorPos);
  if (/\s$/u.test(beforeCursor)) {
    return predictWordCompletions(
      tables.word,
      context.cursorPos,
      context.doc,
      8,
      context.settings.minConfidence,
      3,
      countScale,
    ).map((item) => item.text);
  }
  if (!/[A-Za-z]$/u.test(beforeCursor)) return [];
  return predictMany(
    tables.character,
    context.cursorPos,
    context.doc,
    4,
    context.settings.maxSuggestionLength,
    context.settings.minConfidence,
    4,
    8,
    countScale,
  )
    .map((item) => toEnglishSpellingText(item))
    .filter((item): item is string => Boolean(item));
}

function toEnglishSpellingText(result: PredictionResult): string | null {
  return result.text.match(/^[A-Za-z]+(?:['’-][A-Za-z]+)*/u)?.[0] ?? null;
}

function createMutableSummary(): MutableEvaluationSummary {
  return {
    triggers: 0,
    usable: 0,
    falseTriggers: 0,
    unusableTriggers: 0,
    mixedCandidates: 0,
    mixedOpportunities: 0,
    allRequestLatencies: [],
    visibleLatencies: [],
    gate: { evaluated: 0, rejected: 0, reasons: {} },
    resolver: createCompletionResolverTrace(),
    attribution: {},
  };
}

function finalizeSummary(
  summary: MutableEvaluationSummary,
  opportunities: number,
  silenceOpportunities: number,
): EvaluationLayerSummary {
  const resolverRejected = Object.values(summary.resolver.rejectionReasons).reduce(
    (sum, count) => sum + (count ?? 0),
    0,
  );
  return {
    triggers: summary.triggers,
    triggerRate: rate(summary.triggers, opportunities),
    usable: summary.usable,
    usableRate: rate(summary.usable, opportunities),
    falseTriggers: summary.falseTriggers,
    falseTriggerRate: rate(summary.falseTriggers, silenceOpportunities),
    unusableTriggers: summary.unusableTriggers,
    mixedCandidates: summary.mixedCandidates,
    mixedOpportunities: summary.mixedOpportunities,
    p90Ms: percentile(summary.visibleLatencies, 0.9),
    allRequestP90Ms: percentile(summary.allRequestLatencies, 0.9),
    visiblePredictionP90Ms: percentile(summary.visibleLatencies, 0.9),
    fallbackRate: 0,
    timeoutRate: 0,
    qualityGate: {
      evaluated: summary.gate.evaluated,
      rejected: summary.gate.rejected,
      rejectionRate: rate(summary.gate.rejected, summary.gate.evaluated),
      reasons: summary.gate.reasons,
    },
    resolver: {
      rawCandidates: summary.resolver.rawCandidates,
      normalizedCandidates: summary.resolver.normalizedCandidates,
      deduplicatedCandidates: summary.resolver.deduplicatedCandidates,
      rejected: resolverRejected,
      rejectionRate: rate(resolverRejected, summary.resolver.rawCandidates),
      reasons: summary.resolver.rejectionReasons,
    },
    attribution: Object.fromEntries(
      Object.entries(summary.attribution).sort(([a], [b]) => a.localeCompare(b, 'en')),
    ),
  };
}

function mergeResolverTrace(
  target: CompletionResolverTrace,
  source: CompletionResolverTrace,
): void {
  target.rawCandidates += source.rawCandidates;
  target.normalizedCandidates += source.normalizedCandidates;
  target.deduplicatedCandidates += source.deduplicatedCandidates;
  for (const [reason, count] of Object.entries(source.rejectionReasons)) {
    const key = reason as CompletionResolverRejectionReason;
    target.rejectionReasons[key] = (target.rejectionReasons[key] ?? 0) + (count ?? 0);
  }
}

function isUsable(suggestion: string, expectedSuffix: string, language: 'zh' | 'en'): boolean {
  if (!suggestion) return false;
  if (language === 'en') {
    return expectedSuffix
      .toLocaleLowerCase('en-US')
      .startsWith(suggestion.toLocaleLowerCase('en-US'));
  }
  return expectedSuffix.startsWith(suggestion);
}

export function isMixedCandidate(text: string, language: 'zh' | 'en'): boolean {
  const hasCjk = /[\u3400-\u9fff]/u.test(text);
  const hasLatin = /[A-Za-z]/u.test(text);
  return (hasCjk && hasLatin) || (language === 'zh' ? hasLatin : hasCjk);
}

function normalizeCountScale(value: number): number {
  return Number.isSafeInteger(value) && value > 0 ? value : 1;
}

function rate(value: number, total: number): number {
  return total > 0 ? value / total : 0;
}

export function percentile(values: readonly number[], ratio: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))] ?? 0;
}

export function createEvaluationVerdicts(
  holdout: FormalHoldout,
  fullStack: EvaluationLayerSummary,
  parse: ParseDiagnostics,
  opportunities: number,
  completeOpportunities: number,
  silenceOpportunities: number,
): AutocompleteModelEvaluation['verdicts'] {
  const governanceReasons: string[] = [];
  if (holdout.cases.length < 50) governanceReasons.push('holdout-documents-below-50');
  if (opportunities < 200) governanceReasons.push('holdout-opportunities-below-200');
  if (silenceOpportunities < Math.ceil(opportunities * 0.2)) {
    governanceReasons.push('holdout-silence-below-20-percent');
  }

  const runtimeReasons: string[] = [];
  if (fullStack.mixedCandidates > 0) runtimeReasons.push('mixed-candidate');
  if (fullStack.allRequestP90Ms > 140) runtimeReasons.push('all-request-p90-over-140ms');
  if (fullStack.visiblePredictionP90Ms > 140) {
    runtimeReasons.push('visible-prediction-p90-over-140ms');
  }
  if (hasModelParseLongTask(parse)) {
    runtimeReasons.push('model-parse-long-task-over-50ms');
  }

  const modelReasons: string[] = [];
  if (fullStack.triggerRate < 0.35 || fullStack.triggerRate > 0.42) {
    modelReasons.push('trigger-rate-outside-35-42-percent');
  }
  if (fullStack.usableRate < 0.35) modelReasons.push('usable-rate-below-35-percent');
  if (fullStack.falseTriggerRate > 0.03) modelReasons.push('false-trigger-rate-over-3-percent');
  if (completeOpportunities === 0) modelReasons.push('no-completion-opportunities');

  return {
    governance: verdict(governanceReasons),
    runtimeSafety: verdict(runtimeReasons),
    modelQuality: verdict(modelReasons),
  };
}

export function hasModelParseLongTask(parse: ParseDiagnostics): boolean {
  return parse.longTasksOver50Ms > 0 || parse.maxChunkMs > 50;
}

function verdict(reasons: string[]): EvaluationVerdict {
  return { status: reasons.length === 0 ? 'pass' : 'fail', reasons };
}

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b, 'en'))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}
