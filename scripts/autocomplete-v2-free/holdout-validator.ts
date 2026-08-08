import { createHash } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import * as path from 'node:path';

import { normalizeV2FreeTextIdentity } from '../corpus/v2-free-tools/common';
import type { V2FreeSha256 } from './contract';

export const V2_FREE_HOLDOUT_DESCRIPTOR_SCHEMA_V1 =
  'jotluck.autocomplete.v2-free-holdout-descriptor.v1';
export const V2_FREE_HOLDOUT_DESCRIPTOR_SCHEMA =
  'jotluck.autocomplete.v2-free-holdout-descriptor.v2';
export const V2_FREE_HOLDOUT_SCHEMA = 'jotluck.autocomplete.v2-free-holdout.v1';
export const V2_FREE_NOTE_CATEGORIES = Object.freeze([
  'field-observation',
  'maintenance-log',
  'meeting-note',
  'reading-note',
  'household-plan',
] as const);

export type V2FreeLanguage = 'zh' | 'en';
export type V2FreeNoteCategory = (typeof V2_FREE_NOTE_CATEGORIES)[number];
export type V2FreeHoldoutClassification =
  | 'cold-validation-v1'
  | 'workspace-validation-v1'
  | 'cold-final-v1'
  | 'workspace-final-v1';

export interface V2FreeHoldoutSummary {
  targetDocuments: number;
  supportDocuments: number;
  checkpoints: number;
  completeCheckpoints: number;
  silenceCheckpoints: number;
  languageCheckpoints: Record<V2FreeLanguage, number>;
  categoryCheckpoints: Record<V2FreeNoteCategory, number>;
}

interface V2FreeHoldoutDescriptorCommon {
  datasetId: string;
  frozenAt: string;
  classification: V2FreeHoldoutClassification;
  content: {
    bytes: number;
    sha256: V2FreeSha256;
  };
  summary: V2FreeHoldoutSummary;
  sealed: boolean;
}

export interface V2FreeHoldoutDescriptorV1 extends V2FreeHoldoutDescriptorCommon {
  schema: typeof V2_FREE_HOLDOUT_DESCRIPTOR_SCHEMA_V1;
  schemaVersion: 1;
  humanReviewed: true;
  reviewerIdentitySha256: V2FreeSha256;
}

export type V2FreeHoldoutReview =
  | {
      kind: 'human';
      reviewedAt: string;
      reviewArtifactSha256: V2FreeSha256;
      reviewerIdentitySha256: V2FreeSha256;
    }
  | {
      kind: 'independent-model';
      reviewedAt: string;
      reviewArtifactSha256: V2FreeSha256;
    };

export interface V2FreeHoldoutDescriptorV2 extends V2FreeHoldoutDescriptorCommon {
  schema: typeof V2_FREE_HOLDOUT_DESCRIPTOR_SCHEMA;
  schemaVersion: 2;
  review: V2FreeHoldoutReview;
  formalReleaseEvidence: boolean;
}

export type V2FreeHoldoutDescriptor = V2FreeHoldoutDescriptorV1 | V2FreeHoldoutDescriptorV2;

export interface V2FreeHoldoutSupportDocument {
  id: string;
  path: string;
  language: V2FreeLanguage;
  text: string;
  patternIds: string[];
}

export interface V2FreeHoldoutCheckpoint {
  id: string;
  cursorOffset: number;
  expectedBehavior: 'complete' | 'silence';
  acceptableSuffixes: string[];
  patternId?: string;
  supportDocumentIds?: string[];
  blockType?: 'paragraph' | 'list' | 'quote';
}

export interface V2FreeHoldoutTarget {
  id: string;
  path: string;
  language: V2FreeLanguage;
  category: V2FreeNoteCategory;
  text: string;
  headingTrail?: string[];
  workspaceSupportDocumentIds?: string[];
  checkpoints: V2FreeHoldoutCheckpoint[];
}

export interface V2FreeHoldoutContent {
  schema: typeof V2_FREE_HOLDOUT_SCHEMA;
  schemaVersion: 1;
  datasetId: string;
  classification: V2FreeHoldoutClassification;
  supportDocuments: V2FreeHoldoutSupportDocument[];
  targets: V2FreeHoldoutTarget[];
}

