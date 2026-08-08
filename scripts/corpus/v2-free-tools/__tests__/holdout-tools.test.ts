import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import type {
  V2FreeHoldoutClassification,
  V2FreeHoldoutContent,
  V2FreeNoteCategory,
} from '../../../autocomplete-v2-free/holdout-validator';
import {
  authorFourHoldoutDrafts,
  createHoldoutAuthoringTemplate,
  freezeV2FreeHoldoutSet,
  type HoldoutSetFreezePlan,
} from '../holdout-tools';

const roots: string[] = [];
const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const classifications: V2FreeHoldoutClassification[] = [
  'cold-validation-v1',
  'workspace-validation-v1',
  'cold-final-v1',
  'workspace-final-v1',
];
const categories: V2FreeNoteCategory[] = [
  'field-observation',
  'maintenance-log',
  'meeting-note',
  'reading-note',
  'household-plan',
];

afterEach(async () => {
  for (const root of roots.splice(0)) {
    if (!root.includes(`${path.sep}scripts${path.sep}corpus${path.sep}.tmp-`)) {
      throw new Error('Refusing to remove an unexpected test directory.');
    }
    await rm(root, { recursive: true, force: true });
  }
});

describe('V2 free holdout authoring and freeze tools', () => {
  it('authors four quota-correct content drafts that cannot be mistaken for frozen content', async () => {
    const root = await mkdtemp(path.join(workspaceRoot, 'scripts/corpus/.tmp-holdout-drafts-'));
    roots.push(root);
    const outputRoot = `${relative(root)}/drafts`;
    const authored = await authorFourHoldoutDrafts({ workspaceRoot, outputRoot });
    expect(authored).toHaveLength(4);
    for (const item of authored) {
      const draft = JSON.parse(await readFile(path.join(workspaceRoot, item.path), 'utf8')) as {
        draftOnly: boolean;
        targets: Array<{
          language: 'zh' | 'en';
          category: string;
          checkpoints: Array<{ expectedBehavior: string }>;
          workspaceSupportDocumentIds?: string[];
        }>;
      };
      expect(draft.draftOnly).toBe(true);
      expect(draft.targets).toHaveLength(50);
      expect(draft.targets.flatMap((target) => target.checkpoints)).toHaveLength(200);
      expect(
        draft.targets
          .filter((target) => target.language === 'zh')
          .flatMap((target) => target.checkpoints),
      ).toHaveLength(100);
      for (const category of categories) {
        expect(
          draft.targets
            .filter((target) => target.category === category)
            .flatMap((target) => target.checkpoints),
        ).toHaveLength(40);
      }
      expect(
        draft.targets
          .flatMap((target) => target.checkpoints)
          .filter((item) => item.expectedBehavior === 'complete'),
      ).toHaveLength(150);
      if (item.classification.startsWith('workspace-')) {
        expect(
          draft.targets.every((target) => target.workspaceSupportDocumentIds?.length === 2),
        ).toBe(true);
      }
    }
  });

  it('marks generated skeletons as drafts rather than evaluation content', () => {
    const template = createHoldoutAuthoringTemplate('cold-validation-v1');
    expect(template.draftOnly).toBe(true);
    expect(template.targets).toHaveLength(50);
    expect(template.targets.flatMap((target) => target.checkpointIds)).toHaveLength(200);
  });

  it('atomically freezes exactly four synthetic suites without making a final claim', async () => {
    const root = await mkdtemp(path.join(workspaceRoot, 'scripts/corpus/.tmp-holdout-'));
    roots.push(root);
    const suites = [];
    for (const classification of classifications) {
      const content = fixtureHoldout(classification);
      const contentPath = path.join(root, `${classification}.json`);
      await writeFile(contentPath, `${JSON.stringify(content)}\n`, 'utf8');
      suites.push({
        classification,
        datasetId: content.datasetId,
        contentPath: relative(contentPath),
        reviewerIdentitySha256: 'a'.repeat(64),
        frozenAt: '2026-08-08T00:00:00.000Z',
      });
    }
    const plan: HoldoutSetFreezePlan = {
      schema: 'jotluck.autocomplete.v2-free-holdout-freeze-plan.v1',
      schemaVersion: 1,
      outputRoot: `${relative(root)}/frozen`,
      suites,
    };

    const frozen = await freezeV2FreeHoldoutSet({ workspaceRoot, plan });

    expect(frozen).toHaveLength(4);
    for (const suite of frozen) {
      expect(suite.descriptor.sealed).toBe(suite.classification.endsWith('-final-v1'));
      expect(suite.descriptor.summary.checkpoints).toBe(200);
      expect(
        JSON.parse(await readFile(path.join(workspaceRoot, suite.fingerprintPath), 'utf8')),
      ).toMatchObject({ classification: suite.classification });
    }
    await expect(stat(path.join(root, 'frozen', 'final-claim.json'))).rejects.toThrow();
  });
});

