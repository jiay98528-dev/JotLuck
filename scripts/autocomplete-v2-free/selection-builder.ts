import { createHash } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import * as path from 'node:path';

import { deduplicateSelectionDocuments } from '../corpus/v2-free-tools/fingerprints';
import { normalizeV2FreeTextIdentity } from '../corpus/v2-free-tools/common';
import { V2_FREE_TRAINING_POOL_LIMIT_BYTES, type V2FreeSha256 } from './contract';
import { loadV2FreeHoldoutContent, type V2FreeHoldoutDescriptor } from './holdout-validator';

export const V2_FREE_LICENSED_CORPUS_SCHEMA = 'jotluck.autocomplete.v2-free-licensed-corpus.v1';
export const V2_FREE_SUPPLEMENT_SCHEMA = 'jotluck.autocomplete.v2-free-supplement.v1';
export const V2_FREE_CORPUS_GOVERNANCE_VERSION = 3;
export const V2_FREE_DEVELOPMENT_FRACTION = 0.05;
export const V2_FREE_FORMAL_SMOKE_MINIMUM_BYTES = 32 * 1024 * 1024;
export const V2_FREE_FORMAL_MATRIX_MINIMUM_BYTES = 128 * 1024 * 1024;

export type V2FreeSelectionStage = 'governance' | 'formal-32mib-smoke' | 'formal-128mib-matrix';

type V2FreeSourceKind = 'project-owned' | 'tatoeba-cc0' | 'wikimedia-cc-by-sa';
type V2FreeLicenseSpdx = 'MIT' | 'CC0-1.0' | 'CC-BY-SA-4.0';

interface V2RSourceRecord {
  id: string;
  kind: V2FreeSourceKind;
  language: 'zh' | 'en';
  category: string;
  contentRoot: string;
  licenseSpdx: V2FreeLicenseSpdx;
  licenseEvidencePath: string;
  contentTreeSha256: string;
  collectedAt?: string;
  cleanerVersion?: string;
  generatorVersion?: string;
  generatorSeed?: string;
  attributionUrl?: string;
  upstreamDumpUrl?: string;
  upstreamDumpDate?: string;
  snapshotBytes?: number;
  snapshotSha256?: string;
}

export interface V2FreeSupplementSourceRecord {
  id: string;
  kind: V2FreeSourceKind;
  language: 'zh' | 'en';
  category: string;
  contentRoot: string;
  licenseSpdx: V2FreeLicenseSpdx;
  licenseEvidencePath: string;
  licenseEvidenceBytes: number;
  licenseEvidenceSha256: string;
  cleanerVersion?: string;
  generatorVersion?: string;
  generatorSeed?: string;
  attributionUrl?: string;
  upstreamDumpUrl?: string;
  upstreamDumpDate?: string;
  snapshotBytes?: number;
  snapshotSha256?: string;
}

export interface V2FreeSupplementDocumentRecord {
  documentId: string;
  sourceId: string;
  language: 'zh' | 'en';
  category: string;
  relativePath: string;
  bytes: number;
  sha256: string;
  normalizedSha256: string;
}

export interface V2FreeSupplementManifest {
  schema: typeof V2_FREE_SUPPLEMENT_SCHEMA;
  schemaVersion: 1;
  datasetId: string;
  sources: V2FreeSupplementSourceRecord[];
  documents: V2FreeSupplementDocumentRecord[];
  selectedBytes: number;
  sourceBytes: Record<string, number>;
  languageBytes: Record<'zh' | 'en', number>;
  categoryBytes: Record<string, number>;
  inputTreeSha256: string;
}

interface SourceAuditCandidate extends V2RSourceRecord {
  expectedLicenseEvidenceBytes?: number;
  expectedLicenseEvidenceSha256?: string;
}

interface V2RDocumentRecord {
  documentId: string;
  sourceId: string;
  language: 'zh' | 'en';
  category: string;
  relativePath: string;
  split: 'train' | 'development' | 'internalSelection';
  bytes: number;
  sha256: string;
  normalizedSha256: string;
  templateId?: string;
}

interface V2RSelectionManifest {
  schema: 'jotluck.autocomplete.v2r-corpus-selection.v1';
  schemaVersion: 1;
  datasetId: string;
  selectionSha256: string;
  sources: V2RSourceRecord[];
  documents: V2RDocumentRecord[];
}

export interface V2FreeSelectionSource extends V2RSourceRecord {
  licenseEvidenceSha256: V2FreeSha256;
  licenseEvidenceBytes: number;
}

export interface V2FreeSelectionDocument {
  documentId: string;
  sourceId: string;
  language: 'zh' | 'en';
  category: string;
  relativePath: string;
  bytes: number;
  sha256: V2FreeSha256;
  normalizedSha256: V2FreeSha256;
  split: 'train' | 'development';
  licenseApproved: true;
}

