import { canonicalSha256, normalizeForComparison, sha256 } from './common';
import { assertPathInsideV2RCache, normalizeRepositoryRelativePath } from './workspace';
import type { V2RLanguage } from './phrase-extraction';

export const V2R_CORPUS_SCHEMA = 'jotluck.autocomplete.v2r-corpus-selection.v1';
export const V2R_CORPUS_TOTAL_LIMIT_BYTES = 30 * 1024 * 1024;
export const V2R_DEFAULT_SPLIT_BUDGETS = {
  train: 24 * 1024 * 1024,
  development: 3 * 1024 * 1024,
  internalSelection: 3 * 1024 * 1024,
} as const;

export type V2RCorpusSplit = keyof typeof V2R_DEFAULT_SPLIT_BUDGETS;
export type V2RSourceKind = 'project-owned' | 'tatoeba-cc0' | 'common-voice-cc0';
export type V2RNoteCategory =
  | 'field-observation'
  | 'maintenance-log'
  | 'meeting-note'
  | 'reading-note'
  | 'household-plan';

export interface V2RCorpusSource {
  id: string;
  kind: V2RSourceKind;
  language: V2RLanguage;
  category: V2RNoteCategory;
  contentRoot: string;
  licenseSpdx: 'MIT' | 'CC0-1.0';
  licenseEvidencePath: string;
  contentTreeSha256: string;
  collectedAt: string;
  cleanerVersion: string;
  generatorVersion?: string;
  generatorSeed?: string;
}

export interface V2RCorpusCandidate {
  documentId: string;
  sourceId: string;
  language: V2RLanguage;
  category: V2RNoteCategory;
  relativePath: string;
  text: string;
  templateId?: string;
}

export interface V2RSelectedDocument extends Omit<V2RCorpusCandidate, 'text'> {
  split: V2RCorpusSplit;
  bytes: number;
  sha256: string;
  normalizedSha256: string;
}

export interface V2RCorpusSelectionManifest {
  schema: typeof V2R_CORPUS_SCHEMA;
  schemaVersion: 1;
  datasetId: string;
  createdAt: string;
  selectionSeed: string;
  status: 'complete' | 'incomplete';
  targetBytes: Record<V2RCorpusSplit, number>;
  selectedBytes: Record<V2RCorpusSplit, number>;
  totalBytes: number;
  sources: V2RCorpusSource[];
  documents: V2RSelectedDocument[];
  selectionSha256: string;
}

export interface V2RCorpusGovernanceReport {
  totalBytes: number;
  splitBytes: Record<V2RCorpusSplit, number>;
  projectOwnedRatio: number;
  sourceKindRatios: Record<V2RSourceKind, number>;
  sourceRatios: Record<string, number>;
  categoryRatios: Record<string, number>;
  languageRatios: Record<V2RLanguage, number>;
  exactDuplicates: number;
  nearDuplicates: number;
  forbiddenTextMatches: number;
  unapprovedLicenseSources: number;
  isolatedNovelZhReferences: number;
  holdoutDocumentsAudited: number;
  holdoutInputTreeSha256: string;
  holdoutExactOverlaps: number;
  holdoutNearOverlaps: number;
  maxTemplateRatio: number;
  maxFiveGramRatio: number;
  maxDocumentTrigramRatio: number;
  selectionSha256: string;
}

export interface CorpusSelectionOptions {
  datasetId: string;
  createdAt: string;
  selectionSeed: string;
  targetBytes?: Record<V2RCorpusSplit, number>;
}

export interface GovernanceOptions {
  requireComplete?: boolean;
  nearDuplicateThreshold?: number;
  enforceQuotas?: boolean;
}

