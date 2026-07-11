import { describe, expect, it } from 'vitest';
import {
  assertNestedLearningCurve,
  assertNestedSelectionManifests,
  assertSyntheticOnlySourceSet,
  CANDIDATE_OUTPUT_ROOT,
  LEARNING_CURVE_TIERS,
  PRODUCTION_ROUTER_RUNTIME_EVALUATOR_VERSION,
  selectMinimumEligibleTier,
  SYNTHETIC_LEARNING_CURVE_SOURCE_IDS,
  validateRuntimeTierEvidence,
  validateRuntimeEvidenceReportIdentity,
} from '../run-autocomplete-learning-curve';
import type { TrainingSelectionManifest } from '../train-baseline';
import { AUTOCOMPLETE_MODEL_EVALUATOR_VERSION } from '../autocomplete-model-evaluator';

describe('autocomplete learning curve governance', () => {
  it('uses the fixed nested 0.1/0.5/1/3/8/16/24MiB tiers in an ignored candidate root', () => {
    expect(LEARNING_CURVE_TIERS.map((tier) => tier.bytes)).toEqual([
      104_858, 524_288, 1_048_576, 3_145_728, 8_388_608, 16_777_216, 25_165_824,
    ]);
    expect(CANDIDATE_OUTPUT_ROOT).toMatch(
      /^scripts\/corpus\/_web-cache\/autocomplete-candidates\//u,
    );
    expect(AUTOCOMPLETE_MODEL_EVALUATOR_VERSION).toBe('offline-completion-evaluator-v2');
  });

  it('rejects curated or incomplete source sets', () => {
    expect(() => assertSyntheticOnlySourceSet(SYNTHETIC_LEARNING_CURVE_SOURCE_IDS)).not.toThrow();
    expect(() =>
      assertSyntheticOnlySourceSet([...SYNTHETIC_LEARNING_CURVE_SOURCE_IDS, 'curated-natural-zh']),
    ).toThrow(/only the five registered synthetic sources/u);
    expect(() =>
      assertSyntheticOnlySourceSet(SYNTHETIC_LEARNING_CURVE_SOURCE_IDS.slice(1)),
    ).toThrow(/only the five registered synthetic sources/u);
  });

  it('verifies actual content-addressed members across every nested tier', () => {
    const manifests = LEARNING_CURVE_TIERS.map((_, index) => selection(index + 1));
    expect(() => assertNestedSelectionManifests(manifests)).not.toThrow();
    const tampered = manifests.map((manifest, index) =>
      index === 4
        ? {
            ...manifest,
            fragments: manifest.fragments.map((item, itemIndex) =>
              itemIndex === 0 ? { ...item, contentSha256: 'f'.repeat(64) } : item,
            ),
          }
        : manifest,
    );
    expect(() => assertNestedSelectionManifests(tampered)).toThrow(/not a strict nested/u);
    const reordered = manifests.map((manifest, index) => {
      if (index !== 4) return manifest;
      const fragments = [...manifest.fragments];
      [fragments[0], fragments[1]] = [fragments[1]!, fragments[0]!];
      return { ...manifest, fragments };
    });
    expect(() => assertNestedSelectionManifests(reordered)).toThrow(/ordered prefix/u);
  });

  it('selects the smallest tier only after all eligibility inputs pass', () => {
    const tiers = LEARNING_CURVE_TIERS.map((tier, index) => ({
      id: tier.id,
      requestedBytes: tier.bytes,
      eligible: index >= 3,
    }));
    expect(selectMinimumEligibleTier(tiers)).toBe('3mib');
    expect(
      selectMinimumEligibleTier(tiers.map((tier) => ({ ...tier, eligible: false }))),
    ).toBeNull();
  });

  it('accepts only complete monotonic evidence with content-addressed selections', () => {
    const valid = LEARNING_CURVE_TIERS.map((tier) => ({
      requestedBytes: tier.bytes,
      realizedBytes: tier.bytes - 1,
      selectionManifestHash: 'a'.repeat(64),
    }));

    expect(() => assertNestedLearningCurve(valid)).not.toThrow();
    expect(() => assertNestedLearningCurve(valid.slice(0, -1))).toThrow(/every fixed byte tier/u);
    expect(() =>
      assertNestedLearningCurve(
        valid.map((item, index) =>
          index === 3 ? { ...item, realizedBytes: valid[index - 1]!.realizedBytes - 1 } : item,
        ),
      ),
    ).toThrow(/monotonic/u);
    expect(() =>
      assertNestedLearningCurve(
        valid.map((item, index) =>
          index === 0 ? { ...item, selectionManifestHash: 'not-a-hash' } : item,
        ),
      ),
    ).toThrow(/selection manifest hash/u);
  });

  it('requires real request and visible-ghost samples for runtime eligibility', () => {
    const valid = {
      modelSha256: 'a'.repeat(64),
      requestCount: 200,
      visibleSampleCount: 72,
      allRequestP90Ms: 100,
      visiblePredictionP90Ms: 110,
      fallbackRate: 0.02,
      timeoutRate: 0.01,
      mixedCandidateRate: 0,
      parseMaxChunkMs: 40,
      parseLongTasksOver50Ms: 0,
      productionRouterObserved: true,
    };
    expect(validateRuntimeTierEvidence(valid, 'a'.repeat(64), 200)).toBeNull();
    expect(validateRuntimeTierEvidence({ ...valid, requestCount: 0 }, undefined, 200)).toMatch(
      /requestCount/u,
    );
    expect(
      validateRuntimeTierEvidence({ ...valid, visibleSampleCount: 0 }, undefined, 200),
    ).toMatch(/visibleSampleCount/u);
    const report = {
      schemaVersion: 2 as const,
      classification: 'production-router-runtime-evidence' as const,
      validationSha256: 'b'.repeat(64),
      evaluatorVersion: PRODUCTION_ROUTER_RUNTIME_EVALUATOR_VERSION,
      tiers: { '0.1mib': valid },
    };
    expect(validateRuntimeEvidenceReportIdentity(report, 'b'.repeat(64))).toBeNull();
    expect(
      validateRuntimeEvidenceReportIdentity(
        { ...report, evaluatorVersion: 'untrusted-runtime-evaluator' },
        'b'.repeat(64),
      ),
    ).toMatch(/exact production-router-runtime-v2/u);
  });
});

function selection(size: number): TrainingSelectionManifest {
  return {
    schemaVersion: 1,
    samplerVersion: 'nested-category-round-robin-v1',
    documents: Array.from({ length: size }, (_, index) => ({
      id: `synthetic:doc-${index}`,
      contentSha256: String(index).padStart(64, '0'),
    })),
    fragments: Array.from({ length: size }, (_, index) => ({
      idSha256: String(index).padStart(64, '0'),
      contentSha256: String(index + 1).padStart(64, '0'),
      category: 'synthetic',
      bytes: 10,
      documents: [`synthetic:doc-${index}`],
    })),
  };
}