export interface V2FreeLicensedCorpusSelection {
  schema: typeof V2_FREE_LICENSED_CORPUS_SCHEMA;
  schemaVersion: 1;
  governanceVersion: typeof V2_FREE_CORPUS_GOVERNANCE_VERSION;
  datasetId: string;
  createdAt: string;
  sourceSelectionSha256: V2FreeSha256;
  sourceSelectionManifestSha256: V2FreeSha256;
  sourceRegistrySha256: V2FreeSha256;
  supplementManifestSha256s: V2FreeSha256[];
  licenseAuditSha256: V2FreeSha256;
  inputTreeSha256: V2FreeSha256;
  selectedBytes: number;
  splitBytes: Record<'train' | 'development', number>;
  splitDocuments: Record<'train' | 'development', number>;
  sourceBytes: Record<string, number>;
  languageBytes: Record<'zh' | 'en', number>;
  categoryBytes: Record<string, number>;
  exactDuplicates: 0;
  inputNearDuplicateDocumentRate: number;
  validationExactOverlaps: 0;
  sources: V2FreeSelectionSource[];
  documents: V2FreeSelectionDocument[];
}

export interface V2FreeValidationInput {
  descriptor: V2FreeHoldoutDescriptor;
  contentPath: string;
}

export interface BuildV2FreeSelectionOptions {
  workspaceRoot: string;
  selectionPath: string;
  sourceRegistryPath: string;
  supplementPaths?: readonly string[];
  validationHoldouts?: readonly V2FreeValidationInput[];
  createdAt?: string;
}

