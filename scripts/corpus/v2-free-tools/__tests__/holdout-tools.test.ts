import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import type {
  V2FreeHoldoutClassification,
  V2FreeHoldoutContent,
  V2FreeNoteCategory,
} from '../../../autocomplete-v2-free/holdout-validator';
import { validateV2FreeHoldoutContent } from '../../../autocomplete-v2-free/holdout-validator';
import {
  authorFourHoldoutDrafts,
  createHoldoutAuthoringTemplate,
  freezeV2FreeHoldoutSet,
  publishFrozenHoldoutEvidence,
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
        frozenAt: '2026-08-08T00:00:00.000Z',
        review: {
          kind: 'independent-model' as const,
          reviewedAt: '2026-08-08T00:00:00.000Z',
          reviewArtifactSha256: 'a'.repeat(64),
        },
        formalReleaseEvidence: false,
      });
    }
    const plan: HoldoutSetFreezePlan = {
      schema: 'jotluck.autocomplete.v2-free-holdout-freeze-plan.v2',
      schemaVersion: 2,
      outputRoot: `${relative(root)}/frozen`,
      suites,
    };

    const frozen = await freezeV2FreeHoldoutSet({ workspaceRoot, plan });

    expect(frozen).toHaveLength(4);
    for (const suite of frozen) {
      expect(suite.descriptor).toMatchObject({
        schema: 'jotluck.autocomplete.v2-free-holdout-descriptor.v2',
        schemaVersion: 2,
        review: { kind: 'independent-model' },
        formalReleaseEvidence: false,
      });
      expect(suite.descriptor.review).not.toHaveProperty('reviewerIdentitySha256');
      expect(suite.descriptor.sealed).toBe(suite.classification.endsWith('-final-v1'));
      expect(suite.descriptor.summary.checkpoints).toBe(200);
      expect(
        JSON.parse(await readFile(path.join(workspaceRoot, suite.fingerprintPath), 'utf8')),
      ).toMatchObject({ classification: suite.classification });
    }
    await expect(stat(path.join(root, 'frozen', 'final-claim.json'))).rejects.toThrow();

    const published = await publishFrozenHoldoutEvidence({
      workspaceRoot,
      frozenRoot: `${relative(root)}/frozen`,
      outputRoot: `${relative(root)}/public`,
    });
    expect(published).toHaveLength(4);
    for (const suite of published) {
      expect(suite.contentSha256).toMatch(/^[a-f0-9]{64}$/u);
      await expect(
        stat(path.join(root, 'public', suite.classification, 'content.json')),
      ).rejects.toThrow();
    }

    const legacyDescriptor = {
      ...frozen[0]!.descriptor,
      schema: 'jotluck.autocomplete.v2-free-holdout-descriptor.v1',
      schemaVersion: 1,
      humanReviewed: true,
      reviewerIdentitySha256: 'b'.repeat(64),
    };
    delete (legacyDescriptor as Partial<typeof legacyDescriptor>).review;
    delete (legacyDescriptor as Partial<typeof legacyDescriptor>).formalReleaseEvidence;
    await writeFile(
      path.join(workspaceRoot, frozen[0]!.descriptorPath),
      `${JSON.stringify(legacyDescriptor)}\n`,
      'utf8',
    );
    await expect(
      publishFrozenHoldoutEvidence({
        workspaceRoot,
        frozenRoot: `${relative(root)}/frozen`,
        outputRoot: `${relative(root)}/public-legacy`,
      }),
    ).rejects.toThrow(/refuses legacy v1/u);

    await expect(
      freezeV2FreeHoldoutSet({
        workspaceRoot,
        plan: {
          ...plan,
          outputRoot: `${relative(root)}/invalid-review`,
          suites: plan.suites.map((suite) => ({
            ...suite,
            formalReleaseEvidence: true,
          })),
        },
      }),
    ).rejects.toThrow(/cannot impersonate a human or become release evidence/u);
  });

  it('rejects unsafe prose and target-level quota redistribution', () => {
    const unsafe = fixtureHoldout('cold-validation-v1');
    unsafe.targets[0]!.text = '---\nsecret: value';
    expect(() => validateV2FreeHoldoutContent(unsafe)).toThrow(/code, frontmatter/u);

    const redistributed = fixtureHoldout('cold-validation-v1');
    redistributed.targets[0]!.checkpoints[3] = {
      ...redistributed.targets[0]!.checkpoints[2]!,
      id: 'redistributed-complete',
    };
    redistributed.targets[1]!.checkpoints[2] = {
      ...redistributed.targets[1]!.checkpoints[3]!,
      id: 'redistributed-silence',
    };
    expect(() => validateV2FreeHoldoutContent(redistributed)).toThrow(
      /three complete and one silence/u,
    );
  });

  it('accepts one to three independent host-visible references and rejects invalid sets', () => {
    expect(() => validateV2FreeHoldoutContent(fixtureHoldout('cold-validation-v1'))).not.toThrow();

    const empty = fixtureHoldout('cold-validation-v1');
    empty.targets[1]!.checkpoints[0]!.acceptableSuffixes = [];
    expect(() => validateV2FreeHoldoutContent(empty)).toThrow(/requires 1-3 references/u);

    const tooMany = fixtureHoldout('cold-validation-v1');
    tooMany.targets[1]!.checkpoints[0]!.acceptableSuffixes = [
      'Obser',
      'Observ',
      'Observa',
      'Observat',
    ];
    expect(() => validateV2FreeHoldoutContent(tooMany)).toThrow(/requires 1-3 references/u);

    const repeated = fixtureHoldout('cold-validation-v1');
    repeated.targets[1]!.checkpoints[0]!.acceptableSuffixes = ['Observ', 'Observ'];
    expect(() => validateV2FreeHoldoutContent(repeated)).toThrow(/repeats a reference/u);

    const overlong = fixtureHoldout('cold-validation-v1');
    overlong.targets[1]!.checkpoints[0]!.acceptableSuffixes = ['Observation note'];
    expect(() => validateV2FreeHoldoutContent(overlong)).toThrow(/visible host length boundary/u);
  });
});

