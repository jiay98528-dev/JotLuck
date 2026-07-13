import { canonicalSha256, normalizeForComparison } from './common';
import { findNearDuplicatePairs, type V2RNoteCategory } from './corpus-governance';
import {
  isMeaningfulPhrase,
  isMixedLanguageCandidate,
  type V2RLanguage,
} from './phrase-extraction';
import { normalizeRepositoryRelativePath } from './workspace';

export const V2R_HOLDOUT_SCHEMA = 'jotluck.autocomplete.multi-reference-holdout.v3';

export type V2RHoldoutClassification =
  | 'cold-validation-v3'
  | 'cold-final-v3'
  | 'workspace-validation-v3'
  | 'workspace-final-v3';

export interface V2RHoldoutSupportDocument {
  id: string;
  path: string;
  language: V2RLanguage;
  text: string;
  /** Abstract patterns supported by this independently written document. */
  patternIds: string[];
}

export interface V2RHoldoutCheckpoint {
  id: string;
  cursorOffset: number;
  expectedBehavior: 'complete' | 'silence';
  acceptableSuffixes: string[];
  patternId?: string;
  supportDocumentIds?: string[];
}

export interface V2RHoldoutTarget {
  id: string;
  path: string;
  language: V2RLanguage;
  category: V2RNoteCategory;
  text: string;
  workspaceSupportDocumentIds?: string[];
  checkpoints: V2RHoldoutCheckpoint[];
}

export interface V2RHoldoutV3 {
  schema: typeof V2R_HOLDOUT_SCHEMA;
  schemaVersion: 3;
  datasetId: string;
  frozenAt: string;
  classification: V2RHoldoutClassification;
  releaseEvidence: true;
  description: string;
  supportDocuments: V2RHoldoutSupportDocument[];
  targets: V2RHoldoutTarget[];
}

export interface V2RHoldoutAudit {
  datasetSha256: string;
  targetDocuments: number;
  checkpoints: number;
  completeCheckpoints: number;
  silenceCheckpoints: number;
  languageCheckpoints: Record<V2RLanguage, number>;
  categoryCheckpoints: Record<V2RNoteCategory, number>;
  acceptableContinuations: number;
  exactContinuationDuplicates: number;
  nearContinuationPairs: number;
  supportContinuationOverlaps: number;
  supportContinuationNearOverlaps: number;
  supportDocumentNearDuplicatePairs: number;
  targetSupportNearDuplicatePairs: number;
}

export interface HoldoutValidationPolicy {
  expectedTargetDocuments?: number;
  expectedCheckpoints?: number;
  expectedCompleteCheckpoints?: number;
  expectedSilenceCheckpoints?: number;
  expectedLanguageCheckpoints?: number;
  expectedCategoryCheckpoints?: number;
  expectedCheckpointsPerTarget?: number;
  expectedLanguageTargets?: number;
  expectedCategoryTargets?: number;
  expectedLanguageCompleteCheckpoints?: number;
  expectedLanguageSilenceCheckpoints?: number;
  expectedCategoryCompleteCheckpoints?: number;
  expectedCategorySilenceCheckpoints?: number;
  maximumNearContinuationRatio?: number;
}

const DEFAULT_POLICY: Required<HoldoutValidationPolicy> = {
  expectedTargetDocuments: 50,
  expectedCheckpoints: 200,
  expectedCompleteCheckpoints: 150,
  expectedSilenceCheckpoints: 50,
  expectedLanguageCheckpoints: 100,
  expectedCategoryCheckpoints: 40,
  expectedCheckpointsPerTarget: 4,
  expectedLanguageTargets: 25,
  expectedCategoryTargets: 10,
  expectedLanguageCompleteCheckpoints: 75,
  expectedLanguageSilenceCheckpoints: 25,
  expectedCategoryCompleteCheckpoints: 30,
  expectedCategorySilenceCheckpoints: 10,
  maximumNearContinuationRatio: 0.03,
};

