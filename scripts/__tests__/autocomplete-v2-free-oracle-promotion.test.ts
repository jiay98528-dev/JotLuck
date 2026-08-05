import { createHash } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import {
  computeV2FreeCandidateArtifactSha256,
  type V2FreeSha256,
} from '../autocomplete-v2-free/contract';
import {
  computeV2FreeEvaluatorTreeSha256,
  writeV2FreeEvaluationArtifacts,
  type V2FreeEvaluationObservation,
  type V2FreeEvaluationReport,
} from '../autocomplete-v2-free/evaluation-manifest';
import {
  promoteV2FreeOracle,
  type V2FreeRuntimeMeasurement,
} from '../autocomplete-v2-free/oracle-promotion';

const REPOSITORY_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const CANDIDATE_TEST_ROOT = path.join(
  REPOSITORY_ROOT,
  'scripts/corpus/_web-cache/autocomplete-v2-free/candidates/oracle-promotion-tests',
);
const CATEGORIES = [
  'field-observation',
  'maintenance-log',
  'meeting-note',
  'reading-note',
  'household-plan',
] as const;
let serial = 0;
const cleanup: string[] = [];

interface Fixture {
  candidateRoot: string;
  candidateRootRelative: string;
  trainedManifestRelative: string;
  oracleOutputRelative: string;
  measurementRelative: string;
  workerRelative: string;
  candidateArtifactSha256: V2FreeSha256;
  evaluatorTreeSha256: V2FreeSha256;
}

afterEach(() => {
  for (const target of cleanup.splice(0)) rmSync(target, { recursive: true, force: true });
});

describe('V2 free Oracle lifecycle promotion', () => {
  it('rejects a runtime measurement bound to a different candidate artifact', async () => {
    const fixture = await createFixture();
    await mutateJson(path.join(REPOSITORY_ROOT, fixture.measurementRelative), (value) => {
      value.candidateArtifactSha256 = 'f'.repeat(64);
    });
    await expect(promote(fixture)).rejects.toThrow('measurement identity');
  });

  it('recomputes observations and rejects a forged report aggregate', async () => {
    const fixture = await createFixture();
    const oracleDirectory = path.join(REPOSITORY_ROOT, fixture.oracleOutputRelative);
    const reportPath = path.join(oracleDirectory, 'evaluation-report.json');
    await mutateJson(reportPath, (report) => {
      const oracleAt8 = report.oracleAt8 as Record<string, unknown>;
      oracleAt8.hits = 100;
      oracleAt8.rate = 0.5;
      const withoutHash = { ...report };
      delete withoutHash.reportSha256;
      report.reportSha256 = canonicalSha256(withoutHash);
    });
    await rebindEvaluationManifest(oracleDirectory);
    await expect(promote(fixture)).rejects.toThrow('aggregate does not match');
  });

  it('rejects zero-valued measurements and missing raw measurement evidence', async () => {
    const fixture = await createFixture();
    await mutateJson(path.join(REPOSITORY_ROOT, fixture.measurementRelative), (value) => {
      value.modelP90Ms = 0;
      value.modelInferenceSamplesMs = [];
    });
    await expect(promote(fixture)).rejects.toThrow('lacks raw samples');
  });

  it('stops when recomputed Oracle rates miss a required threshold', async () => {
    const fixture = await createFixture({ oracleAt8Hits: 89, oracleAt32Hits: 110 });
    await expect(promote(fixture)).rejects.toThrow('oracle-at8-minimum');
  });

  it('writes one oraclePassed manifest exclusively and preserves evaluation-only isolation', async () => {
    const fixture = await createFixture();
    const result = await promote(fixture);
    const outputPath = path.join(REPOSITORY_ROOT, result.outputPath);
    const manifest = JSON.parse(await readFile(outputPath, 'utf8')) as Record<string, unknown>;
    expect(result).toMatchObject({ oracleAt8: 0.45, oracleAt32: 0.55, modelP90Ms: 70 });
    expect(manifest).toMatchObject({
      lifecycle: 'oraclePassed',
      evaluationOnly: true,
      runtimeEligible: true,
      releaseEligible: false,
      runtimeStaticDeltaBytes: 1_024,
      measuredPeakMemoryBytes: 128 * 1024 * 1024,
      measuredModelInferenceP90Ms: 70,
      oraclePrecheck: {
        checkpoints: 200,
        oracleAt8: 0.45,
        oracleAt32: 0.55,
        chineseOracleAt8: 0.4,
        englishOracleAt8: 0.5,
        passed: true,
      },
    });
    expect(manifest.releaseEvidence).toBeUndefined();
    await expect(promote(fixture)).rejects.toThrow(/exist|EEXIST/iu);
  });
});

