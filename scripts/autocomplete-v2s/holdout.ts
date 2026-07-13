import { canonicalSha256, normalizeForComparison } from './common';

export const V2S_HOLDOUT_SCHEMA = 'jotluck.autocomplete.v2s-holdout.v1';

export type V2SLanguage = 'zh' | 'en';
export type V2SNoteCategory =
  | 'field-observation'
  | 'maintenance-log'
  | 'meeting-note'
  | 'reading-note'
  | 'household-plan';
export type V2SHoldoutClassification =
  | 'cold-validation-v2s-v1'
  | 'cold-final-v2s-v1'
  | 'workspace-validation-v2s-v1'
  | 'workspace-final-v2s-v1';

export interface V2SSupportDocument {
  id: string;
  path: string;
  language: V2SLanguage;
  text: string;
  patternIds: string[];
}

export interface V2SCheckpoint {
  id: string;
  cursorOffset: number;
  expectedBehavior: 'complete' | 'silence';
  acceptableSuffixes: string[];
  patternId?: string;
  supportDocumentIds?: string[];
}

export interface V2STargetDocument {
  id: string;
  path: string;
  language: V2SLanguage;
  category: V2SNoteCategory;
  /** Independently assigned layout identity; no identity may exceed 10%. */
  structureId: string;
  text: string;
  workspaceSupportDocumentIds?: string[];
  checkpoints: V2SCheckpoint[];
}

export interface V2SHoldout {
  schema: typeof V2S_HOLDOUT_SCHEMA;
  schemaVersion: 1;
  datasetId: string;
  frozenAt: string;
  classification: V2SHoldoutClassification;
  authorship: 'independently-reviewed-manual';
  releaseEvidence: true;
  description: string;
  supportDocuments: V2SSupportDocument[];
  targets: V2STargetDocument[];
}

export interface V2SHoldoutPolicy {
  targets?: number;
  checkpoints?: number;
  complete?: number;
  silence?: number;
  checkpointsPerTarget?: number;
  targetsPerLanguage?: number;
  checkpointsPerLanguage?: number;
  completePerLanguage?: number;
  silencePerLanguage?: number;
  targetsPerCategory?: number;
  checkpointsPerCategory?: number;
  completePerCategory?: number;
  silencePerCategory?: number;
  maximumNearReferenceRatio?: number;
  maximumStructureRatio?: number;
}

export interface V2SHoldoutAudit {
  datasetSha256: string;
  targets: number;
  checkpoints: number;
  complete: number;
  silence: number;
  references: number;
  nearReferencePairs: number;
  maximumStructureRatio: number;
  languageCheckpoints: Record<V2SLanguage, number>;
  categoryCheckpoints: Record<V2SNoteCategory, number>;
  supportContinuationOverlaps: number;
  supportDocumentNearDuplicates: number;
  targetSupportNearDuplicates: number;
}

const DEFAULT_POLICY: Required<V2SHoldoutPolicy> = {
  targets: 50,
  checkpoints: 200,
  complete: 150,
  silence: 50,
  checkpointsPerTarget: 4,
  targetsPerLanguage: 25,
  checkpointsPerLanguage: 100,
  completePerLanguage: 75,
  silencePerLanguage: 25,
  targetsPerCategory: 10,
  checkpointsPerCategory: 40,
  completePerCategory: 30,
  silencePerCategory: 10,
  maximumNearReferenceRatio: 0.03,
  maximumStructureRatio: 0.1,
};

const CATEGORIES: readonly V2SNoteCategory[] = [
  'field-observation',
  'maintenance-log',
  'meeting-note',
  'reading-note',
  'household-plan',
];

