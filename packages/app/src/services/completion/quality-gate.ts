import type { PredictionResult } from '@/utils/ngram-engine';

export type PredictionQualityGateReason =
  | 'empty'
  | 'multiline'
  | 'repeated-character'
  | 'markdown-marker-run'
  | 'leading-whitespace'
  | 'language-mismatch'
  | 'sentence-already-ended';

export interface PredictionQualityGateEvaluation {
  result: PredictionResult | null;
  reason: PredictionQualityGateReason | null;
}

/** Pure quality gate shared by runtime prediction and offline evaluation. */
export function evaluatePredictionQualityGate(
  result: PredictionResult,
  cursorPos: number,
  doc: string,
  maxSuggestionLength: number,
): PredictionQualityGateEvaluation {
  let text = result.text.slice(0, maxSuggestionLength);
  if (result.syntaxType === 'word-en' && result.text.length > text.length) {
    const boundary = text.lastIndexOf(' ');
    if (boundary > 0) text = text.slice(0, boundary);
  }
  if (!text.trim()) return rejected('empty');
  if (text.includes('\r') || text.includes('\n')) return rejected('multiline');
  if (/(.)\1{4,}/u.test(text)) return rejected('repeated-character');
  if (/^[*_#`~]{3,}/u.test(text)) return rejected('markdown-marker-run');
  if (/^\s{2,}/u.test(text)) return rejected('leading-whitespace');

  const localContext = doc.slice(Math.max(0, cursorPos - 12), cursorPos);
  const first = text.trimStart()[0] ?? '';
  const localLanguage = inferLocalWritingLanguage(localContext);
  if (
    (localLanguage === 'zh' && /[A-Za-z]/u.test(first)) ||
    (localLanguage === 'en' && /[\u3400-\u9fff]/u.test(first))
  ) {
    return rejected('language-mismatch');
  }
  if (/[。！？!?；;：:]$/u.test(localContext.trim())) {
    return rejected('sentence-already-ended');
  }

  return { result: { ...result, text }, reason: null };
}

function rejected(reason: PredictionQualityGateReason): PredictionQualityGateEvaluation {
  return { result: null, reason };
}

function inferLocalWritingLanguage(text: string): 'zh' | 'en' | 'unknown' {
  const fragments = text.match(/[\u3400-\u9fff]+|[A-Za-z][A-Za-z'-]*/gu) ?? [];
  const nearest = fragments[fragments.length - 1];
  if (!nearest) return 'unknown';
  return /[\u3400-\u9fff]/u.test(nearest) ? 'zh' : 'en';
}
