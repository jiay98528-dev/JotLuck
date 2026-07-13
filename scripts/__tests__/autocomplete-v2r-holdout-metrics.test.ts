import { describe, expect, it } from 'vitest';
import type { V2RNoteCategory } from '../autocomplete-v2r/corpus-governance';
import {
  isCandidateUsable,
  validateV2RHoldoutV3,
  type HoldoutValidationPolicy,
  type V2RHoldoutCheckpoint,
  type V2RHoldoutV3,
} from '../autocomplete-v2r/holdout-v3';
import {
  calculateV2RQualityMetrics,
  type V2REvaluationObservation,
} from '../autocomplete-v2r/metrics';

const CATEGORIES: readonly V2RNoteCategory[] = [
  'field-observation',
  'maintenance-log',
  'meeting-note',
  'reading-note',
  'household-plan',
] as const;

const CATEGORY_ZH: Record<V2RNoteCategory, string> = {
  'field-observation': '现场观察',
  'maintenance-log': '维护记录',
  'meeting-note': '会议纪要',
  'reading-note': '阅读笔记',
  'household-plan': '家务计划',
};

const UNIT_POLICY: HoldoutValidationPolicy = {
  expectedTargetDocuments: 10,
  expectedCheckpoints: 40,
  expectedCompleteCheckpoints: 30,
  expectedSilenceCheckpoints: 10,
  expectedLanguageCheckpoints: 20,
  expectedCategoryCheckpoints: 8,
  expectedCheckpointsPerTarget: 4,
  expectedLanguageTargets: 5,
  expectedCategoryTargets: 2,
  expectedLanguageCompleteCheckpoints: 15,
  expectedLanguageSilenceCheckpoints: 5,
  expectedCategoryCompleteCheckpoints: 6,
  expectedCategorySilenceCheckpoints: 2,
  maximumNearContinuationRatio: 100,
};

function makeColdHoldout(): V2RHoldoutV3 {
  const targets = (['zh', 'en'] as const).flatMap((language) =>
    CATEGORIES.map((category, categoryIndex) => {
      const marker = `${language}-${categoryIndex}`;
      const phrases =
        language === 'zh'
          ? [
              `${CATEGORY_ZH[category]}继续记录甲${CATEGORY_ZH[category]}项差异`,
              `${CATEGORY_ZH[category]}完成复核乙${CATEGORY_ZH[category]}项变化`,
              `${CATEGORY_ZH[category]}准备确认丙${CATEGORY_ZH[category]}项结果`,
            ]
          : [
              ` ${category} captures primary evidence`,
              ` ${category} completes secondary review`,
              ` ${category} prepares final confirmation`,
            ];
      const labels =
        language === 'zh' ? ['开头', '中段', '结尾'] : ['Opening', 'Middle', 'Closing'];
      const text = labels.map((label, index) => `${label}${phrases[index]}`).join('. ');
      const checkpoints: V2RHoldoutCheckpoint[] = phrases.map((phrase, index) => ({
        id: `${marker}-complete-${index}`,
        cursorOffset: text.indexOf(phrase),
        expectedBehavior: 'complete',
        acceptableSuffixes: [
          phrase,
          language === 'zh'
            ? `${CATEGORY_ZH[category]}可以追踪${['丁', '戊', '己'][index]}项依据`
            : ` ${category} preserves ${['fourth', 'fifth', 'sixth'][index]} supporting detail`,
          language === 'zh'
            ? `${CATEGORY_ZH[category]}能够比较${['庚', '辛', '壬'][index]}项证据`
            : ` ${category} compares ${['seventh', 'eighth', 'ninth'][index]} recorded outcome`,
        ],
      }));
      checkpoints.push({
        id: `${marker}-silence`,
        cursorOffset: text.length,
        expectedBehavior: 'silence',
        acceptableSuffixes: [],
      });
      return {
        id: `${marker}-target`,
        path: `targets/${marker}.md`,
        language,
        category,
        text,
        checkpoints,
      };
    }),
  );
  return {
    schema: 'jotluck.autocomplete.multi-reference-holdout.v3',
    schemaVersion: 3,
    datasetId: 'unit-cold-validation-v3',
    frozenAt: '2026-07-12T00:00:00.000Z',
    classification: 'cold-validation-v3',
    releaseEvidence: true,
    description: 'Unit-only multi-reference fixture.',
    supportDocuments: [],
    targets,
  };
}

