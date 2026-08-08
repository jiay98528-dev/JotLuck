import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  claimV2FreeFinalPair,
  readV2FreeFinalPairClaim,
  writeV2FreeFinalPairReceipt,
} from '../autocomplete-v2-free/holdout-ledger';
import {
  loadV2FreeHoldoutContent,
  validateV2FreeHoldoutContent,
  validateV2FreeHoldoutDescriptor,
  type V2FreeHoldoutClassification,
  type V2FreeHoldoutContent,
  type V2FreeHoldoutDescriptor,
  type V2FreeHoldoutDescriptorV2,
} from '../autocomplete-v2-free/holdout-validator';

const REPOSITORY_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const TEST_ROOT = path.join(
  REPOSITORY_ROOT,
  'scripts/corpus/_web-cache/autocomplete-v2-free-governance-tests',
);

function legacyDescriptor(classification: V2FreeHoldoutClassification): V2FreeHoldoutDescriptor {
  const final = classification.endsWith('-final-v1');
  const workspace = classification.startsWith('workspace-');
  return {
    schema: 'jotluck.autocomplete.v2-free-holdout-descriptor.v1',
    schemaVersion: 1,
    datasetId: classification,
    frozenAt: '2026-08-05T00:00:00.000Z',
    classification,
    content: {
      bytes: 1,
      sha256: (workspace ? 'b' : 'a').repeat(64),
    },
    summary: {
      targetDocuments: 50,
      supportDocuments: workspace ? 2 : 0,
      checkpoints: 200,
      completeCheckpoints: 150,
      silenceCheckpoints: 50,
      languageCheckpoints: { zh: 100, en: 100 },
      categoryCheckpoints: {
        'field-observation': 40,
        'maintenance-log': 40,
        'meeting-note': 40,
        'reading-note': 40,
        'household-plan': 40,
      },
    },
    humanReviewed: true,
    reviewerIdentitySha256: 'c'.repeat(64),
    sealed: final,
  };
}

function descriptorV2(
  classification: V2FreeHoldoutClassification,
  reviewKind: 'human' | 'independent-model',
): V2FreeHoldoutDescriptorV2 {
  const legacy = legacyDescriptor(classification);
  const common = {
    datasetId: legacy.datasetId,
    frozenAt: legacy.frozenAt,
    classification: legacy.classification,
    content: legacy.content,
    summary: legacy.summary,
    sealed: legacy.sealed,
  };
  return reviewKind === 'human'
    ? {
        ...common,
        schema: 'jotluck.autocomplete.v2-free-holdout-descriptor.v2',
        schemaVersion: 2,
        review: {
          kind: 'human',
          reviewedAt: '2026-08-08T00:00:00.000Z',
          reviewArtifactSha256: 'd'.repeat(64),
          reviewerIdentitySha256: 'e'.repeat(64),
        },
        formalReleaseEvidence: true,
      }
    : {
        ...common,
        schema: 'jotluck.autocomplete.v2-free-holdout-descriptor.v2',
        schemaVersion: 2,
        review: {
          kind: 'independent-model',
          reviewedAt: '2026-08-08T00:00:00.000Z',
          reviewArtifactSha256: 'd'.repeat(64),
        },
        formalReleaseEvidence: false,
      };
}

