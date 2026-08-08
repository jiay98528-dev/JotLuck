import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { sha256 } from '../common';
import {
  auditSelectionFingerprints,
  deduplicateSelectionDocuments,
  fingerprintDocuments,
  fingerprintText,
} from '../fingerprints';

const roots: string[] = [];
const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

afterEach(async () => {
  for (const root of roots.splice(0)) {
    if (!root.includes(`${path.sep}scripts${path.sep}corpus${path.sep}.tmp-`)) {
      throw new Error('Refusing to remove an unexpected test directory.');
    }
    await rm(root, { recursive: true, force: true });
  }
});

describe('V2 free corpus fingerprints', () => {
  it('uses the locked language-aware 128-value fingerprint contract', () => {
    const mixed = fingerprintText(
      'mixed',
      '这是用于验证中文十二字短窗和连续三十二字泄漏窗口的稳定观察记录内容补充文本 ' +
        'one two three four five six seven eight nine ten eleven twelve thirteen',
    );
    expect(mixed.minHash128).toHaveLength(128);
    expect(mixed.cjk32WindowSha256s.length).toBeGreaterThan(0);
    expect(mixed.english12WindowSha256s.length).toBeGreaterThan(0);
    expect(fingerprintText('short', 'one two three').minHash128).toBeNull();
  });

  it('returns deterministic removals and the measured input near-duplicate rate', () => {
    const base =
      'one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen';
    const result = deduplicateSelectionDocuments([
      { id: 'b-copy', text: `${base} carefully` },
      { id: 'a-original', text: base },
      {
        id: 'c-distinct',
        text: 'garden notes compare rain patterns across several unrelated weeks and seasons',
      },
    ]);
    expect(result.retainedDocumentIds).toEqual(['a-original', 'c-distinct']);
    expect(result.inputNearDuplicateDocumentRate).toBeCloseTo(2 / 3);
    expect(result.removedPairs).toMatchObject([{ retainedId: 'a-original', removedId: 'b-copy' }]);
  });

  it('passes distinct training and validation text without reading final content', async () => {
    const fixture = await createSelection([
      '清晨的维护记录说明设备已经恢复运行，下一轮巡检安排在周五下午。',
      'The reading note compares two offline workflows and records the remaining questions.',
    ]);
    const cold = inventory(
      'cold-validation-v1',
      '冷启动样本讨论花园观察和天气变化，不包含任何训练段落。',
    );
    const workspace = inventory(
      'workspace-validation-v1',
      'Workspace notes describe an unrelated planning pattern for a local workshop.',
    );
    const report = await auditSelectionFingerprints({
      workspaceRoot,
      selection: fixture.selection,
      selectionManifestBytes: fixture.selectionBytes,
      holdoutInventories: [cold, workspace],
    });

    expect(report.passed).toBe(true);
    expect(report.finalContentRead).toBe(false);
    expect(report.exactHoldoutOverlaps).toBe(0);
    expect(report.longWindowLeakages).toBe(0);
  });

  it('detects exact, near and long-window leakage from fingerprint inventories', async () => {
    const leaked =
      'The field observation records a quiet river crossing before sunrise and lists every safety check for the return trip.';
    const fixture = await createSelection([
      leaked,
      `${leaked} carefully`,
      '另一篇完全不同的中文记录描述图书整理流程和下周需要确认的事项。',
    ]);
    const cold = inventory('cold-validation-v1', leaked);
    const workspace = inventory(
      'workspace-validation-v1',
      'The unrelated workspace target covers a meeting agenda and several follow-up owners.',
    );
    const report = await auditSelectionFingerprints({
      workspaceRoot,
      selection: fixture.selection,
      selectionManifestBytes: fixture.selectionBytes,
      holdoutInventories: [cold, workspace],
    });

    expect(report.passed).toBe(false);
    expect(report.exactHoldoutOverlaps).toBeGreaterThan(0);
    expect(report.longWindowLeakages).toBeGreaterThan(0);
    expect(report.nearDuplicatePairs).toBeGreaterThan(0);
  });
});

function inventory(classification: 'cold-validation-v1' | 'workspace-validation-v1', text: string) {
  return fingerprintDocuments({
    datasetId: `${classification}-fixture`,
    classification,
    contentSha256: sha256(`${classification}-content`),
    documents: [{ id: `${classification}-target`, text }],
  });
}

async function createSelection(texts: string[]) {
  const root = await mkdtemp(path.join(workspaceRoot, 'scripts/corpus/.tmp-fingerprint-'));
  roots.push(root);
  await mkdir(root, { recursive: true });
  const documents = [];
  for (const [index, text] of texts.entries()) {
    const file = path.join(root, `document-${index}.txt`);
    const bytes = Buffer.from(text, 'utf8');
    await writeFile(file, bytes);
    documents.push({
      documentId: `document-${index}`,
      relativePath: path.relative(workspaceRoot, file).replaceAll('\\', '/'),
      bytes: bytes.byteLength,
      sha256: sha256(bytes),
    });
  }
  const selection = {
    inputTreeSha256: sha256('fixture-tree'),
    inputNearDuplicateDocumentRate: 0,
    documents,
  };
  return { selection, selectionBytes: Buffer.from(JSON.stringify(selection), 'utf8') };
}
