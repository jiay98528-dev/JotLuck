import { readFile } from 'node:fs/promises';

import {
  canonicalSha256,
  decodeUtf8,
  isSha256,
  readPinnedFile,
  sha256,
  type Sha256,
} from './common';

export type HoldoutClassification =
  | 'cold-validation-v1'
  | 'workspace-validation-v1'
  | 'cold-final-v1'
  | 'workspace-final-v1';

export interface FingerprintTextDocument {
  id: string;
  text: string;
}

export interface FingerprintRecord {
  id: string;
  normalizedSha256: Sha256;
  tokenCount: number;
  shortShingleSha256s: Sha256[];
  minHash128: string[] | null;
  cjk32WindowSha256s: Sha256[];
  english12WindowSha256s: Sha256[];
}

export interface HoldoutFingerprintInventory {
  schema: 'jotluck.autocomplete.v2-free-holdout-fingerprints.v1';
  schemaVersion: 1;
  datasetId: string;
  classification: HoldoutClassification;
  contentSha256: Sha256;
  documents: FingerprintRecord[];
  inventorySha256: Sha256;
}

export interface SelectionDocumentIdentity {
  documentId: string;
  relativePath: string;
  bytes: number;
  sha256: Sha256;
}

export interface SelectionFingerprintInput {
  inputTreeSha256: Sha256;
  inputNearDuplicateDocumentRate: number;
  documents: SelectionDocumentIdentity[];
}

export interface FingerprintLeakageAudit {
  schema: 'jotluck.autocomplete.v2-free-fingerprint-audit.v1';
  schemaVersion: 1;
  selectionManifestSha256: Sha256;
  selectionInputTreeSha256: Sha256;
  selectedDocuments: number;
  holdoutInventories: Array<{
    datasetId: string;
    classification: HoldoutClassification;
    contentSha256: Sha256;
    inventorySha256: Sha256;
  }>;
  exactDuplicatePairs: number;
  nearDuplicatePairs: number;
  inputNearDuplicateDocumentRate: number;
  nearDuplicateDocumentRate: number;
  exactHoldoutOverlaps: number;
  nearHoldoutOverlaps: number;
  longWindowLeakages: number;
  samples: Array<{
    kind: 'exact-train' | 'near-train' | 'exact-holdout' | 'near-holdout' | 'long-window';
    leftId: string;
    rightId: string;
    holdoutClassification?: HoldoutClassification;
  }>;
  finalContentRead: false;
  passed: boolean;
  reportSha256: Sha256;
}

export interface NearDuplicateRemoval {
  retainedId: string;
  removedId: string;
  matchedId: string;
  jaccard: number;
}

export interface SelectionDeduplicationResult {
  retainedDocumentIds: string[];
  inputNearDuplicateDocumentRate: number;
  removedPairs: NearDuplicateRemoval[];
}

const MIN_HASH_COUNT = 128;
const MIN_HASH_BAND_SIZE = 4;
const NEAR_DUPLICATE_THRESHOLD = 0.8;
const MAX_NEAR_DUPLICATE_DOCUMENT_RATE = 0.03;
const CJK_SHORT_WINDOW_CODEPOINTS = 12;
const ENGLISH_SHORT_WINDOW_TOKENS = 5;
const CJK_LONG_WINDOW_CODEPOINTS = 32;
const ENGLISH_LONG_WINDOW_TOKENS = 12;
const SAMPLE_LIMIT = 20;

export function fingerprintDocuments(options: {
  datasetId: string;
  classification: HoldoutClassification;
  contentSha256: Sha256;
  documents: readonly FingerprintTextDocument[];
}): HoldoutFingerprintInventory {
  if (!isSha256(options.contentSha256)) throw new Error('Holdout content SHA-256 is invalid.');
  const ids = new Set<string>();
  const documents = options.documents.map(({ id, text }) => {
    if (!id || ids.has(id)) throw new Error('Fingerprint document identities must be unique.');
    ids.add(id);
    return fingerprintText(id, text);
  });
  const withoutHash = {
    schema: 'jotluck.autocomplete.v2-free-holdout-fingerprints.v1' as const,
    schemaVersion: 1 as const,
    datasetId: options.datasetId,
    classification: options.classification,
    contentSha256: options.contentSha256,
    documents,
  };
  return { ...withoutHash, inventorySha256: canonicalSha256(withoutHash) };
}

