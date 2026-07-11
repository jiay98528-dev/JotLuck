import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { nearDuplicateCorpusKey, normalizeCorpusFragment } from './web-corpus-utils';

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const WORKSPACE_FINAL_V2_PATH = 'scripts/corpus/workspace-conditioned-final-v2.json';

export interface WorkspaceSupportDocument {
  id: string;
  path: string;
  language: 'zh' | 'en';
  text: string;
}

export interface WorkspaceFinalCheckpoint {
  id: string;
  cursorOffset: number;
  expectedSuffix: string;
  expectedBehavior: 'complete' | 'silence';
}

export interface WorkspaceFinalTarget {
  id: string;
  path: string;
  language: 'zh' | 'en';
  category: string;
  text: string;
  supportDocumentIds: string[];
  checkpoints: WorkspaceFinalCheckpoint[];
}

export interface WorkspaceFinalHoldout {
  schemaVersion: 2;
  datasetId: string;
  frozenAt: string;
  classification: 'workspace-conditioned-final-v2';
  releaseEvidence: true;
  description: string;
  supportDocuments: WorkspaceSupportDocument[];
  targets: WorkspaceFinalTarget[];
}

export interface WorkspaceFinalAudit {
  datasetSha256: string;
  targetDocuments: number;
  checkpoints: number;
  languageCheckpoints: { zh: number; en: number };
  silenceCheckpoints: number;
  exactContinuationDuplicates: number;
  nearContinuationDuplicates: number;
  supportContinuationOverlaps: number;
  nearTargetPairs: number;
  maxCategoryRatio: number;
  maxTemplateRatio: number;
  maxStructuralTemplateRatio: number;
  maxFrequentNgramRatio: number;
  sharedLongNgramPairs: number;
}

interface AuditedDocument {
  key: string;
  language: 'zh' | 'en';
  text: string;
}

const STRUCTURAL_TEMPLATE_LIMIT = 0.1;
const STRUCTURAL_SIMILARITY_THRESHOLD = { zh: 0.08, en: 0.15 } as const;
const SHARED_LONG_NGRAM_SIZE = { zh: 16, en: 10 } as const;

export function loadAndValidateWorkspaceFinalV2(repoRoot = REPOSITORY_ROOT): {
  holdout: WorkspaceFinalHoldout;
  audit: WorkspaceFinalAudit;
} {
  const filePath = path.resolve(repoRoot, WORKSPACE_FINAL_V2_PATH);
  if (!fs.existsSync(filePath)) {
    throw new Error('Workspace final-v2 holdout is not frozen; RC remains fail-closed.');
  }
  const holdout = JSON.parse(fs.readFileSync(filePath, 'utf8')) as WorkspaceFinalHoldout;
  return { holdout, audit: validateWorkspaceFinalV2(holdout) };
}

