import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
// The independent verifier intentionally has no TypeScript declaration output.
// @ts-expect-error See scripts/verify-autocomplete-v2r-evidence.mjs.
import {
  hasAnyV2RPublicManifest,
  verifyAutocompleteV2REvidence,
} from '../verify-autocomplete-v2r-evidence.mjs';
import {
  PUBLIC_MODEL_MANIFEST_SCHEMA_V5,
  validatePublicModelManifestV5,
  type PublicModelManifestV5,
} from '../autocomplete-v2r/manifest-v5';
import { V2R_REPOSITORY_ROOT } from '../autocomplete-v2r/workspace';

const HASH = 'a'.repeat(64);
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true })));
});

function makeManifest(): PublicModelManifestV5 {
  return {
    schema: PUBLIC_MODEL_MANIFEST_SCHEMA_V5,
    schemaVersion: 5,
    engine: 'public-phrase-transformer-v1',
    profile: 'web-local',
    createdAt: '2026-07-12T00:00:00.000Z',
    architecture: {
      format: 'onnx',
      quantization: 'int8',
      phraseBankSize: 8192,
      hiddenSize: 96,
      layers: 2,
      attentionHeads: 4,
      maxContextUtf8Bytes: 192,
      contextPatchBytes: 4,
      maxCandidates: 32,
      abstainClass: true,
    },
    assets: [
      {
        role: 'model',
        path: 'packages/app/public/autocomplete/v2r/model.int8.onnx',
        sha256: HASH,
        bytes: 2_000_000,
      },
      {
        role: 'phrase-bank',
        path: 'packages/app/public/autocomplete/v2r/phrases.bin',
        sha256: HASH,
        bytes: 1_000_000,
      },
      {
        role: 'metadata',
        path: 'packages/app/public/autocomplete/v2r/metadata.json',
        sha256: HASH,
        bytes: 1_000,
      },
      {
        role: 'runtime',
        path: 'packages/app/public/autocomplete/v2r/ort-wasm.wasm',
        sha256: HASH,
        bytes: 3_000_000,
      },
    ],
    staticBundleDeltaBytes: 6_001_000,
    training: {
      selectionManifestPath:
        'scripts/corpus/autocomplete-v2r-release/candidate/selection-manifest.json.gz',
      selectionManifestSha256: HASH,
      inputTreeSha256: HASH,
      generatorVersion: 'jotluck-project-owned-short-notes-v3.1',
      seeds: [17, 29],
      trainBytes: 24 * 1024 * 1024,
      developmentBytes: 3 * 1024 * 1024,
      internalSelectionBytes: 3 * 1024 * 1024,
    },
    evidenceBindings: Object.fromEntries(
      [
        'model',
        'phraseBank',
        'metadata',
        'runtime',
        'selectionManifest',
        'sourceRegistry',
        'corpusGovernance',
        'generatorReport',
        'trainingInput',
        'trainingReport',
        'quantizationReport',
        'operatorConfig',
        'runtimeBuildReport',
        'bundleSizeReport',
        'coldValidationHoldout',
        'workspaceValidationHoldout',
        'coldFinalHoldout',
        'workspaceFinalHoldout',
        'evaluatorSourceTree',
        'qualityReport',
        'runtimeReport',
        'finalConsumptionReceipt',
        'finalOverlapAudit',
        'webviewSmoke',
      ].map((name) => [
        name,
        { path: `scripts/autocomplete-v2r/evidence/${name}.json`, sha256: HASH },
      ]),
    ),
    runtimeEligible: true,
    qualityGatePassed: true,
    releaseEligible: true,
  };
}

describe('V2R public model manifest v5', () => {
  it('accepts the frozen architecture, evidence, asset, and runtime bindings', () => {
    expect(validatePublicModelManifestV5(makeManifest())).toEqual(makeManifest());
  });

  it('rejects an architecture outside the bounded matrix', () => {
    const manifest = makeManifest();
    manifest.architecture.hiddenSize = 128;
    expect(() => validatePublicModelManifestV5(manifest)).toThrow(/training matrix/u);
  });

  it('requires the WASM runtime asset and enforces fail-closed qualification flags', () => {
    const missingRuntime = makeManifest();
    missingRuntime.assets = missingRuntime.assets.filter((asset) => asset.role !== 'runtime');
    expect(() => validatePublicModelManifestV5(missingRuntime)).toThrow(/WASM runtime/u);

    const inconsistent = makeManifest();
    inconsistent.runtimeEligible = false;
    expect(() => validatePublicModelManifestV5(inconsistent)).toThrow(/qualityGatePassed/u);
  });

  it('rejects path traversal and model data beyond six MiB', () => {
    const traversal = makeManifest();
    traversal.assets[0]!.path = '../model.onnx';
    expect(() => validatePublicModelManifestV5(traversal)).toThrow(/allowed repository root/u);

    const oversized = makeManifest();
    oversized.assets[0]!.bytes = 6 * 1024 * 1024;
    expect(() => validatePublicModelManifestV5(oversized)).toThrow(/exceed/u);
  });

  it('treats a single v5 profile as an atomic-publication failure', async () => {
    const root = await mkdtemp(path.join(V2R_REPOSITORY_ROOT, '.tmp-v2r-verify-'));
    temporaryRoots.push(root);
    const publicRoot = path.join(root, 'packages', 'app', 'public');
    await mkdir(publicRoot, { recursive: true });
    await writeFile(
      path.join(publicRoot, 'public-phrase-transformer-v1.web-local.manifest.json'),
      '{}\n',
      'utf8',
    );

    expect(hasAnyV2RPublicManifest(root)).toBe(true);
    expect(() =>
      verifyAutocompleteV2REvidence({ rootDir: root, expectedEvaluatorFiles: [] }),
    ).toThrow(/partially installed/iu);
  });

  it('rejects all v5 evidence while an architecture-stop record is present', async () => {
    const root = await mkdtemp(path.join(V2R_REPOSITORY_ROOT, '.tmp-v2r-stop-'));
    temporaryRoots.push(root);
    const stopPath = path.join(root, 'scripts/corpus/autocomplete-v2r-architecture-stop.json');
    await mkdir(path.dirname(stopPath), { recursive: true });
    await writeFile(
      stopPath,
      JSON.stringify({
        schema: 'jotluck.autocomplete.v2r-architecture-stop.v1',
        engine: 'public-phrase-transformer-v1',
        status: 'architecture-blocked',
        stopLongTraining: true,
      }),
      'utf8',
    );

    expect(() =>
      verifyAutocompleteV2REvidence({ rootDir: root, expectedEvaluatorFiles: [] }),
    ).toThrow(/architecture is blocked/iu);
  });
});