export function deduplicateSelectionDocuments(
  documents: readonly FingerprintTextDocument[],
): SelectionDeduplicationResult {
  if (documents.length === 0) {
    return { retainedDocumentIds: [], inputNearDuplicateDocumentRate: 0, removedPairs: [] };
  }
  const ids = new Set<string>();
  const records = [...documents]
    .map(({ id, text }) => {
      if (!id || ids.has(id)) throw new Error('Deduplication document identities must be unique.');
      ids.add(id);
      return fingerprintText(id, text);
    })
    .sort((left, right) => left.id.localeCompare(right.id));
  const nearPairs = enumerateNearPairs(records);
  const parents = records.map((_, index) => index);
  const find = (value: number): number => {
    let root = value;
    while (parents[root] !== root) root = parents[root]!;
    while (parents[value] !== value) {
      const next = parents[value]!;
      parents[value] = root;
      value = next;
    }
    return root;
  };
  for (const pair of nearPairs) {
    const leftRoot = find(pair.leftIndex);
    const rightRoot = find(pair.rightIndex);
    if (leftRoot !== rightRoot) parents[rightRoot] = leftRoot;
  }
  const groups = new Map<number, number[]>();
  for (const [index] of records.entries()) {
    const root = find(index);
    const values = groups.get(root) ?? [];
    values.push(index);
    groups.set(root, values);
  }
  const retained = new Set(records.map((record) => record.id));
  const removedPairs: NearDuplicateRemoval[] = [];
  for (const indices of groups.values()) {
    if (indices.length < 2) continue;
    const retainedIndex = indices[0]!;
    for (const removedIndex of indices.slice(1)) {
      const match = nearPairs.find(
        (pair) => pair.leftIndex === removedIndex || pair.rightIndex === removedIndex,
      );
      if (!match) throw new Error('Near-duplicate component lost its matching edge.');
      const matchedIndex = match.leftIndex === removedIndex ? match.rightIndex : match.leftIndex;
      retained.delete(records[removedIndex]!.id);
      removedPairs.push({
        retainedId: records[retainedIndex]!.id,
        removedId: records[removedIndex]!.id,
        matchedId: records[matchedIndex]!.id,
        jaccard: match.jaccard,
      });
    }
  }
  const nearDocumentIds = new Set(
    nearPairs.flatMap((pair) => [records[pair.leftIndex]!.id, records[pair.rightIndex]!.id]),
  );
  return {
    retainedDocumentIds: [...retained].sort(),
    inputNearDuplicateDocumentRate: nearDocumentIds.size / records.length,
    removedPairs: removedPairs.sort((left, right) => left.removedId.localeCompare(right.removedId)),
  };
}

export function verifyFingerprintInventory(
  inventory: HoldoutFingerprintInventory,
): HoldoutFingerprintInventory {
  const withoutHash = { ...inventory };
  delete (withoutHash as Partial<HoldoutFingerprintInventory>).inventorySha256;
  if (
    inventory.schema !== 'jotluck.autocomplete.v2-free-holdout-fingerprints.v1' ||
    inventory.schemaVersion !== 1 ||
    !isSha256(inventory.contentSha256) ||
    !isSha256(inventory.inventorySha256) ||
    canonicalSha256(withoutHash) !== inventory.inventorySha256 ||
    !Array.isArray(inventory.documents)
  ) {
    throw new Error('Holdout fingerprint inventory identity is invalid.');
  }
  for (const record of inventory.documents) verifyFingerprintRecord(record);
  return inventory;
}

