import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
// @ts-expect-error Plain ESM integrity constants intentionally have no declaration file.
import { AUTOCOMPLETE_EVIDENCE_SOURCE_FILES } from '../autocomplete-evidence-integrity.mjs';
// The production verifier is deliberately plain ESM so Node can run it without a TS loader.
// @ts-expect-error -- the repository does not emit declarations for executable .mjs scripts.
import { verifyAutocompleteEvidence } from '../verify-autocomplete-evidence.mjs';
import {
  publishAutocompleteFinal,
  type PublishAutocompleteFinalOptions,
} from '../publish-autocomplete-final';
import { validateWorkspaceFinalV2, type WorkspaceFinalHoldout } from '../workspace-final-holdout';

const REPOSITORY_ROOT = path.resolve(__dirname, '..', '..');
const CURVE_PATH =
  'scripts/corpus/_web-cache/autocomplete-candidates/learning-curve-v2/learning-curve-report.json';
const CANDIDATE_DIR = 'scripts/corpus/_web-cache/autocomplete-candidates/learning-curve-v2/0.1mib';
const FINAL_DIR = 'scripts/corpus/_web-cache/autocomplete-candidates/final-v2-consumption';
const FINAL_RUNTIME_PATH =
  'scripts/corpus/_web-cache/autocomplete-candidates/workspace-final-runtime-evidence.json';