export async function buildV2FreeLicensedCorpusSelection(
  options: BuildV2FreeSelectionOptions,
): Promise<V2FreeLicensedCorpusSelection> {
  const root = await realpath(path.resolve(options.workspaceRoot));
  const selectionPath = await resolveExistingInside(root, options.selectionPath, 'selection');
  const sourceRegistryPath = await resolveExistingInside(
    root,
    options.sourceRegistryPath,
    'source registry',
  );
  const selectionBytes = await readFile(selectionPath);
  const registryBytes = await readFile(sourceRegistryPath);
  const selection = parseV2RSelection(selectionBytes);
  const registry = parseSourceRegistry(registryBytes);
  if (canonicalJson(selection.sources) !== canonicalJson(registry)) {
    throw new Error('V2R selection sources do not match the source registry.');
  }

  const validationTexts = new Set<string>();
  for (const input of options.validationHoldouts ?? []) {
    if (!input.descriptor.classification.endsWith('-validation-v1')) {
      throw new Error('Corpus governance may read validation holdouts only.');
    }
    const holdout = await loadV2FreeHoldoutContent({
      workspaceRoot: root,
      descriptor: input.descriptor,
      contentPath: input.contentPath,
      allowFinalRead: false,
    });
    for (const support of holdout.supportDocuments)
      validationTexts.add(normalizeText(support.text));
    for (const target of holdout.targets) validationTexts.add(normalizeText(target.text));
  }

  const supplements: Array<{
    manifest: V2FreeSupplementManifest;
    manifestSha256: V2FreeSha256;
  }> = [];
  for (const supplementValue of options.supplementPaths ?? []) {
    const supplementPath = await resolveExistingInside(
      root,
      supplementValue,
      'supplement manifest',
    );
    const bytes = await readFile(supplementPath);
    const manifest = parseV2FreeSupplementManifest(bytes);
    assertSupplementManifestIdentity(manifest);
    supplements.push({ manifest, manifestSha256: sha256(bytes) });
  }

  const sourceCandidates: SourceAuditCandidate[] = registry.map((source) => ({ ...source }));
  const candidateDocuments: Array<V2RDocumentRecord | V2FreeSupplementDocumentRecord> =
    selection.documents.filter((document) => document.split === 'train');
  for (const { manifest } of supplements) {
    for (const source of manifest.sources) {
      const sourceDocuments = manifest.documents.filter(
        (document) => document.sourceId === source.id,
      );
      sourceCandidates.push({
        ...source,
        contentTreeSha256: computeSupplementSourceTreeSha256(sourceDocuments),
        expectedLicenseEvidenceBytes: source.licenseEvidenceBytes,
        expectedLicenseEvidenceSha256: source.licenseEvidenceSha256,
      });
    }
    candidateDocuments.push(...manifest.documents);
  }

  const sources = await auditSources(root, sourceCandidates);
  const sourceById = new Map(sources.map((source) => [source.id, source]));
  const documents: V2FreeSelectionDocument[] = [];
  const documentIds = new Set<string>();
  const validatedDocuments: Array<{
    document: V2RDocumentRecord | V2FreeSupplementDocumentRecord;
    source: V2FreeSelectionSource;
    documentPath: string;
    bytes: Buffer;
    text: string;
  }> = [];
  const sourceBytes: Record<string, number> = {};
  const languageBytes: Record<'zh' | 'en', number> = { zh: 0, en: 0 };
  const categoryBytes: Record<string, number> = {};
  let selectedBytes = 0;

  for (const document of candidateDocuments) {
    const source = sourceById.get(document.sourceId);
    if (!source) throw new Error(`Training document has unknown source: ${document.sourceId}.`);
    if (document.language !== source.language || document.category !== source.category) {
      throw new Error(
        `Training document provenance disagrees with source: ${document.documentId}.`,
      );
    }
    assertSafeIdentifier(document.documentId, 'document id');
    if (documentIds.has(document.documentId)) {
      throw new Error(`Training corpus has a duplicate document id: ${document.documentId}.`);
    }
    documentIds.add(document.documentId);
    assertSafeIdentifier(document.category, 'category');
    assertSha256(document.sha256, `${document.documentId}.sha256`);
    assertSha256(document.normalizedSha256, `${document.documentId}.normalizedSha256`);
    const documentPath = await resolveExistingInside(
      root,
      document.relativePath,
      'training document',
    );
    assertTrainingPath(root, documentPath, source.contentRoot);
    const bytes = await readFile(documentPath);
    if (bytes.byteLength !== document.bytes || sha256(bytes) !== document.sha256) {
      throw new Error(`Training document byte identity mismatch: ${document.documentId}.`);
    }
    const text = decodeUtf8(bytes, document.documentId);
    assertAllowedTrainingText(text, document.documentId);
    const identity = normalizeText(text);
    if (!identity) throw new Error(`Training document is empty: ${document.documentId}.`);
    if (sha256(Buffer.from(identity, 'utf8')) !== document.normalizedSha256) {
      throw new Error(`Training document normalized identity mismatch: ${document.documentId}.`);
    }
    if (validationTexts.has(identity)) {
      throw new Error(`Training corpus has an exact validation overlap.`);
    }
    validatedDocuments.push({ document, source, documentPath, bytes, text });
  }

  const exactIdentities = new Set<string>();
  const exactDeduplicated = validatedDocuments
    .sort((left, right) => left.document.documentId.localeCompare(right.document.documentId))
    .filter(({ document }) => {
      if (exactIdentities.has(document.normalizedSha256)) return false;
      exactIdentities.add(document.normalizedSha256);
      return true;
    });
  const nearDeduplication = deduplicateSelectionDocuments(
    exactDeduplicated.map(({ document, text }) => ({ id: document.documentId, text })),
  );
  if (nearDeduplication.inputNearDuplicateDocumentRate > 0.03) {
    throw new Error('Training corpus input near-duplicate rate exceeds 3%.');
  }
  const retainedDocumentIds = new Set(nearDeduplication.retainedDocumentIds);
  for (const { document, source, documentPath, bytes } of exactDeduplicated) {
    if (!retainedDocumentIds.has(document.documentId)) continue;
    selectedBytes += bytes.byteLength;
    if (selectedBytes > V2_FREE_TRAINING_POOL_LIMIT_BYTES) {
      throw new Error('V2 free cleaned training pool exceeds 512 MiB.');
    }
    sourceBytes[source.id] = (sourceBytes[source.id] ?? 0) + bytes.byteLength;
    languageBytes[document.language] += bytes.byteLength;
    categoryBytes[document.category] = (categoryBytes[document.category] ?? 0) + bytes.byteLength;
    documents.push({
      documentId: document.documentId,
      sourceId: document.sourceId,
      language: document.language,
      category: document.category,
      relativePath: toRepositoryPath(root, documentPath),
      bytes: bytes.byteLength,
      sha256: document.sha256 as V2FreeSha256,
      normalizedSha256: document.normalizedSha256 as V2FreeSha256,
      split: 'train',
      licenseApproved: true,
    });
  }
  if (documents.length === 0 || languageBytes.zh === 0 || languageBytes.en === 0) {
    throw new Error('V2 free selection requires non-empty Chinese and English training documents.');
  }
  assertDistribution(sourceBytes, selectedBytes, 0.2, 'source');
  assertDistribution(categoryBytes, selectedBytes, 0.4, 'category');

  const developmentDocumentIds = selectDevelopmentDocumentIds(documents);
  for (const document of documents) {
    if (developmentDocumentIds.has(document.documentId)) document.split = 'development';
  }
  const splitBytes = { train: 0, development: 0 };
  const splitDocuments = { train: 0, development: 0 };
  for (const document of documents) {
    splitBytes[document.split] += document.bytes;
    splitDocuments[document.split] += 1;
  }

  const inputTreeSha256 = computeV2FreeInputTreeSha256(documents);
  const licenseAuditSha256 = canonicalSha256(
    sources.map((source) => ({
      id: source.id,
      licenseEvidenceBytes: source.licenseEvidenceBytes,
      licenseEvidenceSha256: source.licenseEvidenceSha256,
      licenseSpdx: source.licenseSpdx,
    })),
  );
  const result: V2FreeLicensedCorpusSelection = {
    schema: V2_FREE_LICENSED_CORPUS_SCHEMA,
    schemaVersion: 1,
    governanceVersion: V2_FREE_CORPUS_GOVERNANCE_VERSION,
    datasetId: `public-v2-free-${selection.datasetId}`,
    createdAt: canonicalIso(options.createdAt ?? new Date().toISOString()),
    sourceSelectionSha256: selection.selectionSha256 as V2FreeSha256,
    sourceSelectionManifestSha256: sha256(selectionBytes),
    sourceRegistrySha256: sha256(registryBytes),
    supplementManifestSha256s: supplements.map(({ manifestSha256 }) => manifestSha256),
    licenseAuditSha256,
    inputTreeSha256,
    selectedBytes,
    splitBytes,
    splitDocuments,
    sourceBytes,
    languageBytes,
    categoryBytes,
    exactDuplicates: 0,
    validationExactOverlaps: 0,
    inputNearDuplicateDocumentRate: nearDeduplication.inputNearDuplicateDocumentRate,
    sources,
    documents,
  };
  assertV2FreeSelectionStage(result, 'governance');
  return result;
}