export function selectV2RCorpus(
  candidates: readonly V2RCorpusCandidate[],
  sources: readonly V2RCorpusSource[],
  options: CorpusSelectionOptions,
): V2RCorpusSelectionManifest {
  const targetBytes = options.targetBytes ?? { ...V2R_DEFAULT_SPLIT_BUDGETS };
  validateSplitTargets(targetBytes);
  const sourceIds = new Set(sources.map((source) => source.id));
  const prepared = candidates.map((candidate) => {
    if (!sourceIds.has(candidate.sourceId)) {
      throw new Error(
        `Unknown source for document ${candidate.documentId}: ${candidate.sourceId}.`,
      );
    }
    assertPathInsideV2RCache(candidate.relativePath, `${candidate.documentId}.relativePath`);
    const bytes = Buffer.byteLength(candidate.text, 'utf8');
    if (bytes < 1 || bytes > 512 * 1024) {
      throw new Error(`Document ${candidate.documentId} has an invalid byte length.`);
    }
    const contentSha256 = sha256(candidate.text);
    return {
      candidate,
      bytes,
      contentSha256,
      order: sha256(`${options.selectionSeed}\0${candidate.documentId}\0${contentSha256}`),
    };
  });
  prepared.sort((left, right) => left.order.localeCompare(right.order));

  const selectedBytes = emptySplitCounts();
  const selectedLanguageBytes: Record<V2RCorpusSplit, Record<V2RLanguage, number>> = {
    train: { zh: 0, en: 0 },
    development: { zh: 0, en: 0 },
    internalSelection: { zh: 0, en: 0 },
  };
  const selected: V2RSelectedDocument[] = [];
  const selectedIds = new Set<string>();
  const splitOrder: V2RCorpusSplit[] = ['train', 'development', 'internalSelection'];
  for (const item of prepared) {
    const preferred = splitForDigest(item.order);
    const choices = [preferred, ...splitOrder.filter((split) => split !== preferred)].sort(
      (left, right) => {
        if (left === preferred) return -1;
        if (right === preferred) return 1;
        return remainingRatio(right) - remainingRatio(left);
      },
    );
    const split = choices.find((candidate) => {
      const languageBudget = splitLanguageBudget(targetBytes[candidate], item.candidate.language);
      return (
        selectedBytes[candidate] + item.bytes <= targetBytes[candidate] &&
        selectedLanguageBytes[candidate][item.candidate.language] + item.bytes <= languageBudget
      );
    });
    if (!split) continue;
    const candidate = item.candidate;
    selected.push({
      documentId: candidate.documentId,
      sourceId: candidate.sourceId,
      language: candidate.language,
      category: candidate.category,
      relativePath: candidate.relativePath,
      split,
      bytes: item.bytes,
      sha256: item.contentSha256,
      normalizedSha256: sha256(normalizeForComparison(candidate.text)),
      ...(candidate.templateId ? { templateId: candidate.templateId } : {}),
    });
    selectedIds.add(candidate.documentId);
    selectedBytes[split] += item.bytes;
    selectedLanguageBytes[split][candidate.language] += item.bytes;

    function remainingRatio(value: V2RCorpusSplit): number {
      return (targetBytes[value] - selectedBytes[value]) / targetBytes[value];
    }
  }

  const unselected = prepared.filter((item) => !selectedIds.has(item.candidate.documentId));
  const status = splitOrder.every((split) =>
    (['zh', 'en'] as const).every((language) => {
      const remaining =
        splitLanguageBudget(targetBytes[split], language) - selectedLanguageBytes[split][language];
      return (
        remaining === 0 ||
        !unselected.some((item) => item.candidate.language === language && item.bytes <= remaining)
      );
    }),
  )
    ? 'complete'
    : 'incomplete';
  const identity: Omit<V2RCorpusSelectionManifest, 'selectionSha256'> = {
    schema: V2R_CORPUS_SCHEMA,
    schemaVersion: 1 as const,
    datasetId: options.datasetId,
    createdAt: options.createdAt,
    selectionSeed: options.selectionSeed,
    status,
    targetBytes,
    selectedBytes,
    totalBytes: Object.values(selectedBytes).reduce((sum, value) => sum + value, 0),
    sources: [...sources].sort((left, right) => left.id.localeCompare(right.id)),
    documents: selected,
  };
  return { ...identity, selectionSha256: canonicalSha256(identity) };
}