async function createFixture(
  options: {
    oracleAt8Hits?: number;
    oracleAt32Hits?: number;
  } = {},
): Promise<Fixture> {
  const candidateId = `16m-q4-promotion-${process.pid}-${++serial}`;
  const candidateRoot = path.join(CANDIDATE_TEST_ROOT, candidateId);
  const oracleOutput = path.join(candidateRoot, 'oracle-output');
  mkdirSync(candidateRoot, { recursive: true });
  cleanup.push(candidateRoot);

  const model = Buffer.from('JLFDQ02 fixture model', 'utf8');
  const tokenizer = Buffer.from('{"fixture":"tokenizer"}\n', 'utf8');
  const worker = Buffer.from('signed completion worker fixture', 'utf8');
  writeFileSync(path.join(candidateRoot, 'model.jlfdq'), model);
  writeFileSync(path.join(candidateRoot, 'tokenizer.runtime.json'), tokenizer);
  writeFileSync(path.join(candidateRoot, 'worker.exe'), worker);
  const candidateArtifactSha256 = computeV2FreeCandidateArtifactSha256({
    candidateId,
    parameterCount: 16_000_000,
    quantization: 'q4',
    model: { bytes: model.byteLength, sha256: sha256(model) },
    tokenizer: { bytes: tokenizer.byteLength, sha256: sha256(tokenizer) },
  }) as V2FreeSha256;
  const trainedManifest = {
    schema: 'jotluck.autocomplete.public-free-decoder.v1',
    schemaVersion: 1,
    engine: 'public-v2-free-decoder-v1',
    candidateId,
    candidateArtifactSha256,
    lifecycle: 'trained',
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
    training: { cleanedPoolBytes: 32 * 1024 * 1024, licenseAuditPassed: true },
    oraclePrecheck: {
      checkpoints: 0,
      oracleAt8: 0,
      oracleAt32: 0,
      chineseOracleAt8: 0,
      englishOracleAt8: 0,
      passed: false,
    },
    assets: {
      model: { file: 'model.jlfdq', bytes: model.byteLength, sha256: sha256(model) },
      tokenizer: {
        file: 'tokenizer.runtime.json',
        bytes: tokenizer.byteLength,
        sha256: sha256(tokenizer),
      },
    },
    runtimeStaticDeltaBytes: 0,
    measuredPeakMemoryBytes: 0,
    measurementClaims: { runtimeStaticDeltaBytes: false, measuredPeakMemoryBytes: false },
  };
  const trainedManifestPath = path.join(candidateRoot, 'candidate.q4.manifest.json');
  writeFileSync(trainedManifestPath, `${JSON.stringify(trainedManifest, null, 2)}\n`, 'utf8');

  const evaluatorTreeSha256 = await computeV2FreeEvaluatorTreeSha256(REPOSITORY_ROOT);
  const observations = createObservations(
    options.oracleAt8Hits ?? 90,
    options.oracleAt32Hits ?? 110,
  );
  const report = createReport(
    candidateId,
    candidateArtifactSha256,
    evaluatorTreeSha256,
    observations,
  );
  await writeV2FreeEvaluationArtifacts({
    workspaceRoot: REPOSITORY_ROOT,
    outputDirectory: relative(REPOSITORY_ROOT, oracleOutput),
    observations,
    report,
    workerExecutablePath: path.join(candidateRoot, 'worker.exe'),
    candidateManifestPath: relative(REPOSITORY_ROOT, trainedManifestPath),
    createdAt: '2026-08-05T00:00:00.000Z',
  });
  const measurement: V2FreeRuntimeMeasurement = {
    schema: 'jotluck.autocomplete.v2-free-runtime-measurement.v1',
    schemaVersion: 1,
    engine: 'public-v2-free-decoder-v1',
    candidateId,
    candidateArtifactSha256,
    workerExecutableSha256: sha256(worker),
    evaluatorTreeSha256,
    runtimeStaticDeltaBytes: 1_024,
    peakMemoryBytes: 128 * 1024 * 1024,
    modelP90Ms: 70,
    modelInferenceSamplesMs: Array.from({ length: 20 }, () => 70),
    peakMemorySamplesBytes: [120 * 1024 * 1024, 128 * 1024 * 1024],
  };
  const measurementPath = path.join(candidateRoot, 'runtime-measurement.json');
  writeFileSync(measurementPath, `${JSON.stringify(measurement, null, 2)}\n`, 'utf8');
  return {
    candidateRoot,
    candidateRootRelative: relative(REPOSITORY_ROOT, candidateRoot),
    trainedManifestRelative: relative(REPOSITORY_ROOT, trainedManifestPath),
    oracleOutputRelative: relative(REPOSITORY_ROOT, oracleOutput),
    measurementRelative: relative(REPOSITORY_ROOT, measurementPath),
    workerRelative: relative(REPOSITORY_ROOT, path.join(candidateRoot, 'worker.exe')),
    candidateArtifactSha256,
    evaluatorTreeSha256,
  };
}