export function assertV2FreeSelectionStage(
  selection: V2FreeLicensedCorpusSelection,
  stage: V2FreeSelectionStage,
): void {
  if (
    selection.schema !== V2_FREE_LICENSED_CORPUS_SCHEMA ||
    selection.schemaVersion !== 1 ||
    selection.governanceVersion !== V2_FREE_CORPUS_GOVERNANCE_VERSION ||
    !Array.isArray(selection.documents) ||
    selection.documents.length < 2 ||
    !Number.isSafeInteger(selection.selectedBytes) ||
    selection.selectedBytes < 1 ||
    selection.selectedBytes > V2_FREE_TRAINING_POOL_LIMIT_BYTES ||
    selection.exactDuplicates !== 0 ||
    selection.validationExactOverlaps !== 0
  ) {
    throw new Error('V2 free governed selection contract is invalid.');
  }
  if (
    !Number.isFinite(selection.inputNearDuplicateDocumentRate) ||
    selection.inputNearDuplicateDocumentRate < 0 ||
    selection.inputNearDuplicateDocumentRate > 0.03
  ) {
    throw new Error('V2 free selection input near-duplicate rate is invalid.');
  }
  assertSha256(selection.sourceSelectionSha256, 'source selection identity');
  assertSha256(selection.sourceSelectionManifestSha256, 'source selection manifest identity');
  assertSha256(selection.sourceRegistrySha256, 'source registry identity');
  if (!Array.isArray(selection.supplementManifestSha256s)) {
    throw new Error('V2 free supplement manifest identities are invalid.');
  }
  for (const identity of selection.supplementManifestSha256s) {
    assertSha256(identity, 'supplement manifest identity');
  }
  assertSha256(selection.licenseAuditSha256, 'license audit identity');
  assertSha256(selection.inputTreeSha256, 'input tree identity');

  const expectedDevelopmentIds = selectDevelopmentDocumentIds(selection.documents);
  const documentIds = new Set<string>();
  const normalizedIdentities = new Set<string>();
  const sourceIds = new Set<string>();
  for (const source of selection.sources) {
    assertSafeIdentifier(source.id, 'source id');
    if (sourceIds.has(source.id)) throw new Error('V2 free selection has duplicate sources.');
    sourceIds.add(source.id);
    if (
      !isSupportedSourceKind(source.kind) ||
      (source.kind === 'project-owned' &&
        (source.licenseSpdx !== 'MIT' || !source.generatorVersion || !source.generatorSeed)) ||
      (source.kind === 'tatoeba-cc0' &&
        (source.licenseSpdx !== 'CC0-1.0' || !source.cleanerVersion)) ||
      (source.kind === 'wikimedia-cc-by-sa' && !isValidWikimediaSource(source))
    ) {
      throw new Error('V2 free selection has an unsupported source license.');
    }
    assertSha256(source.licenseEvidenceSha256, `${source.id}.licenseEvidenceSha256`);
  }
  const splitBytes = { train: 0, development: 0 };
  const splitDocuments = { train: 0, development: 0 };
  const sourceBytes: Record<string, number> = {};
  const languageBytes: Record<'zh' | 'en', number> = { zh: 0, en: 0 };
  const categoryBytes: Record<string, number> = {};
  let selectedBytes = 0;
  for (const document of selection.documents) {
    assertSafeIdentifier(document.documentId, 'document id');
    assertSha256(document.sha256, `${document.documentId}.sha256`);
    assertSha256(document.normalizedSha256, `${document.documentId}.normalizedSha256`);
    if (
      documentIds.has(document.documentId) ||
      normalizedIdentities.has(document.normalizedSha256) ||
      document.licenseApproved !== true ||
      (document.split !== 'train' && document.split !== 'development')
    ) {
      throw new Error('V2 free selection split contains duplicate or invalid documents.');
    }
    const source = selection.sources.find(({ id }) => id === document.sourceId);
    if (!source || document.language !== source.language || document.category !== source.category) {
      throw new Error('V2 free selection document provenance is invalid.');
    }
    documentIds.add(document.documentId);
    normalizedIdentities.add(document.normalizedSha256);
    const expectedSplit = expectedDevelopmentIds.has(document.documentId) ? 'development' : 'train';
    if (document.split !== expectedSplit) {
      throw new Error('V2 free development split is not the deterministic 5% partition.');
    }
    if (!Number.isSafeInteger(document.bytes) || document.bytes < 1) {
      throw new Error('V2 free selection document byte count is invalid.');
    }
    selectedBytes += document.bytes;
    splitBytes[document.split] += document.bytes;
    splitDocuments[document.split] += 1;
    sourceBytes[document.sourceId] = (sourceBytes[document.sourceId] ?? 0) + document.bytes;
    languageBytes[document.language] += document.bytes;
    categoryBytes[document.category] = (categoryBytes[document.category] ?? 0) + document.bytes;
  }
  if (
    splitDocuments.train < 1 ||
    splitDocuments.development < 1 ||
    selectedBytes !== selection.selectedBytes ||
    canonicalJson(splitBytes) !== canonicalJson(selection.splitBytes) ||
    canonicalJson(splitDocuments) !== canonicalJson(selection.splitDocuments) ||
    canonicalJson(sourceBytes) !== canonicalJson(selection.sourceBytes) ||
    canonicalJson(languageBytes) !== canonicalJson(selection.languageBytes) ||
    canonicalJson(categoryBytes) !== canonicalJson(selection.categoryBytes) ||
    languageBytes.zh < 1 ||
    languageBytes.en < 1
  ) {
    throw new Error('V2 free selection requires disjoint, non-empty train/development splits.');
  }
  assertDistribution(sourceBytes, selectedBytes, 0.2, 'source');
  assertDistribution(categoryBytes, selectedBytes, 0.4, 'category');
  if (computeV2FreeInputTreeSha256(selection.documents) !== selection.inputTreeSha256) {
    throw new Error('V2 free selection split/input-tree identity mismatch.');
  }
  if (stage === 'formal-32mib-smoke') {
    if (selection.selectedBytes < V2_FREE_FORMAL_SMOKE_MINIMUM_BYTES) {
      throw new Error('Formal 32 MiB smoke selection is undersized and must fail closed.');
    }
  } else if (stage === 'formal-128mib-matrix') {
    if (selection.selectedBytes < V2_FREE_FORMAL_MATRIX_MINIMUM_BYTES) {
      throw new Error('Formal 128 MiB matrix selection is undersized and must fail closed.');
    }
    const languageDifference = Math.abs(
      languageBytes.zh / selectedBytes - languageBytes.en / selectedBytes,
    );
    if (languageDifference > 0.01) {
      throw new Error('Formal matrix Chinese/English byte-share difference exceeds 1%.');
    }
  } else if (stage !== 'governance') {
    throw new Error(`Unsupported V2 free selection stage: ${String(stage)}.`);
  }
}

