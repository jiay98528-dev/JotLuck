import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
// The verifier is intentionally plain ESM so release-rc-gate can execute it without TS loaders.
// @ts-expect-error Plain ESM release verifier has no separate declaration file.
import { verifyAutocompleteEvidence } from '../verify-autocomplete-evidence.mjs';
// @ts-expect-error Plain ESM integrity constants intentionally have no declaration file.
import { AUTOCOMPLETE_EVIDENCE_SOURCE_FILES } from '../autocomplete-evidence-integrity.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const tempRoot = path.join(repositoryRoot, 'scripts/__tests__/.evidence-verifier-test');
const outsideRoot = path.join(os.tmpdir(), 'jotluck-evidence-verifier-outside');
const SYNTHETIC_SOURCE_IDS = [
  'synthetic-natural-zh',
  'synthetic-project-zh',
  'synthetic-technical-en',
  'synthetic-technical-zh',
  'synthetic-workflow-en',
] as const;

afterEach(() => {
  if (existsSync(tempRoot)) rmSync(tempRoot, { recursive: true, force: true });
  if (existsSync(outsideRoot)) rmSync(outsideRoot, { recursive: true, force: true });
});

describe('autocomplete evidence verifier', () => {
  it('recomputes every bound file and rejects one-byte evidence tampering', () => {
    const fixture = createReleaseFixture();
    expect(() =>
      verifyAutocompleteEvidence({ rootDir: tempRoot, mode: 'rc', models: [fixture.model] }),
    ).not.toThrow();
    writeFileSync(path.join(tempRoot, 'quality.json'), '{"tampered":true}\n', 'utf8');
    expect(() =>
      verifyAutocompleteEvidence({ rootDir: tempRoot, mode: 'rc', models: [fixture.model] }),
    ).toThrow(/evidence SHA mismatch: qualityReport/u);
  });

  it('accepts checked-in legacy models only when every runtime/release flag is false', () => {
    const model = createLegacyFixture();
    expect(
      verifyAutocompleteEvidence({ rootDir: tempRoot, mode: 'ci', models: [model] }).models[0]
        .status,
    ).toBe('fail-closed-legacy');
    const manifestPath = path.join(tempRoot, model.manifest);
    const manifest = JSON.parse(String(requireFile(manifestPath)));
    manifest.runtimeEligible = true;
    writeFileSync(manifestPath, `${JSON.stringify(manifest)}\n`, 'utf8');
    expect(() =>
      verifyAutocompleteEvidence({ rootDir: tempRoot, mode: 'ci', models: [model] }),
    ).toThrow(/not fail-closed/u);
  });

  it('rejects a partially installed V2R profile pair before checking legacy assets', () => {
    mkdirSync(path.join(tempRoot, 'packages/app/public'), { recursive: true });
    writeFileSync(
      path.join(
        tempRoot,
        'packages/app/public/public-phrase-transformer-v1.web-local.manifest.json',
      ),
      '{}\n',
      'utf8',
    );

    expect(() => verifyAutocompleteEvidence({ rootDir: tempRoot, mode: 'ci', models: [] })).toThrow(
      /partially installed/u,
    );
  });

  it('rejects runtime evidence with no visible production ghost samples', () => {
    const fixture = createReleaseFixture();
    const runtimePath = path.join(tempRoot, 'runtime.json');
    const runtime = JSON.parse(String(requireFile(runtimePath)));
    runtime.tiers['0.1mib'].visibleSampleCount = 0;
    writeFileSync(runtimePath, `${JSON.stringify(runtime)}\n`, 'utf8');
    const curvePath = path.join(tempRoot, 'curve.json');
    const curve = JSON.parse(String(requireFile(curvePath)));
    curve.runtimeEvidenceSha256 = sha(requireFile(runtimePath));
    const { learningCurveSha256: _oldCurveSha, ...curveCore } = curve;
    curve.learningCurveSha256 = sha(canonical(curveCore));
    writeFileSync(curvePath, `${JSON.stringify(curve)}\n`, 'utf8');
    const manifestPath = path.join(tempRoot, 'manifest.json');
    const manifest = JSON.parse(String(requireFile(manifestPath)));
    manifest.evidenceBindings.runtimeReport.sha256 = sha(requireFile(runtimePath));
    manifest.evidenceBindings.learningCurve.sha256 = sha(requireFile(curvePath));
    manifest.learningCurveSha256 = curve.learningCurveSha256;
    writeFileSync(manifestPath, `${JSON.stringify(manifest)}\n`, 'utf8');
    expect(() =>
      verifyAutocompleteEvidence({ rootDir: tempRoot, mode: 'rc', models: [fixture.model] }),
    ).toThrow(/runtime evidence is missing or failed/u);
  });

  it('recomputes evaluator sources, final holdout, curve self-hash, and manifest cross-bindings', () => {
    const tamperers: Array<{
      expected: RegExp;
      mutate: (fixture: ReturnType<typeof createReleaseFixture>) => void;
    }> = [
      {
        expected: /Evaluator source SHA mismatch/u,
        mutate: () =>
          writeFileSync(
            path.join(tempRoot, AUTOCOMPLETE_EVIDENCE_SOURCE_FILES[0]),
            'tampered evaluator source\n',
            'utf8',
          ),
      },
      {
        expected: /evidence SHA mismatch: final/u,
        mutate: () => writeFileSync(path.join(tempRoot, 'final.json'), '{"tampered":true}\n'),
      },
      {
        expected: /Learning curve .*self-bound/u,
        mutate: () => {
          const curvePath = path.join(tempRoot, 'curve.json');
          const curve = JSON.parse(String(requireFile(curvePath)));
          curve.generatedCorpusSha256 = '0'.repeat(64);
          writeFileSync(curvePath, `${JSON.stringify(curve)}\n`, 'utf8');
          refreshBinding('learningCurve', 'curve.json');
        },
      },
      {
        expected: /Learning curve .*self-bound|Quality evidence/u,
        mutate: () => {
          const manifestPath = path.join(tempRoot, 'manifest.json');
          const manifest = JSON.parse(String(requireFile(manifestPath)));
          manifest.learningCurveSha256 = '0'.repeat(64);
          writeFileSync(manifestPath, `${JSON.stringify(manifest)}\n`, 'utf8');
        },
      },
    ];
    for (const { expected, mutate } of tamperers) {
      if (existsSync(tempRoot)) rmSync(tempRoot, { recursive: true, force: true });
      const fixture = createReleaseFixture();
      mutate(fixture);
      expect(() =>
        verifyAutocompleteEvidence({ rootDir: tempRoot, mode: 'rc', models: [fixture.model] }),
      ).toThrow(expected);
    }
  }, 15_000);

  it('rejects evidence symlinks that escape the workspace', () => {
    const fixture = createReleaseFixture();
    mkdirSync(outsideRoot, { recursive: true });
    writeFileSync(
      path.join(outsideRoot, 'quality.json'),
      requireFile(path.join(tempRoot, 'quality.json')),
    );
    symlinkSync(outsideRoot, path.join(tempRoot, 'outside-link'), 'junction');
    const manifestPath = path.join(tempRoot, 'manifest.json');
    const manifest = JSON.parse(String(requireFile(manifestPath)));
    manifest.evidenceBindings.qualityReport = {
      path: 'outside-link/quality.json',
      sha256: sha(requireFile(path.join(outsideRoot, 'quality.json'))),
    };
    writeFileSync(manifestPath, `${JSON.stringify(manifest)}\n`, 'utf8');
    expect(() =>
      verifyAutocompleteEvidence({ rootDir: tempRoot, mode: 'rc', models: [fixture.model] }),
    ).toThrow(/symlink escapes the workspace/u);
  });
});