export function validateV2RCorpusSelection(
  manifest: V2RCorpusSelectionManifest,
  documents: readonly V2RCorpusCandidate[],
  holdoutTexts: readonly { id: string; text: string }[] = [],
  options: GovernanceOptions = {},
): V2RCorpusGovernanceReport {
  if (manifest.schema !== V2R_CORPUS_SCHEMA || manifest.schemaVersion !== 1) {
    throw new Error('V2R corpus selection manifest identity is invalid.');
  }
  validateSplitTargets(manifest.targetBytes);
  if ((options.requireComplete ?? true) && manifest.status !== 'complete') {
    throw new Error('V2R corpus selection is incomplete.');
  }
  validateSources(manifest.sources);

  const sourceById = new Map(manifest.sources.map((source) => [source.id, source]));
  const textById = new Map(documents.map((document) => [document.documentId, document]));
  if (textById.size !== documents.length) throw new Error('Corpus document ids must be unique.');
  if (manifest.documents.length !== documents.length) {
    throw new Error('Selection manifest and materialized document counts differ.');
  }

  const splitBytes = emptySplitCounts();
  const sourceBytes = new Map<string, number>();
  const sourceKindBytes: Record<V2RSourceKind, number> = {
    'project-owned': 0,
    'tatoeba-cc0': 0,
    'common-voice-cc0': 0,
  };
  const categoryBytes = new Map<string, number>();
  const languageBytes: Record<V2RLanguage, number> = { zh: 0, en: 0 };
  const seenIds = new Set<string>();
  const seenPaths = new Set<string>();
  const normalizedDocuments: FingerprintDocument[] = [];
  const templateCounts = new Map<string, number>();
  const fiveGramCounts = new Map<number, number>();
  const documentTrigramCounts = new Map<number, number>();
  let fiveGramTotal = 0;
  let projectOwnedBytes = 0;

  for (const selected of manifest.documents) {
    if (seenIds.has(selected.documentId))
      throw new Error(`Duplicate document id: ${selected.documentId}.`);
    if (seenPaths.has(selected.relativePath))
      throw new Error(`Duplicate document path: ${selected.relativePath}.`);
    seenIds.add(selected.documentId);
    seenPaths.add(selected.relativePath);
    assertPathInsideV2RCache(selected.relativePath, `${selected.documentId}.relativePath`);
    const source = sourceById.get(selected.sourceId);
    if (!source) throw new Error(`Unknown selected source: ${selected.sourceId}.`);
    const materialized = textById.get(selected.documentId);
    if (!materialized) throw new Error(`Missing materialized document: ${selected.documentId}.`);
    if (
      materialized.sourceId !== selected.sourceId ||
      materialized.language !== selected.language ||
      materialized.category !== selected.category ||
      materialized.relativePath !== selected.relativePath ||
      source.language !== selected.language ||
      source.category !== selected.category
    ) {
      throw new Error(`Document metadata mismatch: ${selected.documentId}.`);
    }
    const bytes = Buffer.byteLength(materialized.text, 'utf8');
    if (
      bytes !== selected.bytes ||
      sha256(materialized.text) !== selected.sha256 ||
      sha256(normalizeForComparison(materialized.text)) !== selected.normalizedSha256
    ) {
      throw new Error(`Document content identity mismatch: ${selected.documentId}.`);
    }
    const forbidden = findForbiddenText(materialized.text);
    if (forbidden.length > 0) {
      throw new Error(
        `Forbidden or private text in ${selected.documentId}: ${forbidden.join(', ')}.`,
      );
    }
    splitBytes[selected.split] += bytes;
    sourceBytes.set(selected.sourceId, (sourceBytes.get(selected.sourceId) ?? 0) + bytes);
    sourceKindBytes[source.kind] += bytes;
    categoryBytes.set(selected.category, (categoryBytes.get(selected.category) ?? 0) + bytes);
    languageBytes[selected.language] += bytes;
    if (source.kind === 'project-owned') projectOwnedBytes += bytes;
    normalizedDocuments.push({ id: selected.documentId, text: materialized.text });
    if (materialized.templateId) {
      if (selected.templateId !== materialized.templateId) {
        throw new Error(`Document template identity mismatch: ${selected.documentId}.`);
      }
      templateCounts.set(
        materialized.templateId,
        (templateCounts.get(materialized.templateId) ?? 0) + 1,
      );
    }
    for (const gram of extractNGrams(materialized.text, materialized.language, 5)) {
      const digest = fnv1a32(gram);
      fiveGramCounts.set(digest, (fiveGramCounts.get(digest) ?? 0) + 1);
      fiveGramTotal++;
    }
    for (const gram of new Set(extractNGrams(materialized.text, materialized.language, 3))) {
      const digest = fnv1a32(gram);
      documentTrigramCounts.set(digest, (documentTrigramCounts.get(digest) ?? 0) + 1);
    }
  }

  for (const split of Object.keys(splitBytes) as V2RCorpusSplit[]) {
    if (splitBytes[split] !== manifest.selectedBytes[split]) {
      throw new Error(`Selected byte count mismatch for ${split}.`);
    }
    if (splitBytes[split] > manifest.targetBytes[split]) {
      throw new Error(`Selected byte budget exceeded for ${split}.`);
    }
  }
  const totalBytes = Object.values(splitBytes).reduce((sum, value) => sum + value, 0);
  if (totalBytes !== manifest.totalBytes || totalBytes > V2R_CORPUS_TOTAL_LIMIT_BYTES) {
    throw new Error('Total selected byte count is invalid.');
  }

  const withoutIdentity = { ...manifest } as Omit<V2RCorpusSelectionManifest, 'selectionSha256'> & {
    selectionSha256?: string;
  };
  delete withoutIdentity.selectionSha256;
  const selectionSha256 = canonicalSha256(withoutIdentity);
  if (selectionSha256 !== manifest.selectionSha256) {
    throw new Error('Selection manifest SHA-256 binding is invalid.');
  }

  const exactDuplicates = countExactDuplicates(normalizedDocuments);
  if (exactDuplicates > 0) throw new Error(`Corpus contains ${exactDuplicates} exact duplicates.`);
  const nearDuplicates = findNearDuplicatePairs(
    normalizedDocuments,
    options.nearDuplicateThreshold ?? 0.9,
  ).length;
  if (nearDuplicates / Math.max(1, normalizedDocuments.length) > 0.03) {
    throw new Error(`Corpus near-duplicate ratio exceeds 3% (${nearDuplicates} pairs).`);
  }

  const holdoutDocuments = holdoutTexts.map((item) => ({
    id: `holdout:${item.id}`,
    text: item.text,
  }));
  const holdoutInputTreeSha256 = canonicalSha256(
    holdoutDocuments
      .map((document) => ({ id: document.id, sha256: sha256(document.text) }))
      .sort((left, right) => left.id.localeCompare(right.id)),
  );
  const trainingExact = new Set(
    normalizedDocuments.map((document) => normalizeForComparison(document.text)),
  );
  const holdoutExactOverlaps = holdoutDocuments.filter((document) =>
    trainingExact.has(normalizeForComparison(document.text)),
  ).length;
  if (holdoutExactOverlaps > 0) throw new Error('Training corpus has exact holdout overlap.');
  const combinedNearPairs =
    holdoutDocuments.length === 0
      ? []
      : findNearDuplicatePairs(
          [...normalizedDocuments, ...holdoutDocuments],
          options.nearDuplicateThreshold ?? 0.9,
        );
  const holdoutNearOverlaps = combinedNearPairs.filter(
    ([left, right]) => left.startsWith('holdout:') !== right.startsWith('holdout:'),
  ).length;
  if (holdoutNearOverlaps > 0) throw new Error('Training corpus has near holdout overlap.');

  const sourceRatios = ratios(sourceBytes, totalBytes);
  const categoryRatios = ratios(categoryBytes, totalBytes);
  const languageRatios = {
    zh: totalBytes === 0 ? 0 : languageBytes.zh / totalBytes,
    en: totalBytes === 0 ? 0 : languageBytes.en / totalBytes,
  };
  const projectOwnedRatio = totalBytes === 0 ? 0 : projectOwnedBytes / totalBytes;
  const maxTemplateRatio =
    manifest.documents.length === 0 ? 0 : maxMapValue(templateCounts) / manifest.documents.length;
  const maxFiveGramRatio = fiveGramTotal === 0 ? 0 : maxMapValue(fiveGramCounts) / fiveGramTotal;
  const maxDocumentTrigramRatio =
    manifest.documents.length === 0
      ? 0
      : maxMapValue(documentTrigramCounts) / manifest.documents.length;
  const sourceKindRatios: Record<V2RSourceKind, number> = {
    'project-owned': totalBytes === 0 ? 0 : sourceKindBytes['project-owned'] / totalBytes,
    'tatoeba-cc0': totalBytes === 0 ? 0 : sourceKindBytes['tatoeba-cc0'] / totalBytes,
    'common-voice-cc0': totalBytes === 0 ? 0 : sourceKindBytes['common-voice-cc0'] / totalBytes,
  };
  if (options.enforceQuotas ?? true) {
    if (projectOwnedRatio < 0.6) throw new Error('Project-owned corpus share is below 60%.');
    if (sourceKindRatios['tatoeba-cc0'] > 0.2 + Number.EPSILON) {
      throw new Error('Tatoeba CC0 corpus share exceeds 20%.');
    }
    if (sourceKindRatios['common-voice-cc0'] > 0.2 + Number.EPSILON) {
      throw new Error('Common Voice CC0 corpus share exceeds 20%.');
    }
    for (const [sourceId, ratio] of Object.entries(sourceRatios)) {
      if (ratio > 0.2 + Number.EPSILON) throw new Error(`Source ${sourceId} exceeds 20%.`);
    }
    for (const [category, ratio] of Object.entries(categoryRatios)) {
      if (ratio > 0.4 + Number.EPSILON) throw new Error(`Category ${category} exceeds 40%.`);
    }
    if (languageRatios.zh < 0.48 || languageRatios.en < 0.48) {
      throw new Error('Corpus language balance must remain within 48%-52%.');
    }
    if (maxTemplateRatio > 0.005 + Number.EPSILON) {
      throw new Error(`Corpus template ratio exceeds 0.5% (${maxTemplateRatio}).`);
    }
    if (maxFiveGramRatio > 0.01 + Number.EPSILON) {
      throw new Error(`Corpus high-frequency 5-gram ratio exceeds 1% (${maxFiveGramRatio}).`);
    }
    if (maxDocumentTrigramRatio > 0.08 + Number.EPSILON) {
      throw new Error(
        `Corpus document-level 3-gram ratio exceeds 8% (${maxDocumentTrigramRatio}).`,
      );
    }
  }

  return {
    totalBytes,
    splitBytes,
    projectOwnedRatio,
    sourceKindRatios,
    sourceRatios,
    categoryRatios,
    languageRatios,
    exactDuplicates,
    nearDuplicates,
    forbiddenTextMatches: 0,
    unapprovedLicenseSources: 0,
    isolatedNovelZhReferences: 0,
    holdoutDocumentsAudited: holdoutDocuments.length,
    holdoutInputTreeSha256,
    holdoutExactOverlaps,
    holdoutNearOverlaps,
    maxTemplateRatio,
    maxFiveGramRatio,
    maxDocumentTrigramRatio,
    selectionSha256,
  };
}

