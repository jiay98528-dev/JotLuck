import { getLocalLanguageHint } from './context';
import type { CompletionCandidate, CompletionContext, CompletionProvider } from './types';

export interface CompletionResolverResult {
  candidate: CompletionCandidate | null;
  providerCount: number;
  rankedCandidates: CompletionCandidate[];
}

export interface CompletionResolverOptions {
  getRejectionCount?: (candidate: CompletionCandidate, context: CompletionContext) => number;
  getBoost?: (candidate: CompletionCandidate, context: CompletionContext) => number;
  trace?: CompletionResolverTrace;
}

export type CompletionResolverRejectionReason =
  | 'empty'
  | 'multiline'
  | 'mid-line'
  | 'language'
  | 'information'
  | 'low-value'
  | 'low-confidence'
  | 'rejected-suggestion';

export interface CompletionResolverTrace {
  rawCandidates: number;
  normalizedCandidates: number;
  deduplicatedCandidates: number;
  rejectionReasons: Partial<Record<CompletionResolverRejectionReason, number>>;
  winner: Pick<
    CompletionCandidate,
    'text' | 'providerId' | 'sourceLayer' | 'syntaxType' | 'confidence'
  > | null;
}

export function createCompletionResolverTrace(): CompletionResolverTrace {
  return {
    rawCandidates: 0,
    normalizedCandidates: 0,
    deduplicatedCandidates: 0,
    rejectionReasons: {},
    winner: null,
  };
}

export function resolveCompletion(
  context: CompletionContext,
  providers: CompletionProvider[],
  options: CompletionResolverOptions = {},
): CompletionResolverResult {
  return resolveCompletionCandidates(
    context,
    collectProviderCandidates(context, providers),
    options,
    providers.length,
  );
}

export function collectProviderCandidates(
  context: CompletionContext,
  providers: CompletionProvider[],
): CompletionCandidate[] {
  const candidates: CompletionCandidate[] = [];
  for (const provider of providers) {
    if (!provider.canProvide(context)) continue;
    const provided = provider.provideMany?.(context) ?? [provider.provide(context)];
    for (const candidate of provided) {
      if (candidate) candidates.push(candidate);
    }
  }
  return candidates;
}

export function resolveCompletionCandidates(
  context: CompletionContext,
  rawCandidates: CompletionCandidate[],
  options: CompletionResolverOptions = {},
  providerCount = 0,
): CompletionResolverResult {
  const groupedCandidates = new Map<
    string,
    Array<{ candidate: CompletionCandidate; rejectionCount: number }>
  >();

  if (options.trace) options.trace.rawCandidates += rawCandidates.length;
  for (const candidate of rawCandidates) {
    const normalizedResult = normalizeCandidate(candidate, context);
    if (!normalizedResult.candidate) {
      recordResolverRejection(options.trace, normalizedResult.reason);
      continue;
    }
    const normalized = normalizedResult.candidate;
    if (options.trace) options.trace.normalizedCandidates++;
    const rejectionCount = options.getRejectionCount?.(normalized, context) ?? 0;
    const boost = options.getBoost?.(normalized, context) ?? 0;
    const scored = {
      ...normalized,
      confidence: Math.max(0, Math.min(0.99, normalized.confidence + boost)),
      learningBoost: boost > 0 ? boost : normalized.learningBoost,
      learningPenalty: boost < 0 ? Math.abs(boost) : normalized.learningPenalty,
    };
    const key = normalizeSuggestionKey(scored.text);
    const group = groupedCandidates.get(key) ?? [];
    group.push({ candidate: scored, rejectionCount });
    groupedCandidates.set(key, group);
  }

  const candidates: CompletionCandidate[] = [];
  for (const group of groupedCandidates.values()) {
    if (options.trace) {
      options.trace.deduplicatedCandidates += Math.max(0, group.length - 1);
    }
    // A rejection belongs to the normalized suggestion, not to whichever provider
    // happened to win the previous resolver pass.
    if (group.some((entry) => entry.rejectionCount >= 2)) {
      recordResolverRejection(options.trace, 'rejected-suggestion', group.length);
      continue;
    }
    group.sort((a, b) => compareCandidates(a.candidate, b.candidate));
    const winner = group[0]?.candidate;
    if (winner) candidates.push(winner);
  }

  if (candidates.length === 0) {
    return { candidate: null, providerCount, rankedCandidates: [] };
  }

  candidates.sort(compareCandidates);

  const winner = candidates[0] ?? null;
  if (options.trace && winner) {
    options.trace.winner = {
      text: winner.text,
      providerId: winner.providerId,
      sourceLayer: winner.sourceLayer,
      syntaxType: winner.syntaxType,
      confidence: winner.confidence,
    };
  }
  return { candidate: winner, providerCount, rankedCandidates: candidates };
}