function createReleaseFixture() {
  mkdirSync(tempRoot, { recursive: true });
  const { evaluator, frozen } = seedTrustedIdentities();
  const asset = '# jotluck-baseline-v4\n[character]\n["61",[["62",2000]]]\n[word]\n';
  writeFileSync(path.join(tempRoot, 'model.txt'), asset, 'utf8');
  const modelSha256 = sha(asset);
  const validation = {
    schemaVersion: 2,
    datasetId: 'validation',
    cases: [
      {
        id: 'validation-zh',
        language: 'zh',
        checkpoints: Array.from({ length: 100 }, (_, index) => ({
          id: `zh-${index}`,
          expectedBehavior: index < 25 ? 'silence' : 'complete',
        })),
      },
      {
        id: 'validation-en',
        language: 'en',
        checkpoints: Array.from({ length: 100 }, (_, index) => ({
          id: `en-${index}`,
          expectedBehavior: index < 25 ? 'silence' : 'complete',
        })),
      },
    ],
  };
  const validationSha256 = sha(canonical(validation));
  const selection = {
    schemaVersion: 1,
    documents: [{ id: 'doc-1', contentSha256: '1'.repeat(64) }],
    fragments: [
      {
        idSha256: '2'.repeat(64),
        contentSha256: '3'.repeat(64),
        category: 'zh-natural-notes',
        bytes: 32,
        documents: ['doc-1'],
      },
    ],
  };
  const selectionHash = sha(canonical(selection));
  const comparison = {
    schemaVersion: 1,
    holdoutSha256: validationSha256,
    frozenV1TreeSha256: frozen.treeSha256,
    v1: comparisonMetrics(0.35),
    v2: comparisonMetrics(0.36),
    delta: {
      contextHitRate: 0.01,
      top1Rate: 0.01,
      oracleAt8Rate: 0.01,
      usableRate: 0.01,
      falseTriggerRate: -0.01,
    },
  };
  const selectedTier = curveTier({
    id: '0.1mib',
    requestedBytes: 104_858,
    eligible: true,
    modelSha256,
    modelBytes: Buffer.byteLength(asset),
    selectionHash,
    comparison,
  });
  const otherTiers = [
    ['0.5mib', 524_288],
    ['1mib', 1_048_576],
    ['3mib', 3_145_728],
    ['8mib', 8_388_608],
    ['16mib', 16_777_216],
    ['24mib-cap', 25_165_824],
  ].map(([id, requestedBytes], index) =>
    curveTier({
      id: String(id),
      requestedBytes: Number(requestedBytes),
      eligible: false,
      modelSha256: String(index + 1).repeat(64),
      modelBytes: Buffer.byteLength(asset),
      selectionHash: String(index + 2).repeat(64),
      comparison,
    }),
  );
  const runtimeTier = {
    modelSha256,
    requestCount: 200,
    visibleSampleCount: 72,
    allRequestP90Ms: 100,
    visiblePredictionP90Ms: 105,
    fallbackRate: 0.02,
    timeoutRate: 0.01,
    mixedCandidateRate: 0,
    parseMaxChunkMs: 40,
    parseLongTasksOver50Ms: 0,
    productionRouterObserved: true,
  };
  const runtime = {
    schemaVersion: 2,
    classification: 'production-router-runtime-evidence',
    validationSha256,
    evaluatorVersion: 'production-router-runtime-v2',
    tiers: { '0.1mib': runtimeTier },
  };
  const runtimeText = `${JSON.stringify(runtime)}\n`;
  const curveCore = {
    schemaVersion: 2,
    version: 'autocomplete-learning-curve-v2',
    stage: 'validation',
    generatedAt: '2026-07-11T00:00:00.000Z',
    generatorVersion: 'jotluck-synthetic-short-notes-v1',
    generatorSeed: 'project-owned-seed-2026-07-11',
    sourceIds: [...SYNTHETIC_SOURCE_IDS],
    generatedCorpusSha256: '8'.repeat(64),
    validationPath: 'validation.json',
    validationSha256,
    evaluatorVersion: 'offline-completion-evaluator-v2',
    evaluatorTreeSha256: evaluator.treeSha256,
    frozenV1TreeSha256: frozen.treeSha256,
    runtimeEvidenceSha256: sha(runtimeText),
    runtimeEvidenceStatus: 'accepted',
    runtimeEvidenceError: null,
    tiers: [selectedTier, ...otherTiers],
    selectedTier: '0.1mib',
    selectionReason: 'minimum-eligible-tier',
    releaseEligible: false,
    finalHoldoutConsumed: false,
  };
  // The production path is fixed; the fixture is written there below.
  curveCore.validationPath = 'scripts/corpus/formal-holdout.json';
  const curve = { ...curveCore, learningCurveSha256: sha(canonical(curveCore)) };
  const quality = {
    schemaVersion: 2,
    classification: 'deterministic-model-quality-evidence',
    stage: 'validation',
    releaseEligible: false,
    modelSha256,
    trainingInputHash: 'b'.repeat(64),
    validationSha256,
    evaluatorVersion: 'offline-completion-evaluator-v2',
    evaluatorTreeSha256: evaluator.treeSha256,
    frozenV1TreeSha256: frozen.treeSha256,
    comparison,
    evaluation: {
      schemaVersion: 2,
      evaluatorVersion: 'offline-completion-evaluator-v2',
      model: { sha256: modelSha256, bytes: Buffer.byteLength(asset) },
      holdout: { sha256: validationSha256, opportunities: 200 },
      l3Raw: { contextHitRate: 0.4, top1Rate: 0.36, oracleAt8Rate: 0.5 },
      fullStack: {
        triggerRate: 0.36,
        usableRate: 0.36,
        falseTriggerRate: 0.02,
        mixedCandidates: 0,
      },
      verdicts: { runtimeSafety: { status: 'pass' }, modelQuality: { status: 'pass' } },
    },
  };
  const finalHoldout = createFinalHoldout();
  const finalHoldoutSha256 = sha(canonical(finalHoldout));
  const finalRuntime = {
    schemaVersion: 1,
    classification: 'workspace-final-v2-runtime-evidence',
    stage: 'final',
    productionRouterObserved: true,
    modelSha256,
    finalHoldoutSha256,
    opportunities: 200,
    requestCount: 200,
    visibleSampleCount: 72,
    triggerRate: 0.36,
    usableRate: 0.36,
    falseTriggerRate: 0.01,
    mixedCandidateRate: 0,
    allRequestP90Ms: 100,
    visiblePredictionP90Ms: 105,
    oracleAt8Rate: 0.45,
    top1Rate: 0.36,
    language: {
      zh: { top1Rate: 0.36, usableRate: 0.36, v1Top1Rate: 0.35, v1UsableRate: 0.35 },
      en: { top1Rate: 0.36, usableRate: 0.36, v1Top1Rate: 0.35, v1UsableRate: 0.35 },
    },
  };
  const receipt = {
    schemaVersion: 1,
    classification: 'workspace-final-v2-consumption-receipt',
    finalHoldoutSha256,
    modelSha256,
    validationCurveSha256: curve.learningCurveSha256,
    claimedAt: '2026-07-11T00:00:00.000Z',
  };
  const finalReport = {
    schemaVersion: 1,
    classification: 'workspace-final-v2-evidence',
    releaseEligible: true,
    finalHoldoutConsumed: true,
    modelSha256,
    validationCurveSha256: curve.learningCurveSha256,
    finalHoldoutSha256,
    finalAudit: {
      datasetSha256: finalHoldoutSha256,
      targetDocuments: 50,
      checkpoints: 200,
      languageCheckpoints: { zh: 100, en: 100 },
      silenceCheckpoints: 50,
      exactContinuationDuplicates: 0,
      nearContinuationDuplicates: 0,
      supportContinuationOverlaps: 0,
      maxCategoryRatio: 0.2,
      maxTemplateRatio: 0.02,
      maxStructuralTemplateRatio: 0.08,
      maxFrequentNgramRatio: 0.1,
      sharedLongNgramPairs: 0,
    },
    runtime: finalRuntime,
    runtimeEvidenceSha256: sha(`${JSON.stringify(finalRuntime)}\n`),
    consumptionReceiptSha256: sha(`${JSON.stringify(receipt)}\n`),
    v21Eligible: true,
  };
  const webview = {
    classification: 'tauri-webview-offline-smoke',
    status: 'pass',
    modelSha256,
    completedAt: '2026-07-11T01:00:00.000Z',
  };
  const files = {
    selection,
    final: finalHoldout,
    finalReport,
    evaluator,
    quality,
    runtime,
    comparison,
    curve,
    webview,
    finalRuntime,
    receipt,
  };
  for (const [name, value] of Object.entries(files)) {
    writeFileSync(path.join(tempRoot, `${name}.json`), `${JSON.stringify(value)}\n`, 'utf8');
  }
  const validationPath = path.join(tempRoot, 'scripts/corpus/formal-holdout.json');
  mkdirSync(path.dirname(validationPath), { recursive: true });
  writeFileSync(validationPath, `${JSON.stringify(validation)}\n`, 'utf8');
  const binding = (name: string) => ({
    path: `${name}.json`,
    sha256: sha(requireFile(path.join(tempRoot, `${name}.json`))),
  });
  const manifest = {
    schemaVersion: 2,
    profile: 'web-local',
    serialization: 'sectioned-jsonl-hex-v4',
    order: 'section-profile-context-hex',
    ngramN: 4,
    minNgramN: 2,
    wordNgramOrders: [1, 2],
    countScale: 1000,
    modelBytes: Buffer.byteLength(asset),
    entryCount: 1,
    sha256: modelSha256,
    trainingInputHash: quality.trainingInputHash,
    holdoutSha256: validationSha256,
    evaluatorVersion: 'offline-completion-evaluator-v2',
    evaluatorSha256: evaluator.treeSha256,
    learningCurveSha256: curve.learningCurveSha256,
    verifiedOnly: true,
    runtimeEligible: true,
    qualityGatePassed: true,
    releaseEligible: true,
    evidenceBindings: {
      schemaVersion: 2,
      model: { path: 'model.txt', sha256: modelSha256 },
      trainingInput: binding('selection'),
      validation: {
        path: 'scripts/corpus/formal-holdout.json',
        sha256: sha(requireFile(validationPath)),
      },
      final: binding('final'),
      finalReport: binding('finalReport'),
      evaluatorTree: binding('evaluator'),
      frozenV1: {
        path: 'scripts/frozen-v1-fb46b1e/snapshot-manifest.json',
        sha256: sha(
          requireFile(path.join(tempRoot, 'scripts/frozen-v1-fb46b1e/snapshot-manifest.json')),
        ),
      },
      qualityReport: binding('quality'),
      runtimeReport: binding('runtime'),
      comparison: binding('comparison'),
      learningCurve: binding('curve'),
      webviewSmoke: binding('webview'),
      finalRuntimeReport: binding('finalRuntime'),
      finalConsumptionReceipt: binding('receipt'),
    },
  };
  writeFileSync(path.join(tempRoot, 'manifest.json'), `${JSON.stringify(manifest)}\n`, 'utf8');
  return { model: { asset: 'model.txt', manifest: 'manifest.json' } };
}

