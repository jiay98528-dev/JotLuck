import { isCandidateUsable, type V2RHoldoutV3 } from './holdout-v3';
import { isTrainablePublicPhrase, type V2RLanguage } from './phrase-extraction';
import type { V2RPhraseBankEntry } from './training-data';

export interface V2RPhraseBankRepresentationSlice {
  opportunities: number;
  completeOpportunities: number;
  representable: number;
  absoluteRate: number;
  positiveRecall: number;
}

export interface V2RPhraseBankRepresentationReport {
  overall: V2RPhraseBankRepresentationSlice;
  byLanguage: Record<V2RLanguage, V2RPhraseBankRepresentationSlice>;
  missedCheckpointIds: string[];
  passed: boolean;
  reasons: string[];
}

export interface V2RPhraseBankRepresentationThresholds {
  minimumAbsoluteRate: number;
  minimumLanguageAbsoluteRate: number;
}

export const V2R_PHRASE_BANK_REPRESENTATION_THRESHOLDS: V2RPhraseBankRepresentationThresholds = {
  minimumAbsoluteRate: 0.7,
  minimumLanguageAbsoluteRate: 0.65,
};

/**
 * Computes an optimistic upper bound before classifier training. A checkpoint
 * is representable when any phrase-bank entry is a legal prefix of one of its
 * frozen references. Ranking can only reduce this number, so a failure here
 * must stop the bounded training matrix before CPU time is spent.
 */
export function calculateV2RPhraseBankRepresentation(
  holdout: V2RHoldoutV3,
  phraseBank: readonly V2RPhraseBankEntry[],
  thresholds: V2RPhraseBankRepresentationThresholds = V2R_PHRASE_BANK_REPRESENTATION_THRESHOLDS,
): V2RPhraseBankRepresentationReport {
  validatePhraseBank(phraseBank);
  const byLanguageEntries = {
    zh: phraseBank.filter((entry) => entry.language === 'zh'),
    en: phraseBank.filter((entry) => entry.language === 'en'),
  } as const;
  const observations = holdout.targets.flatMap((target) =>
    target.checkpoints.map((checkpoint) => ({
      checkpoint,
      language: target.language,
      representable:
        checkpoint.expectedBehavior === 'complete' &&
        byLanguageEntries[target.language].some((entry) =>
          isCandidateUsable(entry.text, checkpoint, target.language),
        ),
    })),
  );
  if (observations.length === 0)
    throw new Error('Phrase-bank representation requires checkpoints.');
  const overall = calculateSlice(observations);
  const byLanguage = {
    zh: calculateSlice(observations.filter((item) => item.language === 'zh')),
    en: calculateSlice(observations.filter((item) => item.language === 'en')),
  };
  const reasons: string[] = [];
  if (overall.absoluteRate < thresholds.minimumAbsoluteRate) {
    reasons.push(
      `Phrase-bank absolute representation ${overall.absoluteRate} is below ${thresholds.minimumAbsoluteRate}.`,
    );
  }
  for (const language of ['zh', 'en'] as const) {
    if (byLanguage[language].absoluteRate < thresholds.minimumLanguageAbsoluteRate) {
      reasons.push(
        `${language} phrase-bank representation ${byLanguage[language].absoluteRate} is below ${thresholds.minimumLanguageAbsoluteRate}.`,
      );
    }
  }
  return {
    overall,
    byLanguage,
    missedCheckpointIds: observations
      .filter((item) => item.checkpoint.expectedBehavior === 'complete' && !item.representable)
      .map((item) => item.checkpoint.id),
    passed: reasons.length === 0,
    reasons,
  };
}

function calculateSlice(
  observations: readonly {
    checkpoint: { expectedBehavior: 'complete' | 'silence' };
    representable: boolean;
  }[],
): V2RPhraseBankRepresentationSlice {
  const completeOpportunities = observations.filter(
    (item) => item.checkpoint.expectedBehavior === 'complete',
  ).length;
  const representable = observations.filter((item) => item.representable).length;
  return {
    opportunities: observations.length,
    completeOpportunities,
    representable,
    absoluteRate: ratio(representable, observations.length),
    positiveRecall: ratio(representable, completeOpportunities),
  };
}

function validatePhraseBank(phraseBank: readonly V2RPhraseBankEntry[]): void {
  if (phraseBank.length === 0) throw new Error('Phrase bank is empty.');
  const indexes = new Set<number>();
  const texts = new Set<string>();
  for (const entry of phraseBank) {
    if (
      !Number.isSafeInteger(entry.index) ||
      entry.index < 0 ||
      indexes.has(entry.index) ||
      !entry.id ||
      texts.has(entry.text) ||
      !isTrainablePublicPhrase(entry.text, entry.language)
    ) {
      throw new Error(`Phrase bank entry is invalid: ${entry.id || entry.index}.`);
    }
    indexes.add(entry.index);
    texts.add(entry.text);
  }
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}