function normalizeSuggestionKey(text: string): string {
  return text.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase('en-US');
}

function compareCandidates(a: CompletionCandidate, b: CompletionCandidate): number {
  const tierDelta = getPriorityTier(b) - getPriorityTier(a);
  if (tierDelta !== 0) return tierDelta;

  // Priority selects a semantic tier, but learned confidence is allowed to
  // reorder candidates inside that tier.
  const rankDelta = rankCandidate(b) - rankCandidate(a);
  if (rankDelta !== 0) return rankDelta;

  const priorityDelta = b.priority - a.priority;
  if (priorityDelta !== 0) return priorityDelta;
  return a.providerId.localeCompare(b.providerId);
}

function getPriorityTier(candidate: CompletionCandidate): number {
  if (candidate.source === 'structured') return 6;
  if (candidate.priority >= 80) return 5;
  if (candidate.priority >= 72) return 4;
  if (candidate.priority >= 65) return 3;
  // Curated English fallbacks are safer than a generic public L3 continuation,
  // but remain below document and personal evidence.
  if (candidate.providerId === 'short-english') return 2;
  if (candidate.sourceLayer === 'fallback') return 1;
  return 2;
}

function normalizeCandidate(
  candidate: CompletionCandidate,
  context: CompletionContext,
): { candidate: CompletionCandidate | null; reason: CompletionResolverRejectionReason | null } {
  const text = refineCandidateText(candidate.text, context, candidate);
  if (!text.trim()) return rejectedCandidate('empty');
  if (text.includes('\r') || text.includes('\n')) return rejectedCandidate('multiline');
  if (!context.atEndOfLine && candidate.source !== 'structured') {
    return rejectedCandidate('mid-line');
  }

  const isStructured = candidate.source === 'structured';
  if (!isStructured && !passesLanguageGate(text, context)) return rejectedCandidate('language');
  const informationScore = isStructured ? 1 : getInformationScore(text, candidate, context);
  if (!isStructured && !passesInformationGate(informationScore, text, candidate, context)) {
    return rejectedCandidate('information');
  }
  if (!isStructured && isLowValueCandidate(text, candidate, context)) {
    return rejectedCandidate('low-value');
  }
  if (!isStructured && candidate.confidence < context.settings.minConfidence) {
    return rejectedCandidate('low-confidence');
  }

  return {
    candidate: {
      ...candidate,
      text,
      informationScore,
      priority: candidate.priority,
    },
    reason: null,
  };
}

function rejectedCandidate(reason: CompletionResolverRejectionReason): {
  candidate: null;
  reason: CompletionResolverRejectionReason;
} {
  return { candidate: null, reason };
}

function recordResolverRejection(
  trace: CompletionResolverTrace | undefined,
  reason: CompletionResolverRejectionReason | null,
  count = 1,
): void {
  if (!trace || !reason) return;
  trace.rejectionReasons[reason] = (trace.rejectionReasons[reason] ?? 0) + count;
}

function refineCandidateText(
  rawText: string,
  context: CompletionContext,
  candidate: CompletionCandidate,
): string {
  const languageHint = getLocalLanguageHint(context);
  const maxLength =
    languageHint === 'zh' &&
    candidate.source !== 'structured' &&
    candidate.syntaxType !== 'line-echo'
      ? Math.min(8, context.settings.maxSuggestionLength)
      : context.settings.maxSuggestionLength;
  const rawPoints = Array.from(rawText);
  let text = rawPoints.slice(0, maxLength).join('');
  if (languageHint === 'en' && rawPoints.length > maxLength && /\s/u.test(rawText)) {
    const boundary = text.lastIndexOf(' ');
    if (boundary > 0) text = text.slice(0, boundary);
  }
  if (
    languageHint !== 'en' ||
    candidate.source === 'structured' ||
    candidate.providerId !== 'ngram' ||
    candidate.syntaxType === 'word-en'
  ) {
    return text;
  }
  if (!/\s/.test(text) || !/[A-Za-z]$/.test(text)) return text;

  const trimmed = text.replace(/\s+[A-Za-z]{3,}$/u, '').trimEnd();
  return trimmed.length >= 2 ? trimmed : text;
}