export function findNearDuplicatePairs(
  documents: readonly FingerprintDocument[],
  threshold = 0.9,
): Array<[string, string]> {
  if (!(threshold > 0 && threshold <= 1)) throw new Error('Near-duplicate threshold is invalid.');
  const fingerprints = documents.map((document) => buildFingerprint(document));
  const bandSize = documents.length > 10_000 ? 4 : 2;
  const buckets = new Map<string, number[]>();
  const output: Array<[string, string]> = [];
  const emitted = new Set<string>();
  for (const [index, fingerprint] of fingerprints.entries()) {
    const signature = minHashSignature(fingerprint.shingles, 16);
    for (let offset = 0; offset < signature.length; offset += bandSize) {
      const band = signature.slice(offset, offset + bandSize);
      if (band.length !== bandSize) continue;
      const key = `${offset}:${band.join(':')}`;
      const existing = buckets.get(key) ?? [];
      for (const otherIndex of existing) {
        const left = fingerprints[otherIndex]!;
        const smaller = Math.min(left.shingles.size, fingerprint.shingles.size);
        const larger = Math.max(left.shingles.size, fingerprint.shingles.size);
        if (larger === 0 || smaller / larger < threshold) continue;
        if (jaccard(left.shingles, fingerprint.shingles) < threshold) continue;
        const pair = `${otherIndex}:${index}`;
        if (emitted.has(pair)) continue;
        emitted.add(pair);
        output.push([left.id, fingerprint.id]);
        if (output.length >= 10_000) return output;
      }
      existing.push(index);
      buckets.set(key, existing);
    }
  }
  return output;
}

