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
  validateV2FreeHoldoutDescriptor,
  type V2FreeHoldoutClassification,
  type V2FreeHoldoutDescriptor,
} from '../autocomplete-v2-free/holdout-validator';

const REPOSITORY_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const TEST_ROOT = path.join(
  REPOSITORY_ROOT,
  'scripts/corpus/_web-cache/autocomplete-v2-free-governance-tests',
);

function descriptor(classification: V2FreeHoldoutClassification): V2FreeHoldoutDescriptor {
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

describe('V2 free holdout governance', () => {
  it('validates a final descriptor without reading sealed content', async () => {
    const value = descriptor('cold-final-v1');
    expect(validateV2FreeHoldoutDescriptor(value)).toBe(value);
    await expect(
      loadV2FreeHoldoutContent({
        workspaceRoot: REPOSITORY_ROOT,
        descriptor: value,
        contentPath: 'does-not-exist.json',
      }),
    ).rejects.toThrow('sealed');
  });

  it('claims the cold/workspace pair globally once and keeps its receipt immutable', async () => {
    mkdirSync(TEST_ROOT, { recursive: true });
    const workspaceRoot = mkdtempSync(path.join(TEST_ROOT, 'case-'));
    const options = {
      workspaceRoot,
      coldDescriptor: descriptor('cold-final-v1'),
      workspaceDescriptor: descriptor('workspace-final-v1'),
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