function computeV2FreeInputTreeSha256(documents: readonly V2FreeSelectionDocument[]): V2FreeSha256 {
  return canonicalSha256(
    documents.map(({ documentId, sha256: documentSha256, split }) => ({
      documentId,
      sha256: documentSha256,
      split,
    })),
  );
}

function selectDevelopmentDocumentIds(
  documents: readonly V2FreeSelectionDocument[],
): ReadonlySet<string> {
  if (documents.length < 2) {
    throw new Error('V2 free selection requires separate training and development documents.');
  }
  const developmentCount = Math.min(
    documents.length - 1,
    Math.max(1, Math.ceil(documents.length * V2_FREE_DEVELOPMENT_FRACTION)),
  );
  return new Set(
    [...documents]
      .sort((left, right) => {
        const byIdentity = left.normalizedSha256.localeCompare(right.normalizedSha256);
        return byIdentity || left.documentId.localeCompare(right.documentId);
      })
      .slice(0, developmentCount)
      .map((document) => document.documentId),
  );
}

async function auditSources(
  root: string,
  sources: readonly SourceAuditCandidate[],
): Promise<V2FreeSelectionSource[]> {
  const ids = new Set<string>();
  const audited: V2FreeSelectionSource[] = [];
  for (const source of sources) {
    assertSafeIdentifier(source.id, 'source id');
    assertSafeIdentifier(source.category, 'source category');
    if (ids.has(source.id)) throw new Error(`Duplicate source id: ${source.id}.`);
    ids.add(source.id);
    assertSha256(source.contentTreeSha256, `${source.id}.contentTreeSha256`);
    if (source.kind === 'project-owned') {
      if (source.licenseSpdx !== 'MIT' || !source.generatorVersion || !source.generatorSeed) {
        throw new Error(
          `Project-owned source license/generator identity is invalid: ${source.id}.`,
        );
      }
    } else if (source.kind === 'tatoeba-cc0') {
      if (source.licenseSpdx !== 'CC0-1.0' || !source.cleanerVersion) {
        throw new Error(`Tatoeba source must be CC0-1.0 with a cleaner version: ${source.id}.`);
      }
    } else if (source.kind === 'wikimedia-cc-by-sa') {
      if (!isValidWikimediaSource(source)) {
        throw new Error(`Wikimedia source provenance is invalid: ${source.id}.`);
      }
    } else {
      throw new Error(`Unsupported V2 free source kind: ${String(source.kind)}.`);
    }
    const evidencePath = await resolveExistingInside(
      root,
      source.licenseEvidencePath,
      'license evidence',
    );
    const evidence = await readFile(evidencePath);
    if (evidence.byteLength === 0) throw new Error(`License evidence is empty: ${source.id}.`);
    const evidenceSha256 = sha256(evidence);
    if (
      (source.expectedLicenseEvidenceBytes !== undefined &&
        source.expectedLicenseEvidenceBytes !== evidence.byteLength) ||
      (source.expectedLicenseEvidenceSha256 !== undefined &&
        source.expectedLicenseEvidenceSha256 !== evidenceSha256)
    ) {
      throw new Error(`License evidence identity mismatch: ${source.id}.`);
    }
    const {
      expectedLicenseEvidenceBytes: _expectedLicenseEvidenceBytes,
      expectedLicenseEvidenceSha256: _expectedLicenseEvidenceSha256,
      ...publicSource
    } = source;
    audited.push({
      ...publicSource,
      contentRoot: normalizeRelativePath(source.contentRoot),
      licenseEvidencePath: toRepositoryPath(root, evidencePath),
      licenseEvidenceSha256: evidenceSha256,
      licenseEvidenceBytes: evidence.byteLength,
    });
  }
  return audited;
}