export function validateV2SHoldout(
  holdout: V2SHoldout,
  policy: V2SHoldoutPolicy = {},
): V2SHoldoutAudit {
  const expected = { ...DEFAULT_POLICY, ...policy };
  if (
    holdout.schema !== V2S_HOLDOUT_SCHEMA ||
    holdout.schemaVersion !== 1 ||
    holdout.releaseEvidence !== true ||
    holdout.authorship !== 'independently-reviewed-manual' ||
    !isClassification(holdout.classification)
  ) {
    throw new Error('Public V2S holdout identity is invalid.');
  }
  if (
    !holdout.datasetId ||
    !holdout.description ||
    !Number.isFinite(Date.parse(holdout.frozenAt)) ||
    new Date(holdout.frozenAt).toISOString() !== holdout.frozenAt
  ) {
    throw new Error('Public V2S holdout metadata is incomplete.');
  }
  if (holdout.targets.length !== expected.targets) {
    throw new Error(`Public V2S holdout requires ${expected.targets} target documents.`);
  }

  const workspace = holdout.classification.startsWith('workspace-');
  if (workspace !== holdout.supportDocuments.length > 0) {
    throw new Error('Cold/workspace support-document boundary is invalid.');
  }

  const paths = new Set<string>();
  const supportById = new Map<string, V2SSupportDocument>();
  const supportByPattern = new Map<string, Set<string>>();
  for (const support of holdout.supportDocuments) {
    validateIdentity(support.id, 'support id');
    validateRelativePath(support.path);
    if (supportById.has(support.id) || paths.has(support.path) || !support.text.trim()) {
      throw new Error(`Duplicate or empty support document: ${support.id}.`);
    }
    if (
      support.patternIds.length === 0 ||
      new Set(support.patternIds).size !== support.patternIds.length
    ) {
      throw new Error(`Support ${support.id} requires unique pattern identities.`);
    }
    for (const patternId of support.patternIds) {
      validateIdentity(patternId, 'pattern id');
      const ids = supportByPattern.get(patternId) ?? new Set<string>();
      ids.add(support.id);
      supportByPattern.set(patternId, ids);
    }
    paths.add(support.path);
    supportById.set(support.id, support);
  }

  const targetIds = new Set<string>();
  const checkpointIds = new Set<string>();
  const structureCounts = new Map<string, number>();
  const languageTargets = emptyLanguageCounts();
  const languageCheckpoints = emptyLanguageCounts();
  const languageComplete = emptyLanguageCounts();
  const languageSilence = emptyLanguageCounts();
  const categoryTargets = emptyCategoryCounts();
  const categoryCheckpoints = emptyCategoryCounts();
  const categoryComplete = emptyCategoryCounts();
  const categorySilence = emptyCategoryCounts();
  const references: Array<{ id: string; owner: string; text: string }> = [];
  const normalizedReferences = new Set<string>();
  const targetDocuments: Array<{ id: string; text: string }> = [];
  let checkpoints = 0;
  let complete = 0;
  let silence = 0;

  for (const target of holdout.targets) {
    validateIdentity(target.id, 'target id');
    validateIdentity(target.structureId, 'structure id');
    validateRelativePath(target.path);
    if (
      targetIds.has(target.id) ||
      supportById.has(target.id) ||
      paths.has(target.path) ||
      !target.text.trim()
    ) {
      throw new Error(`Duplicate or empty target document: ${target.id}.`);
    }
    if (!CATEGORIES.includes(target.category)) throw new Error('Unknown holdout category.');
    targetIds.add(target.id);
    paths.add(target.path);
    targetDocuments.push({ id: `target:${target.id}`, text: target.text });
    languageTargets[target.language]++;
    categoryTargets[target.category]++;
    structureCounts.set(target.structureId, (structureCounts.get(target.structureId) ?? 0) + 1);
    if (target.checkpoints.length !== expected.checkpointsPerTarget) {
      throw new Error(`Target ${target.id} requires ${expected.checkpointsPerTarget} checkpoints.`);
    }

    const targetSupportIds = new Set(target.workspaceSupportDocumentIds ?? []);
    if (workspace && targetSupportIds.size < 2) {
      throw new Error(`Workspace target ${target.id} requires at least two supports.`);
    }
    if (!workspace && targetSupportIds.size > 0) {
      throw new Error(`Cold target ${target.id} cannot reference support documents.`);
    }
    for (const supportId of targetSupportIds) {
      const support = supportById.get(supportId);
      if (!support || support.language !== target.language) {
        throw new Error(`Target ${target.id} has an invalid support binding.`);
      }
    }

    for (const checkpoint of target.checkpoints) {
      validateIdentity(checkpoint.id, 'checkpoint id');
      if (checkpointIds.has(checkpoint.id))
        throw new Error(`Duplicate checkpoint ${checkpoint.id}.`);
      checkpointIds.add(checkpoint.id);
      validateCursor(target.text, checkpoint.cursorOffset, checkpoint.id);
      checkpoints++;
      languageCheckpoints[target.language]++;
      categoryCheckpoints[target.category]++;

      if (checkpoint.expectedBehavior === 'silence') {
        silence++;
        languageSilence[target.language]++;
        categorySilence[target.category]++;
        if (
          checkpoint.acceptableSuffixes.length > 0 ||
          checkpoint.patternId ||
          (checkpoint.supportDocumentIds?.length ?? 0) > 0
        ) {
          throw new Error(`Silence checkpoint ${checkpoint.id} contains completion evidence.`);
        }
        continue;
      }

      complete++;
      languageComplete[target.language]++;
      categoryComplete[target.category]++;
      if (checkpoint.acceptableSuffixes.length < 3 || checkpoint.acceptableSuffixes.length > 5) {
        throw new Error(`Completion checkpoint ${checkpoint.id} requires 3-5 references.`);
      }
      const actual = normalizeContinuation(target.text.slice(checkpoint.cursorOffset));
      const local = new Set<string>();
      let matchesFrozenTarget = false;
      for (const suffix of checkpoint.acceptableSuffixes) {
        if (!isMeaningfulCompletion(suffix, target.language)) {
          throw new Error(`Checkpoint ${checkpoint.id} contains a low-information reference.`);
        }
        const normalized = normalizeContinuation(suffix);
        const identity = comparable(normalized, target.language);
        if (local.has(identity) || normalizedReferences.has(`${target.language}:${identity}`)) {
          throw new Error(`Holdout repeats an exact continuation: ${checkpoint.id}.`);
        }
        local.add(identity);
        normalizedReferences.add(`${target.language}:${identity}`);
        matchesFrozenTarget ||= comparable(actual, target.language).startsWith(identity);
        references.push({
          id: `reference:${references.length}`,
          owner: checkpoint.id,
          text: normalized,
        });
      }
      if (!matchesFrozenTarget) {
        throw new Error(`Checkpoint ${checkpoint.id} has no reference matching its target text.`);
      }

      if (workspace) {
        if (!checkpoint.patternId) throw new Error(`Checkpoint ${checkpoint.id} lacks patternId.`);
        validateIdentity(checkpoint.patternId, 'pattern id');
        const bound = new Set(checkpoint.supportDocumentIds ?? []);
        if (bound.size < 2 || (supportByPattern.get(checkpoint.patternId)?.size ?? 0) < 2) {
          throw new Error(`Checkpoint ${checkpoint.id} lacks two independent pattern supports.`);
        }
        for (const supportId of bound) {
          const support = supportById.get(supportId);
          if (
            !support ||
            support.language !== target.language ||
            !targetSupportIds.has(supportId) ||
            !support.patternIds.includes(checkpoint.patternId)
          ) {
            throw new Error(`Checkpoint ${checkpoint.id} has an invalid pattern support.`);
          }
        }
      } else if (checkpoint.patternId || (checkpoint.supportDocumentIds?.length ?? 0) > 0) {
        throw new Error(`Cold checkpoint ${checkpoint.id} cannot bind workspace evidence.`);
      }
    }
  }

  assertCount(checkpoints, expected.checkpoints, 'checkpoint');
  assertCount(complete, expected.complete, 'complete');
  assertCount(silence, expected.silence, 'silence');
  for (const language of ['zh', 'en'] as const) {
    assertCount(languageTargets[language], expected.targetsPerLanguage, `${language} target`);
    assertCount(
      languageCheckpoints[language],
      expected.checkpointsPerLanguage,
      `${language} checkpoint`,
    );
    assertCount(languageComplete[language], expected.completePerLanguage, `${language} complete`);
    assertCount(languageSilence[language], expected.silencePerLanguage, `${language} silence`);
  }
  for (const category of CATEGORIES) {
    assertCount(categoryTargets[category], expected.targetsPerCategory, `${category} target`);
    assertCount(
      categoryCheckpoints[category],
      expected.checkpointsPerCategory,
      `${category} checkpoint`,
    );
    assertCount(categoryComplete[category], expected.completePerCategory, `${category} complete`);
    assertCount(categorySilence[category], expected.silencePerCategory, `${category} silence`);
  }

  const maximumStructureRatio = Math.max(...structureCounts.values(), 0) / holdout.targets.length;
  if (maximumStructureRatio > expected.maximumStructureRatio) {
    throw new Error('Public V2S holdout structure dominance exceeds 10%.');
  }
  const nearReferencePairs = countNearPairs(
    references.map(({ id, text }) => ({ id, text })),
    0.9,
    (left, right) =>
      referencesById(references, left).owner !== referencesById(references, right).owner,
  );
  if (nearReferencePairs / Math.max(1, references.length) > expected.maximumNearReferenceRatio) {
    throw new Error('Public V2S holdout near-reference ratio exceeds its limit.');
  }

  const supports = holdout.supportDocuments.map((item) => ({
    id: `support:${item.id}`,
    text: item.text,
  }));
  const supportIds = new Set(supports.map(({ id }) => id));
  const supportContinuationOverlaps = countNearPairs(
    [...supports, ...references.map(({ id, text }) => ({ id, text }))],
    0.85,
    (left, right) => supportIds.has(left) !== supportIds.has(right),
  );
  if (supportContinuationOverlaps > 0) {
    throw new Error('Workspace support overlaps a frozen continuation.');
  }
  const supportDocumentNearDuplicates = countNearPairs(supports, 0.9);
  if (supportDocumentNearDuplicates > 0) {
    throw new Error('Workspace support documents are near-duplicates.');
  }
  const targetIdsForAudit = new Set(targetDocuments.map(({ id }) => id));
  const targetSupportNearDuplicates = countNearPairs(
    [...targetDocuments, ...supports],
    0.9,
    (left, right) => targetIdsForAudit.has(left) !== targetIdsForAudit.has(right),
  );
  if (targetSupportNearDuplicates > 0) {
    throw new Error('Workspace targets and support documents are near-duplicates.');
  }

  return {
    datasetSha256: canonicalSha256(holdout),
    targets: holdout.targets.length,
    checkpoints,
    complete,
    silence,
    references: references.length,
    nearReferencePairs,
    maximumStructureRatio,
    languageCheckpoints,
    categoryCheckpoints,
    supportContinuationOverlaps,
    supportDocumentNearDuplicates,
    targetSupportNearDuplicates,
  };
}