export async function auditSelectionFingerprints(options: {
  workspaceRoot: string;
  selection: SelectionFingerprintInput;
  selectionManifestBytes: Uint8Array;
  holdoutInventories: readonly HoldoutFingerprintInventory[];
}): Promise<FingerprintLeakageAudit> {
  if (!isSha256(options.selection.inputTreeSha256)) {
    throw new Error('Selection input tree SHA-256 is invalid.');
  }
  if (
    !Number.isFinite(options.selection.inputNearDuplicateDocumentRate) ||
    options.selection.inputNearDuplicateDocumentRate < 0 ||
    options.selection.inputNearDuplicateDocumentRate > 1
  ) {
    throw new Error('Selection input near-duplicate rate is invalid.');
  }
  if (options.selection.documents.length < 2) {
    throw new Error('Fingerprint audit requires at least two selection documents.');
  }
  const inventories = options.holdoutInventories.map(verifyFingerprintInventory);
  const classifications = new Set(inventories.map((item) => item.classification));
  for (const required of ['cold-validation-v1', 'workspace-validation-v1'] as const) {
    if (!classifications.has(required)) {
      throw new Error(`Fingerprint audit is missing ${required}.`);
    }
  }

  const trainingRecords: FingerprintRecord[] = [];
  const documentIds = new Set<string>();
  for (const document of options.selection.documents) {
    if (documentIds.has(document.documentId)) {
      throw new Error('Selection contains a duplicate document id.');
    }
    documentIds.add(document.documentId);
    const pinned = await readPinnedFile(
      options.workspaceRoot,
      { path: document.relativePath, bytes: document.bytes, sha256: document.sha256 },
      `selection document ${document.documentId}`,
    );
    trainingRecords.push(
      fingerprintText(document.documentId, decodeUtf8(pinned.bytes, document.documentId)),
    );
  }

  const samples: FingerprintLeakageAudit['samples'] = [];
  const exactDuplicatePairs = collectExactTrainingDuplicates(trainingRecords, samples);
  const nearTraining = collectNearTrainingDuplicates(trainingRecords, samples);
  const holdoutComparison = compareTrainingToHoldouts(trainingRecords, inventories, samples);
  const nearDuplicateDocumentRate = nearTraining.documentIds.size / trainingRecords.length;
  const withoutHash = {
    schema: 'jotluck.autocomplete.v2-free-fingerprint-audit.v1' as const,
    schemaVersion: 1 as const,
    selectionManifestSha256: sha256(options.selectionManifestBytes),
    selectionInputTreeSha256: options.selection.inputTreeSha256,
    selectedDocuments: trainingRecords.length,
    holdoutInventories: inventories.map((item) => ({
      datasetId: item.datasetId,
      classification: item.classification,
      contentSha256: item.contentSha256,
      inventorySha256: item.inventorySha256,
    })),
    exactDuplicatePairs,
    nearDuplicatePairs: nearTraining.pairs,
    inputNearDuplicateDocumentRate: options.selection.inputNearDuplicateDocumentRate,
    nearDuplicateDocumentRate,
    exactHoldoutOverlaps: holdoutComparison.exact,
    nearHoldoutOverlaps: holdoutComparison.near,
    longWindowLeakages: holdoutComparison.longWindow,
    samples,
    finalContentRead: false as const,
    passed:
      exactDuplicatePairs === 0 &&
      options.selection.inputNearDuplicateDocumentRate <= MAX_NEAR_DUPLICATE_DOCUMENT_RATE &&
      nearTraining.pairs === 0 &&
      holdoutComparison.exact === 0 &&
      holdoutComparison.near === 0 &&
      holdoutComparison.longWindow === 0,
  };
  return { ...withoutHash, reportSha256: canonicalSha256(withoutHash) };
}

export async function readFingerprintInventory(path: string): Promise<HoldoutFingerprintInventory> {
  return verifyFingerprintInventory(
    JSON.parse(await readFile(path, 'utf8')) as HoldoutFingerprintInventory,
  );
}

export function fingerprintText(id: string, text: string): FingerprintRecord {
  const normalized = normalizeText(text);
  if (!normalized) throw new Error(`Fingerprint document ${id} is empty.`);
  const cjkCodepoints = normalized.match(/[\p{Script=Han}]/gu) ?? [];
  const englishTokens = normalized.match(/[a-z0-9]+/gu) ?? [];
  const tokenCount = cjkCodepoints.length + englishTokens.length;
  if (tokenCount === 0) throw new Error(`Fingerprint document ${id} has no text tokens.`);
  const shortShingles = [
    ...windows(cjkCodepoints, CJK_SHORT_WINDOW_CODEPOINTS).map((item) => `cjk:${item}`),
    ...windows(englishTokens, ENGLISH_SHORT_WINDOW_TOKENS).map((item) => `en:${item}`),
  ];
  const shortShingleSha256s = [...new Set(shortShingles.map((item) => sha256(item)))].sort();
  return {
    id,
    normalizedSha256: sha256(normalized),
    tokenCount,
    shortShingleSha256s,
    minHash128: shortShingleSha256s.length > 0 ? computeMinHash(shortShingleSha256s) : null,
    cjk32WindowSha256s: uniqueWindowHashes(cjkCodepoints, CJK_LONG_WINDOW_CODEPOINTS),
    english12WindowSha256s: uniqueWindowHashes(englishTokens, ENGLISH_LONG_WINDOW_TOKENS),
  };
}

