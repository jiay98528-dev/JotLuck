import { mkdir, readFile, stat } from 'node:fs/promises';
import * as path from 'node:path';

import {
  validateV2FreeHoldoutContent,
  type V2FreeHoldoutClassification,
  type V2FreeHoldoutContent,
  type V2FreeHoldoutDescriptor,
} from '../../autocomplete-v2-free/holdout-validator';
import {
  canonicalSha256,
  decodeUtf8,
  isSha256,
  publishStagedDirectory,
  resolveCorpusOutput,
  resolveWorkspaceInput,
  safeRemoveStagingDirectory,
  sha256,
  writeExclusiveBytes,
  writeExclusiveJson,
  type Sha256,
} from './common';
import { fingerprintDocuments, type HoldoutFingerprintInventory } from './fingerprints';

const CLASSIFICATIONS = Object.freeze([
  'cold-validation-v1',
  'workspace-validation-v1',
  'cold-final-v1',
  'workspace-final-v1',
] as const);

export interface HoldoutFreezeInput {
  classification: V2FreeHoldoutClassification;
  datasetId: string;
  contentPath: string;
  reviewerIdentitySha256: Sha256;
  frozenAt: string;
}

export interface HoldoutSetFreezePlan {
  schema: 'jotluck.autocomplete.v2-free-holdout-freeze-plan.v1';
  schemaVersion: 1;
  outputRoot: string;
  suites: HoldoutFreezeInput[];
}

export interface FrozenHoldoutSuite {
  classification: V2FreeHoldoutClassification;
  descriptor: V2FreeHoldoutDescriptor;
  descriptorPath: string;
  contentPath: string;
  fingerprintPath: string;
  fingerprintInventorySha256: Sha256;
}

export interface HoldoutAuthoringTemplate {
  schema: 'jotluck.autocomplete.v2-free-holdout-authoring-template.v1';
  schemaVersion: 1;
  draftOnly: true;
  classification: V2FreeHoldoutClassification;
  instructions: string[];
  targets: Array<{
    id: string;
    language: 'zh' | 'en';
    category: string;
    checkpointIds: string[];
  }>;
}

export interface HoldoutContentDraft {
  schema: 'jotluck.autocomplete.v2-free-holdout-content-draft.v1';
  schemaVersion: 1;
  draftOnly: true;
  classification: V2FreeHoldoutClassification;
  datasetId: string;
  instructions: string[];
  supportDocuments: Array<{
    id: string;
    path: string;
    language: 'zh' | 'en';
    text: string;
    patternIds: string[];
  }>;
  targets: Array<{
    id: string;
    path: string;
    language: 'zh' | 'en';
    category: string;
    text: string;
    workspaceSupportDocumentIds?: string[];
    checkpoints: Array<{
      id: string;
      cursorOffset: number;
      expectedBehavior: 'complete' | 'silence';
      acceptableSuffixes: string[];
      patternId?: string;
      supportDocumentIds?: string[];
    }>;
  }>;
}

export async function authorFourHoldoutDrafts(options: {
  workspaceRoot: string;
  outputRoot: string;
}): Promise<Array<{ classification: V2FreeHoldoutClassification; path: string }>> {
  const outputRoot = await resolveCorpusOutput(options.workspaceRoot, options.outputRoot);
  if (await exists(outputRoot)) throw new Error('Holdout draft output root already exists.');
  const staging = path.join(
    path.dirname(outputRoot),
    `.staging-${path.basename(outputRoot)}-${process.pid}-${Date.now()}`,
  );
  await mkdir(path.dirname(outputRoot), { recursive: true });
  await mkdir(staging, { recursive: false });
  try {
    const results = [];
    for (const classification of CLASSIFICATIONS) {
      const draft = createHoldoutContentDraft(classification);
      const filename = `${classification}.draft.json`;
      await writeExclusiveJson(path.join(staging, filename), draft);
      results.push({
        classification,
        path: `${options.outputRoot}/${filename}`.replaceAll('\\', '/'),
      });
    }
    await publishStagedDirectory(staging, outputRoot);
    return results;
  } catch (error) {
    if (await exists(staging)) await safeRemoveStagingDirectory(staging);
    throw error;
  }
}