export interface V2FreeHoldoutValidationPolicy {
  targetDocuments?: number;
  checkpoints?: number;
  completeCheckpoints?: number;
  silenceCheckpoints?: number;
  checkpointsPerTarget?: number;
  languageCheckpoints?: number;
  categoryCheckpoints?: number;
}

const DEFAULT_POLICY: Required<V2FreeHoldoutValidationPolicy> = {
  targetDocuments: 50,
  checkpoints: 200,
  completeCheckpoints: 150,
  silenceCheckpoints: 50,
  checkpointsPerTarget: 4,
  languageCheckpoints: 100,
  categoryCheckpoints: 40,
};

export function validateV2FreeHoldoutDescriptor(
  descriptor: V2FreeHoldoutDescriptor,
  policy: V2FreeHoldoutValidationPolicy = {},
): V2FreeHoldoutDescriptor {
  const expected = { ...DEFAULT_POLICY, ...policy };
  if (
    !isClassification(descriptor.classification) ||
    !isSafeIdentifier(descriptor.datasetId) ||
    !isCanonicalIso(descriptor.frozenAt) ||
    !Number.isSafeInteger(descriptor.content.bytes) ||
    descriptor.content.bytes < 1 ||
    !isSha256(descriptor.content.sha256)
  ) {
    throw new Error('V2 free holdout descriptor identity is invalid.');
  }
  if (
    descriptor.schema === V2_FREE_HOLDOUT_DESCRIPTOR_SCHEMA_V1 &&
    descriptor.schemaVersion === 1
  ) {
    if (descriptor.humanReviewed !== true || !isSha256(descriptor.reviewerIdentitySha256)) {
      throw new Error('V2 free holdout v1 descriptor review identity is invalid.');
    }
  } else if (
    descriptor.schema === V2_FREE_HOLDOUT_DESCRIPTOR_SCHEMA &&
    descriptor.schemaVersion === 2
  ) {
    validateDescriptorReview(descriptor);
  } else {
    throw new Error('V2 free holdout descriptor schema is invalid.');
  }
  const final = descriptor.classification.endsWith('-final-v1');
  if (descriptor.sealed !== final) {
    throw new Error('V2 free final descriptors must be sealed; validation descriptors must not.');
  }
  validateSummary(descriptor.summary, expected);
  return descriptor;
}

export async function loadV2FreeHoldoutContent(options: {
  workspaceRoot: string;
  descriptor: V2FreeHoldoutDescriptor;
  contentPath: string;
  allowFinalRead?: boolean;
  policy?: V2FreeHoldoutValidationPolicy;
}): Promise<V2FreeHoldoutContent> {
  const descriptor = validateV2FreeHoldoutDescriptor(options.descriptor, options.policy);
  if (descriptor.classification.endsWith('-final-v1') && options.allowFinalRead !== true) {
    throw new Error('Final holdout content is sealed and cannot be read before a pair claim.');
  }
  const root = await realpath(path.resolve(options.workspaceRoot));
  const contentPath = await resolveExistingInside(root, options.contentPath);
  const bytes = await readFile(contentPath);
  if (
    bytes.byteLength !== descriptor.content.bytes ||
    sha256(bytes) !== descriptor.content.sha256
  ) {
    throw new Error('V2 free holdout content identity does not match its frozen descriptor.');
  }
  const value = parseJson(bytes);
  const audit = validateV2FreeHoldoutContent(value, options.policy);
  if (
    value.datasetId !== descriptor.datasetId ||
    value.classification !== descriptor.classification ||
    canonicalJson(audit) !== canonicalJson(descriptor.summary)
  ) {
    throw new Error('V2 free holdout content does not match its frozen descriptor summary.');
  }
  return value;
}