export function validateV2RHoldoutV3(
  holdout: V2RHoldoutV3,
  policy: HoldoutValidationPolicy = {},
): V2RHoldoutAudit {
  const expected = { ...DEFAULT_POLICY, ...policy };
  if (
    holdout.schema !== V2R_HOLDOUT_SCHEMA ||
    holdout.schemaVersion !== 3 ||
    holdout.releaseEvidence !== true ||
    !isClassification(holdout.classification)
  ) {
    throw new Error('V2R holdout v3 identity is invalid.');
  }
  if (
    !Number.isFinite(Date.parse(holdout.frozenAt)) ||
    new Date(holdout.frozenAt).toISOString() !== holdout.frozenAt
  ) {
    throw new Error('V2R holdout frozenAt must be a canonical ISO timestamp.');
  }
  if (!holdout.datasetId || !holdout.description)
    throw new Error('V2R holdout metadata is incomplete.');
  if (holdout.targets.length !== expected.expectedTargetDocuments) {
    throw new Error(`V2R holdout must contain ${expected.expectedTargetDocuments} targets.`);
  }

  const workspaceConditioned = holdout.classification.startsWith('workspace-');
  if (workspaceConditioned && holdout.supportDocuments.length < 2) {
    throw new Error('Workspace holdout requires independent support documents.');
  }
  if (!workspaceConditioned && holdout.supportDocuments.length !== 0) {
    throw new Error('Cold holdout must not include workspace support documents.');
  }

  const supportById = new Map<string, V2RHoldoutSupportDocument>();
  const supportByPattern = new Map<string, Set<string>>();
  const supportTextIdentities = new Set<string>();
  const allPaths = new Set<string>();
  for (const support of holdout.supportDocuments) {
    if (!support.id || supportById.has(support.id))
      throw new Error(`Duplicate support id: ${support.id}.`);
    normalizeRepositoryRelativePath(support.path, `${support.id}.path`);
    if (allPaths.has(support.path)) throw new Error(`Duplicate holdout path: ${support.path}.`);
    const supportIdentity = normalizeForComparison(support.text);
    if (!supportIdentity || supportTextIdentities.has(supportIdentity)) {
      throw new Error('Workspace support documents must have independent text.');
    }
    supportTextIdentities.add(supportIdentity);
    if (
      !Array.isArray(support.patternIds) ||
      support.patternIds.length === 0 ||
      new Set(support.patternIds).size !== support.patternIds.length ||
      support.patternIds.some((patternId) => !isPatternId(patternId))
    ) {
      throw new Error(`Workspace support ${support.id} has invalid pattern identities.`);
    }
    for (const patternId of support.patternIds) {
      const supporters = supportByPattern.get(patternId) ?? new Set<string>();
      supporters.add(support.id);
      supportByPattern.set(patternId, supporters);
    }
    allPaths.add(support.path);
    supportById.set(support.id, support);
  }

  const targetIds = new Set<string>();
  const checkpointIds = new Set<string>();
  const normalizedContinuations = new Set<string>();
  const continuationDocuments: Array<{ id: string; text: string }> = [];
  const continuationOwner = new Map<string, string>();
  const targetDocuments: Array<{ id: string; text: string }> = [];
  const languageCheckpoints: Record<V2RLanguage, number> = { zh: 0, en: 0 };
  const categoryCheckpoints = emptyCategoryCounts();
  const languageTargets: Record<V2RLanguage, number> = { zh: 0, en: 0 };
  const categoryTargets = emptyCategoryCounts();
  const languageComplete: Record<V2RLanguage, number> = { zh: 0, en: 0 };
  const languageSilence: Record<V2RLanguage, number> = { zh: 0, en: 0 };
  const categoryComplete = emptyCategoryCounts();
  const categorySilence = emptyCategoryCounts();
  let checkpoints = 0;
  let completeCheckpoints = 0;
  let silenceCheckpoints = 0;
  let acceptableContinuations = 0;
  let exactContinuationDuplicates = 0;
  let supportContinuationOverlaps = 0;

  for (const target of holdout.targets) {
    if (!target.id || targetIds.has(target.id) || supportById.has(target.id)) {
      throw new Error(`Duplicate target id: ${target.id}.`);
    }
    targetIds.add(target.id);
    targetDocuments.push({ id: `target:${target.id}`, text: target.text });
    languageTargets[target.language]++;
    categoryTargets[target.category]++;
    if (target.checkpoints.length !== expected.expectedCheckpointsPerTarget) {
      throw new Error(
        `Target ${target.id} must contain ${expected.expectedCheckpointsPerTarget} checkpoints.`,
      );
    }
    normalizeRepositoryRelativePath(target.path, `${target.id}.path`);
    if (allPaths.has(target.path))
      throw new Error(`Support and target paths must be disjoint: ${target.path}.`);
    allPaths.add(target.path);
    const targetSupportIds = new Set(target.workspaceSupportDocumentIds ?? []);
    if (workspaceConditioned) {
      if (targetSupportIds.size < 2) {
        throw new Error(`Workspace target ${target.id} requires at least two support documents.`);
      }
      for (const supportId of targetSupportIds) {
        const support = supportById.get(supportId);
        if (!support)
          throw new Error(`Workspace target ${target.id} references unknown support ${supportId}.`);
        if (support.language !== target.language) {
          throw new Error(`Workspace target ${target.id} support language is inconsistent.`);
        }
        if (normalizeForComparison(support.text) === normalizeForComparison(target.text)) {
          throw new Error(`Workspace target ${target.id} copies a support document.`);
        }
      }
    } else if (targetSupportIds.size > 0) {
      throw new Error(`Cold target ${target.id} must not bind workspace support.`);
    }
    for (const checkpoint of target.checkpoints) {
      checkpoints++;
      languageCheckpoints[target.language]++;
      categoryCheckpoints[target.category]++;
      if (!checkpoint.id || checkpointIds.has(checkpoint.id)) {
        throw new Error(`Duplicate checkpoint id: ${checkpoint.id}.`);
      }
      checkpointIds.add(checkpoint.id);
      validateCursor(target.text, checkpoint.cursorOffset, checkpoint.id);
      if (checkpoint.expectedBehavior === 'silence') {
        silenceCheckpoints++;
        languageSilence[target.language]++;
        categorySilence[target.category]++;
        if (checkpoint.acceptableSuffixes.length !== 0) {
          throw new Error(`Silence checkpoint ${checkpoint.id} must not have continuations.`);
        }
        if ((checkpoint.supportDocumentIds?.length ?? 0) > 0) {
          throw new Error(`Silence checkpoint ${checkpoint.id} must not bind support documents.`);
        }
        continue;
      }

      completeCheckpoints++;
      languageComplete[target.language]++;
      categoryComplete[target.category]++;
      if (checkpoint.acceptableSuffixes.length < 3 || checkpoint.acceptableSuffixes.length > 5) {
        throw new Error(`Completion checkpoint ${checkpoint.id} requires 3-5 references.`);
      }
      const local = new Set<string>();
      const actualSuffix = target.text.slice(checkpoint.cursorOffset);
      let hasObservedContinuation = false;
      for (const [index, suffix] of checkpoint.acceptableSuffixes.entries()) {
        if (!isMeaningfulPhrase(suffix, target.language)) {
          throw new Error(`Reference ${checkpoint.id}[${index}] is not a meaningful phrase.`);
        }
        const normalized = normalizeContinuation(suffix);
        if (local.has(normalized))
          throw new Error(`Checkpoint ${checkpoint.id} repeats a reference.`);
        local.add(normalized);
        if (normalizedContinuations.has(normalized)) exactContinuationDuplicates++;
        else normalizedContinuations.add(normalized);
        const continuationId = `continuation-${acceptableContinuations}`;
        continuationDocuments.push({ id: continuationId, text: normalized });
        continuationOwner.set(continuationId, checkpoint.id);
        acceptableContinuations++;
        if (normalizeContinuation(actualSuffix).startsWith(normalized))
          hasObservedContinuation = true;
        for (const support of supportById.values()) {
          if (normalizeForComparison(support.text).includes(normalizeForComparison(suffix))) {
            supportContinuationOverlaps++;
          }
        }
      }
      if (!hasObservedContinuation) {
        throw new Error(
          `Checkpoint ${checkpoint.id} has no reference matching its frozen target text.`,
        );
      }

      if (workspaceConditioned) {
        if (!checkpoint.patternId || !isPatternId(checkpoint.patternId))
          throw new Error(`Checkpoint ${checkpoint.id} is missing patternId.`);
        const supportIds = new Set(checkpoint.supportDocumentIds ?? []);
        if (supportIds.size < 2) {
          throw new Error(
            `Checkpoint ${checkpoint.id} requires two independent support documents.`,
          );
        }
        for (const supportId of supportIds) {
          const support = supportById.get(supportId);
          if (!support)
            throw new Error(`Checkpoint ${checkpoint.id} references unknown support ${supportId}.`);
          if (support.language !== target.language) {
            throw new Error(`Checkpoint ${checkpoint.id} support language is inconsistent.`);
          }
          if (!targetSupportIds.has(supportId)) {
            throw new Error(
              `Checkpoint ${checkpoint.id} support is outside its target support set.`,
            );
          }
          if (!support.patternIds.includes(checkpoint.patternId)) {
            throw new Error(
              `Checkpoint ${checkpoint.id} pattern is not declared by support ${supportId}.`,
            );
          }
        }
        if ((supportByPattern.get(checkpoint.patternId)?.size ?? 0) < 2) {
          throw new Error(`Checkpoint ${checkpoint.id} pattern lacks two independent supports.`);
        }
      } else if ((checkpoint.supportDocumentIds?.length ?? 0) > 0 || checkpoint.patternId) {
        throw new Error(`Cold checkpoint ${checkpoint.id} must not bind workspace support.`);
      }
    }
  }

  if (checkpoints !== expected.expectedCheckpoints) {
    throw new Error(`V2R holdout must contain ${expected.expectedCheckpoints} checkpoints.`);
  }
  if (
    completeCheckpoints !== expected.expectedCompleteCheckpoints ||
    silenceCheckpoints !== expected.expectedSilenceCheckpoints
  ) {
    throw new Error('V2R holdout complete/silence balance is invalid.');
  }
  for (const language of ['zh', 'en'] as const) {
    if (languageTargets[language] !== expected.expectedLanguageTargets) {
      throw new Error(`V2R holdout ${language} target balance is invalid.`);
    }
    if (languageCheckpoints[language] !== expected.expectedLanguageCheckpoints) {
      throw new Error(`V2R holdout ${language} checkpoint balance is invalid.`);
    }
    if (
      languageComplete[language] !== expected.expectedLanguageCompleteCheckpoints ||
      languageSilence[language] !== expected.expectedLanguageSilenceCheckpoints
    ) {
      throw new Error(`V2R holdout ${language} complete/silence composition is invalid.`);
    }
  }
  for (const category of Object.keys(categoryCheckpoints) as V2RNoteCategory[]) {
    if (categoryTargets[category] !== expected.expectedCategoryTargets) {
      throw new Error(`V2R holdout ${category} target balance is invalid.`);
    }
    if (categoryCheckpoints[category] !== expected.expectedCategoryCheckpoints) {
      throw new Error(`V2R holdout ${category} balance is invalid.`);
    }
    if (
      categoryComplete[category] !== expected.expectedCategoryCompleteCheckpoints ||
      categorySilence[category] !== expected.expectedCategorySilenceCheckpoints
    ) {
      throw new Error(`V2R holdout ${category} complete/silence composition is invalid.`);
    }
  }
  if (exactContinuationDuplicates > 0) {
    throw new Error('V2R holdout contains exact continuation duplicates.');
  }
  if (supportContinuationOverlaps > 0) {
    throw new Error('V2R workspace support contains a frozen continuation.');
  }
  const nearContinuationPairs = findNearDuplicatePairs(continuationDocuments, 0.9).filter(
    ([left, right]) => continuationOwner.get(left) !== continuationOwner.get(right),
  ).length;
  if (
    nearContinuationPairs / Math.max(1, acceptableContinuations) >
    expected.maximumNearContinuationRatio
  ) {
    throw new Error('V2R holdout near-continuation ratio exceeds its limit.');
  }
  const supportFragments = holdout.supportDocuments.flatMap((support, supportIndex) =>
    support.text
      .split(/[\r\n。！？!?]+/u)
      .map((text) => text.trim())
      .filter((text) => text.length >= 5)
      .map((text, fragmentIndex) => ({
        id: `support-${supportIndex}-${fragmentIndex}`,
        text,
      })),
  );
  const supportIds = new Set(supportFragments.map((fragment) => fragment.id));
  const supportContinuationNearOverlaps = findNearDuplicatePairs(
    [...continuationDocuments, ...supportFragments],
    0.85,
  ).filter(([left, right]) => supportIds.has(left) !== supportIds.has(right)).length;
  if (supportContinuationNearOverlaps > 0) {
    throw new Error('V2R workspace support is near-duplicate with a frozen continuation.');
  }
  const supportDocuments = holdout.supportDocuments.map((support) => ({
    id: `support:${support.id}`,
    text: support.text,
  }));
  const supportDocumentNearDuplicatePairs = findNearDuplicatePairs(supportDocuments, 0.9).length;
  if (supportDocumentNearDuplicatePairs > 0) {
    throw new Error('V2R workspace support documents are near-duplicates of each other.');
  }
  const supportIdentityIds = new Set(supportDocuments.map(({ id }) => id));
  const targetSupportNearDuplicatePairs = findNearDuplicatePairs(
    [...targetDocuments, ...supportDocuments],
    0.9,
  ).filter(
    ([left, right]) => supportIdentityIds.has(left) !== supportIdentityIds.has(right),
  ).length;
  if (targetSupportNearDuplicatePairs > 0) {
    throw new Error('V2R workspace target and support documents are near-duplicates.');
  }

  return {
    datasetSha256: canonicalSha256(holdout),
    targetDocuments: holdout.targets.length,
    checkpoints,
    completeCheckpoints,
    silenceCheckpoints,
    languageCheckpoints,
    categoryCheckpoints,
    acceptableContinuations,
    exactContinuationDuplicates,
    nearContinuationPairs,
    supportContinuationOverlaps,
    supportContinuationNearOverlaps,
    supportDocumentNearDuplicatePairs,
    targetSupportNearDuplicatePairs,
  };
}