function passesLanguageGate(text: string, context: CompletionContext): boolean {
  const trimmed = text.trim();
  const hasCjk = /[\u3400-\u9fff]/u.test(trimmed);
  const hasLatin = /[A-Za-z]/.test(trimmed);
  const languageHint = getLocalLanguageHint(context);

  if (hasCjk && hasLatin) return false;
  if (context.languageHint === 'mixed' && languageHint === 'unknown') return false;
  if (languageHint === 'mixed') return false;
  if (languageHint === 'en' && hasCjk) return false;
  if (
    languageHint === 'zh' &&
    /^[A-Za-z]/.test(trimmed) &&
    (context.languageHint === 'mixed' || !isMarkdownToken(trimmed))
  ) {
    return false;
  }
  return true;
}

function isLowValueCandidate(
  text: string,
  candidate: CompletionCandidate,
  context: CompletionContext,
): boolean {
  const trimmed = text.trim();
  if (!trimmed) return true;
  const languageHint = getLocalLanguageHint(context);

  if (
    (candidate.providerId === 'ngram' || candidate.providerId === 'short-chinese') &&
    languageHint === 'zh' &&
    /^[的了在和与及或而但并就都很更再也还又把被对为以中上下一是有用个]$/u.test(trimmed)
  ) {
    return true;
  }

  if (
    candidate.providerId === 'short-chinese-fallback' &&
    trimmed === '可以' &&
    !context.line?.beforeCursor.endsWith('可以')
  ) {
    return true;
  }

  if (languageHint === 'en') {
    const beforeCursor = context.line?.beforeCursor ?? '';
    if (
      candidate.providerId === 'ngram' &&
      candidate.sourceLayer === 'l3' &&
      ((/[A-Za-z]$/u.test(beforeCursor) && /^[A-Za-z]/u.test(text)) ||
        (/\b(?:a|an|the)$/iu.test(beforeCursor) && /^\s+[A-Za-z]/u.test(text)))
    ) {
      return true;
    }
    if (/[\u3000-\u303f\uff00-\uffef]/u.test(trimmed)) return true;
    if (candidate.providerId === 'ngram' && isWebBoilerplateContext(context)) return true;
    if (/^(and|or|but|the|a|an|to|of|in|on|for|with|is|are|was|were|status)$/i.test(trimmed)) {
      return true;
    }
    if (isWeakSource(candidate) && isGenericEnglishFragment(trimmed)) return true;
    if (/\b(?:the|a|an)\s+(?:can|should|need|must|will|would)\b/i.test(trimmed)) return true;
    if (/\b(?:are|is|was|were)\s+not\s+be\b/i.test(trimmed)) return true;
    if (/^[A-Za-z]{8,}$/.test(trimmed) && candidate.providerId === 'ngram') return true;
  }

  if (/\b(cookie|copyright|all rights reserved|login|sign up|read more)\b/i.test(trimmed)) {
    return true;
  }
  return false;
}

function isWebBoilerplateContext(context: CompletionContext): boolean {
  const beforeCursor = context.line?.beforeCursor.trim().toLowerCase() ?? '';
  return /^(?:read more|sign up|log in|login|subscribe|cookie|copyright)$/.test(beforeCursor);
}

function isMarkdownToken(text: string): boolean {
  return /^(md|markdown|html|css|js|ts|tsx|jsx|json|yaml|yml|url|http|https)\b/i.test(text);
}

function rankCandidate(candidate: CompletionCandidate): number {
  const layerBonus = getSourceLayerBonus(candidate);
  const informationBonus = (candidate.informationScore ?? 0.5) * 0.08;
  const providerBonus = candidate.providerId === 'short-english' ? 0.16 : 0;
  return candidate.confidence + informationBonus + layerBonus + providerBonus;
}

function getSourceLayerBonus(candidate: CompletionCandidate): number {
  switch (candidate.sourceLayer) {
    case 'l1':
    case 'short-l1':
      return 0.07;
    case 'l2':
    case 'short-l2':
    case 'provider':
      return 0.05;
    case 'notebook':
    case 'short-notebook':
      return 0.03;
    case 'l3':
      return -0.04;
    case 'fallback':
      return -0.06;
    default:
      return 0;
  }
}