function seedTrustedIdentities(): {
  evaluator: {
    schemaVersion: 1;
    files: Array<{ path: string; sha256: string }>;
    treeSha256: string;
  };
  frozen: { treeSha256: string };
} {
  const files = AUTOCOMPLETE_EVIDENCE_SOURCE_FILES.map((relativePath: string) => {
    const source = path.join(repositoryRoot, relativePath);
    const target = path.join(tempRoot, relativePath);
    mkdirSync(path.dirname(target), { recursive: true });
    cpSync(source, target);
    return { path: relativePath, sha256: sha(requireFile(target)) };
  });
  const frozenSource = path.join(repositoryRoot, 'scripts/frozen-v1-fb46b1e');
  const frozenTarget = path.join(tempRoot, 'scripts/frozen-v1-fb46b1e');
  cpSync(frozenSource, frozenTarget, { recursive: true });
  return {
    evaluator: { schemaVersion: 1, files, treeSha256: sha(canonical(files)) },
    frozen: JSON.parse(String(requireFile(path.join(frozenTarget, 'snapshot-manifest.json')))) as {
      treeSha256: string;
    },
  };
}

function curveTier(input: {
  id: string;
  requestedBytes: number;
  eligible: boolean;
  modelSha256: string;
  modelBytes: number;
  selectionHash: string;
  comparison: Record<string, unknown>;
}): Record<string, unknown> {
  return {
    id: input.id,
    requestedBytes: input.requestedBytes,
    realizedBytes: Math.max(1, input.requestedBytes - 1),
    selectionManifestHash: input.selectionHash,
    selectionDocumentCount: 1,
    selectionFragmentCount: 1,
    modelSha256: input.modelSha256,
    modelBytes: input.modelBytes,
    trainingInputHash: 'b'.repeat(64),
    sourceIds: [...SYNTHETIC_SOURCE_IDS],
    safetyGatePassed: input.eligible,
    hardLimitPassed: input.eligible,
    softTargetPassed: input.eligible,
    contextHitRate: 0.4,
    top1Rate: 0.36,
    oracleAt8Rate: 0.5,
    triggerRate: 0.36,
    usableRate: 0.36,
    falseTriggerRate: 0.02,
    mixedCandidateRate: 0,
    deterministicRuntimeSafetyPassed: input.eligible,
    modelQualityPassed: input.eligible,
    runtimeMeasurementRequired: input.eligible,
    runtimeEvidencePassed: input.eligible,
    runtimeRequestCount: input.eligible ? 200 : null,
    runtimeVisibleSampleCount: input.eligible ? 72 : null,
    allRequestP90Ms: input.eligible ? 100 : null,
    visiblePredictionP90Ms: input.eligible ? 105 : null,
    fallbackRate: input.eligible ? 0.02 : null,
    timeoutRate: input.eligible ? 0.01 : null,
    parseMaxChunkMs: input.eligible ? 40 : null,
    parseLongTasksOver50Ms: input.eligible ? 0 : null,
    v1Comparison: input.comparison,
    eligible: input.eligible,
    ineligibilityReasons: input.eligible ? [] : ['absolute-quality-gates'],
    candidateDirectory: `scripts/corpus/_web-cache/autocomplete-candidates/learning-curve-v2/${input.id}`,
  };
}