export function validateV2FreeHoldoutContent(
  holdout: V2FreeHoldoutContent,
  policy: V2FreeHoldoutValidationPolicy = {},
): V2FreeHoldoutSummary {
  const expected = { ...DEFAULT_POLICY, ...policy };
  if (
    holdout.schema !== V2_FREE_HOLDOUT_SCHEMA ||
    holdout.schemaVersion !== 1 ||
    !isClassification(holdout.classification) ||
    !isSafeIdentifier(holdout.datasetId) ||
    !Array.isArray(holdout.targets) ||
    !Array.isArray(holdout.supportDocuments)
  ) {
    throw new Error('V2 free holdout content identity is invalid.');
  }
  if (holdout.targets.length !== expected.targetDocuments) {
    throw new Error(`V2 free holdout must contain ${expected.targetDocuments} targets.`);
  }
  const workspace = holdout.classification.startsWith('workspace-');
  if (workspace ? holdout.supportDocuments.length < 2 : holdout.supportDocuments.length !== 0) {
    throw new Error('V2 free holdout support-document boundary is invalid.');
  }

  const allIds = new Set<string>();
  const allPaths = new Set<string>();
  const supportById = new Map<string, V2FreeHoldoutSupportDocument>();
  const normalizedSupportById = new Map<string, string>();
  const patternSupport = new Map<string, Set<string>>();
  const normalizedSupportTexts = new Set<string>();
  for (const support of holdout.supportDocuments) {
    assertUniqueId(support.id, allIds, 'support');
    assertRelativePath(support.path, 'support');
    if (allPaths.has(support.path)) throw new Error('V2 free holdout paths must be unique.');
    allPaths.add(support.path);
    assertLanguage(support.language);
    assertSafeHoldoutProse(support.text, `support ${support.id}`);
    assertLanguageContent(support.text, support.language, `support ${support.id}`);
    const normalized = normalizeText(support.text);
    if (!normalized || normalizedSupportTexts.has(normalized)) {
      throw new Error('Workspace support documents must contain independent text.');
    }
    normalizedSupportTexts.add(normalized);
    normalizedSupportById.set(support.id, normalized);
    const patterns = new Set(support.patternIds);
    if (patterns.size === 0 || patterns.size !== support.patternIds.length) {
      throw new Error(`Workspace support has invalid pattern identities: ${support.id}.`);
    }
    for (const patternId of patterns) {
      assertPatternId(patternId);
      const supporters = patternSupport.get(patternId) ?? new Set<string>();
      supporters.add(support.id);
      patternSupport.set(patternId, supporters);
    }
    supportById.set(support.id, support);
  }

  const languageCheckpoints: Record<V2FreeLanguage, number> = { zh: 0, en: 0 };
  const categoryCheckpoints = emptyCategoryCounts();
  const normalizedTargetTexts = new Set<string>();
  const supportTargetOwners = new Map<string, string>();
  let checkpoints = 0;
  let completeCheckpoints = 0;
  let silenceCheckpoints = 0;
  for (const target of holdout.targets) {
    assertUniqueId(target.id, allIds, 'target');
    assertRelativePath(target.path, 'target');
    if (allPaths.has(target.path)) throw new Error('Support and target paths must be disjoint.');
    allPaths.add(target.path);
    assertLanguage(target.language);
    assertCategory(target.category);
    assertSafeHoldoutProse(target.text, `target ${target.id}`);
    assertLanguageContent(target.text, target.language, `target ${target.id}`);
    if (!target.text || target.checkpoints.length !== expected.checkpointsPerTarget) {
      throw new Error(`Target ${target.id} has an invalid checkpoint count or empty text.`);
    }
    const normalizedTarget = normalizeText(target.text);
    if (normalizedTargetTexts.has(normalizedTarget)) {
      throw new Error(`Target ${target.id} duplicates another target document.`);
    }
    normalizedTargetTexts.add(normalizedTarget);
    if ((target.headingTrail?.length ?? 0) > 6) {
      throw new Error(`Target ${target.id} has too many headings.`);
    }
    const targetSupportIds = new Set(target.workspaceSupportDocumentIds ?? []);
    if (workspace && (targetSupportIds.size < 2 || targetSupportIds.size > 3)) {
      throw new Error(`Workspace target ${target.id} requires two or three supports.`);
    }
    if (!workspace && targetSupportIds.size > 0) {
      throw new Error(`Cold target ${target.id} cannot bind support documents.`);
    }
    for (const supportId of targetSupportIds) {
      const support = supportById.get(supportId);
      if (!support || support.language !== target.language) {
        throw new Error(`Target ${target.id} has an invalid support binding.`);
      }
      if (normalizeText(support.text) === normalizeText(target.text)) {
        throw new Error(`Target ${target.id} duplicates a support document.`);
      }
      const owner = supportTargetOwners.get(supportId);
      if (owner !== undefined && owner !== target.id) {
        throw new Error(`Workspace support ${supportId} is reused across targets.`);
      }
      supportTargetOwners.set(supportId, target.id);
    }

    let targetCompleteCheckpoints = 0;
    let targetSilenceCheckpoints = 0;
    for (const checkpoint of target.checkpoints) {
      assertUniqueId(checkpoint.id, allIds, 'checkpoint');
      validateCursor(target.text, checkpoint.cursorOffset, checkpoint.id);
      checkpoints++;
      languageCheckpoints[target.language]++;
      categoryCheckpoints[target.category]++;
      if (checkpoint.expectedBehavior === 'silence') {
        silenceCheckpoints++;
        targetSilenceCheckpoints++;
        if (
          checkpoint.acceptableSuffixes.length !== 0 ||
          checkpoint.patternId !== undefined ||
          (checkpoint.supportDocumentIds?.length ?? 0) > 0
        ) {
          throw new Error(`Silence checkpoint ${checkpoint.id} contains completion evidence.`);
        }
        continue;
      }
      if (checkpoint.expectedBehavior !== 'complete') {
        throw new Error(`Checkpoint ${checkpoint.id} has an invalid behavior.`);
      }
      completeCheckpoints++;
      targetCompleteCheckpoints++;
      if (checkpoint.acceptableSuffixes.length < 1 || checkpoint.acceptableSuffixes.length > 3) {
        throw new Error(`Completion checkpoint ${checkpoint.id} requires 1-3 references.`);
      }
      const references = new Set<string>();
      const actualSuffix = normalizeContinuation(target.text.slice(checkpoint.cursorOffset));
      let matchesFrozenText = false;
      for (const suffix of checkpoint.acceptableSuffixes) {
        assertSafeHoldoutProse(suffix, `checkpoint ${checkpoint.id} continuation`);
        assertLanguageContent(suffix, target.language, `checkpoint ${checkpoint.id} continuation`);
        assertMeaningfulContinuation(suffix, target.language, checkpoint.id);
        const normalized = normalizeContinuation(suffix);
        if (references.has(normalized)) {
          throw new Error(`Checkpoint ${checkpoint.id} repeats a reference.`);
        }
        if (
          [...references].some(
            (reference) => reference.startsWith(normalized) || normalized.startsWith(reference),
          )
        ) {
          throw new Error(`Checkpoint ${checkpoint.id} contains nested reference prefixes.`);
        }
        references.add(normalized);
        if (actualSuffix.startsWith(normalized)) matchesFrozenText = true;
      }
      if (!matchesFrozenText) {
        throw new Error(`Checkpoint ${checkpoint.id} has no reference matching target text.`);
      }
      if (workspace) {
        assertPatternId(checkpoint.patternId);
        const supportIds = new Set(checkpoint.supportDocumentIds ?? []);
        if (
          supportIds.size < 2 ||
          supportIds.size > 3 ||
          (patternSupport.get(checkpoint.patternId)?.size ?? 0) < 2
        ) {
          throw new Error(
            `Checkpoint ${checkpoint.id} requires two or three independent pattern supports.`,
          );
        }
        for (const supportId of supportIds) {
          const support = supportById.get(supportId);
          if (
            !support ||
            !targetSupportIds.has(supportId) ||
            support.language !== target.language ||
            !support.patternIds.includes(checkpoint.patternId)
          ) {
            throw new Error(`Checkpoint ${checkpoint.id} has an invalid support reference.`);
          }
        }
        for (const reference of references) {
          if (
            ![...supportIds].some((supportId) =>
              normalizedSupportById.get(supportId)?.includes(reference),
            )
          ) {
            throw new Error(
              `Checkpoint ${checkpoint.id} reference cannot be recovered from its bound supports.`,
            );
          }
        }
      } else if (
        checkpoint.patternId !== undefined ||
        (checkpoint.supportDocumentIds?.length ?? 0) > 0
      ) {
        throw new Error(`Cold checkpoint ${checkpoint.id} cannot bind workspace support.`);
      }
    }
    if (targetCompleteCheckpoints !== 3 || targetSilenceCheckpoints !== 1) {
      throw new Error(
        `Target ${target.id} must contain three complete and one silence checkpoint.`,
      );
    }
  }
  const summary: V2FreeHoldoutSummary = {
    targetDocuments: holdout.targets.length,
    supportDocuments: holdout.supportDocuments.length,
    checkpoints,
    completeCheckpoints,
    silenceCheckpoints,
    languageCheckpoints,
    categoryCheckpoints,
  };
  validateSummary(summary, expected);
  return summary;
}