const WEBVIEW_PATH = 'scripts/corpus/_web-cache/autocomplete-candidates/tauri-webview-smoke.json';
const SYNTHETIC_LEARNING_CURVE_SOURCE_IDS = [
  'synthetic-natural-zh',
  'synthetic-project-zh',
  'synthetic-technical-en',
  'synthetic-technical-zh',
  'synthetic-workflow-en',
] as const;
const OUTPUTS = [
  'packages/app/public/baseline-ngram.web-local.compact.txt',
  'packages/app/public/baseline-ngram.web-local.compact.manifest.json',
  'scripts/corpus/training-report.web-local.json',
] as const;

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe('post-final autocomplete publisher', () => {
  it('rejects selectedTier=null before any output write', () => {
    const root = createRoot();
    const curve = baseCurve(null);
    writeJson(root, CURVE_PATH, withCurveHash(curve));
    seedOldOutputs(root);
    const before = outputSnapshot(root);

    expect(() => publishAutocompleteFinal({ rootDir: root })).toThrow(
      /No validation tier is eligible/u,
    );

    expect(outputSnapshot(root)).toEqual(before);
    expect(fs.existsSync(path.join(root, 'scripts/corpus/autocomplete-release-evidence'))).toBe(
      false,
    );
  });

  it('publishes one canonical profile and a fully verifiable evidence bundle', () => {
    const fixture = createPassingFixture();
    const result = publishAutocompleteFinal(fixture.options);

    expect(result.selectedTier).toBe('0.1mib');
    expect(result.modelSha256).toBe(fixture.modelSha256);
    expect(result.profiles.map((item) => item.profile)).toEqual(['web-local']);
    for (const profile of result.profiles) {
      expect(read(fixture.root, profile.modelPath)).toBe(fixture.model);
      const manifest = readJson<Record<string, unknown>>(fixture.root, profile.manifestPath);
      expect(manifest).toMatchObject({
        profile: profile.profile,
        runtimeEligible: true,
        qualityGatePassed: true,
        releaseEligible: true,
        sha256: fixture.modelSha256,
      });
      expect(readJson(fixture.root, profile.reportPath)).toMatchObject({
        classification: 'autocomplete-public-profile-report',
        profile: profile.profile,
        selectedTier: '0.1mib',
        releaseEligible: true,
      });
    }
    expect(
      fs.existsSync(
        path.join(fixture.root, result.evidenceDirectory, 'final-consumption-receipt.json'),
      ),
    ).toBe(true);
    expect(verifyAutocompleteEvidence({ rootDir: fixture.root, mode: 'rc' }).models).toEqual([
      expect.objectContaining({ profile: 'web-local', status: 'release-evidence-verified' }),
    ]);
  }, 15_000);

  it('leaves every previous public artifact intact when final evidence is tampered', () => {
    const fixture = createPassingFixture();
    const before = outputSnapshot(fixture.root);
    fs.appendFileSync(path.join(fixture.root, FINAL_RUNTIME_PATH), '\n', 'utf8');

    expect(() => publishAutocompleteFinal(fixture.options)).toThrow(
      /final evidence is invalid|runtime evidence failed/u,
    );

    expect(outputSnapshot(fixture.root)).toEqual(before);
    expect(
      fs.existsSync(path.join(fixture.root, 'scripts/corpus/autocomplete-release-evidence')),
    ).toBe(false);
  });

  it('rejects an evidence binding that escapes the workspace without writing outputs', () => {
    const fixture = createPassingFixture();
    const before = outputSnapshot(fixture.root);
    const manifestPath = `${CANDIDATE_DIR}/manifest.json`;
    const manifest = readJson<Record<string, unknown>>(fixture.root, manifestPath);
    const bindings = manifest.evidenceBindings as Record<string, unknown>;
    bindings.qualityReport = {
      path: '../../../../../outside-quality.json',
      sha256: '0'.repeat(64),
    };
    writeJson(fixture.root, manifestPath, manifest);

    expect(() => publishAutocompleteFinal(fixture.options)).toThrow(/escapes the workspace/u);
    expect(outputSnapshot(fixture.root)).toEqual(before);
  });

  it('re-opens the curve, model, and one-shot receipt instead of trusting their claims', () => {
    const tamperers: Array<(fixture: ReturnType<typeof createPassingFixture>) => void> = [
      (fixture) => {
        const curve = readJson<Record<string, unknown>>(fixture.root, CURVE_PATH);
        curve.generatedCorpusSha256 = '0'.repeat(64);
        writeJson(fixture.root, CURVE_PATH, curve);
      },
      (fixture) => {
        fs.appendFileSync(path.join(fixture.root, `${CANDIDATE_DIR}/model.compact.txt`), 'corrupt');
      },
      (fixture) => {
        fs.appendFileSync(
          path.join(fixture.root, AUTOCOMPLETE_EVIDENCE_SOURCE_FILES[0]),
          '\n// evaluator tamper\n',
        );
      },
      (fixture) => {
        fs.appendFileSync(
          path.join(fixture.root, 'scripts/frozen-v1-fb46b1e/runner.ts'),
          '\n// frozen runner tamper\n',
        );
      },
      (fixture) => {
        const finalHoldoutPath = 'scripts/corpus/workspace-conditioned-final-v2.json';
        const finalHoldout = readJson<Record<string, unknown>>(fixture.root, finalHoldoutPath);
        const targets = finalHoldout.targets as Array<Record<string, unknown>>;
        targets[0]!.text = `${String(targets[0]!.text)} semantic-tamper`;
        writeJson(fixture.root, finalHoldoutPath, finalHoldout);
      },
      (fixture) => {
        const finalEvidence = readJson<Record<string, unknown>>(
          fixture.root,
          `${FINAL_DIR}/final-evidence.json`,
        );
        const receiptPath = `${FINAL_DIR}/${String(finalEvidence.finalHoldoutSha256)}.json`;
        const receipt = readJson<Record<string, unknown>>(fixture.root, receiptPath);
        receipt.claimedAt = '2026-07-11T00:01:00.000Z';
        writeJson(fixture.root, receiptPath, receipt);
      },
    ];
    for (const tamper of tamperers) {
      const fixture = createPassingFixture();
      const before = outputSnapshot(fixture.root);
      tamper(fixture);
      expect(() => publishAutocompleteFinal(fixture.options)).toThrow();
      expect(outputSnapshot(fixture.root)).toEqual(before);
    }
  }, 15_000);
});

