import { describe, expect, it } from 'vitest';

import { canonicalSha256, sha256 } from '../common';
import type { FingerprintLeakageAudit } from '../fingerprints';
import {
  createFormal128SelectionStageReceipt,
  FORMAL_128_MIB_BYTES,
  type FormalSelectionManifest,
} from '../selection-stage';

describe('formal-128mib-matrix selection stage', () => {
  it('binds the 128 MiB selection to clean cold and workspace fingerprints', () => {
    const selection = fakeSelection(FORMAL_128_MIB_BYTES);
    const bytes = Buffer.from(JSON.stringify(selection), 'utf8');
    const audit = fakeAudit(selection.inputTreeSha256, sha256(bytes));
    const receipt = createFormal128SelectionStageReceipt({
      selection,
      selectionManifestBytes: bytes,
      fingerprintAudit: audit,
    });

    expect(receipt.stage).toBe('formal-128mib-matrix');
    expect(receipt.passed).toBe(true);
    expect(receipt.finalFingerprintInventoriesRead).toBe(false);
  });

  it('rejects undersized selections and missing final fingerprints in release preflight', () => {
    const undersized = fakeSelection(FORMAL_128_MIB_BYTES - 1);
    const undersizedBytes = Buffer.from(JSON.stringify(undersized), 'utf8');
    expect(() =>
      createFormal128SelectionStageReceipt({
        selection: undersized,
        selectionManifestBytes: undersizedBytes,
        fingerprintAudit: fakeAudit(undersized.inputTreeSha256, sha256(undersizedBytes)),
      }),
    ).toThrow(/undersized/u);

    const selection = fakeSelection(FORMAL_128_MIB_BYTES);
    const bytes = Buffer.from(JSON.stringify(selection), 'utf8');
    expect(() =>
      createFormal128SelectionStageReceipt({
        selection,
        selectionManifestBytes: bytes,
        fingerprintAudit: fakeAudit(selection.inputTreeSha256, sha256(bytes)),
        requireFinalFingerprints: true,
      }),
    ).toThrow(/cold-final-v1/u);
  });
});

function fakeSelection(selectedBytes: number): FormalSelectionManifest {
  const categories = [
    'field-observation',
    'maintenance-log',
    'meeting-note',
    'reading-note',
    'household-plan',
  ];
  const baseBytes = Math.floor(selectedBytes / 10);
  const documents = Array.from({ length: 10 }, (_, index) => ({
    documentId: `document-${index}`,
    sourceId: `source-${index}`,
    language: index % 2 === 0 ? ('zh' as const) : ('en' as const),
    category: categories[index % categories.length]!,
    relativePath: `scripts/corpus/fixture-${index}.txt`,
    bytes: baseBytes + (index === 9 ? selectedBytes - baseBytes * 10 : 0),
    sha256: sha256(`document-${index}`),
    normalizedSha256: sha256(`normalized-${index}`),
    split: index === 9 ? ('development' as const) : ('train' as const),
    licenseApproved: true as const,
  }));
  const sourceBytes = Object.fromEntries(documents.map((item) => [item.sourceId, item.bytes]));
  const categoryBytes = documents.reduce<Record<string, number>>((result, item) => {
    result[item.category] = (result[item.category] ?? 0) + item.bytes;
    return result;
  }, {});
  const actualLanguageBytes = {
    zh: documents
      .filter((item) => item.language === 'zh')
      .reduce((sum, item) => sum + item.bytes, 0),
    en: documents
      .filter((item) => item.language === 'en')
      .reduce((sum, item) => sum + item.bytes, 0),
  };
  return {
    schema: 'jotluck.autocomplete.v2-free-licensed-corpus.v1',
    schemaVersion: 1,
    datasetId: 'formal-128-fixture',
    selectedBytes,
    splitBytes: {
      train: documents
        .filter((item) => item.split === 'train')
        .reduce((sum, item) => sum + item.bytes, 0),
      development: documents
        .filter((item) => item.split === 'development')
        .reduce((sum, item) => sum + item.bytes, 0),
    },
    sourceBytes,
    languageBytes: actualLanguageBytes,
    categoryBytes,
    inputTreeSha256: sha256('input-tree'),
    inputNearDuplicateDocumentRate: 0.02,
    licenseAuditSha256: sha256('license-audit'),
    sources: documents.map((item) => ({
      id: item.sourceId,
      licenseSpdx: 'CC0-1.0',
      licenseEvidenceSha256: sha256(`${item.sourceId}-license`),
      licenseEvidenceBytes: 100,
    })),
    documents,
  };
}

function fakeAudit(
  inputTreeSha256: string,
  selectionManifestSha256: string,
): FingerprintLeakageAudit {
  const withoutHash = {
    schema: 'jotluck.autocomplete.v2-free-fingerprint-audit.v1' as const,
    schemaVersion: 1 as const,
    selectionManifestSha256,
    selectionInputTreeSha256: inputTreeSha256,
    selectedDocuments: 5,
    holdoutInventories: [
      {
        datasetId: 'cold-validation',
        classification: 'cold-validation-v1' as const,
        contentSha256: sha256('cold-content'),
        inventorySha256: sha256('cold-inventory'),
      },
      {
        datasetId: 'workspace-validation',
        classification: 'workspace-validation-v1' as const,
        contentSha256: sha256('workspace-content'),
        inventorySha256: sha256('workspace-inventory'),
      },
    ],
    exactDuplicatePairs: 0,
    nearDuplicatePairs: 0,
    inputNearDuplicateDocumentRate: 0.02,
    nearDuplicateDocumentRate: 0,
    exactHoldoutOverlaps: 0,
    nearHoldoutOverlaps: 0,
    longWindowLeakages: 0,
    samples: [],
    finalContentRead: false as const,
    passed: true,
  };
  return { ...withoutHash, reportSha256: canonicalSha256(withoutHash) };
}
