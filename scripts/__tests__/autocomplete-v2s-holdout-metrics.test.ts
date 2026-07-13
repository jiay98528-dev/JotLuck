import { describe, expect, it } from 'vitest';
import {
  isV2SCandidateUsable,
  validateV2SHoldout,
  type V2SCheckpoint,
  type V2SHoldout,
  type V2SHoldoutPolicy,
  type V2SNoteCategory,
} from '../autocomplete-v2s/holdout';
import {
  calculateV2SEvaluation,
  type V2SEvaluationObservation,
  type V2SObservedCandidate,
} from '../autocomplete-v2s/evaluator';

const CATEGORIES: readonly V2SNoteCategory[] = [
  'field-observation',
  'maintenance-log',
  'meeting-note',
  'reading-note',
  'household-plan',
];

const CATEGORY_ZH: Record<V2SNoteCategory, string> = {
  'field-observation': '现场观察',
  'maintenance-log': '维护记录',
  'meeting-note': '会议纪要',
  'reading-note': '阅读笔记',
  'household-plan': '家务计划',
};

const UNIT_POLICY: V2SHoldoutPolicy = {
  targets: 10,
  checkpoints: 40,
  complete: 30,
  silence: 10,
  checkpointsPerTarget: 4,
  targetsPerLanguage: 5,
  checkpointsPerLanguage: 20,
  completePerLanguage: 15,
  silencePerLanguage: 5,
  targetsPerCategory: 2,
  checkpointsPerCategory: 8,
  completePerCategory: 6,
  silencePerCategory: 2,
  maximumNearReferenceRatio: 1,
  maximumStructureRatio: 0.1,
};

function makeColdHoldout(): V2SHoldout {
  let targetOrdinal = 0;
  const targets = (['zh', 'en'] as const).flatMap((language) =>
    CATEGORIES.map((category) => {
      const ordinal = targetOrdinal++;
      const suffixes = Array.from({ length: 3 }, (_, checkpointOrdinal) =>
        language === 'zh'
          ? `${CATEGORY_ZH[category]}完成第${ordinal}${checkpointOrdinal}项复核记录`
          : ` ${category.replaceAll('-', ' ')} records item ${ordinal}${checkpointOrdinal} evidence`,
      );
      const text = suffixes.map((suffix, index) => `段落${index}${suffix}`).join('。');
      const checkpoints: V2SCheckpoint[] = suffixes.map((suffix, checkpointOrdinal) => ({
        id: `${language}-${ordinal}-complete-${checkpointOrdinal}`,
        cursorOffset: text.indexOf(suffix),
        expectedBehavior: 'complete',
        acceptableSuffixes: [
          suffix,
          language === 'zh'
            ? `${CATEGORY_ZH[category]}补充第${ordinal}${checkpointOrdinal}组验证材料`
            : ` ${category.replaceAll('-', ' ')} preserves alternate ${ordinal}${checkpointOrdinal} detail`,
          language === 'zh'
            ? `${CATEGORY_ZH[category]}确认第${ordinal}${checkpointOrdinal}组校准结果`
            : ` ${category.replaceAll('-', ' ')} confirms calibrated ${ordinal}${checkpointOrdinal} outcome`,
        ],
      }));
      checkpoints.push({
        id: `${language}-${ordinal}-silence`,
        cursorOffset: text.length,
        expectedBehavior: 'silence',
        acceptableSuffixes: [],
      });
      return {
        id: `${language}-${ordinal}-target`,
        path: `targets/${language}-${ordinal}.md`,
        language,
        category,
        structureId: `structure-${language}-${ordinal}`,
        text,
        checkpoints,
      };
    }),
  );
  return {
    schema: 'jotluck.autocomplete.v2s-holdout.v1',
    schemaVersion: 1,
    datasetId: 'unit-cold-validation-v2s-v1',
    frozenAt: '2026-07-13T00:00:00.000Z',
    classification: 'cold-validation-v2s-v1',
    authorship: 'independently-reviewed-manual',
    releaseEvidence: true,
    description: 'Unit-only balanced holdout fixture.',
    supportDocuments: [],
    targets,
  };
}

const publicCandidate = (text: string): V2SObservedCandidate => ({
  text,
  providerId: 'public-v2s-mkn-v1',
  sourceLayer: 'l3',
});