function getInformationScore(
  text: string,
  candidate: CompletionCandidate,
  context: CompletionContext,
): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  if (/^[,.;:!?，。；：！？、]+$/u.test(trimmed)) {
    return candidate.providerId === 'phrase-slot' || candidate.sourceLayer === 'provider'
      ? 0.44
      : 0.08;
  }

  const languageHint = getLocalLanguageHint(context);
  if (languageHint === 'en') return getEnglishInformationScore(trimmed);
  if (languageHint === 'zh') return getChineseInformationScore(trimmed, candidate);
  return Math.min(0.72, 0.2 + Math.min(trimmed.length, 10) / 20);
}

function getEnglishInformationScore(text: string): number {
  const words = text.match(/[A-Za-z][A-Za-z'-]*/g) ?? [];
  if (words.length === 0) return 0.1;
  const lowerWords = words.map((word) => word.toLowerCase());
  const weakWords = lowerWords.filter((word) =>
    /^(and|or|but|the|a|an|to|of|in|on|for|with|is|are|was|were|can|status)$/i.test(word),
  ).length;
  const strongWords = lowerWords.filter(
    (word) => !/^(and|or|but|the|a|an|to|of|in|on|for|with|is|are|was|were|can)$/i.test(word),
  ).length;

  if (words.length === 1) return weakWords === 1 ? 0.12 : 0.34;
  const lengthScore = Math.min(0.26, words.join('').length / 40);
  const specificity = Math.min(0.28, strongWords * 0.1);
  const weakPenalty = Math.min(0.16, weakWords * 0.04);
  return Math.max(0.16, Math.min(0.92, 0.34 + lengthScore + specificity - weakPenalty));
}

function getChineseInformationScore(text: string, candidate: CompletionCandidate): number {
  const cjkCount = (text.match(/[\u3400-\u9fff]/gu) ?? []).length;
  if (cjkCount === 0) return 0.12;
  if (cjkCount === 1) return 0.18;
  const contentScore = Math.min(0.38, cjkCount * 0.06);
  const sourceScore = candidate.sourceLayer === 'provider' ? 0.14 : 0.08;
  const weakPenalty = isGenericChineseFragment(text) ? 0.24 : 0;
  return Math.max(0.14, Math.min(0.9, 0.28 + contentScore + sourceScore - weakPenalty));
}

function passesInformationGate(
  informationScore: number,
  text: string,
  candidate: CompletionCandidate,
  context: CompletionContext,
): boolean {
  if (candidate.syntaxType === 'line-echo') return true;
  if (candidate.providerId === 'phrase-slot' && informationScore >= 0.36) return true;
  if (candidate.sourceLayer === 'provider' && informationScore >= 0.28) return true;
  if (candidate.sourceLayer === 'l1' || candidate.sourceLayer === 'short-l1') {
    return informationScore >= 0.16;
  }
  if (candidate.sourceLayer === 'l2' || candidate.sourceLayer === 'short-l2') {
    return informationScore >= 0.16;
  }
  if (candidate.sourceLayer === 'notebook' || candidate.sourceLayer === 'short-notebook') {
    return informationScore >= 0.16;
  }
  if (candidate.sourceLayer === 'l3') return informationScore >= 0.34;
  if (candidate.sourceLayer === 'fallback') {
    const languageHint = getLocalLanguageHint(context);
    if (languageHint === 'en' && isGenericEnglishFragment(text.trim())) return false;
    if (languageHint === 'zh') return informationScore >= 0.24;
    return informationScore >= 0.42;
  }
  return informationScore >= 0.24;
}

function isWeakSource(candidate: CompletionCandidate): boolean {
  return (
    candidate.sourceLayer === 'fallback' ||
    candidate.sourceLayer === 'l3' ||
    candidate.providerId === 'short-chinese-fallback' ||
    candidate.providerId === 'short-english'
  );
}

function isGenericEnglishFragment(text: string): boolean {
  const words = text.trim().match(/[A-Za-z][A-Za-z'-]*/g) ?? [];
  if (words.length === 0) return true;
  if (words.length === 1) {
    return /^(and|or|but|the|a|an|to|of|in|on|for|with|is|are|was|were|can|status|note|notes|step|items|state|main)$/i.test(
      words[0],
    );
  }
  return words.every((word) =>
    /^(and|or|but|the|a|an|to|of|in|on|for|with|is|are|was|were|can)$/i.test(word),
  );
}

function isGenericChineseFragment(text: string): boolean {
  return /^[的了在和与及或而但并就都很更再也还又把被对为以中上下一是有用个可以需要应该因为所以这里那里这种这个]+$/u.test(
    text,
  );
}