function fixtureHoldout(classification: V2FreeHoldoutClassification): V2FreeHoldoutContent {
  const workspace = classification.startsWith('workspace-');
  const supportDocuments: V2FreeHoldoutContent['supportDocuments'] = [];
  const targets = Array.from({ length: 50 }, (_, index) => {
    const number = index + 1;
    const language = index % 2 === 0 ? ('zh' as const) : ('en' as const);
    const text =
      language === 'zh'
        ? `第${number}份观察记录显示流程已经稳定运行，下一步需要继续核对结果。`
        : `Observation note ${number} confirms the workflow is stable and the next review can begin.`;
    const references = language === 'zh' ? [`第${number}份观察`] : ['Observation'];
    const patternId = `pattern-stable-workflow-${number}`;
    const supportIds = [`support-${number}-a`, `support-${number}-b`];
    if (workspace) {
      supportDocuments.push(
        support(
          supportIds[0]!,
          language,
          language === 'zh'
            ? `目标${number}的支持材料甲明确记录“第${number}份观察”作为续写依据。`
            : `Target ${number} support A records Observation as the recoverable continuation.`,
          patternId,
        ),
        support(
          supportIds[1]!,
          language,
          language === 'zh'
            ? `目标${number}的支持材料乙独立说明本次流程的后续复核顺序。`
            : `Target ${number} support B independently explains the follow-up review order.`,
          patternId,
        ),
      );
    }
    return {
      id: `target-${number}`,
      path: `targets/${classification}-${number}.md`,
      language,
      category: categories[index % categories.length]!,
      text,
      ...(workspace ? { workspaceSupportDocumentIds: supportIds } : {}),
      checkpoints: [0, 1, 2]
        .map((checkpoint) => ({
          id: `checkpoint-${number}-${checkpoint + 1}`,
          cursorOffset: 0,
          expectedBehavior: 'complete' as const,
          acceptableSuffixes: references,
          ...(workspace ? { patternId, supportDocumentIds: supportIds } : {}),
        }))
        .concat({
          id: `checkpoint-${number}-4`,
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

function support(id: string, language: 'zh' | 'en', text: string, patternId: string) {
  return {
    id,
    path: `support/${id}.md`,
    language,
    text,
    patternIds: [patternId],
  };
}

function relative(value: string): string {
  return path.relative(workspaceRoot, value).replaceAll('\\', '/');
}