describe('V2R multi-reference holdout v3', () => {
  it('validates balanced targets, checkpoints, references, and immutable identity', () => {
    expect(validateV2RHoldoutV3(makeColdHoldout(), UNIT_POLICY)).toMatchObject({
      targetDocuments: 10,
      checkpoints: 40,
      completeCheckpoints: 30,
      silenceCheckpoints: 10,
      languageCheckpoints: { zh: 20, en: 20 },
      exactContinuationDuplicates: 0,
      supportContinuationOverlaps: 0,
    });
  });

  it('requires target-level and pattern-level support for workspace evidence', () => {
    const holdout = makeColdHoldout();
    holdout.classification = 'workspace-validation-v3';
    holdout.supportDocuments = (['zh', 'en'] as const).flatMap((language) => [
      {
        id: `${language}-support-a`,
        path: `support/${language}-a.md`,
        language,
        patternIds: [],
        text:
          language === 'zh'
            ? '独立资料描述另一处样本，并记录不同的判断条件。'
            : 'An independent note describes another sample with different decision conditions.',
      },
      {
        id: `${language}-support-b`,
        path: `support/${language}-b.md`,
        language,
        patternIds: [],
        text:
          language === 'zh'
            ? '第二份资料使用不同措辞，只保留相同的抽象规律。'
            : 'A second note uses different wording and retains only the abstract pattern.',
      },
    ]);
    for (const target of holdout.targets) {
      target.workspaceSupportDocumentIds = [
        `${target.language}-support-a`,
        `${target.language}-support-b`,
      ];
      for (const checkpoint of target.checkpoints) {
        if (checkpoint.expectedBehavior === 'complete') {
          checkpoint.patternId = `${target.id}:${checkpoint.id}`;
          checkpoint.supportDocumentIds = [...target.workspaceSupportDocumentIds];
        }
      }
    }
    for (const support of holdout.supportDocuments) {
      support.patternIds = holdout.targets
        .filter((target) => target.language === support.language)
        .flatMap((target) => target.checkpoints.map((checkpoint) => checkpoint.patternId))
        .filter((patternId): patternId is string => Boolean(patternId));
    }

    expect(validateV2RHoldoutV3(holdout, UNIT_POLICY)).toMatchObject({
      supportContinuationNearOverlaps: 0,
      supportDocumentNearDuplicatePairs: 0,
      targetSupportNearDuplicatePairs: 0,
    });
    holdout.supportDocuments[0]!.patternIds = [];
    expect(() => validateV2RHoldoutV3(holdout, UNIT_POLICY)).toThrow(/pattern identities/iu);
    holdout.supportDocuments[0]!.patternIds = holdout.supportDocuments[1]!.patternIds;
    delete holdout.targets[0]!.workspaceSupportDocumentIds;
    expect(() => validateV2RHoldoutV3(holdout, UNIT_POLICY)).toThrow(/target.*support/iu);
  });

  it('accepts only a meaningful full-word/full-phrase prefix of a frozen reference', () => {
    const english: V2RHoldoutCheckpoint = {
      id: 'en',
      cursorOffset: 0,
      expectedBehavior: 'complete',
      acceptableSuffixes: [
        " Next review could've started",
        ' Next check is ready',
        ' Further work is ready',
      ],
    };
    expect(isCandidateUsable(' next review', english, 'en')).toBe(true);
    expect(isCandidateUsable(' next revi', english, 'en')).toBe(false);
    expect(isCandidateUsable(' Next review could', english, 'en')).toBe(false);
    expect(isCandidateUsable(" Next review could've", english, 'en')).toBe(true);
    expect(isCandidateUsable(' next 审查', english, 'en')).toBe(false);

    const chinese: V2RHoldoutCheckpoint = {
      id: 'zh',
      cursorOffset: 0,
      expectedBehavior: 'complete',
      acceptableSuffixes: ['继续记录差异', '继续检查结果', '继续比较变化'],
    };
    expect(isCandidateUsable('继续记录', chinese, 'zh')).toBe(true);
    expect(isCandidateUsable('继续', chinese, 'zh')).toBe(false);
  });
});