export function validateWorkspaceFinalV2(holdout: WorkspaceFinalHoldout): WorkspaceFinalAudit {
  if (
    holdout.schemaVersion !== 2 ||
    holdout.classification !== 'workspace-conditioned-final-v2' ||
    holdout.releaseEvidence !== true ||
    !/^workspace-conditioned-final-v2(?:[-.][a-z0-9]+)*$/iu.test(holdout.datasetId) ||
    !Number.isFinite(Date.parse(holdout.frozenAt)) ||
    !Array.isArray(holdout.supportDocuments) ||
    !Array.isArray(holdout.targets)
  ) {
    throw new Error('Workspace final-v2 identity is invalid.');
  }
  if (holdout.targets.length !== 50) {
    throw new Error('Workspace final-v2 must contain exactly 50 target documents.');
  }

  const supportById = new Map<string, WorkspaceSupportDocument>();
  const paths = new Set<string>();
  for (const support of holdout.supportDocuments) {
    assertDocumentIdentity(support.id, support.path, support.language, support.text, paths);
    if (supportById.has(support.id)) throw new Error(`Duplicate support document: ${support.id}.`);
    supportById.set(support.id, support);
  }
  const targetIds = new Set<string>();
  const checkpointIds = new Set<string>();
  const languageCheckpoints = { zh: 0, en: 0 };
  const categoryCounts = new Map<string, number>();
  const exactContinuations = new Set<string>();
  const nearContinuations = new Set<string>();
  const normalizedTargets: string[] = [];
  const targetNgramDocuments = new Map<string, number>();
  const targetAuditDocuments: AuditedDocument[] = [];
  let checkpoints = 0;
  let silenceCheckpoints = 0;
  let exactContinuationDuplicates = 0;
  let nearContinuationDuplicates = 0;
  let supportContinuationOverlaps = 0;

  for (const target of holdout.targets) {
    assertDocumentIdentity(target.id, target.path, target.language, target.text, paths);
    if (targetIds.has(target.id)) throw new Error(`Duplicate target document: ${target.id}.`);
    targetIds.add(target.id);
    categoryCounts.set(target.category, (categoryCounts.get(target.category) ?? 0) + 1);
    if (!target.category || target.checkpoints.length !== 4) {
      throw new Error(`Workspace target must have a category and four checkpoints: ${target.id}.`);
    }
    const supportIds = [...new Set(target.supportDocumentIds)];
    if (supportIds.length < 2 || supportIds.length !== target.supportDocumentIds.length) {
      throw new Error(
        `Workspace target requires at least two distinct support documents: ${target.id}.`,
      );
    }
    const supports = supportIds.map((id) => {
      const support = supportById.get(id);
      if (!support || support.language !== target.language) {
        throw new Error(
          `Workspace target has missing or wrong-language support: ${target.id}/${id}.`,
        );
      }
      return support;
    });
    for (const checkpoint of target.checkpoints) {
      if (
        !checkpoint.id ||
        checkpointIds.has(checkpoint.id) ||
        !Number.isSafeInteger(checkpoint.cursorOffset) ||
        checkpoint.cursorOffset < 0 ||
        checkpoint.cursorOffset > target.text.length ||
        (checkpoint.expectedBehavior !== 'complete' && checkpoint.expectedBehavior !== 'silence')
      ) {
        throw new Error(`Workspace checkpoint is invalid: ${target.id}/${checkpoint.id}.`);
      }
      checkpointIds.add(checkpoint.id);
      checkpoints++;
      languageCheckpoints[target.language]++;
      if (checkpoint.expectedBehavior === 'silence') {
        if (checkpoint.expectedSuffix !== '') {
          throw new Error(`Silence checkpoint has a suffix: ${checkpoint.id}.`);
        }
        silenceCheckpoints++;
        continue;
      }
      if (
        !checkpoint.expectedSuffix ||
        !target.text.slice(checkpoint.cursorOffset).startsWith(checkpoint.expectedSuffix)
      ) {
        throw new Error(`Completion suffix is not anchored at its cursor: ${checkpoint.id}.`);
      }
      const exact = normalizeCorpusFragment(checkpoint.expectedSuffix);
      const near = nearDuplicateCorpusKey(checkpoint.expectedSuffix);
      if (exactContinuations.has(exact)) exactContinuationDuplicates++;
      else exactContinuations.add(exact);
      if (near.length >= 12 && nearContinuations.has(near)) nearContinuationDuplicates++;
      else if (near.length >= 12) nearContinuations.add(near);
      for (const support of supports) {
        const normalizedSupport = normalizeCorpusFragment(support.text);
        if (
          exact.length >= 12 &&
          (normalizedSupport.includes(exact) || exact.includes(normalizedSupport))
        ) {
          supportContinuationOverlaps++;
        }
      }
    }
    const normalizedTarget = normalizeCorpusFragment(target.text);
    normalizedTargets.push(normalizedTarget);
    targetAuditDocuments.push({
      key: `target:${target.id}`,
      language: target.language,
      text: target.text,
    });
    for (const ngram of documentNgrams(target.text, target.language)) {
      targetNgramDocuments.set(ngram, (targetNgramDocuments.get(ngram) ?? 0) + 1);
    }
  }

  const completeCheckpoints = checkpoints - silenceCheckpoints;
  const nearTargetPairs = countNearTargetPairs(normalizedTargets);
  const maxCategoryRatio = Math.max(...categoryCounts.values()) / holdout.targets.length;
  const templateKeys = normalizedTargets.map((text) => nearDuplicateCorpusKey(text));
  const templateCounts = new Map<string, number>();
  for (const key of templateKeys) templateCounts.set(key, (templateCounts.get(key) ?? 0) + 1);
  const maxTemplateRatio = Math.max(...templateCounts.values()) / holdout.targets.length;
  const maxFrequentNgramRatio =
    Math.max(0, ...targetNgramDocuments.values()) / holdout.targets.length;
  const supportAuditDocuments = holdout.supportDocuments.map(
    (support): AuditedDocument => ({
      key: `support:${support.id}`,
      language: support.language,
      text: support.text,
    }),
  );
  const maxStructuralTemplateRatio = Math.max(
    structuralTemplateRatio(targetAuditDocuments),
    structuralTemplateRatio(supportAuditDocuments),
  );
  const sharedLongNgramPairs = countSharedLongNgramPairs([
    ...supportAuditDocuments,
    ...targetAuditDocuments,
  ]);

  if (
    checkpoints !== 200 ||
    languageCheckpoints.zh !== 100 ||
    languageCheckpoints.en !== 100 ||
    silenceCheckpoints !== 50
  ) {
    throw new Error(
      'Workspace final-v2 must have 200 checkpoints, zh/en 100 each, and 50 silence.',
    );
  }
  if (exactContinuationDuplicates !== 0 || supportContinuationOverlaps !== 0) {
    throw new Error('Workspace final-v2 contains exact continuation leakage or duplicates.');
  }
  if (nearContinuationDuplicates / completeCheckpoints > 0.03 || nearTargetPairs / 1_225 > 0.03) {
    throw new Error('Workspace final-v2 near-duplicate rate exceeds 3%.');
  }
  if (maxCategoryRatio > 0.4) throw new Error('Workspace final-v2 category dominance exceeds 40%.');
  if (maxTemplateRatio > 0.1) throw new Error('Workspace final-v2 template dominance exceeds 10%.');
  if (maxStructuralTemplateRatio > STRUCTURAL_TEMPLATE_LIMIT) {
    throw new Error(
      `Workspace final-v2 structural-template dominance exceeds 10% (${(
        maxStructuralTemplateRatio * 100
      ).toFixed(1)}%).`,
    );
  }
  if (sharedLongNgramPairs > 0) {
    throw new Error(
      `Workspace final-v2 contains a shared long n-gram across ${sharedLongNgramPairs} document pair(s).`,
    );
  }
  if (maxFrequentNgramRatio > 0.3) {
    throw new Error('Workspace final-v2 high-frequency n-gram dominance exceeds 30%.');
  }
  return {
    datasetSha256: sha256(canonicalJson(holdout)),
    targetDocuments: holdout.targets.length,
    checkpoints,
    languageCheckpoints,
    silenceCheckpoints,
    exactContinuationDuplicates,
    nearContinuationDuplicates,
    supportContinuationOverlaps,
    nearTargetPairs,
    maxCategoryRatio,
    maxTemplateRatio,
    maxStructuralTemplateRatio,
    maxFrequentNgramRatio,
    sharedLongNgramPairs,
  };
}