function verifyFingerprintRecord(record: FingerprintRecord): void {
  if (
    !record.id ||
    !isSha256(record.normalizedSha256) ||
    !Number.isSafeInteger(record.tokenCount) ||
    record.tokenCount < 1 ||
    record.shortShingleSha256s.some((item) => !isSha256(item)) ||
    (record.minHash128 !== null &&
      (record.minHash128.length !== MIN_HASH_COUNT ||
        record.minHash128.some((item) => !/^[a-f0-9]{16}$/u.test(item)))) ||
    record.cjk32WindowSha256s.some((item) => !isSha256(item)) ||
    record.english12WindowSha256s.some((item) => !isSha256(item))
  ) {
    throw new Error('Fingerprint record contract is invalid.');
  }
}

function normalizeText(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/https?:\/\/\S+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

function windows(tokens: readonly string[], size: number): string[] {
  if (tokens.length < size) return [];
  const result: string[] = [];
  for (let index = 0; index <= tokens.length - size; index++) {
    result.push(tokens.slice(index, index + size).join('\u001f'));
  }
  return result;
}

function uniqueWindowHashes(tokens: readonly string[], size: number): Sha256[] {
  return [...new Set(windows(tokens, size).map((item) => sha256(item)))].sort();
}

function computeMinHash(shingles: readonly string[]): string[] {
  const result: string[] = [];
  for (let seed = 0; seed < MIN_HASH_COUNT; seed++) {
    let minimum = 'ffffffffffffffff';
    for (const shingle of shingles) {
      const value = sha256(`${seed}\u0000${shingle}`).slice(0, 16);
      if (value < minimum) minimum = value;
    }
    result.push(minimum);
  }
  return result;
}

export function minHashSimilarity(left: FingerprintRecord, right: FingerprintRecord): number {
  if (left.minHash128 === null || right.minHash128 === null) return 0;
  let equal = 0;
  for (let index = 0; index < MIN_HASH_COUNT; index++) {
    if (left.minHash128[index] === right.minHash128[index]) equal++;
  }
  return equal / MIN_HASH_COUNT;
}

export function exactShingleJaccard(left: FingerprintRecord, right: FingerprintRecord): number {
  if (left.shortShingleSha256s.length === 0 || right.shortShingleSha256s.length === 0) return 0;
  const leftSet = new Set(left.shortShingleSha256s);
  const rightSet = new Set(right.shortShingleSha256s);
  let intersection = 0;
  for (const value of leftSet) if (rightSet.has(value)) intersection++;
  return intersection / (leftSet.size + rightSet.size - intersection);
}

export function bandKeys(record: FingerprintRecord): string[] {
  if (record.minHash128 === null) return [];
  const keys: string[] = [];
  for (let index = 0; index < MIN_HASH_COUNT; index += MIN_HASH_BAND_SIZE) {
    keys.push(`${index}:${record.minHash128.slice(index, index + MIN_HASH_BAND_SIZE).join('')}`);
  }
  return keys;
}

function collectExactTrainingDuplicates(
  records: readonly FingerprintRecord[],
  samples: FingerprintLeakageAudit['samples'],
): number {
  const previous = new Map<Sha256, string>();
  let pairs = 0;
  for (const record of records) {
    const existing = previous.get(record.normalizedSha256);
    if (existing) {
      pairs++;
      pushSample(samples, { kind: 'exact-train', leftId: existing, rightId: record.id });
    } else {
      previous.set(record.normalizedSha256, record.id);
    }
  }
  return pairs;
}

function collectNearTrainingDuplicates(
  records: readonly FingerprintRecord[],
  samples: FingerprintLeakageAudit['samples'],
): { pairs: number; documentIds: Set<string> } {
  const documentIds = new Set<string>();
  const pairs = enumerateNearPairs(records);
  for (const pair of pairs) {
    const left = records[pair.leftIndex]!;
    const right = records[pair.rightIndex]!;
    documentIds.add(left.id);
    documentIds.add(right.id);
    pushSample(samples, { kind: 'near-train', leftId: left.id, rightId: right.id });
  }
  return { pairs: pairs.length, documentIds };
}

function enumerateNearPairs(
  records: readonly FingerprintRecord[],
): Array<{ leftIndex: number; rightIndex: number; jaccard: number }> {
  const buckets = new Map<string, number[]>();
  const seenPairs = new Set<string>();
  const pairs: Array<{ leftIndex: number; rightIndex: number; jaccard: number }> = [];
  for (const [rightIndex, record] of records.entries()) {
    const candidates = new Set<number>();
    for (const key of bandKeys(record)) {
      for (const candidate of buckets.get(key) ?? []) candidates.add(candidate);
    }
    for (const leftIndex of candidates) {
      const pairKey = `${leftIndex}:${rightIndex}`;
      if (seenPairs.has(pairKey)) continue;
      seenPairs.add(pairKey);
      const left = records[leftIndex]!;
      const jaccard = exactShingleJaccard(left, record);
      if (
        left.normalizedSha256 !== record.normalizedSha256 &&
        jaccard >= NEAR_DUPLICATE_THRESHOLD
      ) {
        pairs.push({ leftIndex, rightIndex, jaccard });
      }
    }
    for (const key of bandKeys(record)) {
      const values = buckets.get(key) ?? [];
      values.push(rightIndex);
      buckets.set(key, values);
    }
  }
  return pairs;
}

function compareTrainingToHoldouts(
  training: readonly FingerprintRecord[],
  inventories: readonly HoldoutFingerprintInventory[],
  samples: FingerprintLeakageAudit['samples'],
): { exact: number; near: number; longWindow: number } {
  let exact = 0;
  let near = 0;
  let longWindow = 0;
  for (const inventory of inventories) {
    const exactByHash = new Map(inventory.documents.map((item) => [item.normalizedSha256, item]));
    const holdoutBands = new Map<string, FingerprintRecord[]>();
    const longWindows = new Map<Sha256, FingerprintRecord>();
    for (const record of inventory.documents) {
      for (const key of bandKeys(record)) {
        const values = holdoutBands.get(key) ?? [];
        values.push(record);
        holdoutBands.set(key, values);
      }
      for (const value of [...record.cjk32WindowSha256s, ...record.english12WindowSha256s]) {
        longWindows.set(value, record);
      }
    }
    for (const record of training) {
      const exactMatch = exactByHash.get(record.normalizedSha256);
      if (exactMatch) {
        exact++;
        pushSample(samples, {
          kind: 'exact-holdout',
          leftId: record.id,
          rightId: exactMatch.id,
          holdoutClassification: inventory.classification,
        });
      }
      const nearCandidates = new Map<string, FingerprintRecord>();
      for (const key of bandKeys(record)) {
        for (const candidate of holdoutBands.get(key) ?? [])
          nearCandidates.set(candidate.id, candidate);
      }
      for (const candidate of nearCandidates.values()) {
        if (
          candidate.normalizedSha256 !== record.normalizedSha256 &&
          exactShingleJaccard(record, candidate) >= NEAR_DUPLICATE_THRESHOLD
        ) {
          near++;
          pushSample(samples, {
            kind: 'near-holdout',
            leftId: record.id,
            rightId: candidate.id,
            holdoutClassification: inventory.classification,
          });
        }
      }
      const matchingLong = [...record.cjk32WindowSha256s, ...record.english12WindowSha256s].find(
        (value) => longWindows.has(value),
      );
      if (matchingLong) {
        longWindow++;
        pushSample(samples, {
          kind: 'long-window',
          leftId: record.id,
          rightId: longWindows.get(matchingLong)!.id,
          holdoutClassification: inventory.classification,
        });
      }
    }
  }
  return { exact, near, longWindow };
}

function pushSample(
  samples: FingerprintLeakageAudit['samples'],
  value: FingerprintLeakageAudit['samples'][number],
): void {
  if (samples.length < SAMPLE_LIMIT) samples.push(value);
}
