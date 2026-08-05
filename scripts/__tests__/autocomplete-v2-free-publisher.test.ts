import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  computeV2FreeCandidateArtifactSha256,
  type V2FreeCandidateEvidence,
  type V2FreeFinalReport,
  type V2FreeOracleReport,
} from '../autocomplete-v2-free/contract';
import { publishV2FreeCanonical } from '../autocomplete-v2-free/publisher';

const REPOSITORY_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const TEST_ROOT = path.join(
  REPOSITORY_ROOT,
  'scripts/corpus/_web-cache/autocomplete-v2-free-publisher-tests',
);

function sha256(value: Buffer | string): string {
  return createHash('sha256').update(value).digest('hex');
}

function finalReport(
  suite: 'cold' | 'workspace',
  candidateId: string,
  candidateArtifactSha256: string,
): V2FreeFinalReport {
  return {
    schema: 'jotluck.autocomplete.v2-free-final.v1',
    engine: 'public-v2-free-decoder-v1',
    candidateId,
    candidateArtifactSha256,
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

function createFixture(): {
  root: string;
  evidence: V2FreeCandidateEvidence;
  relativeCandidate: string;
} {
  mkdirSync(TEST_ROOT, { recursive: true });
  const root = mkdtempSync(path.join(TEST_ROOT, 'case-'));
  const relativeCandidate = 'scripts/corpus/_web-cache/autocomplete-v2-free/candidates/16m-q4-a';
  const candidateDirectory = path.join(root, relativeCandidate);
  mkdirSync(candidateDirectory, { recursive: true });
  const model = Buffer.from('model-bytes-v1', 'utf8');
  const tokenizer = Buffer.from('tokenizer-bytes-v1', 'utf8');
  const modelAsset = { file: 'model.q4.bin', sha256: sha256(model), bytes: model.byteLength };
  const tokenizerAsset = {
    file: 'tokenizer.unigram.bin',
    sha256: sha256(tokenizer),
    bytes: tokenizer.byteLength,
  };
  const candidateArtifactSha256 = computeV2FreeCandidateArtifactSha256({
    candidateId: '16m-q4-a',
    parameterCount: 16_000_000,
    quantization: 'q4',
    model: modelAsset,
    tokenizer: tokenizerAsset,
  });
  const oracle: V2FreeOracleReport = {
    schema: 'jotluck.autocomplete.v2-free-oracle.v1',
    engine: 'public-v2-free-decoder-v1',
    candidateId: '16m-q4-a',
    candidateArtifactSha256,
    suite: 'cold',
    holdoutSha256: '1'.repeat(64),
    evaluatorTreeSha256: '2'.repeat(64),
    observationsSha256: '3'.repeat(64),
    evaluationManifestSha256: '4'.repeat(64),
    checkpoints: 200,
    at8: { hits: 90, rate: 0.45 },
    at32: { hits: 110, rate: 0.55 },
    byLanguage: {
      zh: { checkpoints: 100, at8Hits: 40, at8Rate: 0.4 },
      en: { checkpoints: 100, at8Hits: 50, at8Rate: 0.5 },
    },
    finalHoldoutsRead: false,
  };
  const runtimeStaticDeltaBytes = 1_024;
  const evaluationManifest = {
    schema: 'jotluck.autocomplete.public-free-decoder.v1',
    schemaVersion: 1,
    engine: 'public-v2-free-decoder-v1',
    candidateId: '16m-q4-a',
    candidateArtifactSha256,
    lifecycle: 'oraclePassed',
    evaluationOnly: true,
    runtimeEligible: true,
    releaseEligible: false,
    parameterCount: 16_000_000,
    quantization: 'q4',
    tokenizer: { kind: 'unigram', vocabularySize: 8_000, byteFallback: true, bilingual: true },
    context: { maximumTokens: 256 },
    output: {
      chineseMaximumCodePoints: 8,
      englishMaximumCodePoints: 12,
      preserveCompleteEnglishWord: true,
    },
    training: { cleanedPoolBytes: 1_024, licenseAuditPassed: true },
    oraclePrecheck: {
      checkpoints: 200,
      oracleAt8: 0.45,
      oracleAt32: 0.55,
      chineseOracleAt8: 0.4,
      englishOracleAt8: 0.5,
      passed: true,
    },
    assets: { model: modelAsset, tokenizer: tokenizerAsset },
    runtimeStaticDeltaBytes,
    measuredPeakMemoryBytes: 128 * 1024 * 1024,
  } as const;
  const manifestBytes = Buffer.from(`${JSON.stringify(evaluationManifest)}\n`, 'utf8');
  writeFileSync(path.join(candidateDirectory, modelAsset.file), model);
  writeFileSync(path.join(candidateDirectory, tokenizerAsset.file), tokenizer);
  writeFileSync(path.join(candidateDirectory, 'evaluation-manifest.json'), manifestBytes);
  const guiEvidence = Buffer.from('real-windows-ime-evidence', 'utf8');
  mkdirSync(path.join(root, 'evidence'), { recursive: true });
  writeFileSync(path.join(root, 'evidence/windows-ime.json'), guiEvidence);
  const evidence: V2FreeCandidateEvidence = {
    candidateId: '16m-q4-a',
    candidateArtifactSha256,
    parameterCount: 16_000_000,
    quantization: 'q4',
    oracle,
    coldFinal: finalReport('cold', '16m-q4-a', candidateArtifactSha256),
    workspaceFinal: finalReport('workspace', '16m-q4-a', candidateArtifactSha256),
    windowsGuiImePassed: true,
    windowsGuiEvidenceSha256: sha256(guiEvidence),
    staticBytes:
      manifestBytes.byteLength + model.byteLength + tokenizer.byteLength + runtimeStaticDeltaBytes,
    peakMemoryBytes: 128 * 1024 * 1024,
    modelInferenceP90Ms: 70,
    licenseAuditPassed: true,
    licenseAuditSha256: '9'.repeat(64),
    selectionSha256: 'a'.repeat(64),
    inputTreeSha256: 'b'.repeat(64),
    evaluatorTreeSha256: '2'.repeat(64),
  };
  writeFileSync(path.join(root, 'evidence/candidate.json'), `${JSON.stringify(evidence)}\n`);
  for (const target of [
    path.join(root, 'packages/app/public/autocomplete'),
    path.join(root, 'packages/app/src-tauri/resources/autocomplete'),
  ]) {
    mkdirSync(target, { recursive: true });
    writeFileSync(path.join(target, 'old-marker.txt'), 'old');
  }
  return { root, evidence, relativeCandidate };
}

describe('V2 free canonical publisher', () => {
  it('atomically installs one hash-bound canonical engine in both targets', () => {
    const fixture = createFixture();
    try {
      const result = publishV2FreeCanonical({
        workspaceRoot: fixture.root,
        candidateDirectory: fixture.relativeCandidate,
        evidencePath: 'evidence/candidate.json',
        windowsGuiEvidencePath: 'evidence/windows-ime.json',
      });
      const frontendManifest = path.join(
        fixture.root,
        'packages/app/public/autocomplete/autocomplete-public.manifest.json',
      );
      const resourceRoot = path.join(fixture.root, 'packages/app/src-tauri/resources/autocomplete');
      const installed = JSON.parse(readFileSync(frontendManifest, 'utf8')) as Record<
        string,
        unknown
      >;
      expect(result.candidateId).toBe(fixture.evidence.candidateId);
      expect(installed).toMatchObject({
        candidateArtifactSha256: fixture.evidence.candidateArtifactSha256,
        evaluationOnly: false,
        releaseEligible: true,
      });
      expect(existsSync(path.join(resourceRoot, 'model.q4.bin'))).toBe(true);
      expect(existsSync(path.join(resourceRoot, 'tokenizer.unigram.bin'))).toBe(true);
      expect(existsSync(path.join(resourceRoot, 'old-marker.txt'))).toBe(false);
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  it('refuses mismatched Windows GUI evidence before touching canonical targets', () => {
    const fixture = createFixture();
    try {
      fixture.evidence.windowsGuiEvidenceSha256 = 'f'.repeat(64);
      writeFileSync(
        path.join(fixture.root, 'evidence/candidate.json'),
        `${JSON.stringify(fixture.evidence)}\n`,
      );
      expect(() =>
        publishV2FreeCanonical({
          workspaceRoot: fixture.root,
          candidateDirectory: fixture.relativeCandidate,
          evidencePath: 'evidence/candidate.json',
          windowsGuiEvidencePath: 'evidence/windows-ime.json',
        }),
      ).toThrow('Windows GUI evidence identity mismatch');
      expect(
        readFileSync(
          path.join(fixture.root, 'packages/app/public/autocomplete/old-marker.txt'),
          'utf8',
        ),
      ).toBe('old');
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });
});
