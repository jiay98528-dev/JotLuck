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
      candidates.push({ ...normalized, confidence: Math.min(0.99, normalized.confidence + boost) });
    }
  }

  if (candidates.length === 0) return { candidate: null, providerCount: providers.length };

  candidates.sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    return b.confidence - a.confidence;
  });

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
  if (!isStructured && isLowValueCandidate(text, candidate, context)) return null;
  if (!isStructured && candidate.confidence < context.settings.minConfidence) return null;

  return {
    ...candidate,
    text,
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
    if (candidate.providerId === 'ngram' && isWebBoilerplateContext(context)) return true;
    if (/^(and|or|but|the|a|an|to|of|in|on|for|with)$/i.test(trimmed)) return true;
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