function validateSummary(
  summary: V2FreeHoldoutSummary,
  expected: Required<V2FreeHoldoutValidationPolicy>,
): void {
  if (
    summary.targetDocuments !== expected.targetDocuments ||
    summary.checkpoints !== expected.checkpoints ||
    summary.completeCheckpoints !== expected.completeCheckpoints ||
    summary.silenceCheckpoints !== expected.silenceCheckpoints ||
    !Number.isSafeInteger(summary.supportDocuments) ||
    summary.supportDocuments < 0
  ) {
    throw new Error('V2 free holdout summary totals are invalid.');
  }
  for (const language of ['zh', 'en'] as const) {
    if (summary.languageCheckpoints[language] !== expected.languageCheckpoints) {
      throw new Error(`V2 free ${language} checkpoint balance is invalid.`);
    }
  }
  for (const category of V2_FREE_NOTE_CATEGORIES) {
    if (summary.categoryCheckpoints[category] !== expected.categoryCheckpoints) {
      throw new Error(`V2 free ${category} checkpoint balance is invalid.`);
    }
  }
}

function parseJson(bytes: Buffer): V2FreeHoldoutContent {
  try {
    return JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(bytes),
    ) as V2FreeHoldoutContent;
  } catch (error) {
    throw new Error(`V2 free holdout content is invalid UTF-8 JSON: ${String(error)}`);
  }
}