interface FingerprintDocument {
  id: string;
  text: string;
}

function validateSources(sources: readonly V2RCorpusSource[]): void {
  if (sources.length === 0) throw new Error('Corpus source registry is empty.');
  const ids = new Set<string>();
  let projectGeneratorIdentity: string | undefined;
  for (const source of sources) {
    if (!source.id || ids.has(source.id))
      throw new Error(`Duplicate or empty source id: ${source.id}.`);
    ids.add(source.id);
    assertPathInsideV2RCache(source.contentRoot, `${source.id}.contentRoot`);
    normalizeRepositoryRelativePath(source.licenseEvidencePath, `${source.id}.licenseEvidencePath`);
    if (!/^[0-9a-f]{64}$/u.test(source.contentTreeSha256)) {
      throw new Error(`${source.id}.contentTreeSha256 is invalid.`);
    }
    if (
      !Number.isFinite(Date.parse(source.collectedAt)) ||
      new Date(source.collectedAt).toISOString() !== source.collectedAt
    ) {
      throw new Error(`${source.id}.collectedAt is invalid.`);
    }
    if (!source.cleanerVersion) throw new Error(`${source.id}.cleanerVersion is missing.`);
    if (source.kind === 'project-owned') {
      if (source.licenseSpdx !== 'MIT' || !source.generatorVersion || !source.generatorSeed) {
        throw new Error(`Project-owned source ${source.id} has invalid provenance.`);
      }
      const identity = `${source.generatorVersion}\0${source.generatorSeed}`;
      projectGeneratorIdentity ??= identity;
      if (identity !== projectGeneratorIdentity) {
        throw new Error('Project-owned sources must share one generator version and seed.');
      }
    } else if (source.licenseSpdx !== 'CC0-1.0') {
      throw new Error(`External source ${source.id} must be CC0-1.0.`);
    }
  }
}