function assertDocumentIdentity(
  id: string,
  relativePath: string,
  language: 'zh' | 'en',
  text: string,
  paths: Set<string>,
): void {
  if (
    !/^[a-z0-9][a-z0-9._-]{3,95}$/iu.test(id) ||
    !relativePath ||
    path.isAbsolute(relativePath) ||
    relativePath.replace(/\\/gu, '/').split('/').includes('..') ||
    paths.has(relativePath) ||
    (language !== 'zh' && language !== 'en') ||
    !text.trim()
  ) {
    throw new Error(`Workspace document identity is invalid: ${id}.`);
  }
  paths.add(relativePath);
}

function documentNgrams(text: string, language: 'zh' | 'en'): Set<string> {
  const result = new Set<string>();
  if (language === 'zh') {
    const points = Array.from(normalizeCorpusFragment(text));
    for (let index = 0; index <= points.length - 12; index++) {
      result.add(points.slice(index, index + 12).join(''));
    }
    return result;
  }
  const words = text.toLocaleLowerCase('en-US').match(/[a-z][a-z'-]*/gu) ?? [];
  for (let index = 0; index <= words.length - 4; index++) {
    result.add(words.slice(index, index + 4).join(' '));
  }
  return result;
}

function structuralTemplateRatio(documents: readonly AuditedDocument[]): number {
  if (documents.length === 0) return 0;
  const prepared = documents.map((document) => ({
    ...document,
    punctuation: structuralPunctuation(document.text),
    shingles: structuralShingles(document.text, document.language),
  }));
  let largestNeighborhood = 1;
  for (let left = 0; left < prepared.length; left++) {
    let neighborhood = 1;
    for (let right = 0; right < prepared.length; right++) {
      if (left === right) continue;
      const leftDocument = prepared[left]!;
      const rightDocument = prepared[right]!;
      if (
        leftDocument.language === rightDocument.language &&
        leftDocument.punctuation.length >= 2 &&
        leftDocument.punctuation === rightDocument.punctuation &&
        jaccard(leftDocument.shingles, rightDocument.shingles) >=
          STRUCTURAL_SIMILARITY_THRESHOLD[leftDocument.language]
      ) {
        neighborhood++;
      }
    }
    largestNeighborhood = Math.max(largestNeighborhood, neighborhood);
  }
  return largestNeighborhood / documents.length;
}

function structuralPunctuation(text: string): string {
  return (text.normalize('NFKC').match(/[.!?;,:。！？；：，]/gu) ?? [])
    .join('')
    .replaceAll('。', '.')
    .replaceAll('！', '!')
    .replaceAll('？', '?')
    .replaceAll('；', ';')
    .replaceAll('：', ':')
    .replaceAll('，', ',');
}

function structuralShingles(text: string, language: 'zh' | 'en'): Set<string> {
  if (language === 'zh') {
    const points = Array.from(normalizeCorpusFragment(text).replace(/[\p{P}\p{S}\s]/gu, ''));
    if (points.length < 24) return new Set();
    return sequenceNgrams(points, 3, '');
  }
  const words = englishWords(text);
  if (words.length < 12) return new Set();
  return sequenceNgrams(words, 2, ' ');
}

function countSharedLongNgramPairs(documents: readonly AuditedDocument[]): number {
  const documentsByNgram = new Map<string, Set<string>>();
  for (const document of documents) {
    for (const ngram of sharedLongNgrams(document.text, document.language)) {
      const key = `${document.language}\u0000${ngram}`;
      const owners = documentsByNgram.get(key) ?? new Set<string>();
      owners.add(document.key);
      documentsByNgram.set(key, owners);
    }
  }
  const pairs = new Set<string>();
  for (const owners of documentsByNgram.values()) {
    const keys = [...owners].sort((left, right) => left.localeCompare(right, 'en'));
    for (let left = 0; left < keys.length; left++) {
      for (let right = left + 1; right < keys.length; right++) {
        pairs.add(`${keys[left]}\u0000${keys[right]}`);
      }
    }
  }
  return pairs.size;
}

function sharedLongNgrams(text: string, language: 'zh' | 'en'): Set<string> {
  if (language === 'zh') {
    const points = Array.from(normalizeCorpusFragment(text).replace(/[\p{P}\p{S}\s]/gu, ''));
    return sequenceNgrams(points, SHARED_LONG_NGRAM_SIZE.zh, '');
  }
  const words = englishWords(text);
  return sequenceNgrams(words, SHARED_LONG_NGRAM_SIZE.en, ' ');
}

function englishWords(text: string): string[] {
  return (
    text
      .normalize('NFKC')
      .toLocaleLowerCase('en-US')
      .match(/[a-z][a-z'-]*/gu) ?? []
  );
}

function sequenceNgrams(sequence: readonly string[], size: number, separator: string): Set<string> {
  const result = new Set<string>();
  for (let index = 0; index <= sequence.length - size; index++) {
    result.add(sequence.slice(index, index + size).join(separator));
  }
  return result;
}

function countNearTargetPairs(targets: string[]): number {
  const shingles = targets.map((text) => buildShingles(text, 8));
  let count = 0;
  for (let left = 0; left < shingles.length; left++) {
    for (let right = left + 1; right < shingles.length; right++) {
      if (jaccard(shingles[left]!, shingles[right]!) >= 0.8) count++;
    }
  }
  return count;
}

function buildShingles(text: string, size: number): Set<string> {
  const points = Array.from(text);
  const result = new Set<string>();
  for (let index = 0; index <= points.length - size; index++) {
    result.add(points.slice(index, index + size).join(''));
  }
  return result;
}

function jaccard(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 || right.size === 0) return 0;
  let intersection = 0;
  for (const item of left) if (right.has(item)) intersection++;
  return intersection / (left.size + right.size - intersection);
}

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right, 'en'))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}