async function resolveExistingInside(root: string, value: string): Promise<string> {
  if (!value || path.isAbsolute(value)) throw new Error('Holdout content path must be relative.');
  const normalized = value.replaceAll('\\', '/');
  if (normalized.split('/').some((segment) => segment === '..' || segment === '')) {
    throw new Error('Holdout content path contains traversal.');
  }
  const resolved = await realpath(path.join(root, normalized));
  const relative = path.relative(root, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Holdout content path escaped the workspace.');
  }
  return resolved;
}

function validateCursor(text: string, offset: number, checkpointId: string): void {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > text.length) {
    throw new Error(`Checkpoint ${checkpointId} cursor offset is invalid.`);
  }
  if (
    offset > 0 &&
    offset < text.length &&
    /[\uD800-\uDBFF]/u.test(text[offset - 1] ?? '') &&
    /[\uDC00-\uDFFF]/u.test(text[offset] ?? '')
  ) {
    throw new Error(`Checkpoint ${checkpointId} splits a UTF-16 surrogate pair.`);
  }
}

function assertMeaningfulContinuation(
  value: string,
  language: V2FreeLanguage,
  checkpointId: string,
): void {
  if (value.includes('\n') || value.includes('\r')) {
    throw new Error(`Checkpoint ${checkpointId} has a multiline continuation.`);
  }
  const codePointLength = Array.from(value).length;
  const maximumCodePoints = language === 'zh' ? 8 : 12;
  if (codePointLength < 1 || codePointLength > maximumCodePoints) {
    throw new Error(
      `Checkpoint ${checkpointId} continuation exceeds the visible host length boundary.`,
    );
  }
  if (language === 'zh') {
    if ((value.match(/[\p{Script=Han}]/gu)?.length ?? 0) < 3) {
      throw new Error(`Checkpoint ${checkpointId} has a short Chinese continuation.`);
    }
  } else if ((value.match(/[A-Za-z]/gu)?.length ?? 0) < 5 || !/^[\s\p{P}]*[A-Za-z]+/u.test(value)) {
    throw new Error(`Checkpoint ${checkpointId} has an invalid English continuation.`);
  }
}

