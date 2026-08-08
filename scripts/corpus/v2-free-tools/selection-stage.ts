import { canonicalSha256, isSha256, sha256, type Sha256 } from './common';
import type { FingerprintLeakageAudit, HoldoutClassification } from './fingerprints';

export const FORMAL_128_MIB_BYTES = 128 * 1024 * 1024;
export const MAXIMUM_TRAINING_POOL_BYTES = 512 * 1024 * 1024;

export interface FormalSelectionSource {
  id: string;
  licenseSpdx: string;
  licenseEvidenceSha256: Sha256;
  licenseEvidenceBytes: number;
}

export interface FormalSelectionDocument {
  documentId: string;
  sourceId: string;
  language: 'zh' | 'en';
  category: string;
  relativePath: string;
  bytes: number;
  sha256: Sha256;
  normalizedSha256: Sha256;
  split: 'train' | 'development';
  licenseApproved: true;
}

export interface FormalSelectionManifest {
  schema: string;
  schemaVersion: number;
  datasetId: string;
  selectedBytes: number;
  splitBytes: { train: number; development: number };
  sourceBytes: Record<string, number>;
  languageBytes: Record<'zh' | 'en', number>;
  categoryBytes: Record<string, number>;
  inputTreeSha256: Sha256;
  inputNearDuplicateDocumentRate: number;
  licenseAuditSha256: Sha256;
  sources: FormalSelectionSource[];
  documents: FormalSelectionDocument[];
}

export interface Formal128SelectionStageReceipt {
  schema: 'jotluck.autocomplete.v2-free-selection-stage.v1';
  schemaVersion: 1;
  stage: 'formal-128mib-matrix';
  datasetId: string;
  selectionManifestSha256: Sha256;
  selectionInputTreeSha256: Sha256;
  fingerprintAuditSha256: Sha256;
  selectedBytes: number;
  trainBytes: number;
  developmentBytes: number;
  languages: Record<'zh' | 'en', number>;
  checkedHoldoutClassifications: HoldoutClassification[];
  finalFingerprintInventoriesRead: boolean;
  passed: true;
  receiptSha256: Sha256;
}

export function createFormal128SelectionStageReceipt(options: {
  selection: FormalSelectionManifest;
  selectionManifestBytes: Uint8Array;
  fingerprintAudit: FingerprintLeakageAudit;
  requireFinalFingerprints?: boolean;
}): Formal128SelectionStageReceipt {
  const { selection, fingerprintAudit } = options;
  validateSelection(selection);
  if (selection.selectedBytes < FORMAL_128_MIB_BYTES) {
    throw new Error('Formal 128 MiB matrix selection is undersized.');
  }
  const selectionManifestSha256 = sha256(options.selectionManifestBytes);
  if (
    !fingerprintAudit.passed ||
    fingerprintAudit.selectionManifestSha256 !== selectionManifestSha256 ||
    fingerprintAudit.selectionInputTreeSha256 !== selection.inputTreeSha256 ||
    fingerprintAudit.exactDuplicatePairs !== 0 ||
    fingerprintAudit.inputNearDuplicateDocumentRate > 0.03 ||
    fingerprintAudit.nearDuplicatePairs !== 0 ||
    fingerprintAudit.nearDuplicateDocumentRate !== 0 ||
    fingerprintAudit.exactHoldoutOverlaps !== 0 ||
    fingerprintAudit.nearHoldoutOverlaps !== 0 ||
    fingerprintAudit.longWindowLeakages !== 0 ||
    fingerprintAudit.finalContentRead !== false ||
    !isSha256(fingerprintAudit.reportSha256)
  ) {
    throw new Error('Formal 128 MiB matrix selection fingerprint audit failed.');
  }
  const classifications = [
    ...new Set(fingerprintAudit.holdoutInventories.map((item) => item.classification)),
  ].sort() as HoldoutClassification[];
  for (const required of ['cold-validation-v1', 'workspace-validation-v1'] as const) {
    if (!classifications.includes(required)) {
      throw new Error(`Formal selection is missing ${required} fingerprints.`);
    }
  }
  if (options.requireFinalFingerprints) {
    for (const required of ['cold-final-v1', 'workspace-final-v1'] as const) {
      if (!classifications.includes(required)) {
        throw new Error(`Release preflight is missing ${required} fingerprints.`);
      }
    }
  }
  const withoutHash = {
    schema: 'jotluck.autocomplete.v2-free-selection-stage.v1' as const,
    schemaVersion: 1 as const,
    stage: 'formal-128mib-matrix' as const,
    datasetId: selection.datasetId,
    selectionManifestSha256,
    selectionInputTreeSha256: selection.inputTreeSha256,
    fingerprintAuditSha256: fingerprintAudit.reportSha256,
    selectedBytes: selection.selectedBytes,
    trainBytes: selection.splitBytes.train,
    developmentBytes: selection.splitBytes.development,
    languages: selection.languageBytes,
    checkedHoldoutClassifications: classifications,
    finalFingerprintInventoriesRead: classifications.some((item) => item.endsWith('-final-v1')),
    passed: true as const,
  };
  return { ...withoutHash, receiptSha256: canonicalSha256(withoutHash) };
}