export function createHoldoutContentDraft(
  classification: V2FreeHoldoutClassification,
): HoldoutContentDraft {
  assertClassification(classification);
  const workspace = classification.startsWith('workspace-');
  const categories = [
    'field-observation',
    'maintenance-log',
    'meeting-note',
    'reading-note',
    'household-plan',
  ];
  const supportDocuments = workspace
    ? (['zh', 'en'] as const).flatMap((language) =>
        [1, 2].map((number) => ({
          id: `draft-support-${language}-${number}`,
          path: `support/draft-${language}-${number}.md`,
          language,
          text: `[DRAFT: replace with independent ${language} support prose ${number}]`,
          patternIds: [`draft-pattern-${language}`],
        })),
      )
    : [];
  return {
    schema: 'jotluck.autocomplete.v2-free-holdout-content-draft.v1',
    schemaVersion: 1,
    draftOnly: true,
    classification,
    datasetId: `${classification}-draft`,
    instructions: [
      'Replace every bracketed placeholder with independently authored prose.',
      'Move each cursorOffset to a reviewed writing opportunity without splitting UTF-16.',
      'Replace all complete suffix references; silence checkpoints must remain empty.',
      'Remove draftOnly by converting to the frozen content schema only after human review.',
    ],
    supportDocuments,
    targets: Array.from({ length: 50 }, (_, index) => {
      const language = index % 2 === 0 ? ('zh' as const) : ('en' as const);
      const supportIds = [`draft-support-${language}-1`, `draft-support-${language}-2`];
      const references =
        language === 'zh'
          ? ['[草稿续写示例甲]', '[草稿续写示例乙]', '[草稿续写示例丙]']
          : [
              '[draft continuation alpha]',
              '[draft continuation beta]',
              '[draft continuation gamma]',
            ];
      return {
        id: `draft-target-${index + 1}`,
        path: `targets/${classification}-draft-${index + 1}.md`,
        language,
        category: categories[index % categories.length]!,
        text: `[DRAFT: replace target ${index + 1} with independent ${language} prose]`,
        ...(workspace ? { workspaceSupportDocumentIds: supportIds } : {}),
        checkpoints: [0, 1, 2]
          .map((checkpoint) => ({
            id: `draft-checkpoint-${index + 1}-${checkpoint + 1}`,
            cursorOffset: 0,
            expectedBehavior: 'complete' as const,
            acceptableSuffixes: references,
            ...(workspace
              ? {
                  patternId: `draft-pattern-${language}`,
                  supportDocumentIds: supportIds,
                }
              : {}),
          }))
          .concat({
            id: `draft-checkpoint-${index + 1}-4`,
            cursorOffset: 0,
            expectedBehavior: 'silence' as const,
            acceptableSuffixes: [],
          }),
      };
    }),
  };
}

export function createHoldoutAuthoringTemplate(
  classification: V2FreeHoldoutClassification,
): HoldoutAuthoringTemplate {
  assertClassification(classification);
  const categories = [
    'field-observation',
    'maintenance-log',
    'meeting-note',
    'reading-note',
    'household-plan',
  ];
  return {
    schema: 'jotluck.autocomplete.v2-free-holdout-authoring-template.v1',
    schemaVersion: 1,
    draftOnly: true,
    classification,
    instructions: [
      'Replace every draft target with independently authored prose.',
      'Each target needs four checkpoints: three complete and one silence.',
      'Each complete checkpoint needs 3-5 human-reviewed acceptable suffixes.',
      'Workspace checkpoints must cite two independent support documents with the same pattern id.',
      'This skeleton is never valid evaluation content and cannot be frozen unchanged.',
    ],
    targets: Array.from({ length: 50 }, (_, index) => {
      const number = String(index + 1).padStart(3, '0');
      return {
        id: `${classification}-target-${number}`,
        language: index % 2 === 0 ? 'zh' : 'en',
        category: categories[index % categories.length]!,
        checkpointIds: Array.from(
          { length: 4 },
          (_, checkpoint) => `${classification}-checkpoint-${number}-${checkpoint + 1}`,
        ),
      };
    }),
  };
}