function parseV2FreeSupplementManifest(bytes: Buffer): V2FreeSupplementManifest {
  const value = parseJson(bytes, 'V2 free supplement') as Partial<V2FreeSupplementManifest>;
  if (
    value.schema !== V2_FREE_SUPPLEMENT_SCHEMA ||
    value.schemaVersion !== 1 ||
    typeof value.datasetId !== 'string' ||
    !value.datasetId ||
    !Array.isArray(value.sources) ||
    value.sources.length === 0 ||
    !Array.isArray(value.documents) ||
    value.documents.length === 0 ||
    !Number.isSafeInteger(value.selectedBytes) ||
    !value.sourceBytes ||
    !value.languageBytes ||
    !value.categoryBytes
  ) {
    throw new Error('Unsupported V2 free supplement manifest.');
  }
  assertSafeIdentifier(value.datasetId, 'supplement dataset id');
  assertSha256(value.inputTreeSha256, 'supplement input tree identity');
  return value as V2FreeSupplementManifest;
}

function assertSupplementManifestIdentity(manifest: V2FreeSupplementManifest): void {
  const sourceIds = new Set<string>();
  for (const source of manifest.sources) {
    assertSafeIdentifier(source.id, 'supplement source id');
    assertSafeIdentifier(source.category, 'supplement source category');
    if (sourceIds.has(source.id)) {
      throw new Error(`Supplement has a duplicate source id: ${source.id}.`);
    }
    sourceIds.add(source.id);
    if (source.language !== 'zh' && source.language !== 'en') {
      throw new Error(`Supplement source language is invalid: ${source.id}.`);
    }
    normalizeRelativePath(source.contentRoot);
    normalizeRelativePath(source.licenseEvidencePath);
    if (!Number.isSafeInteger(source.licenseEvidenceBytes) || source.licenseEvidenceBytes < 1) {
      throw new Error(`Supplement license evidence byte count is invalid: ${source.id}.`);
    }
    assertSha256(source.licenseEvidenceSha256, `${source.id}.licenseEvidenceSha256`);
    if (source.kind === 'project-owned') {
      if (source.licenseSpdx !== 'MIT' || !source.generatorVersion || !source.generatorSeed) {
        throw new Error(`Supplement project-owned source is invalid: ${source.id}.`);
      }
    } else if (source.kind === 'tatoeba-cc0') {
      if (source.licenseSpdx !== 'CC0-1.0' || !source.cleanerVersion) {
        throw new Error(`Supplement Tatoeba source is invalid: ${source.id}.`);
      }
    } else if (source.kind === 'wikimedia-cc-by-sa') {
      if (!isValidWikimediaSource(source)) {
        throw new Error(`Supplement Wikimedia source is invalid: ${source.id}.`);
      }
    } else {
      throw new Error(`Unsupported V2 free source kind: ${String(source.kind)}.`);
    }
  }

  const documentIds = new Set<string>();
  const normalizedIdentities = new Set<string>();
  const sourceBytes: Record<string, number> = {};
  const languageBytes: Record<'zh' | 'en', number> = { zh: 0, en: 0 };
  const categoryBytes: Record<string, number> = {};
  let selectedBytes = 0;
  for (const document of manifest.documents) {
    assertSafeIdentifier(document.documentId, 'supplement document id');
    if (documentIds.has(document.documentId)) {
      throw new Error(`Supplement has a duplicate document id: ${document.documentId}.`);
    }
    documentIds.add(document.documentId);
    if (normalizedIdentities.has(document.normalizedSha256)) {
      throw new Error('Supplement has a duplicate normalized identity.');
    }
    normalizedIdentities.add(document.normalizedSha256);
    const source = manifest.sources.find(({ id }) => id === document.sourceId);
    if (!source) throw new Error(`Supplement document has unknown source: ${document.sourceId}.`);
    if (document.language !== source.language || document.category !== source.category) {
      throw new Error(
        `Supplement document provenance disagrees with source: ${document.documentId}.`,
      );
    }
    if (!Number.isSafeInteger(document.bytes) || document.bytes < 1) {
      throw new Error(`Supplement document byte count is invalid: ${document.documentId}.`);
    }
    assertSha256(document.sha256, `${document.documentId}.sha256`);
    assertSha256(document.normalizedSha256, `${document.documentId}.normalizedSha256`);
    normalizeRelativePath(document.relativePath);
    selectedBytes += document.bytes;
    sourceBytes[document.sourceId] = (sourceBytes[document.sourceId] ?? 0) + document.bytes;
    languageBytes[document.language] += document.bytes;
    categoryBytes[document.category] = (categoryBytes[document.category] ?? 0) + document.bytes;
  }
  if (manifest.sources.some((source) => !sourceBytes[source.id])) {
    throw new Error('Supplement source has no documents.');
  }
  if (
    selectedBytes !== manifest.selectedBytes ||
    canonicalJson(sourceBytes) !== canonicalJson(manifest.sourceBytes) ||
    canonicalJson(languageBytes) !== canonicalJson(manifest.languageBytes) ||
    canonicalJson(categoryBytes) !== canonicalJson(manifest.categoryBytes) ||
    computeV2FreeSupplementInputTreeSha256(manifest.documents) !== manifest.inputTreeSha256
  ) {
    throw new Error('V2 free supplement manifest identity or byte summaries do not match.');
  }
}