function fixtureHoldout(classification: V2FreeHoldoutClassification): V2FreeHoldoutContent {
  const workspace = classification.startsWith('workspace-');
  const supportDocuments = workspace
    ? [
        support('support-zh-a', 'zh', '中文支持材料甲记录稳定流程与后续复核方式。'),
        support('support-zh-b', 'zh', '中文支持材料乙独立说明稳定流程如何用于日常记录。'),
        support(
          'support-en-a',
          'en',
          'English support A records the stable workflow and its review pattern.',
        ),
        support(
          'support-en-b',
          'en',
          'English support B independently explains the stable workflow pattern.',
        ),
      ]
    : [];
  const targets = Array.from({ length: 50 }, (_, index) => {
    const language = index % 2 === 0 ? ('zh' as const) : ('en' as const);
    const text =
      language === 'zh'
        ? `第${index + 1}份观察记录显示流程已经稳定运行，下一步需要继续核对结果。`
        : `Observation note ${index + 1} confirms the workflow is stable and the next review can begin.`;
    const references =
      language === 'zh'
        ? [`第${index + 1}份观察`, `第${index + 1}份观察记录`, `第${index + 1}份观察记录显示`]
        : [
            `Observation note ${index + 1}`,
            `Observation note ${index + 1} confirms`,
            `Observation note ${index + 1} confirms the workflow`,
          ];
    const supportIds =
      language === 'zh' ? ['support-zh-a', 'support-zh-b'] : ['support-en-a', 'support-en-b'];
    return {
      id: `target-${index + 1}`,
      path: `targets/${classification}-${index + 1}.md`,
      language,
      category: categories[index % categories.length]!,
      text,
      ...(workspace ? { workspaceSupportDocumentIds: supportIds } : {}),
      checkpoints: [0, 1, 2]
        .map((checkpoint) => ({
          id: `checkpoint-${index + 1}-${checkpoint + 1}`,
          cursorOffset: 0,
          expectedBehavior: 'complete' as const,
          acceptableSuffixes: references,
          ...(workspace
            ? { patternId: 'pattern-stable-workflow', supportDocumentIds: supportIds }
            : {}),
        }))
        .concat({
          id: `checkpoint-${index + 1}-4`,
          cursorOffset: text.length,
          expectedBehavior: 'silence' as const,
          acceptableSuffixes: [],
        }),
    };
  });
  return {
    schema: 'jotluck.autocomplete.v2-free-holdout.v1',
    schemaVersion: 1,
    datasetId: `${classification}-synthetic-fixture`,
    classification,
    supportDocuments,
    targets,
  };
}

function support(id: string, language: 'zh' | 'en', text: string) {
  return {
    id,
    path: `support/${id}.md`,
    language,
    text,
    patternIds: ['pattern-stable-workflow'],
  };
}

function relative(value: string): string {
  return path.relative(workspaceRoot, value).replaceAll('\\', '/');
}