export function isCandidateUsable(
  candidate: string,
  checkpoint: V2RHoldoutCheckpoint,
  language: V2RLanguage,
): boolean {
  if (checkpoint.expectedBehavior !== 'complete' || !isMeaningfulPhrase(candidate, language)) {
    return false;
  }
  if (isMixedLanguageCandidate(candidate, language) || /[\r\n]/u.test(candidate)) return false;
  const normalizedCandidate = normalizeContinuation(candidate);
  if (!normalizedCandidate || /[ \t]$/u.test(normalizedCandidate)) return false;
  return checkpoint.acceptableSuffixes.some((reference) => {
    const normalizedReference = normalizeContinuation(reference);
    const comparableCandidate =
      language === 'en' ? normalizedCandidate.toLocaleLowerCase('en-US') : normalizedCandidate;
    const comparableReference =
      language === 'en' ? normalizedReference.toLocaleLowerCase('en-US') : normalizedReference;
    if (!comparableReference.startsWith(comparableCandidate)) return false;
    if (language === 'en') {
      const last = comparableCandidate.at(-1) ?? '';
      const next = comparableReference[comparableCandidate.length] ?? '';
      if (/[A-Za-z'’-]/u.test(last) && /[A-Za-z'’-]/u.test(next)) return false;
    }
    return true;
  });
}

export function normalizeContinuation(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/\r\n?/gu, '\n')
    .replace(/[ \t]+/gu, ' ')
    .replace(/[ \t]+$/gu, '');
}

function isClassification(value: string): value is V2RHoldoutClassification {
  return [
    'cold-validation-v3',
    'cold-final-v3',
    'workspace-validation-v3',
    'workspace-final-v3',
  ].includes(value);
}

function isPatternId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9._:-]{3,160}$/u.test(value);
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

function emptyCategoryCounts(): Record<V2RNoteCategory, number> {
  return {
    'field-observation': 0,
    'maintenance-log': 0,
    'meeting-note': 0,
    'reading-note': 0,
    'household-plan': 0,
  };
}