function createObservations(
  oracleAt8Hits: number,
  oracleAt32Hits: number,
): V2FreeEvaluationObservation[] {
  if (oracleAt32Hits < oracleAt8Hits || oracleAt32Hits > 150) throw new Error('Bad fixture rate.');
  const observations: V2FreeEvaluationObservation[] = [];
  let at8Remaining = oracleAt8Hits;
  let at32OnlyRemaining = oracleAt32Hits - oracleAt8Hits;
  for (let index = 0; index < 200; index++) {
    const language: 'zh' | 'en' = index < 100 ? 'zh' : 'en';
    const languageIndex = index % 100;
    const complete = languageIndex < 75;
    let rank = -1;
    if (complete && at8Remaining > 0) {
      const desiredLanguageHits =
        language === 'zh' ? Math.min(40, oracleAt8Hits) : oracleAt8Hits - 40;
      const usedInLanguage = observations.filter(
        (item) => item.language === language && item.oracleAt8Usable,
      ).length;
      if (usedInLanguage < desiredLanguageHits) {
        rank = 0;
        at8Remaining--;
      }
    }
    if (rank < 0 && complete && at32OnlyRemaining > 0) {
      rank = 8;
      at32OnlyRemaining--;
    }
    const candidates =
      rank < 0
        ? []
        : Array.from({ length: rank + 1 }, (_unused, candidateIndex) => ({
            candidateId: `candidate-${index}-${candidateIndex}`,
            text: language === 'zh' ? '测试补全' : 'test completion',
            confidence: 0.5,
            modelScore: 0.5,
            gateScore: 0.5,
            language,
            usable: candidateIndex === rank,
          }));
    observations.push({
      checkpointId: `checkpoint-${index}`,
      targetId: `target-${Math.floor(index / 4)}`,
      expectedBehavior: complete ? 'complete' : 'silence',
      language,
      category: CATEGORIES[index % CATEGORIES.length]!,
      cursorOffset: index,
      elapsedMs: 10 + (index % 5),
      triggered: candidates.length > 0,
      top1Usable: candidates[0]?.usable === true,
      oracleAt8Usable: candidates.slice(0, 8).some((candidate) => candidate.usable),
      oracleAt32Usable: candidates.some((candidate) => candidate.usable),
      candidates,
    });
  }
  return observations;
}

