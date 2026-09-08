import { type NGramTable, predictMany } from '@/utils/ngram-engine';
import { containsSensitiveCompletionText } from './learning-admission';
import type {
  PublicEnginePersonalPrior,
  PublicEnginePersonalPriorPhrase,
} from './public-engine-types';
import type { CompletionContext } from './types';

/**
 * Host-side personal-prior builder for the V2.5 one-unit writing runtime
 * (ADR-024 decode-time shallow fusion). The prior merges the personal
 * long/short n-gram tables, this session's retained accepts and the
 * workspace retained-phrase store into a bounded set of one-unit
 * continuations. It travels with the generate request to the Rust worker,
 * stays in-process, and is never persisted. An empty result must return
 * `undefined` so the request omits the field and the worker search stays
 * bit-identical to baseline.
 */

/**
 * λ calibrated by the 2026-09-08 worker probe (v25-personal-prior-probe):
 * one-unit logprob gaps need a full-strength fusion weight for the user
 * word to reach the visible top-1; lower values only re-ordered near-ties.
 */
export const PERSONAL_PRIOR_FUSION_WEIGHT = 1.0;
export const PERSONAL_PRIOR_MAX_PHRASES = 8;
/** Mirrors the Rust worker contract (MAX_PERSONAL_PHRASE_CODE_POINTS). */
const PERSONAL_PRIOR_MAX_CODE_POINTS = 24;
/** One-unit Chinese contract: 1–4 code points. */
const PERSONAL_UNIT_ZH_CODE_POINTS = 4;
/** Any private-use character invalidates the outbound phrase (host-side is
 * stricter than the worker's route-marker check E100–E124). */
const PUA_RANGE = /[\uE000-\uF8FF]/u;

export interface PersonalPriorInputs {
  personalLongTable?: NGramTable | null;
  personalShortTable?: NGramTable | null;
  /** Session history insert texts for the current context tail. */
  sessionMatches?: readonly string[] | null;
  /** Retained personal phrases matching the current context suffix. */
  retainedPhrases?: readonly string[] | null;
  context: CompletionContext;
  language: 'zh' | 'en' | 'unknown';
  n: number;
  maxSuggestionLength: number;
}

interface PersonalPriorCandidate {
  text: string;
  weight: number;
}

export function buildPersonalPrior(
  inputs: PersonalPriorInputs,
): PublicEnginePersonalPrior | undefined {
  if (
    inputs.context.blockType === 'code' ||
    inputs.context.syntax.type !== 'general' ||
    inputs.context.doc.length === 0
  ) {
    return undefined;
  }
  const candidates: PersonalPriorCandidate[] = [];
  const seen = new Set<string>();
  const add = (rawText: string, confidence: number): void => {
    // Route markers and other PUA contamination invalidates the whole entry.
    if (PUA_RANGE.test(rawText)) return;
    const text = clipToOneUnit(rawText);
    if (!text) return;
    if (containsSensitiveCompletionText(text)) return;
    const key = text.normalize('NFKC').toLocaleLowerCase('en-US');
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push({
      text,
      weight: Math.min(1, Math.max(0.3, confidence)),
    });
  };

  if (inputs.personalLongTable) {
    for (const result of predictMany(
      inputs.personalLongTable,
      inputs.context.localCursorPos,
      inputs.context.doc,
      inputs.n,
      Math.min(24, Math.max(4, inputs.maxSuggestionLength)),
      0.15,
      2,
      2,
    )) {
      add(result.text, result.confidence);
    }
  }
  if (inputs.personalShortTable) {
    for (const result of predictMany(
      inputs.personalShortTable,
      inputs.context.localCursorPos,
      inputs.context.doc,
      2,
      6,
      0.55,
      2,
      2,
    )) {
      add(result.text, result.confidence);
    }
  }
  for (const insertText of inputs.sessionMatches ?? []) add(insertText, 0.82);
  for (const phrase of inputs.retainedPhrases ?? []) add(phrase, 0.9);

  if (candidates.length === 0) return undefined;
  candidates.sort((left, right) => right.weight - left.weight);
  const phrases: PublicEnginePersonalPriorPhrase[] = candidates
    .slice(0, PERSONAL_PRIOR_MAX_PHRASES)
    .map((candidate) => ({ text: candidate.text, weight: candidate.weight }));
  return { phrases, fusionWeight: PERSONAL_PRIOR_FUSION_WEIGHT };
}

/**
 * Clip raw prediction text to the one-unit contract: Chinese becomes the
 * first 1–4 Han code points; anything else becomes an optional leading space
 * plus one complete word. Texts that cannot satisfy the contract (mixed
 * scripts, over-length words, empty results) are dropped, because a clipped
 * fragment would be killed by the host display validator anyway.
 */
function clipToOneUnit(rawText: string): string {
  const text = rawText.split(/[\r\n\0]/u)[0] ?? '';
  const hasHan = /\p{Script=Han}/u.test(text);
  const hasLatin = /\p{Script=Latin}/u.test(text);
  if (hasHan && hasLatin) return '';
  if (hasHan) {
    const unit = Array.from(text).slice(0, PERSONAL_UNIT_ZH_CODE_POINTS).join('');
    return /\p{Script=Han}/u.test(unit) ? unit : '';
  }
  const match = text.match(/^\s?[A-Za-z][A-Za-z0-9'’-]*/u);
  if (!match) return '';
  const word = match[0];
  if (word.length === 0 || Array.from(word).length > PERSONAL_PRIOR_MAX_CODE_POINTS) {
    return '';
  }
  return word;
}
