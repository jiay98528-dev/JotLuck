export type V25OneUnitWritingLanguage = 'en' | 'zh';

export type V25OneUnitTriggerReason = 'sentence-already-ended' | 'low-v25-model-score';

export interface V25OneUnitTriggerInput {
  language: V25OneUnitWritingLanguage;
  prefix: string;
  /** exp(length-normalized generator log score), matching the public runtime contract. */
  modelScore: number;
}

export type V25OneUnitTriggerDecision =
  | { allowed: true; reason: null }
  | { allowed: false; reason: V25OneUnitTriggerReason };

/**
 * Frozen from the r22 calibration split. These are deliberately low floors:
 * display coverage remains the primary product goal while obvious completed
 * sentences and the weakest candidates are suppressed.
 */
export const V25_ONE_UNIT_MODEL_SCORE_FLOORS = Object.freeze({
  en: 0.0745673611471674,
  zh: 0.0842532026246352,
});

const ENGLISH_STRONG_TERMINATORS = /[.!?]$/u;
const CHINESE_STRONG_TERMINATORS = /[。！？：；.!?;:]$/u;

/** Host-owned, deterministic display trigger for V2.5 one-unit Writing. */
export function evaluateV25OneUnitWritingTrigger(
  input: V25OneUnitTriggerInput,
): V25OneUnitTriggerDecision {
  const prefix = input.prefix.trimEnd();
  const ended =
    input.language === 'en'
      ? ENGLISH_STRONG_TERMINATORS.test(prefix)
      : CHINESE_STRONG_TERMINATORS.test(prefix);
  if (ended) return rejected('sentence-already-ended');

  if (
    !Number.isFinite(input.modelScore) ||
    input.modelScore < V25_ONE_UNIT_MODEL_SCORE_FLOORS[input.language]
  ) {
    return rejected('low-v25-model-score');
  }
  return { allowed: true, reason: null };
}

function rejected(reason: V25OneUnitTriggerReason): V25OneUnitTriggerDecision {
  return { allowed: false, reason };
}