function createPassingFixture(): {
  root: string;
  model: string;
  modelSha256: string;
  options: PublishAutocompleteFinalOptions;
} {
  const root = createRoot();
  seedOldOutputs(root);
  const { evaluator, frozen } = seedTrustedIdentities(root);
  copy(
    path.join(REPOSITORY_ROOT, 'scripts/corpus/formal-holdout.json'),
    path.join(root, 'scripts/corpus/formal-holdout.json'),
  );
  writeJson(
    root,
    'scripts/corpus/workspace-conditioned-final-v2.json',
    createPassingFinalHoldout(),
  );
  const validation = readJson<Record<string, unknown>>(root, 'scripts/corpus/formal-holdout.json');
  const validationSha256 = sha256(canonicalJson(validation));
  const finalHoldout = readJson<Parameters<typeof validateWorkspaceFinalV2>[0]>(
    root,
    'scripts/corpus/workspace-conditioned-final-v2.json',
  );
  const finalAudit = validateWorkspaceFinalV2(finalHoldout);
  const model = '# jotluck-baseline-v4\n[character]\n["6162",[["63",1000]],"b"]\n[word]\n';
  const modelSha256 = sha256(model);
  const evaluatorVersion = 'offline-completion-evaluator-v2';
  const selection = {
    schemaVersion: 1,
    samplerVersion: 'document-sha-prefix-v1',
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
  const selectionHash = sha256(canonicalJson(selection));
  const comparison = {
    schemaVersion: 1,
    holdoutSha256: validationSha256,
    frozenV1TreeSha256: frozen.treeSha256,
    v1: comparisonMetrics(0.36),
    v2: comparisonMetrics(0.38),
    delta: {
      contextHitRate: 0.02,
      top1Rate: 0.02,
      oracleAt8Rate: 0.02,
      usableRate: 0.02,
      falseTriggerRate: -0.01,
    },
  };
  const selectedTier = tier({
    id: '0.1mib',
    requestedBytes: 104_858,
    eligible: true,
    modelSha256,
    modelBytes: Buffer.byteLength(model),
    validationSha256,
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
  ].map(([id, requestedBytes]) =>
    tier({
      id: String(id),
      requestedBytes: Number(requestedBytes),
      eligible: false,
      modelSha256: '5'.repeat(64),
      modelBytes: Buffer.byteLength(model),
      validationSha256,
      selectionHash: '6'.repeat(64),
      comparison,
    }),
  );
  let curve = withCurveHash({
    ...baseCurve('0.1mib'),
    validationSha256,
    evaluatorTreeSha256: evaluator.treeSha256,
    frozenV1TreeSha256: frozen.treeSha256,
    tiers: [selectedTier, ...otherTiers],
  });
  writeJson(root, CURVE_PATH, curve);
  write(root, `${CANDIDATE_DIR}/model.compact.txt`, model);
  writeJson(root, `${CANDIDATE_DIR}/selection-manifest.json`, selection);
  writeJson(root, `${CANDIDATE_DIR}/evaluator-identity.json`, evaluator);
  const quality = {
    schemaVersion: 2,
    classification: 'deterministic-model-quality-evidence',
    stage: 'validation',
    profile: 'web-local',
    modelSha256,
    trainingInputHash: selectedTier.trainingInputHash,
    validationSha256,
    evaluatorVersion,
    evaluatorTreeSha256: curve.evaluatorTreeSha256,
    frozenV1TreeSha256: curve.frozenV1TreeSha256,
    comparison,
    evaluation: {
      schemaVersion: 2,
      evaluatorVersion,
      model: { sha256: modelSha256, bytes: Buffer.byteLength(model) },
      holdout: { sha256: validationSha256, opportunities: 200 },
      l3Raw: { contextHitRate: 0.4, top1Rate: 0.38, oracleAt8Rate: 0.5 },
      fullStack: {
        triggerRate: 0.36,
        usableRate: 0.36,
        falseTriggerRate: 0.02,
        mixedCandidates: 0,
      },
      verdicts: { runtimeSafety: { status: 'pass' }, modelQuality: { status: 'pass' } },
    },
    releaseEligible: false,
  };
  writeJson(root, `${CANDIDATE_DIR}/quality-evidence.json`, quality);
  writeJson(root, `${CANDIDATE_DIR}/v1-v2-comparison.json`, comparison);
  const validationRuntime = {
    schemaVersion: 2,
    classification: 'production-router-runtime-evidence',
    validationSha256,
    evaluatorVersion: 'production-router-runtime-v2',
    tiers: { '0.1mib': runtimeTier(modelSha256) },
  };
  writeJson(root, `${CANDIDATE_DIR}/runtime-evidence.json`, validationRuntime);
  curve = withCurveHash({
    ...curve,
    runtimeEvidenceSha256: sha256(
      fs.readFileSync(path.join(root, `${CANDIDATE_DIR}/runtime-evidence.json`)),
    ),
  });
  writeJson(root, CURVE_PATH, curve);

  const binding = (relativePath: string) => ({
    path: relativePath,
    sha256: sha256(fs.readFileSync(path.join(root, relativePath))),
  });
  const manifest = {
    schemaVersion: 2,
    profile: 'web-local',
    modelFile: 'model.compact.txt',
    serialization: 'sectioned-jsonl-hex-v4',
    order: 'section-profile-context-hex',
    ngramN: 4,
    minNgramN: 2,
    wordNgramOrders: [1, 2],
    countScale: 1000,
    modelBytes: Buffer.byteLength(model),
    entryCount: 1,
    characterEntryCount: 1,
    wordEntryCount: 0,
    sha256: modelSha256,
    trainingInputHash: selectedTier.trainingInputHash,
    verifiedOnly: true,
    runtimeEligible: false,
    qualityGatePassed: false,
    releaseEligible: false,
    softTargetPassed: true,
    hardLimitPassed: true,
    generatedAt: '2026-07-11T00:00:00.000Z',
    sourceCount: 5,
    holdoutSha256: validationSha256,
    evaluatorVersion,
    evaluatorSha256: curve.evaluatorTreeSha256,
    qualityEvidenceSha256: binding(`${CANDIDATE_DIR}/quality-evidence.json`).sha256,
    learningCurveSha256: curve.learningCurveSha256,
    degradedReason: 'candidate-validation-only',
    evidenceBindings: {
      schemaVersion: 2,
      model: binding(`${CANDIDATE_DIR}/model.compact.txt`),
      trainingInput: binding(`${CANDIDATE_DIR}/selection-manifest.json`),
      validation: binding('scripts/corpus/formal-holdout.json'),
      evaluatorTree: binding(`${CANDIDATE_DIR}/evaluator-identity.json`),
      frozenV1: binding('scripts/frozen-v1-fb46b1e/snapshot-manifest.json'),
      qualityReport: binding(`${CANDIDATE_DIR}/quality-evidence.json`),
      runtimeReport: binding(`${CANDIDATE_DIR}/runtime-evidence.json`),
      comparison: binding(`${CANDIDATE_DIR}/v1-v2-comparison.json`),
      learningCurve: binding(CURVE_PATH),
      final: null,
    },
  };
  writeJson(root, `${CANDIDATE_DIR}/manifest.json`, manifest);

  const finalRuntime = {
    schemaVersion: 1,
    classification: 'workspace-final-v2-runtime-evidence',
    stage: 'final',
    productionRouterObserved: true,
    modelSha256,
    finalHoldoutSha256: finalAudit.datasetSha256,
    opportunities: 200,
    requestCount: 200,
    visibleSampleCount: 72,
    triggerRate: 0.36,
    usableRate: 0.36,
    falseTriggerRate: 0.02,
    mixedCandidateRate: 0,
    allRequestP90Ms: 100,
    visiblePredictionP90Ms: 110,
    oracleAt8Rate: 0.5,
    top1Rate: 0.4,
    language: {
      zh: { top1Rate: 0.4, usableRate: 0.36, v1Top1Rate: 0.4, v1UsableRate: 0.36 },
      en: { top1Rate: 0.4, usableRate: 0.36, v1Top1Rate: 0.4, v1UsableRate: 0.36 },
    },
  };
  writeJson(root, FINAL_RUNTIME_PATH, finalRuntime);
  const receipt = {
    schemaVersion: 1,
    classification: 'workspace-final-v2-consumption-receipt',
    finalHoldoutSha256: finalAudit.datasetSha256,
    modelSha256,
    validationCurveSha256: curve.learningCurveSha256,
    claimedAt: '2026-07-11T00:00:00.000Z',
  };
  const receiptPath = `${FINAL_DIR}/${finalAudit.datasetSha256}.json`;
  writeJson(root, receiptPath, receipt);
  writeJson(root, `${FINAL_DIR}/final-evidence.json`, {
    schemaVersion: 1,
    classification: 'workspace-final-v2-evidence',
    releaseEligible: true,
    finalHoldoutConsumed: true,
    modelSha256,
    validationCurveSha256: curve.learningCurveSha256,
    finalHoldoutSha256: finalAudit.datasetSha256,
    finalAudit,
    runtime: finalRuntime,
    runtimeEvidenceSha256: sha256(fs.readFileSync(path.join(root, FINAL_RUNTIME_PATH))),
    consumptionReceiptSha256: sha256(fs.readFileSync(path.join(root, receiptPath))),
    v21Eligible: true,
  });
  writeJson(root, WEBVIEW_PATH, {
    schemaVersion: 1,
    classification: 'tauri-webview-offline-smoke',
    status: 'pass',
    modelSha256,
    completedAt: '2026-07-11T01:00:00.000Z',
  });
  return { root, model, modelSha256, options: { rootDir: root } };
}

function baseCurve(selectedTier: string | null): Record<string, unknown> {
  return {
    schemaVersion: 2,
    version: 'autocomplete-learning-curve-v2',
    stage: 'validation',
    generatedAt: '2026-07-11T00:00:00.000Z',
    generatorVersion: 'jotluck-synthetic-short-notes-v1',
    generatorSeed: 'project-owned-seed-2026-07-11',
    sourceIds: [...SYNTHETIC_LEARNING_CURVE_SOURCE_IDS],
    generatedCorpusSha256: '8'.repeat(64),
    validationPath: 'scripts/corpus/formal-holdout.json',
    validationSha256: '9'.repeat(64),
    evaluatorVersion: 'offline-completion-evaluator-v2',
    evaluatorTreeSha256: '7'.repeat(64),
    frozenV1TreeSha256: '4'.repeat(64),
    runtimeEvidenceSha256: selectedTier ? 'a'.repeat(64) : null,
    runtimeEvidenceStatus: selectedTier ? 'accepted' : 'not-provided',
    runtimeEvidenceError: null,
    tiers: [],
    selectedTier,
    selectionReason: selectedTier ? 'minimum-eligible-tier' : 'no-tier-passed-all-gates',
    releaseEligible: false,
    finalHoldoutConsumed: false,
  };
}

function tier(input: {
  id: string;
  requestedBytes: number;
  eligible: boolean;
  modelSha256: string;
  modelBytes: number;
  validationSha256: string;
  selectionHash: string;
  comparison: Record<string, unknown>;
}): Record<string, unknown> {
  return {
    id: input.id,
    requestedBytes: input.requestedBytes,
    realizedBytes: Math.min(input.requestedBytes, 100_000),
    selectionManifestHash: input.selectionHash,
    selectionDocumentCount: 1,
    selectionFragmentCount: 1,
    modelSha256: input.modelSha256,
    modelBytes: input.modelBytes,
    trainingInputHash: 'b'.repeat(64),
    sourceIds: [...SYNTHETIC_LEARNING_CURVE_SOURCE_IDS],
    safetyGatePassed: input.eligible,
    hardLimitPassed: input.eligible,
    softTargetPassed: input.eligible,
    contextHitRate: 0.4,
    top1Rate: 0.38,
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
    visiblePredictionP90Ms: input.eligible ? 110 : null,
    fallbackRate: input.eligible ? 0.1 : null,
    timeoutRate: input.eligible ? 0 : null,
    parseMaxChunkMs: input.eligible ? 40 : null,
    parseLongTasksOver50Ms: input.eligible ? 0 : null,
    v1Comparison: input.comparison,
    eligible: input.eligible,
    ineligibilityReasons: input.eligible ? [] : ['absolute-quality-gates'],
    candidateDirectory: `${CANDIDATE_DIR.replace('/0.1mib', '')}/${input.id}`,
  };
}

function runtimeTier(modelSha256: string): Record<string, unknown> {
  return {
    modelSha256,
    requestCount: 200,
    visibleSampleCount: 72,
    allRequestP90Ms: 100,
    visiblePredictionP90Ms: 110,
    fallbackRate: 0.1,
    timeoutRate: 0,
    mixedCandidateRate: 0,
    parseMaxChunkMs: 40,
    parseLongTasksOver50Ms: 0,
    productionRouterObserved: true,
  };
}

function comparisonMetrics(value: number): Record<string, unknown> {
  return {
    contextHitRate: value,
    top1Rate: value,
    oracleAt8Rate: value + 0.1,
    usableRate: value,
    falseTriggerRate: value === 0.36 ? 0.03 : 0.02,
    mixedCandidates: 0,
    allRequestP90Ms: 100,
    visiblePredictionP90Ms: 110,
    fallbackRate: 0.1,
    timeoutRate: 0,
    attribution: { l3: 1 },
  };
}

function createPassingFinalHoldout(): WorkspaceFinalHoldout {
  const supportDocuments: WorkspaceFinalHoldout['supportDocuments'] = [];
  const targets: WorkspaceFinalHoldout['targets'] = [];
  for (let index = 0; index < 50; index++) {
    const language = index < 25 ? 'zh' : 'en';
    const targetId = `target-${String(index).padStart(2, '0')}`;
    const supportIds = [
      `support-${String(index).padStart(2, '0')}-a`,
      `support-${String(index).padStart(2, '0')}-b`,
    ];
    if (language === 'zh') {
      supportDocuments.push(
        {
          id: supportIds[0]!,
          path: `support/zh-${index}-a.md`,
          language,
          text: uniqueCjk(0x5200 + index * 40, 10),
        },
        {
          id: supportIds[1]!,
          path: `support/zh-${index}-b.md`,
          language,
          text: uniqueCjk(0x5200 + index * 40 + 12, 10),
        },
      );
      const text = uniqueCjk(0x6800 + index * 18, 14);
      targets.push({
        id: targetId,
        path: `targets/zh-${index}.md`,
        language,
        category: `category-${index % 5}`,
        text,
        supportDocumentIds: supportIds,
        checkpoints: [
          ...[2, 5, 8].map((cursorOffset, checkpoint) => ({
            id: `${targetId}-complete-${checkpoint}`,
            cursorOffset,
            expectedSuffix: text.slice(cursorOffset),
            expectedBehavior: 'complete' as const,
          })),
          {
            id: `${targetId}-silence`,
            cursorOffset: text.length,
            expectedSuffix: '',
            expectedBehavior: 'silence' as const,
          },
        ],
      });
    } else {
      const stem = alphabeticId(index);
      supportDocuments.push(
        {
          id: supportIds[0]!,
          path: `support/en-${index}-a.md`,
          language,
          text: Array.from({ length: 6 }, (_, word) => `${stem}supporta${alphabeticId(word)}`).join(
            ' ',
          ),
        },
        {
          id: supportIds[1]!,
          path: `support/en-${index}-b.md`,
          language,
          text: Array.from({ length: 6 }, (_, word) => `${stem}supportb${alphabeticId(word)}`).join(
            ' ',
          ),
        },
      );
      const words = Array.from({ length: 8 }, (_, word) => `${stem}target${alphabeticId(word)}`);
      const text = words.join(' ');
      const offsets = [2, 4, 6].map((wordIndex) => words.slice(0, wordIndex).join(' ').length + 1);
      targets.push({
        id: targetId,
        path: `targets/en-${index}.md`,
        language,
        category: `category-${index % 5}`,
        text,
        supportDocumentIds: supportIds,
        checkpoints: [
          ...offsets.map((cursorOffset, checkpoint) => ({
            id: `${targetId}-complete-${checkpoint}`,
            cursorOffset,
            expectedSuffix: text.slice(cursorOffset),
            expectedBehavior: 'complete' as const,
          })),
          {
            id: `${targetId}-silence`,
            cursorOffset: text.length,
            expectedSuffix: '',
            expectedBehavior: 'silence' as const,
          },
        ],
      });
    }
  }
  return {
    schemaVersion: 2,
    datasetId: 'workspace-conditioned-final-v2.publisher-test',
    frozenAt: '2026-07-11T00:00:00.000Z',
    classification: 'workspace-conditioned-final-v2',
    releaseEvidence: true,
    description: 'Deterministic publisher transaction fixture.',
    supportDocuments,
    targets,
  };
}

function uniqueCjk(start: number, length: number): string {
  return Array.from({ length }, (_, offset) => String.fromCodePoint(start + offset)).join('');
}

function alphabeticId(value: number): string {
  const first = String.fromCharCode(97 + (value % 26));
  const second = String.fromCharCode(97 + (Math.floor(value / 26) % 26));
  return `${first}${second}`;
}

function withCurveHash<T extends Record<string, unknown>>(
  curve: T,
): T & { learningCurveSha256: string } {
  const { learningCurveSha256: _old, ...core } = curve;
  return { ...core, learningCurveSha256: sha256(canonicalJson(core)) } as T & {
    learningCurveSha256: string;
  };
}

function seedTrustedIdentities(root: string): {
  evaluator: {
    schemaVersion: 1;
    files: Array<{ path: string; sha256: string }>;
    treeSha256: string;
  };
  frozen: { treeSha256: string };
} {
  const files = AUTOCOMPLETE_EVIDENCE_SOURCE_FILES.map((relativePath: string) => {
    const source = path.join(REPOSITORY_ROOT, relativePath);
    const target = path.join(root, relativePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
    return { path: relativePath, sha256: sha256(fs.readFileSync(target)) };
  });
  const frozenSource = path.join(REPOSITORY_ROOT, 'scripts/frozen-v1-fb46b1e');
  const frozenTarget = path.join(root, 'scripts/frozen-v1-fb46b1e');
  fs.cpSync(frozenSource, frozenTarget, { recursive: true });
  return {
    evaluator: { schemaVersion: 1, files, treeSha256: sha256(canonicalJson(files)) },
    frozen: readJson<{ treeSha256: string }>(
      root,
      'scripts/frozen-v1-fb46b1e/snapshot-manifest.json',
    ),
  };
}

function createRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jotluck-autocomplete-publish-'));
  temporaryRoots.push(root);
  return root;
}

function seedOldOutputs(root: string): void {
  for (const [index, relativePath] of OUTPUTS.entries()) {
    write(root, relativePath, `old-${index}\n`);
  }
}

function outputSnapshot(root: string): Record<string, string> {
  return Object.fromEntries(
    OUTPUTS.map((relativePath) => [relativePath, read(root, relativePath)]),
  );
}

function copy(source: string, target: string): void {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
}

function write(root: string, relativePath: string, content: string): void {
  const target = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, 'utf8');
}

function writeJson(root: string, relativePath: string, value: unknown): void {
  write(root, relativePath, `${JSON.stringify(value, null, 2)}\n`);
}

function read(root: string, relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function readJson<T = Record<string, unknown>>(root: string, relativePath: string): T {
  return JSON.parse(read(root, relativePath)) as T;
}

function sha256(value: string | Buffer): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right, 'en'))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}