function validateSelection(selection: FormalSelectionManifest): void {
  if (
    !selection.datasetId ||
    !Number.isSafeInteger(selection.selectedBytes) ||
    selection.selectedBytes < 1 ||
    selection.selectedBytes > MAXIMUM_TRAINING_POOL_BYTES ||
    !isSha256(selection.inputTreeSha256) ||
    !Number.isFinite(selection.inputNearDuplicateDocumentRate) ||
    selection.inputNearDuplicateDocumentRate < 0 ||
    selection.inputNearDuplicateDocumentRate > 0.03 ||
    !isSha256(selection.licenseAuditSha256) ||
    !Array.isArray(selection.sources) ||
    selection.sources.length < 1 ||
    !Array.isArray(selection.documents) ||
    selection.documents.length < 2
  ) {
    throw new Error('Formal selection contract is invalid.');
  }
  const sourceIds = new Set<string>();
  for (const source of selection.sources) {
    if (
      !source.id ||
      sourceIds.has(source.id) ||
      !source.licenseSpdx ||
      !isSha256(source.licenseEvidenceSha256) ||
      !Number.isSafeInteger(source.licenseEvidenceBytes) ||
      source.licenseEvidenceBytes < 1
    ) {
      throw new Error('Formal selection source contract is invalid.');
    }
    sourceIds.add(source.id);
  }
  const splitBytes = { train: 0, development: 0 };
  const languageBytes: Record<'zh' | 'en', number> = { zh: 0, en: 0 };
  const sourceBytes: Record<string, number> = {};
  const categoryBytes: Record<string, number> = {};
  const ids = new Set<string>();
  const normalized = new Set<Sha256>();
  for (const document of selection.documents) {
    if (
      !document.documentId ||
      ids.has(document.documentId) ||
      !sourceIds.has(document.sourceId) ||
      normalized.has(document.normalizedSha256) ||
      !isSha256(document.sha256) ||
      !isSha256(document.normalizedSha256) ||
      !Number.isSafeInteger(document.bytes) ||
      document.bytes < 1 ||
      document.licenseApproved !== true ||
      (document.language !== 'zh' && document.language !== 'en') ||
      (document.split !== 'train' && document.split !== 'development')
    ) {
      throw new Error('Formal selection document contract is invalid.');
    }
    ids.add(document.documentId);
    normalized.add(document.normalizedSha256);
    splitBytes[document.split] += document.bytes;
    languageBytes[document.language] += document.bytes;
    sourceBytes[document.sourceId] = (sourceBytes[document.sourceId] ?? 0) + document.bytes;
    categoryBytes[document.category] = (categoryBytes[document.category] ?? 0) + document.bytes;
  }
  if (
    splitBytes.train < 1 ||
    splitBytes.development < 1 ||
    splitBytes.train + splitBytes.development !== selection.selectedBytes ||
    canonicalSha256(splitBytes) !== canonicalSha256(selection.splitBytes) ||
    canonicalSha256(languageBytes) !== canonicalSha256(selection.languageBytes) ||
    canonicalSha256(sourceBytes) !== canonicalSha256(selection.sourceBytes) ||
    canonicalSha256(categoryBytes) !== canonicalSha256(selection.categoryBytes)
  ) {
    throw new Error('Formal selection aggregate identities are invalid.');
  }
  const languageShareDifference = Math.abs(
    languageBytes.zh / selection.selectedBytes - languageBytes.en / selection.selectedBytes,
  );
  if (languageShareDifference > 0.01) {
    throw new Error('Formal selection Chinese/English byte-share difference exceeds 1%.');
  }
  assertDistribution(sourceBytes, selection.selectedBytes, 0.2, 'source');
  assertDistribution(categoryBytes, selection.selectedBytes, 0.4, 'category');
}

function assertDistribution(
  groups: Record<string, number>,
  total: number,
  maximum: number,
  label: string,
): void {
  for (const [id, bytes] of Object.entries(groups)) {
    if (bytes / total > maximum) {
      throw new Error(`Formal selection ${label} dominance exceeds ${maximum}: ${id}.`);
    }
  }
}
