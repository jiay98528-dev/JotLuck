import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { assertV2SArchitectureActive } from './architecture-stop';
import { canonicalJson, normalizeRelativePath, resolveInside, sha256 } from './common';
import {
  finalizeV2SManifest,
  packV2SContainer,
  unpackV2SContainer,
  verifyV2SManifest,
  type V2SPublicModelManifest,
} from './container-v6';
import { gateModelToBytes, trainG0Gate, trainG1Gate, type GateSample } from './gate';
import { resolveV2SCandidateDirectory } from './matrix';

const REQUIRED_SECTIONS = [
  'tokenizer.zh',
  'tokenizer.en',
  'lm.zh',
  'lm.en',
  'gate',
  'metadata',
] as const;
const MAX_GATE_BYTES = 32 * 1024;

export async function repackV2SCandidateGate(options: {
  workspaceRoot: string;
  sourceCandidateId: string;
  candidateId: string;
  gateKind: 'g0' | 'g1';
  gateSamples: readonly GateSample[];
  gateSamplesPath: string;
}): Promise<{ directory: string; manifest: V2SPublicModelManifest }> {
  assertV2SArchitectureActive(options.workspaceRoot);
  if (options.sourceCandidateId === options.candidateId) {
    throw new Error('V2S gate repack requires a new candidate id.');
  }
  const sourceDirectory = resolveV2SCandidateDirectory(
    options.workspaceRoot,
    options.sourceCandidateId,
  );
  const sourceManifestPath = path.join(sourceDirectory, 'manifest.json');
  const sourceManifestBytes = await readFile(sourceManifestPath);
  const sourceManifest = JSON.parse(sourceManifestBytes.toString('utf8')) as V2SPublicModelManifest;
  verifyV2SManifest(sourceManifest);
  if (
    sourceManifest.profile !== 'candidate' ||
    sourceManifest.runtimeEligible ||
    sourceManifest.qualityGatePassed ||
    sourceManifest.releaseEligible
  ) {
    throw new Error('V2S gate repack accepts only fail-closed candidate manifests.');
  }
  const expectedSourceAsset = path.join(sourceDirectory, 'public-v2s.bin');
  const sourceAssetPath = resolveInside(
    options.workspaceRoot,
    sourceManifest.asset.path,
    'V2S source candidate asset',
  );
  if (path.resolve(sourceAssetPath) !== path.resolve(expectedSourceAsset)) {
    throw new Error('V2S source candidate manifest points outside its own directory.');
  }
  const sourceAsset = await readFile(sourceAssetPath);
  if (
    sourceAsset.byteLength !== sourceManifest.asset.bytes ||
    sha256(sourceAsset) !== sourceManifest.asset.sha256
  ) {
    throw new Error('V2S source candidate asset does not match its manifest.');
  }
  const unpacked = unpackV2SContainer(sourceAsset);
  if (
    unpacked.headerSha256 !== sourceManifest.asset.containerHeaderSha256 ||
    REQUIRED_SECTIONS.some((id) => !unpacked.sections.has(id)) ||
    unpacked.sections.size !== REQUIRED_SECTIONS.length
  ) {
    throw new Error('V2S source candidate container identity is invalid.');
  }
  const gateSamplesRelativePath = normalizeRelativePath(
    options.gateSamplesPath,
    'V2S gate samples',
  );
  const gateSamplesRaw = await readFile(
    resolveInside(options.workspaceRoot, gateSamplesRelativePath, 'V2S gate samples'),
  );
  const gateSamplesFromDisk = JSON.parse(gateSamplesRaw.toString('utf8')) as GateSample[];
  const canonicalGateSamples = canonicalJson(gateSamplesFromDisk);
  if (canonicalGateSamples !== canonicalJson(options.gateSamples)) {
    throw new Error('V2S gate samples changed between CLI validation and repack.');
  }
  const canonicalGateSamplesBytes = new TextEncoder().encode(canonicalGateSamples);
  const gate =
    options.gateKind === 'g0' ? trainG0Gate(options.gateSamples) : trainG1Gate(options.gateSamples);
  const gateSamplesSummary = summarizeGateSamples(gateSamplesFromDisk);
  const gateBytes = gateModelToBytes(gate);
  if (gateBytes.byteLength > MAX_GATE_BYTES) {
    throw new Error('V2S calibrated gate exceeds the 32 KiB limit.');
  }
  const metadata = parseMetadata(unpacked.sections.get('metadata')!);
  const metadataMaxOrder = metadata.maxOrder;
  const zhMaxOrder = parseMknMaxOrder(unpacked.sections.get('lm.zh')!);
  const enMaxOrder = parseMknMaxOrder(unpacked.sections.get('lm.en')!);
  if (
    !Number.isSafeInteger(metadataMaxOrder) ||
    (metadataMaxOrder as number) < 2 ||
    (metadataMaxOrder as number) > 5 ||
    sourceManifest.architecture.ngramOrders[1] !== metadataMaxOrder ||
    zhMaxOrder !== metadataMaxOrder ||
    enMaxOrder !== metadataMaxOrder
  ) {
    throw new Error('V2S source manifest and runtime metadata disagree on MKN order.');
  }
  const metadataBytes = new TextEncoder().encode(
    canonicalJson({ ...metadata, candidateId: options.candidateId }),
  );
  const container = packV2SContainer(
    REQUIRED_SECTIONS.map((id) => ({
      id,
      bytes:
        id === 'gate' ? gateBytes : id === 'metadata' ? metadataBytes : unpacked.sections.get(id)!,
    })),
    sourceManifest.architecture.assetBudgetBytes,
  );

  const finalDirectory = resolveV2SCandidateDirectory(options.workspaceRoot, options.candidateId);
  const temporaryDirectory = `${finalDirectory}.tmp-${process.pid}`;
  await mkdir(path.dirname(finalDirectory), { recursive: true });
  await rm(temporaryDirectory, { recursive: true, force: true });
  await mkdir(temporaryDirectory, { recursive: false });
  try {
    const relativeDirectory = path
      .relative(options.workspaceRoot, finalDirectory)
      .replaceAll(path.sep, '/');
    const canonicalGateSamplesRelativePath = `${relativeDirectory}/gate-samples.canonical.json`;
    const { manifestSha256: _sourceManifestSha256, ...sourceUnsigned } = sourceManifest;
    const manifest = finalizeV2SManifest({
      ...sourceUnsigned,
      candidateId: options.candidateId,
      architecture: {
        ...sourceManifest.architecture,
        quantization:
          gate.kind === 'g0-rules' ? 'probability-q16+gate-q16' : 'probability-q16+gate-int8',
        gateKind: gate.kind,
      },
      asset: {
        path: `${relativeDirectory}/public-v2s.bin`,
        bytes: container.bytes.byteLength,
        sha256: sha256(container.bytes),
        containerHeaderSha256: container.headerSha256,
      },
      evidenceBindings: {
        ...sourceManifest.evidenceBindings,
        parentCandidate: {
          path: path.relative(options.workspaceRoot, sourceManifestPath).replaceAll(path.sep, '/'),
          sha256: sha256(sourceManifestBytes),
        },
        gateSamples: {
          path: gateSamplesRelativePath,
          sha256: sha256(gateSamplesRaw),
        },
        gateSamplesCanonical: {
          path: canonicalGateSamplesRelativePath,
          sha256: sha256(canonicalGateSamplesBytes),
        },
      },
    });
    const sourceReport = parseReport(
      await readFile(path.join(sourceDirectory, 'training-report.json')),
    );
    const report = {
      ...sourceReport,
      candidateId: options.candidateId,
      parentCandidateId: options.sourceCandidateId,
      gateKind: gate.kind,
      gateCalibrationStatus: gate.calibration.status,
      gateCalibrationFailureReasons: gate.calibration.failureReasons,
      gateCalibrationMetrics: gate.calibration.metrics,
      excludedBankMisses: gate.excludedBankMisses,
      gateSamples: {
        path: gateSamplesRelativePath,
        rawSha256: sha256(gateSamplesRaw),
        canonicalSha256: sha256(canonicalGateSamplesBytes),
        ...gateSamplesSummary,
      },
      containerBytes: container.bytes.byteLength,
      note: 'candidate-only; gate-only repack; no holdout quality claim',
    };
    await Promise.all([
      writeFile(path.join(temporaryDirectory, 'public-v2s.bin'), container.bytes),
      writeFile(
        path.join(temporaryDirectory, 'gate-samples.canonical.json'),
        canonicalGateSamplesBytes,
      ),
      writeFile(
        path.join(temporaryDirectory, 'manifest.json'),
        `${canonicalJson(manifest)}\n`,
        'utf8',
      ),
      writeFile(
        path.join(temporaryDirectory, 'training-report.json'),
        `${canonicalJson(report)}\n`,
        'utf8',
      ),
    ]);
    await rename(temporaryDirectory, finalDirectory);
    return { directory: finalDirectory, manifest };
  } catch (error) {
    await rm(temporaryDirectory, { recursive: true, force: true });
    throw error;
  }
}