function assertSafeHoldoutProse(value: string, label: string): void {
  if (
    !value ||
    /(^|\n)\s*(?:```|~~~)/u.test(value) ||
    /^---\s*(?:\r?\n|$)/u.test(value) ||
    value.includes('`') ||
    /-----BEGIN [A-Z ]+PRIVATE KEY-----/u.test(value) ||
    /\bAKIA[A-Z0-9]{16}\b/u.test(value) ||
    /\b(?:api[_-]?key|client[_-]?secret|password|passwd|access[_-]?token|refresh[_-]?token)\s*[:=]\s*\S+/iu.test(
      value,
    )
  ) {
    throw new Error(`V2 free holdout ${label} contains code, frontmatter, or sensitive text.`);
  }
}

function assertLanguageContent(value: string, language: V2FreeLanguage, label: string): void {
  if (language === 'zh') {
    if ((value.match(/[\p{Script=Han}]/gu)?.length ?? 0) < 3) {
      throw new Error(`V2 free holdout ${label} does not contain Chinese prose.`);
    }
  } else if ((value.match(/[A-Za-z]+/gu)?.length ?? 0) < 1 || /[\p{Script=Han}]/u.test(value)) {
    throw new Error(`V2 free holdout ${label} does not contain English-only prose.`);
  }
}

function assertUniqueId(value: string, ids: Set<string>, label: string): void {
  if (!isSafeIdentifier(value) || ids.has(value)) throw new Error(`Duplicate/invalid ${label} id.`);
  ids.add(value);
}

function assertRelativePath(value: string, label: string): void {
  const normalized = value.replaceAll('\\', '/');
  if (
    !normalized ||
    path.isAbsolute(value) ||
    normalized.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')
  ) {
    throw new Error(`V2 free ${label} path is invalid.`);
  }
}

function assertPatternId(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^pattern-[a-z0-9][a-z0-9-]{0,63}$/u.test(value)) {
    throw new Error('V2 free holdout pattern id is invalid.');
  }
}

function assertLanguage(value: unknown): asserts value is V2FreeLanguage {
  if (value !== 'zh' && value !== 'en') throw new Error('V2 free holdout language is invalid.');
}

function assertCategory(value: unknown): asserts value is V2FreeNoteCategory {
  if (!V2_FREE_NOTE_CATEGORIES.includes(value as V2FreeNoteCategory)) {
    throw new Error('V2 free holdout category is invalid.');
  }
}

function emptyCategoryCounts(): Record<V2FreeNoteCategory, number> {
  return Object.fromEntries(V2_FREE_NOTE_CATEGORIES.map((category) => [category, 0])) as Record<
    V2FreeNoteCategory,
    number
  >;
}

function normalizeText(value: string): string {
  return normalizeV2FreeTextIdentity(value);
}

function normalizeContinuation(value: string): string {
  return normalizeV2FreeTextIdentity(value);
}

function validateDescriptorReview(descriptor: V2FreeHoldoutDescriptorV2): void {
  if (
    ['humanReviewed', 'reviewerIdentitySha256', 'reviewedAt', 'reviewArtifactSha256'].some(
      (field) => Object.hasOwn(descriptor, field),
    )
  ) {
    throw new Error('V2 free holdout v2 descriptor contains top-level legacy review fields.');
  }
  const review = descriptor.review;
  if (
    !review ||
    !isCanonicalIso(review.reviewedAt) ||
    !isSha256(review.reviewArtifactSha256) ||
    typeof descriptor.formalReleaseEvidence !== 'boolean'
  ) {
    throw new Error('V2 free holdout v2 descriptor review identity is invalid.');
  }
  if (review.kind === 'human') {
    if (!isSha256(review.reviewerIdentitySha256)) {
      throw new Error('V2 free human review requires a reviewer identity.');
    }
    return;
  }
  if (
    review.kind !== 'independent-model' ||
    'reviewerIdentitySha256' in review ||
    descriptor.formalReleaseEvidence !== false
  ) {
    throw new Error(
      'V2 free independent-model review cannot impersonate a human or become formal release evidence.',
    );
  }
}

function isClassification(value: unknown): value is V2FreeHoldoutClassification {
  return (
    value === 'cold-validation-v1' ||
    value === 'workspace-validation-v1' ||
    value === 'cold-final-v1' ||
    value === 'workspace-final-v1'
  );
}

function isSafeIdentifier(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z0-9][a-z0-9._-]{0,127}$/u.test(value);
}

function isCanonicalIso(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString() === value;
}

function isSha256(value: unknown): value is V2FreeSha256 {
  return typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
}

function sha256(bytes: Buffer): V2FreeSha256 {
  return createHash('sha256').update(bytes).digest('hex') as V2FreeSha256;
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