function createReport(
  candidateId: string,
  candidateArtifactSha256: V2FreeSha256,
  evaluatorTreeSha256: V2FreeSha256,
  observations: V2FreeEvaluationObservation[],
): Omit<V2FreeEvaluationReport, 'observationsSha256' | 'reportSha256'> {
  const complete = observations.filter((item) => item.expectedBehavior === 'complete');
  const silence = observations.filter((item) => item.expectedBehavior === 'silence');
  const byLanguage = {
    zh: group(observations.filter((item) => item.language === 'zh')),
    en: group(observations.filter((item) => item.language === 'en')),
  };
  const byCategory: Record<string, { checkpoints: number; top1Hits: number }> = {};
  for (const observation of observations) {
    const value = byCategory[observation.category] ?? { checkpoints: 0, top1Hits: 0 };
    value.checkpoints++;
    if (observation.top1Usable) value.top1Hits++;
    byCategory[observation.category] = value;
  }
  return {
    schema: 'jotluck.autocomplete.v2-free-evaluation-report.v1',
    schemaVersion: 1,
    engine: 'public-v2-free-decoder-v1',
    mode: 'oracle',
    suite: 'cold',
    classification: 'cold-validation-v1',
    candidateId,
    candidateArtifactSha256,
    holdoutSha256: 'a'.repeat(64) as V2FreeSha256,
    evaluatorTreeSha256,
    checkpoints: observations.length,
    completeCheckpoints: complete.length,
    silenceCheckpoints: silence.length,
    oracleAt8: rate(observations, (item) => item.oracleAt8Usable),
    oracleAt32: rate(observations, (item) => item.oracleAt32Usable),
    top1: rate(observations, (item) => item.top1Usable),
    triggers: rate(observations, (item) => item.triggered),
    silenceFalseTriggers: rate(silence, (item) => item.triggered),
    byLanguage,
    byCategory,
    requestP90Ms: 14,
    finalHoldoutsRead: false,
    passed: false,
  };
}

function group(items: V2FreeEvaluationObservation[]): {
  checkpoints: number;
  oracleAt8Hits: number;
  top1Hits: number;
} {
  return {
    checkpoints: items.length,
    oracleAt8Hits: items.filter((item) => item.oracleAt8Usable).length,
    top1Hits: items.filter((item) => item.top1Usable).length,
  };
}

function rate(
  items: V2FreeEvaluationObservation[],
  predicate: (item: V2FreeEvaluationObservation) => boolean,
): { hits: number; checkpoints: number; rate: number } {
  const hits = items.filter(predicate).length;
  return { hits, checkpoints: items.length, rate: items.length === 0 ? 0 : hits / items.length };
}

async function promote(fixture: Fixture) {
  return promoteV2FreeOracle({
    workspaceRoot: REPOSITORY_ROOT,
    candidateRoot: fixture.candidateRootRelative,
    trainedManifestPath: fixture.trainedManifestRelative,
    oracleOutputDirectory: fixture.oracleOutputRelative,
    runtimeMeasurementPath: fixture.measurementRelative,
    workerExecutablePath: fixture.workerRelative,
  });
}

async function rebindEvaluationManifest(directory: string): Promise<void> {
  const report = await readFile(path.join(directory, 'evaluation-report.json'));
  await mutateJson(path.join(directory, 'evaluation-manifest.json'), (manifest) => {
    manifest.report = {
      file: 'evaluation-report.json',
      bytes: report.byteLength,
      sha256: sha256(report),
    };
    const withoutHash = { ...manifest };
    delete withoutHash.manifestSha256;
    manifest.manifestSha256 = canonicalSha256(withoutHash);
  });
}

async function mutateJson(
  filePath: string,
  mutate: (value: Record<string, unknown>) => void,
): Promise<void> {
  const value = JSON.parse(await readFile(filePath, 'utf8')) as Record<string, unknown>;
  mutate(value);
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function relative(root: string, target: string): string {
  return path.relative(root, target).replaceAll('\\', '/');
}

function canonicalSha256(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256(value: Buffer): V2FreeSha256 {
  return createHash('sha256').update(value).digest('hex') as V2FreeSha256;
}