export async function freezeV2FreeHoldoutSet(options: {
  workspaceRoot: string;
  plan: HoldoutSetFreezePlan;
}): Promise<FrozenHoldoutSuite[]> {
  validatePlan(options.plan);
  const outputRoot = await resolveCorpusOutput(options.workspaceRoot, options.plan.outputRoot);
  if (await exists(outputRoot)) throw new Error('Holdout freeze output root already exists.');

  const prepared = [];
  for (const suite of options.plan.suites) {
    const inputPath = await resolveWorkspaceInput(options.workspaceRoot, suite.contentPath);
    const bytes = await readFile(inputPath);
    const content = JSON.parse(
      decodeUtf8(bytes, `${suite.classification} holdout`),
    ) as V2FreeHoldoutContent;
    if (content.classification !== suite.classification || content.datasetId !== suite.datasetId) {
      throw new Error(`Holdout input identity mismatch: ${suite.classification}.`);
    }
    const summary = validateV2FreeHoldoutContent(content);
    const descriptorWithoutContent = {
      schema: 'jotluck.autocomplete.v2-free-holdout-descriptor.v1' as const,
      schemaVersion: 1 as const,
      datasetId: suite.datasetId,
      frozenAt: canonicalIso(suite.frozenAt),
      classification: suite.classification,
      content: { bytes: bytes.byteLength, sha256: sha256(bytes) },
      summary,
      humanReviewed: true as const,
      reviewerIdentitySha256: suite.reviewerIdentitySha256,
      sealed: suite.classification.endsWith('-final-v1'),
    };
    const descriptor = descriptorWithoutContent satisfies V2FreeHoldoutDescriptor;
    const fingerprint = fingerprintDocuments({
      datasetId: suite.datasetId,
      classification: suite.classification,
      contentSha256: descriptor.content.sha256,
      documents: [
        ...content.supportDocuments.map((item) => ({ id: item.id, text: item.text })),
        ...content.targets.map((item) => ({ id: item.id, text: item.text })),
      ],
    });
    prepared.push({ suite, bytes, descriptor, fingerprint });
  }

  const staging = path.join(
    path.dirname(outputRoot),
    `.staging-${path.basename(outputRoot)}-${process.pid}-${Date.now()}`,
  );
  await mkdir(path.dirname(outputRoot), { recursive: true });
  await mkdir(staging, { recursive: false });
  try {
    const results: FrozenHoldoutSuite[] = [];
    for (const item of prepared) {
      const suiteRoot = path.join(staging, item.suite.classification);
      const contentPath = path.join(suiteRoot, 'content.json');
      const descriptorPath = path.join(suiteRoot, 'descriptor.json');
      const fingerprintPath = path.join(suiteRoot, 'fingerprints.json');
      await writeExclusiveBytes(contentPath, item.bytes);
      await writeExclusiveJson(descriptorPath, item.descriptor);
      await writeExclusiveJson(fingerprintPath, item.fingerprint);
      results.push({
        classification: item.suite.classification,
        descriptor: item.descriptor,
        descriptorPath: `${options.plan.outputRoot}/${item.suite.classification}/descriptor.json`,
        contentPath: `${options.plan.outputRoot}/${item.suite.classification}/content.json`,
        fingerprintPath: `${options.plan.outputRoot}/${item.suite.classification}/fingerprints.json`,
        fingerprintInventorySha256: item.fingerprint.inventorySha256,
      });
    }
    await publishStagedDirectory(staging, outputRoot);
    return results;
  } catch (error) {
    if (await exists(staging)) await safeRemoveStagingDirectory(staging);
    throw error;
  }
}

export function verifyFrozenDescriptorFingerprintBinding(options: {
  descriptor: V2FreeHoldoutDescriptor;
  fingerprint: HoldoutFingerprintInventory;
}): void {
  if (
    options.descriptor.datasetId !== options.fingerprint.datasetId ||
    options.descriptor.classification !== options.fingerprint.classification ||
    options.descriptor.content.sha256 !== options.fingerprint.contentSha256
  ) {
    throw new Error('Holdout descriptor and fingerprint inventory are not bound.');
  }
}

function validatePlan(plan: HoldoutSetFreezePlan): void {
  if (
    plan.schema !== 'jotluck.autocomplete.v2-free-holdout-freeze-plan.v1' ||
    plan.schemaVersion !== 1 ||
    !Array.isArray(plan.suites) ||
    plan.suites.length !== CLASSIFICATIONS.length
  ) {
    throw new Error('Holdout freeze plan contract is invalid.');
  }
  const classifications = new Set<V2FreeHoldoutClassification>();
  const datasetIds = new Set<string>();
  for (const suite of plan.suites) {
    assertClassification(suite.classification);
    if (
      classifications.has(suite.classification) ||
      !suite.datasetId ||
      datasetIds.has(suite.datasetId) ||
      !isSha256(suite.reviewerIdentitySha256)
    ) {
      throw new Error('Holdout freeze suite identity is invalid.');
    }
    canonicalIso(suite.frozenAt);
    classifications.add(suite.classification);
    datasetIds.add(suite.datasetId);
  }
  if (CLASSIFICATIONS.some((item) => !classifications.has(item))) {
    throw new Error('Holdout freeze plan must contain all four suites exactly once.');
  }
}

function assertClassification(value: string): asserts value is V2FreeHoldoutClassification {
  if (!CLASSIFICATIONS.includes(value as V2FreeHoldoutClassification)) {
    throw new Error('Unknown V2 free holdout classification.');
  }
}

function canonicalIso(value: string): string {
  const date = new Date(value);
  if (!value || Number.isNaN(date.valueOf()) || date.toISOString() !== value) {
    throw new Error('Holdout freeze timestamp must be canonical UTC ISO.');
  }
  return value;
}

async function exists(value: string): Promise<boolean> {
  try {
    await stat(value);
    return true;
  } catch {
    return false;
  }
}

export function descriptorIdentitySha256(descriptor: V2FreeHoldoutDescriptor): Sha256 {
  return canonicalSha256(descriptor);
}