function comparisonMetrics(value: number): Record<string, unknown> {
  return {
    contextHitRate: value,
    top1Rate: value,
    oracleAt8Rate: value + 0.1,
    usableRate: value,
    falseTriggerRate: value === 0.35 ? 0.03 : 0.02,
    mixedCandidates: 0,
    allRequestP90Ms: 100,
    visiblePredictionP90Ms: 105,
    fallbackRate: 0.02,
    timeoutRate: 0.01,
    attribution: { l3: 1 },
  };
}

function createFinalHoldout(): Record<string, unknown> {
  const supportDocuments: Array<Record<string, unknown>> = [];
  const targets: Array<Record<string, unknown>> = [];
  for (let index = 0; index < 50; index++) {
    const language = index < 25 ? 'zh' : 'en';
    const targetId = `target-${index}`;
    const supportIds = [`support-${index}-a`, `support-${index}-b`];
    for (const [supportIndex, supportId] of supportIds.entries()) {
      supportDocuments.push({
        id: supportId,
        path: `support/${supportId}.md`,
        language,
        text: `${language}-${index}-${supportIndex}-independent support`,
      });
    }
    targets.push({
      id: targetId,
      path: `targets/${targetId}.md`,
      language,
      category: `category-${index % 5}`,
      text: `${language}-${index}-target text`,
      supportDocumentIds: supportIds,
      checkpoints: [0, 1, 2]
        .map((checkpoint) => ({
          id: `${targetId}-complete-${checkpoint}`,
          expectedBehavior: 'complete',
        }))
        .concat([{ id: `${targetId}-silence`, expectedBehavior: 'silence' }]),
    });
  }
  return {
    schemaVersion: 2,
    datasetId: 'workspace-final-verifier-fixture',
    frozenAt: '2026-07-11T00:00:00.000Z',
    classification: 'workspace-conditioned-final-v2',
    releaseEvidence: true,
    supportDocuments,
    targets,
  };
}