export function isV2SCandidateUsable(
  candidate: string,
  checkpoint: V2SCheckpoint,
  language: V2SLanguage,
): boolean {
  if (checkpoint.expectedBehavior !== 'complete' || !isMeaningfulCompletion(candidate, language)) {
    return false;
  }
  if (isMixedV2SCandidate(candidate, language) || /[\r\n]/u.test(candidate)) return false;
  const normalized = normalizeContinuation(candidate);
  if (!normalized || /[ \t]$/u.test(normalized)) return false;
  return checkpoint.acceptableSuffixes.some((reference) => {
    const candidateText = comparable(normalized, language);
    const referenceText = comparable(normalizeContinuation(reference), language);
    if (!referenceText.startsWith(candidateText)) return false;
    if (language === 'en') {
      const last = candidateText.at(-1) ?? '';
      const next = referenceText[candidateText.length] ?? '';
      if (/[A-Za-z'’-]/u.test(last) && /[A-Za-z'’-]/u.test(next)) return false;
    }
    return true;
  });
}

export function isMixedV2SCandidate(candidate: string, language: V2SLanguage): boolean {
  return language === 'zh' ? /[A-Za-z]/u.test(candidate) : /[\u3400-\u9fff]/u.test(candidate);
}

export function normalizeContinuation(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/\r\n?/gu, '\n')
    .replace(/[ \t]+/gu, ' ')
    .replace(/[ \t]+$/gu, '');
}

