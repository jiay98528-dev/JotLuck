import type { CompletionCandidate, CompletionContext, CompletionProvider } from './types';

export interface CompletionResolverResult {
  candidate: CompletionCandidate | null;
  providerCount: number;
}

export interface CompletionResolverOptions {
  getRejectionCount?: (candidate: CompletionCandidate, context: CompletionContext) => number;
  getBoost?: (candidate: CompletionCandidate, context: CompletionContext) => number;
}

export function resolveCompletion(
  context: CompletionContext,
  providers: CompletionProvider[],
  options: CompletionResolverOptions = {},
): CompletionResolverResult {
  const candidates: CompletionCandidate[] = [];

  for (const provider of providers) {
    if (!provider.canProvide(context)) continue;
    const rawCandidates =
      provider.provideMany?.(context) ?? [provider.provide(context)].filter(Boolean);
    for (const candidate of rawCandidates) {
      if (!candidate) continue;
      const normalized = normalizeCandidate(candidate, context);
      if (!normalized) continue;
      if ((options.getRejectionCount?.(normalized, context) ?? 0) >= 2) continue;
      const boost = options.getBoost?.(normalized, context) ?? 0;
      candidates.push({
        ...normalized,
        confidence: Math.max(0, Math.min(0.99, normalized.confidence + boost)),
        learningBoost: boost > 0 ? boost : normalized.learningBoost,
        learningPenalty: boost < 0 ? Math.abs(boost) : normalized.learningPenalty,
      });
    }
  }

  if (candidates.length === 0) return { candidate: null, providerCount: providers.length };

  candidates.sort((a, b) => {
    const priorityDelta = getEffectivePriority(b) - getEffectivePriority(a);
    if (priorityDelta !== 0) return priorityDelta;
    const aRank = rankCandidate(a);
    const bRank = rankCandidate(b);
    return bRank - aRank;
  });

  // Evaluation-only observation hook. It receives a defensive copy after the
  // original fb46b1e sort and cannot participate in ranking or Top-1 choice.
  try {
    const observer = (
      globalThis as typeof globalThis & {
        __JOTLUCK_FROZEN_V1_OBSERVER__?: (items: CompletionCandidate[]) => void;
      }
    ).__JOTLUCK_FROZEN_V1_OBSERVER__;
    observer?.(candidates.map((candidate) => ({ ...candidate })));
  } catch {
    // Observability must never change the frozen engine behavior.
  }

  return { candidate: candidates[0] ?? null, providerCount: providers.length };
}

function normalizeCandidate(
  candidate: CompletionCandidate,
  context: CompletionContext,
): CompletionCandidate | null {
  const text = refineCandidateText(candidate.text, context, candidate);
  if (!text.trim()) return null;
  if (text.includes('\r') || text.includes('\n')) return null;
  if (!context.atEndOfLine && candidate.source !== 'structured') return null;

  const isStructured = candidate.source === 'structured';
  if (!isStructured && !passesLanguageGate(text, candidate, context)) return null;
  const informationScore = isStructured ? 1 : getInformationScore(text, candidate, context);
  if (!isStructured && !passesInformationGate(informationScore, text, candidate, context)) {
    return null;
  }
  if (!isStructured && isLowValueCandidate(text, candidate, context)) return null;
  if (!isStructured && candidate.confidence < context.settings.minConfidence) return null;

  return {
    ...candidate,
    text,
    informationScore,
    priority: candidate.priority,
  };
}

function refineCandidateText(
  rawText: string,
  context: CompletionContext,
  candidate: CompletionCandidate,
): string {
  const maxLength =
    context.languageHint === 'zh' &&
    candidate.source !== 'structured' &&
    candidate.syntaxType !== 'line-echo'
      ? Math.min(8, context.settings.maxSuggestionLength)
      : context.settings.maxSuggestionLength;
  const text = rawText.slice(0, maxLength);
  if (
    context.languageHint !== 'en' ||
    candidate.source === 'structured' ||
    candidate.providerId !== 'ngram'
  ) {
    return text;
  }
  if (!/\s/.test(text) || !/[A-Za-z]$/.test(text)) return text;

  const trimmed = text.replace(/\s+[A-Za-z]{3,}$/u, '').trimEnd();
  return trimmed.length >= 2 ? trimmed : text;
}

function passesLanguageGate(
  text: string,
  candidate: CompletionCandidate,
  context: CompletionContext,
): boolean {
  const trimmed = text.trim();
  const hasCjk = /[\u3400-\u9fff]/u.test(trimmed);
  const hasLatin = /[A-Za-z]/.test(trimmed);

  if (context.languageHint === 'mixed') return false;
  if (context.languageHint === 'en' && hasCjk) return false;
  if (context.languageHint === 'zh' && /^[A-Za-z]/.test(trimmed) && !isMarkdownToken(trimmed)) {
    return false;
  }
  if (hasCjk && hasLatin && candidate.syntaxType !== 'markdown-structure') return false;
  return true;
}

function isLowValueCandidate(
  text: string,
  candidate: CompletionCandidate,
  context: CompletionContext,
): boolean {
  const trimmed = text.trim();
  if (!trimmed) return true;

  if (
    (candidate.providerId === 'ngram' || candidate.providerId === 'short-chinese') &&
    context.languageHint === 'zh' &&
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

  if (context.languageHint === 'en') {
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
  return candidate.confidence + informationBonus + layerBonus;
}

function getEffectivePriority(candidate: CompletionCandidate): number {
  if (candidate.source === 'structured') return candidate.priority;
  if (candidate.providerId === 'short-chinese-fallback') return candidate.priority + 12;
  if (candidate.providerId === 'short-english') return candidate.priority - 7;
  switch (candidate.sourceLayer) {
    case 'l1':
    case 'short-l1':
      return candidate.priority + 4;
    case 'l2':
    case 'short-l2':
    case 'provider':
      return candidate.priority + 2;
    case 'l3':
      return candidate.priority - 3;
    case 'fallback':
      return candidate.priority - 25;
    default:
      return candidate.priority;
  }
}

function getSourceLayerBonus(candidate: CompletionCandidate): number {
  switch (candidate.sourceLayer) {
    case 'l1':
    case 'short-l1':
      return 0.05;
    case 'l2':
    case 'short-l2':
    case 'provider':
      return 0.03;
    case 'l3':
      return -0.03;
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

  if (context.languageHint === 'en') return getEnglishInformationScore(trimmed);
  if (context.languageHint === 'zh') return getChineseInformationScore(trimmed, candidate);
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
  if (candidate.sourceLayer === 'l3') return informationScore >= 0.34;
  if (candidate.sourceLayer === 'fallback') {
    if (context.languageHint === 'en' && isGenericEnglishFragment(text.trim())) return false;
    if (context.languageHint === 'zh') return informationScore >= 0.24;
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