function summarizeGateSamples(samples: readonly GateSample[]): {
  count: number;
  labels: Record<GateSample['label'], number>;
  calibrationRoles: Record<GateSample['calibrationRole'], number>;
  languages: Record<GateSample['language'], number>;
  expectedBehaviors: Record<GateSample['expectedBehavior'], number>;
} {
  const labels = { show: 0, silence: 0, 'bank-miss': 0 };
  const calibrationRoles = { fit: 0, calibration: 0 };
  const languages = { zh: 0, en: 0 };
  const expectedBehaviors = { complete: 0, silence: 0 };
  for (const sample of samples) {
    labels[sample.label] += 1;
    calibrationRoles[sample.calibrationRole] += 1;
    languages[sample.language] += 1;
    expectedBehaviors[sample.expectedBehavior] += 1;
  }
  return {
    count: samples.length,
    labels,
    calibrationRoles,
    languages,
    expectedBehaviors,
  };
}

function parseMetadata(bytes: Uint8Array): Record<string, unknown> {
  const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    (value as Record<string, unknown>).schema !== 'jotluck.autocomplete.v2s-runtime-metadata.v1'
  ) {
    throw new Error('V2S source candidate metadata is invalid.');
  }
  return value as Record<string, unknown>;
}

function parseMknMaxOrder(bytes: Uint8Array): number {
  const magic = new TextEncoder().encode('JLMKN2\0\0');
  if (bytes.byteLength < 24 || magic.some((value, index) => bytes[index] !== value)) {
    throw new Error('V2S source candidate MKN identity is invalid.');
  }
  const maxOrder = bytes[8]!;
  if (maxOrder < 2 || maxOrder > 5) {
    throw new Error('V2S source candidate MKN order is invalid.');
  }
  return maxOrder;
}

function parseReport(bytes: Uint8Array): Record<string, unknown> {
  const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    (value as Record<string, unknown>).schema !== 'jotluck.autocomplete.v2s-training-report.v1'
  ) {
    throw new Error('V2S source candidate training report is invalid.');
  }
  return value as Record<string, unknown>;
}