function validateSplitTargets(targets: Record<V2RCorpusSplit, number>): void {
  const { train, development, internalSelection } = targets;
  for (const [name, value] of Object.entries(targets)) {
    if (!Number.isSafeInteger(value) || value <= 0)
      throw new Error(`${name} target bytes are invalid.`);
  }
  const total = train + development + internalSelection;
  if (total > V2R_CORPUS_TOTAL_LIMIT_BYTES) throw new Error('Corpus targets exceed 30MiB.');
  if (train * 10 !== total * 8 || development * 10 !== total || internalSelection * 10 !== total) {
    throw new Error('Corpus split targets must use an 80/10/10 ratio.');
  }
}

function splitForDigest(digest: string): V2RCorpusSplit {
  const bucket = Number.parseInt(digest.slice(0, 8), 16) % 10;
  if (bucket < 8) return 'train';
  return bucket === 8 ? 'development' : 'internalSelection';
}

function splitLanguageBudget(totalBytes: number, language: V2RLanguage): number {
  const chineseBytes = Math.floor(totalBytes / 2);
  return language === 'zh' ? chineseBytes : totalBytes - chineseBytes;
}

function emptySplitCounts(): Record<V2RCorpusSplit, number> {
  return { train: 0, development: 0, internalSelection: 0 };
}