function refreshBinding(key: string, relativePath: string): void {
  const manifestPath = path.join(tempRoot, 'manifest.json');
  const manifest = JSON.parse(String(requireFile(manifestPath)));
  manifest.evidenceBindings[key] = {
    path: relativePath,
    sha256: sha(requireFile(path.join(tempRoot, relativePath))),
  };
  writeFileSync(manifestPath, `${JSON.stringify(manifest)}\n`, 'utf8');
}

function createLegacyFixture() {
  mkdirSync(tempRoot, { recursive: true });
  const asset = '["61",[["62",2]]]\n';
  writeFileSync(path.join(tempRoot, 'legacy.txt'), asset, 'utf8');
  const manifest = {
    schemaVersion: 1,
    profile: 'web-local',
    serialization: 'jsonl-hex-v3-fixed-int',
    modelBytes: Buffer.byteLength(asset),
    entryCount: 1,
    sha256: sha(asset),
    verifiedOnly: true,
    runtimeEligible: false,
    qualityGatePassed: false,
    releaseEligible: false,
  };
  writeFileSync(path.join(tempRoot, 'legacy.json'), `${JSON.stringify(manifest)}\n`, 'utf8');
  return { asset: 'legacy.txt', manifest: 'legacy.json' };
}

function requireFile(filePath: string): Buffer {
  return readFileSync(filePath);
}

function sha(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b, 'en'))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}
