import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

interface WorkspaceHoldout {
  schemaVersion: 1;
  datasetId: string;
  supportDocuments: Array<{ id: string; path: string; language: 'zh' | 'en'; text: string }>;
  targets: Array<{
    id: string;
    language: 'zh' | 'en';
    text: string;
    supportDocumentIds: string[];
    checkpoints: Array<{
      id: string;
      cursorOffset: number;
      expectedSuffix: string;
      expectedBehavior: 'complete' | 'silence';
    }>;
  }>;
}

const HOLDOUT = JSON.parse(
  readFileSync(resolveRepoFile('scripts/corpus/workspace-conditioned-holdout.json'), 'utf8'),
) as WorkspaceHoldout;

function resolveRepoFile(relativePath: string): string {
  const direct = path.resolve(process.cwd(), relativePath);
  if (existsSync(direct)) return direct;
  return path.resolve(process.cwd(), '..', '..', relativePath);
}

describe('workspace-conditioned holdout governance', () => {
  it('has independent support/target documents and the required opportunity balance', () => {
    const checkpoints = HOLDOUT.targets.flatMap((target) =>
      target.checkpoints.map((checkpoint) => ({ target, checkpoint })),
    );
    expect(HOLDOUT.targets).toHaveLength(50);
    expect(checkpoints).toHaveLength(200);
    expect(checkpoints.filter(({ target }) => target.language === 'zh')).toHaveLength(100);
    expect(checkpoints.filter(({ target }) => target.language === 'en')).toHaveLength(100);
    expect(
      checkpoints.filter(({ checkpoint }) => checkpoint.expectedBehavior === 'silence').length /
        checkpoints.length,
    ).toBeGreaterThanOrEqual(0.2);
  });

  it('uses two distinct support documents without copying targets or full continuations', () => {
    const supportById = new Map(
      HOLDOUT.supportDocuments.map((document) => [document.id, document]),
    );
    expect(new Set(HOLDOUT.supportDocuments.map((document) => document.path)).size).toBe(
      HOLDOUT.supportDocuments.length,
    );

    for (const target of HOLDOUT.targets) {
      expect(new Set(target.supportDocumentIds).size, target.id).toBeGreaterThanOrEqual(2);
      const supports = target.supportDocumentIds.map((id) => supportById.get(id));
      expect(supports.every(Boolean), target.id).toBe(true);
      for (const support of supports) {
        expect(support?.language, target.id).toBe(target.language);
        expect(support?.text, target.id).not.toBe(target.text);
        expect(support?.text.includes(target.text), target.id).toBe(false);
        for (const checkpoint of target.checkpoints) {
          if (checkpoint.expectedBehavior !== 'complete') continue;
          expect(
            support?.text.includes(checkpoint.expectedSuffix),
            `${target.id}/${checkpoint.id}/${support?.id}`,
          ).toBe(false);
        }
      }
    }
  });

  it('keeps every cursor and expected suffix bound to immutable target text', () => {
    for (const target of HOLDOUT.targets) {
      for (const checkpoint of target.checkpoints) {
        expect(Number.isSafeInteger(checkpoint.cursorOffset), checkpoint.id).toBe(true);
        expect(checkpoint.cursorOffset, checkpoint.id).toBeGreaterThanOrEqual(0);
        expect(checkpoint.cursorOffset, checkpoint.id).toBeLessThanOrEqual(target.text.length);
        if (checkpoint.expectedBehavior === 'complete') {
          expect(
            target.text.slice(checkpoint.cursorOffset).startsWith(checkpoint.expectedSuffix),
            checkpoint.id,
          ).toBe(true);
        } else {
          expect(checkpoint.expectedSuffix, checkpoint.id).toBe('');
        }
      }
    }
  });
});