function isMeaningfulCompletion(value: string, language: V2SLanguage): boolean {
  const normalized = normalizeContinuation(value);
  if (language === 'zh') return (normalized.match(/[\u3400-\u9fff]/gu) ?? []).length >= 3;
  const words = normalized.match(/[A-Za-z][A-Za-z'’-]*/gu) ?? [];
  return words.length >= 1 && words.join('').replace(/[^A-Za-z]/gu, '').length >= 5;
}

function comparable(value: string, language: V2SLanguage): string {
  return language === 'en' ? value.toLocaleLowerCase('en-US') : value;
}

function validateCursor(text: string, offset: number, id: string): void {
  if (!Number.isInteger(offset) || offset < 0 || offset > text.length) {
    throw new Error(`Checkpoint ${id} cursor is outside its target.`);
  }
  if (offset > 0 && offset < text.length) {
    const previous = text.charCodeAt(offset - 1);
    const next = text.charCodeAt(offset);
    if (previous >= 0xd800 && previous <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) {
      throw new Error(`Checkpoint ${id} cursor splits a Unicode code point.`);
    }
  }
}

function validateIdentity(value: string, label: string): void {
  if (!/^[A-Za-z0-9._:-]{3,160}$/u.test(value)) throw new Error(`Invalid ${label}: ${value}.`);
}

function validateRelativePath(value: string): void {
  const normalized = value.replace(/\\/gu, '/');
  if (
    !normalized ||
    normalized.startsWith('/') ||
    /^[A-Za-z]:/u.test(normalized) ||
    normalized.split('/').includes('..')
  ) {
    throw new Error(`Holdout path must be repository-relative: ${value}.`);
  }
}

function isClassification(value: string): value is V2SHoldoutClassification {
  return [
    'cold-validation-v2s-v1',
    'cold-final-v2s-v1',
    'workspace-validation-v2s-v1',
    'workspace-final-v2s-v1',
  ].includes(value);
}

function countNearPairs(
  documents: readonly { id: string; text: string }[],
  threshold: number,
  include: (left: string, right: string) => boolean = () => true,
): number {
  let pairs = 0;
  for (let left = 0; left < documents.length; left++) {
    for (let right = left + 1; right < documents.length; right++) {
      const a = documents[left]!;
      const b = documents[right]!;
      if (include(a.id, b.id) && similarity(a.text, b.text) >= threshold) pairs++;
    }
  }
  return pairs;
}

function similarity(left: string, right: string): number {
  const a = shingles(normalizeForComparison(left));
  const b = shingles(normalizeForComparison(right));
  if (a.size === 0 || b.size === 0)
    return normalizeForComparison(left) === normalizeForComparison(right) ? 1 : 0;
  let intersection = 0;
  for (const item of a) if (b.has(item)) intersection++;
  return intersection / (a.size + b.size - intersection);
}

function shingles(text: string): Set<string> {
  const points = Array.from(text);
  const values = new Set<string>();
  for (let index = 0; index <= points.length - 3; index++)
    values.add(points.slice(index, index + 3).join(''));
  return values;
}

function referencesById(
  references: readonly { id: string; owner: string; text: string }[],
  id: string,
): { id: string; owner: string; text: string } {
  const value = references.find((item) => item.id === id);
  if (!value) throw new Error(`Unknown reference ${id}.`);
  return value;
}

function assertCount(actual: number, expected: number, label: string): void {
  if (actual !== expected)
    throw new Error(`Public V2S ${label} count must be ${expected}, got ${actual}.`);
}

function emptyLanguageCounts(): Record<V2SLanguage, number> {
  return { zh: 0, en: 0 };
}

function emptyCategoryCounts(): Record<V2SNoteCategory, number> {
  return {
    'field-observation': 0,
    'maintenance-log': 0,
    'meeting-note': 0,
    'reading-note': 0,
    'household-plan': 0,
  };
}