function makePassingObservations(): V2REvaluationObservation[] {
  const observations: V2REvaluationObservation[] = [];
  for (const language of ['zh', 'en'] as const) {
    for (const category of CATEGORIES) {
      for (let index = 0; index < 20; index++) {
        const complete = index < 15;
        const usableCandidate = language === 'zh' ? '继续记录' : ' next review';
        const checkpoint: V2RHoldoutCheckpoint = complete
          ? {
              id: `${language}-${category}-${index}`,
              cursorOffset: 0,
              expectedBehavior: 'complete',
              acceptableSuffixes:
                language === 'zh'
                  ? ['继续记录差异', '继续检查结果', '继续比较变化']
                  : [' next review is ready', ' next check is ready', ' further work is ready'],
            }
          : {
              id: `${language}-${category}-${index}`,
              cursorOffset: 0,
              expectedBehavior: 'silence',
              acceptableSuffixes: [],
            };
        const oracle = complete && index < 14;
        const visible = complete && index < 12;
        observations.push({
          checkpointId: checkpoint.id,
          language,
          category,
          checkpoint,
          publicL3Candidates: oracle
            ? [
                {
                  text: usableCandidate,
                  providerId: 'public-phrase-transformer-v1',
                  sourceLayer: 'l3',
                  source: 'neural',
                },
              ]
            : [],
          resolverTop1: visible
            ? {
                text: usableCandidate,
                providerId: 'public-phrase-transformer-v1',
                sourceLayer: 'l3',
              }
            : null,
          allRequestLatencyMs: 40 + (index % 5),
          ...(visible ? { visibleLatencyMs: 50 + (index % 5) } : {}),
          fallback: false,
          timeout: false,
        });
      }
    }
  }
  const falseTrigger = observations.find(
    (item) => item.language === 'zh' && item.checkpoint.expectedBehavior === 'silence',
  )!;
  falseTrigger.resolverTop1 = { text: '。继续检查', providerId: 'phrase-slot', sourceLayer: 'l1' };
  falseTrigger.visibleLatencyMs = 52;
  return observations;
}

describe('V2R absolute quality and Oracle@32 metrics', () => {
  it('passes only when 120/200 are usable, trigger is 60-65%, and Oracle@32 is 140/200', () => {
    const result = calculateV2RQualityMetrics(makePassingObservations());

    expect(result.overall).toMatchObject({
      opportunities: 200,
      triggers: 121,
      triggerRate: 0.605,
      usable: 120,
      usableRate: 0.6,
      falseTriggers: 1,
      falseTriggerRate: 0.02,
      oracleAt32Hits: 140,
      oracleAt32Rate: 0.7,
    });
    expect(result.overall.conditionalPrecision).toBeCloseTo(120 / 121);
    expect(result.byLanguage.zh.usableRate).toBe(0.6);
    expect(result.byLanguage.en.usableRate).toBe(0.6);
    expect(result.candidateGate).toEqual({ passed: true, reasons: [] });
    expect(result.releaseGate).toEqual({ passed: true, reasons: [] });
  });

  it('scans the complete public L3 pool for mixed candidates', () => {
    const observations = makePassingObservations();
    observations[0]!.publicL3Candidates.push({
      text: ' continue 检查',
      providerId: 'public-phrase-transformer-v1',
      sourceLayer: 'l3',
      source: 'neural',
    });
    const result = calculateV2RQualityMetrics(observations);

    expect(result.mixedRankedCandidates).toBe(1);
    expect(result.releaseGate.passed).toBe(false);
  });

  it('rejects missing runtime latency instead of treating it as zero', () => {
    const observations = makePassingObservations();
    delete observations[0]!.allRequestLatencyMs;

    expect(() => calculateV2RQualityMetrics(observations)).toThrow(/latency evidence/u);
  });
});