describe('V2 free holdout governance', () => {
  it('keeps legacy v1 descriptors read-only compatible without reading sealed content', async () => {
    const value = legacyDescriptor('cold-final-v1');
    expect(validateV2FreeHoldoutDescriptor(value)).toBe(value);
    await expect(
      loadV2FreeHoldoutContent({
        workspaceRoot: REPOSITORY_ROOT,
        descriptor: value,
        contentPath: 'does-not-exist.json',
      }),
    ).rejects.toThrow('sealed');
  });

  it('distinguishes truthful v2 human and independent-model review evidence', () => {
    const human = descriptorV2('cold-validation-v1', 'human');
    const independent = descriptorV2('cold-validation-v1', 'independent-model');
    expect(validateV2FreeHoldoutDescriptor(human)).toBe(human);
    expect(validateV2FreeHoldoutDescriptor(independent)).toBe(independent);

    const elevatedModelReview = {
      ...independent,
      formalReleaseEvidence: true,
    };
    expect(() => validateV2FreeHoldoutDescriptor(elevatedModelReview)).toThrow(
      /cannot impersonate a human/u,
    );

    const impersonatingModelReview = {
      ...independent,
      review: {
        ...independent.review,
        reviewerIdentitySha256: 'f'.repeat(64),
      },
    } as unknown as V2FreeHoldoutDescriptor;
    expect(() => validateV2FreeHoldoutDescriptor(impersonatingModelReview)).toThrow(
      /cannot impersonate a human/u,
    );

    for (const legacyField of [
      { humanReviewed: false },
      { reviewerIdentitySha256: 'f'.repeat(64) },
      { reviewedAt: '2026-08-08T00:00:00.000Z' },
      { reviewArtifactSha256: 'f'.repeat(64) },
    ]) {
      const misplacedLegacyReview = {
        ...independent,
        ...legacyField,
      } as unknown as V2FreeHoldoutDescriptor;
      expect(() => validateV2FreeHoldoutDescriptor(misplacedLegacyReview)).toThrow(
        /top-level legacy review fields/u,
      );
    }
  });

  it('rejects nested suffixes, unrecoverable workspace references, and reused supports', () => {
    const policy = workspacePolicy();
    expect(() => validateV2FreeHoldoutContent(workspaceFixture(), policy)).not.toThrow();

    const nested = workspaceFixture();
    nested.targets[0]!.checkpoints[0]!.acceptableSuffixes = ['参考甲', '参考甲项'];
    expect(() => validateV2FreeHoldoutContent(nested, policy)).toThrow(
      /nested reference prefixes/u,
    );

    const unrecoverable = workspaceFixture();
    unrecoverable.targets[0]!.text = unrecoverable.targets[0]!.text.replace('参考甲项', '参考丁项');
    unrecoverable.targets[0]!.checkpoints[0]!.acceptableSuffixes = ['参考丁项'];
    expect(() => validateV2FreeHoldoutContent(unrecoverable, policy)).toThrow(
      /cannot be recovered from its bound supports/u,
    );

    const reused = workspaceFixture();
    const firstSupportIds = reused.targets[0]!.workspaceSupportDocumentIds!;
    reused.targets[1]!.workspaceSupportDocumentIds = [...firstSupportIds];
    for (const checkpoint of reused.targets[1]!.checkpoints.slice(0, 3)) {
      checkpoint.supportDocumentIds = [...firstSupportIds];
    }
    expect(() => validateV2FreeHoldoutContent(reused, policy)).toThrow(/reused across targets/u);
  });

  it('claims the cold/workspace pair globally once and keeps its receipt immutable', async () => {
    mkdirSync(TEST_ROOT, { recursive: true });
    const workspaceRoot = mkdtempSync(path.join(TEST_ROOT, 'case-'));
    const options = {
      workspaceRoot,
      coldDescriptor: legacyDescriptor('cold-final-v1'),
      workspaceDescriptor: legacyDescriptor('workspace-final-v1'),
      candidateArtifactSha256: 'd'.repeat(64),
      baselineSha256: 'e'.repeat(64),
      evaluatorTreeSha256: 'f'.repeat(64),
      claimedAt: '2026-08-05T01:00:00.000Z',
    } as const;
    try {
      const first = await claimV2FreeFinalPair(options);
      expect(
        await readV2FreeFinalPairClaim({
          workspaceRoot,
          claimPath: first.claimPath,
        }),
      ).toEqual(first.claim);
      await expect(claimV2FreeFinalPair(options)).rejects.toThrow('already consumed');

      const receipt = await writeV2FreeFinalPairReceipt({
        workspaceRoot,
        claim: first.claim,
        status: 'failed',
        failureCode: 'worker-crashed',
        completedAt: '2026-08-05T01:01:00.000Z',
      });
      expect(receipt.receipt).toMatchObject({
        status: 'failed',
        failureCode: 'worker-crashed',
      });
      await expect(
        writeV2FreeFinalPairReceipt({
          workspaceRoot,
          claim: first.claim,
          status: 'failed',
          failureCode: 'retry-not-allowed',
        }),
      ).rejects.toThrow('cannot be overwritten');
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });
});

function workspacePolicy() {
  return {
    targetDocuments: 10,
    checkpoints: 40,
    completeCheckpoints: 30,
    silenceCheckpoints: 10,
    checkpointsPerTarget: 4,
    languageCheckpoints: 20,
    categoryCheckpoints: 8,
  };
}

function workspaceFixture(): V2FreeHoldoutContent {
  const categories = [
    'field-observation',
    'maintenance-log',
    'meeting-note',
    'reading-note',
    'household-plan',
  ] as const;
  const supportDocuments: V2FreeHoldoutContent['supportDocuments'] = [];
  const targets: V2FreeHoldoutContent['targets'] = [];
  for (let index = 0; index < 10; index++) {
    const language = index < 5 ? ('zh' as const) : ('en' as const);
    const number = index + 1;
    const patternId = `pattern-workspace-${number}`;
    const supportIds = [`support-${number}-a`, `support-${number}-b`];
    const references =
      language === 'zh'
        ? ['参考甲项', '参考乙项', '参考丙项']
        : ['alpha fact', 'bravo fact', 'cedar fact'];
    const text =
      language === 'zh'
        ? `目标${number}记录包含参考甲项、参考乙项和参考丙项，另有独立说明。`
        : `Target ${number} contains alpha fact, bravo fact, and cedar fact with an independent note.`;
    supportDocuments.push(
      {
        id: supportIds[0]!,
        path: `supports/${supportIds[0]}.md`,
        language,
        text:
          language === 'zh'
            ? `第${number}份支持材料包含参考甲项与参考乙项，并说明现场情况。`
            : `Support ${number} records alpha fact and bravo fact with local context.`,
        patternIds: [patternId],
      },
      {
        id: supportIds[1]!,
        path: `supports/${supportIds[1]}.md`,
        language,
        text:
          language === 'zh'
            ? `第${number}份另一材料包含参考丙项，同时提供复核背景。`
            : `Alternate support ${number} records cedar fact and provides review context.`,
        patternIds: [patternId],
      },
    );
    targets.push({
      id: `target-${number}`,
      path: `targets/target-${number}.md`,
      language,
      category: categories[index % categories.length]!,
      text,
      workspaceSupportDocumentIds: supportIds,
      checkpoints: references
        .map((reference, checkpointIndex) => ({
          id: `checkpoint-${number}-${checkpointIndex + 1}`,
          cursorOffset: text.indexOf(reference),
          expectedBehavior: 'complete' as const,
          acceptableSuffixes: [reference],
          patternId,
          supportDocumentIds: supportIds,
        }))
        .concat({
          id: `checkpoint-${number}-4`,
          cursorOffset: text.length,
          expectedBehavior: 'silence' as const,
          acceptableSuffixes: [],
        }),
    });
  }
  return {
    schema: 'jotluck.autocomplete.v2-free-holdout.v1',
    schemaVersion: 1,
    datasetId: 'workspace-contract-fixture',
    classification: 'workspace-validation-v1',
    supportDocuments,
    targets,
  };
}