function isSupportedSourceKind(value: string): value is V2FreeSourceKind {
  return value === 'project-owned' || value === 'tatoeba-cc0' || value === 'wikimedia-cc-by-sa';
}

function isValidWikimediaSource(source: V2FreeSupplementSourceRecord | V2RSourceRecord): boolean {
  return (
    source.kind === 'wikimedia-cc-by-sa' &&
    source.licenseSpdx === 'CC-BY-SA-4.0' &&
    Boolean(source.cleanerVersion) &&
    isHttpsUrl(source.attributionUrl) &&
    isHttpsUrl(source.upstreamDumpUrl) &&
    typeof source.upstreamDumpDate === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/u.test(source.upstreamDumpDate) &&
    Number.isSafeInteger(source.snapshotBytes) &&
    Number(source.snapshotBytes) > 0 &&
    typeof source.snapshotSha256 === 'string' &&
    /^[a-f0-9]{64}$/u.test(source.snapshotSha256)
  );
}

function isHttpsUrl(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

export function computeV2FreeSupplementInputTreeSha256(
  documents: readonly V2FreeSupplementDocumentRecord[],
): V2FreeSha256 {
  return canonicalSha256(
    [...documents]
      .sort((left, right) => left.documentId.localeCompare(right.documentId))
      .map(
        ({
          documentId,
          sourceId,
          language,
          category,
          relativePath,
          bytes,
          sha256: documentSha256,
          normalizedSha256,
        }) => ({
          documentId,
          sourceId,
          language,
          category,
          relativePath: normalizeRelativePath(relativePath),
          bytes,
          sha256: documentSha256,
          normalizedSha256,
        }),
      ),
  );
}

function computeSupplementSourceTreeSha256(
  documents: readonly V2FreeSupplementDocumentRecord[],
): V2FreeSha256 {
  return canonicalSha256(
    [...documents]
      .sort((left, right) => left.documentId.localeCompare(right.documentId))
      .map(({ documentId, relativePath, bytes, sha256: documentSha256 }) => ({
        documentId,
        relativePath: normalizeRelativePath(relativePath),
        bytes,
        sha256: documentSha256,
      })),
  );
}

function parseV2RSelection(bytes: Buffer): V2RSelectionManifest {
  const value = parseJson(bytes, 'V2R selection') as Partial<V2RSelectionManifest>;
  if (
    value.schema !== 'jotluck.autocomplete.v2r-corpus-selection.v1' ||
    value.schemaVersion !== 1 ||
    !value.datasetId ||
    !Array.isArray(value.sources) ||
    !Array.isArray(value.documents)
  ) {
    throw new Error('Unsupported V2R selection manifest.');
  }
  assertSha256(value.selectionSha256, 'V2R selection identity');
  return value as V2RSelectionManifest;
}

function parseSourceRegistry(bytes: Buffer): V2RSourceRecord[] {
  const value = parseJson(bytes, 'source registry');
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error('V2R source registry must be a non-empty array.');
  }
  return value as V2RSourceRecord[];
}