function makeReleaseObservations(): V2SEvaluationObservation[] {
  const observations: V2SEvaluationObservation[] = [];
  for (const [categoryOrdinal, category] of CATEGORIES.entries()) {
    for (const language of ['zh', 'en'] as const) {
      for (let local = 0; local < 20; local++) {
        const complete = local < 15;
        const suffix =
          language === 'zh'
            ? `记录第${categoryOrdinal}${local}项校准结果`
            : ` records calibrated item ${categoryOrdinal}${local}`;
        const checkpoint: V2SCheckpoint = {
          id: `${category}-${language}-${local}`,
          cursorOffset: 0,
          expectedBehavior: complete ? 'complete' : 'silence',
          acceptableSuffixes: complete ? [suffix, `${suffix} safely`, `${suffix} clearly`] : [],
        };
        const oracleHit = complete && local < 9;
        const combinedHit = complete && local < (language === 'zh' ? 7 : 8);
        const b0Hit = complete && local < 4;
        const text =
          language === 'zh' ? `记录第${categoryOrdinal}${local}项` : ` records calibrated`;
        observations.push({
          checkpointId: checkpoint.id,
          language,
          category,
          checkpoint,
          b0Top1: b0Hit ? publicCandidate(text) : null,
          publicCandidates: oracleHit ? [publicCandidate(text)] : [],
          combinedTop1: combinedHit ? publicCandidate(text) : null,
          allRequestLatencyMs: 10,
          visibleLatencyMs: combinedHit ? 9 : undefined,
          fallback: false,
          timeout: false,
          rejectionReasons: oracleHit && !combinedHit ? ['gate-abstain'] : [],
        });
      }
    }
  }
  return observations;
}

describe('Public V2S holdout and release metrics', () => {
  it('validates the balanced, manually attributed holdout contract', () => {
    expect(validateV2SHoldout(makeColdHoldout(), UNIT_POLICY)).toMatchObject({
      targets: 10,
      checkpoints: 40,
      complete: 30,
      silence: 10,
      languageCheckpoints: { zh: 20, en: 20 },
      maximumStructureRatio: 0.1,
    });
  });

  it('enforces meaningful whole-word and Chinese continuations', () => {
    const english: V2SCheckpoint = {
      id: 'english-complete',
      cursorOffset: 0,
      expectedBehavior: 'complete',
      acceptableSuffixes: [' records calibrated evidence'],
    };
    const chinese: V2SCheckpoint = {
      id: 'chinese-complete',
      cursorOffset: 0,
      expectedBehavior: 'complete',
      acceptableSuffixes: ['记录校准结果'],
    };
    expect(isV2SCandidateUsable(' records', english, 'en')).toBe(true);
    expect(isV2SCandidateUsable(' reco', english, 'en')).toBe(false);
    expect(isV2SCandidateUsable('记录校准', chinese, 'zh')).toBe(true);
    expect(isV2SCandidateUsable('记录', chinese, 'zh')).toBe(false);
  });

  it('uses the absolute 200-checkpoint denominator and passes the registered margin', () => {
    const report = calculateV2SEvaluation('cold-validation-v2s-v1', makeReleaseObservations());
    expect(report.combined).toMatchObject({
      opportunities: 200,
      triggers: 75,
      usable: 75,
      silenceFalseTriggers: 0,
    });
    expect(report.publicOracle).toMatchObject({
      oracleAt8Hits: 90,
      oracleAt32Hits: 90,
    });
    expect(report.architectureGate).toEqual({ passed: true, reasons: [] });
    expect(report.releaseGate).toEqual({ passed: true, reasons: [] });
    expect(report.validationMargin).toEqual({ passed: true, reasons: [] });
  });

  it('fails closed on a truncated observation set and full-pool mixed candidate', () => {
    expect(() =>
      calculateV2SEvaluation('cold-validation-v2s-v1', makeReleaseObservations().slice(1)),
    ).toThrow(/exactly 200/u);

    const mixed = makeReleaseObservations();
    mixed[0]!.publicCandidates = [publicCandidate('记录 mixed result')];
    const report = calculateV2SEvaluation('cold-validation-v2s-v1', mixed);
    expect(report.mixedPublicCandidates).toBe(1);
    expect(report.releaseGate.passed).toBe(false);
  });
});