function countExactDuplicates(documents: readonly FingerprintDocument[]): number {
  const seen = new Set<string>();
  let duplicates = 0;
  for (const document of documents) {
    const normalized = normalizeForComparison(document.text);
    if (seen.has(normalized)) duplicates++;
    else seen.add(normalized);
  }
  return duplicates;
}

function findForbiddenText(value: string): string[] {
  const patterns: Array<[string, RegExp]> = [
    ['email', /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu],
    ['phone', /(?:\+?\d[\s-]*){8,}/u],
    ['url', /(?:https?:\/\/|www\.)/iu],
    ['navigation boilerplate', /\b(?:click here|subscribe|sign in|log in|navigation menu)\b/iu],
    ['conversation prompt', /(?:^|\n)\s*(?:user|assistant|system)\s*:/iu],
  ];
  return patterns.filter(([, pattern]) => pattern.test(value)).map(([name]) => name);
}

function buildFingerprint(document: FingerprintDocument): {
  id: string;
  shingles: Set<number>;
} {
  const normalized = normalizeForComparison(document.text).replace(/[\p{P}\p{S}\s]+/gu, '');
  const points = Array.from(normalized);
  const shingles = new Set<number>();
  for (let index = 0; index <= points.length - 5; index++) {
    shingles.add(fnv1a32(points.slice(index, index + 5).join('')));
  }
  return { id: document.id, shingles };
}

function fnv1a32(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function minHashSignature(shingles: ReadonlySet<number>, size: number): number[] {
  if (shingles.size === 0) return [];
  const signature = Array<number>(size).fill(0xffffffff);
  for (const shingle of shingles) {
    for (let index = 0; index < size; index++) {
      const mixed = mix32(shingle ^ Math.imul(index + 1, 0x9e3779b1));
      if (mixed < signature[index]!) signature[index] = mixed;
    }
  }
  return signature;
}

function mix32(value: number): number {
  let mixed = value >>> 0;
  mixed ^= mixed >>> 16;
  mixed = Math.imul(mixed, 0x7feb352d);
  mixed ^= mixed >>> 15;
  mixed = Math.imul(mixed, 0x846ca68b);
  mixed ^= mixed >>> 16;
  return mixed >>> 0;
}

function jaccard(left: Set<number>, right: Set<number>): number {
  if (left.size === 0 || right.size === 0) return 0;
  let intersection = 0;
  const smaller = left.size <= right.size ? left : right;
  const larger = smaller === left ? right : left;
  for (const value of smaller) if (larger.has(value)) intersection++;
  return intersection / (left.size + right.size - intersection);
}

function ratios(values: Map<string, number>, total: number): Record<string, number> {
  return Object.fromEntries(
    [...values.entries()].map(([key, value]) => [key, total === 0 ? 0 : value / total]),
  );
}

function extractNGrams(value: string, language: V2RLanguage, size: number): string[] {
  const units =
    language === 'en'
      ? (value
          .normalize('NFKC')
          .toLocaleLowerCase('en-US')
          .match(/[a-z]+(?:['’-][a-z]+)*/gu) ?? [])
      : Array.from(value.normalize('NFKC')).filter((point) => /\p{Script=Han}/u.test(point));
  const grams: string[] = [];
  for (let index = 0; index <= units.length - size; index++) {
    grams.push(units.slice(index, index + size).join(language === 'en' ? ' ' : ''));
  }
  return grams;
}

function maxMapValue(values: ReadonlyMap<unknown, number>): number {
  let maximum = 0;
  for (const value of values.values()) maximum = Math.max(maximum, value);
  return maximum;
}