function parseJson(bytes: Buffer, label: string): unknown {
  try {
    return JSON.parse(bytes.toString('utf8')) as unknown;
  } catch (error) {
    throw new Error(`${label} is not valid UTF-8 JSON: ${String(error)}`);
  }
}

async function resolveExistingInside(root: string, value: string, label: string): Promise<string> {
  if (!value || path.isAbsolute(value))
    throw new Error(`${label} path must be workspace-relative.`);
  const normalized = normalizeRelativePath(value);
  const resolved = await realpath(path.join(root, normalized));
  if (!isWithin(resolved, root)) throw new Error(`${label} path escaped the workspace.`);
  return resolved;
}

function assertTrainingPath(root: string, documentPath: string, contentRoot: string): void {
  const relative = toRepositoryPath(root, documentPath);
  const segments = relative.toLocaleLowerCase('en-US').split('/');
  const forbidden = new Set([
    'doc',
    'spec',
    'memory',
    'e2e',
    'packages',
    'site',
    '宣传片',
    'novel-zh',
  ]);
  if (segments.some((segment) => forbidden.has(segment) || segment.includes('holdout'))) {
    throw new Error(`Training document uses a forbidden path: ${relative}.`);
  }
  const normalizedRoot = `${normalizeRelativePath(contentRoot).replace(/\/$/u, '')}/`;
  if (!`${relative}/`.startsWith(normalizedRoot)) {
    throw new Error(`Training document escaped its source content root: ${relative}.`);
  }
  if (!/\.(?:md|markdown|txt)$/iu.test(relative)) {
    throw new Error(`Training document is not approved prose: ${relative}.`);
  }
}

function assertAllowedTrainingText(text: string, documentId: string): void {
  const disallowed: Array<[string, RegExp]> = [
    ['frontmatter', /^\uFEFF?---\s*\r?\n/u],
    ['fenced code', /(?:^|\n)\s*(?:```|~~~)/u],
    ['email', /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu],
    ['phone', /(?:\+?\d[\s-]*){8,}/u],
    [
      'secret',
      /(?:password|passwd|secret|api[_ -]?key|access[_ -]?token|bearer)\s*[:=]\s*[^\s]+/iu,
    ],
    ['conversation prompt', /(?:^|\n)\s*(?:user|assistant|system)\s*:/iu],
  ];
  const hit = disallowed.find(([, pattern]) => pattern.test(text));
  if (hit) throw new Error(`Training document ${documentId} contains ${hit[0]}.`);
}

function assertDistribution(
  groups: Record<string, number>,
  total: number,
  maximum: number,
  label: string,
): void {
  for (const [id, bytes] of Object.entries(groups)) {
    if (bytes / total > maximum) {
      throw new Error(`V2 free ${label} dominance exceeds ${maximum}: ${id}.`);
    }
  }
}

function normalizeText(value: string): string {
  return normalizeV2FreeTextIdentity(value);
}

function decodeUtf8(bytes: Buffer, label: string): string {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  if (Buffer.from(text, 'utf8').equals(bytes)) return text;
  throw new Error(`Training document is not canonical UTF-8: ${label}.`);
}

function normalizeRelativePath(value: string): string {
  const normalized = value.replaceAll('\\', '/');
  if (
    !normalized ||
    normalized.startsWith('/') ||
    normalized.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')
  ) {
    throw new Error(`Repository-relative path is invalid: ${value}.`);
  }
  return normalized;
}

function toRepositoryPath(root: string, value: string): string {
  const relative = path.relative(root, value).replaceAll('\\', '/');
  if (!relative || relative.startsWith('../') || path.isAbsolute(relative)) {
    throw new Error('Path escaped the workspace.');
  }
  return relative;
}

function isWithin(candidate: string, root: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function assertSafeIdentifier(value: string, label: string): void {
  if (!/^[a-z0-9][a-z0-9._-]{0,127}$/u.test(value)) {
    throw new Error(`${label} is invalid: ${value}.`);
  }
}

function assertSha256(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) {
    throw new Error(`${label} is not a SHA-256 identity.`);
  }
}

function canonicalIso(value: string): string {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.valueOf()) || parsed.toISOString() !== value) {
    throw new Error('createdAt must be a canonical ISO timestamp.');
  }
  return value;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function canonicalSha256(value: unknown): V2FreeSha256 {
  return sha256(Buffer.from(canonicalJson(value), 'utf8'));
}

function sha256(bytes: Buffer): V2FreeSha256 {
  return createHash('sha256').update(bytes).digest('hex') as V2FreeSha256;
}
