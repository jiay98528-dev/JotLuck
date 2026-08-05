import { describe, expect, it } from 'vitest';
import {
  assessV2FreeCandidate,
  computeV2FreeCandidateArtifactSha256,
  selectSmallestPassingV2FreeCandidate,
  type V2FreeCandidateEvidence,
  type V2FreeFinalReport,
  type V2FreeOracleReport,
} from '../autocomplete-v2-free/contract';

function oracle(candidateId = '16m-q4-a'): V2FreeOracleReport {
  return {
    schema: 'jotluck.autocomplete.v2-free-oracle.v1',
    engine: 'public-v2-free-decoder-v1',
    candidateId,
    candidateArtifactSha256: 'd'.repeat(64),
    suite: 'cold',
    holdoutSha256: '1'.repeat(64),
    evaluatorTreeSha256: '2'.repeat(64),
    observationsSha256: '3'.repeat(64),
    evaluationManifestSha256: '4'.repeat(64),
    checkpoints: 200,
    at8: { hits: 90, rate: 90 / 200 },
    at32: { hits: 110, rate: 110 / 200 },
    byLanguage: {
      zh: { checkpoints: 100, at8Hits: 40, at8Rate: 0.4 },
      en: { checkpoints: 100, at8Hits: 50, at8Rate: 0.5 },
    },
    finalHoldoutsRead: false,
  };
}

function final(suite: 'cold' | 'workspace', candidateId: string): V2FreeFinalReport {
  return {
    schema: 'jotluck.autocomplete.v2-free-final.v1',
    engine: 'public-v2-free-decoder-v1',
    candidateId,
    candidateArtifactSha256: 'd'.repeat(64),
    suite,
    holdoutSha256: (suite === 'cold' ? 'a' : 'b').repeat(64),
    baselineSha256: 'c'.repeat(64),
    evaluatorTreeSha256: '2'.repeat(64),
    observationsSha256: (suite === 'cold' ? '3' : '4').repeat(64),
    evaluationManifestSha256: (suite === 'cold' ? '5' : '6').repeat(64),
    finalClaimSha256: '7'.repeat(64),
    finalReceiptSha256: '8'.repeat(64),
    checkpoints: 200,
    completeCheckpoints: 150,
    silenceCheckpoints: 50,
    triggerRate: 0.38,
    absoluteUsableRate: 0.36,
    byLanguage: {
      zh: { checkpoints: 100, usableRate: 0.34 },
      en: { checkpoints: 100, usableRate: 0.38 },
    },
    byCategory: {
      journal: { checkpoints: 100, usableRate: 0.36 },
      planning: { checkpoints: 100, usableRate: 0.36 },
    },
    silenceFalseTriggerRate: 0.02,
    mixedVisibleCount: 0,
    crossLineCount: 0,
    overlongCount: 0,
    structuredChecks: 20,
    structuredCorrect: 20,
    editChecks: 20,
    editCorrect: 20,
    requestP90Ms: 90,
    visibleGhostP90Ms: 100,
    mainThreadModelTasksOver50Ms: 0,
    consumedOnce: true,
  };
}

function evidence(
  candidateId = '16m-q4-a',
  parameterCount: 16_000_000 | 24_000_000 = 16_000_000,
): V2FreeCandidateEvidence {
  return {
    candidateId,
    candidateArtifactSha256: 'd'.repeat(64),
    parameterCount,
    quantization: 'q4',
    oracle: oracle(candidateId),
    coldFinal: final('cold', candidateId),
    workspaceFinal: final('workspace', candidateId),
    windowsGuiImePassed: true,
    windowsGuiEvidenceSha256: 'e'.repeat(64),
    staticBytes: parameterCount === 16_000_000 ? 10_000_000 : 14_000_000,
    peakMemoryBytes: 128 * 1024 * 1024,
    modelInferenceP90Ms: 70,
    licenseAuditPassed: true,
    licenseAuditSha256: '9'.repeat(64),
    selectionSha256: 'a'.repeat(64),
    inputTreeSha256: 'b'.repeat(64),
    evaluatorTreeSha256: '2'.repeat(64),
  };
}

describe('V2 free decoder evidence gates', () => {
  it('content-addresses the exact model and tokenizer identity', () => {
    const identity = {
      candidateId: '16m-q4-a',
      parameterCount: 16_000_000 as const,
      quantization: 'q4' as const,
      model: { sha256: 'a'.repeat(64), bytes: 8_000_000 },
      tokenizer: { sha256: 'b'.repeat(64), bytes: 500_000 },
    };
    const first = computeV2FreeCandidateArtifactSha256(identity);
    const second = computeV2FreeCandidateArtifactSha256({
      ...identity,
      model: { ...identity.model, bytes: identity.model.bytes + 1 },
    });
    expect(first).toMatch(/^[a-f0-9]{64}$/u);
    expect(second).not.toBe(first);
  });

  it('stops before final consumption when Oracle precheck misses', () => {
    const candidate = evidence();
    candidate.oracle.at8 = { hits: 89, rate: 89 / 200 };
    delete candidate.coldFinal;
    delete candidate.workspaceFinal;
    expect(assessV2FreeCandidate(candidate)).toMatchObject({
      stage: 'architecture-stop',
      passed: false,
      failures: expect.arrayContaining(['oracle-at8-minimum']),
    });
  });

  it('requires both one-shot finals and real Windows IME closure', () => {
    const candidate = evidence();
    candidate.windowsGuiImePassed = false;
    expect(assessV2FreeCandidate(candidate)).toMatchObject({
      stage: 'candidate',
      passed: false,
      failures: expect.arrayContaining(['windows-gui-ime']),
    });
  });

  it('rejects reports that name the candidate but bind different asset bytes', () => {
    const candidate = evidence();
    candidate.workspaceFinal!.candidateArtifactSha256 = 'f'.repeat(64);
    expect(assessV2FreeCandidate(candidate)).toMatchObject({
      stage: 'candidate',
      passed: false,
      failures: expect.arrayContaining(['final-candidate-artifact-identity']),
    });
  });

  it('selects the smallest candidate that passes every gate', () => {
    const larger = evidence('24m-q4-a', 24_000_000);
    const smaller = evidence();
    expect(selectSmallestPassingV2FreeCandidate([larger, smaller]).candidateId).toBe(
      smaller.candidateId,
    );
  });
});
