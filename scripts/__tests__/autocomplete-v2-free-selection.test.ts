import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { runV2FreeCli } from '../autocomplete-v2-free/cli';
import {
  V2_FREE_FORMAL_SMOKE_MINIMUM_BYTES,
  assertV2FreeSelectionStage,
  buildV2FreeLicensedCorpusSelection,
} from '../autocomplete-v2-free/selection-builder';

const REPOSITORY_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const TEST_ROOT = path.join(
  REPOSITORY_ROOT,
  'scripts/corpus/_web-cache/autocomplete-v2-free-selection-tests',
);
const CATEGORIES = [
  'field-observation',
  'maintenance-log',
  'meeting-note',
  'reading-note',
  'household-plan',
] as const;

function sha256(value: Buffer | string): string {
  return createHash('sha256').update(value).digest('hex');
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

function createSelectionFixture(secret = false): {
  workspaceRoot: string;
  selectionPath: string;
  registryPath: string;
} {
  mkdirSync(TEST_ROOT, { recursive: true });
  const workspaceRoot = mkdtempSync(path.join(TEST_ROOT, 'case-'));
  const sources = CATEGORIES.map((category, index) => {
    const sourceId = `source-${index}`;
    const contentRoot = `training/${sourceId}`;
    const licenseEvidencePath = `licenses/${sourceId}.txt`;
    mkdirSync(path.join(workspaceRoot, contentRoot), { recursive: true });
    mkdirSync(path.join(workspaceRoot, 'licenses'), { recursive: true });
    writeFileSync(path.join(workspaceRoot, licenseEvidencePath), 'MIT License\n', 'utf8');
    return {
      id: sourceId,
      kind: 'project-owned',
      language: index % 2 === 0 ? 'zh' : 'en',
      category,
      contentRoot,
      licenseSpdx: 'MIT',
      licenseEvidencePath,
      contentTreeSha256: String(index + 1).repeat(64),
      collectedAt: '2026-08-05T00:00:00.000Z',
      cleanerVersion: 'fixture-v1',
      generatorVersion: 'fixture-v1',
      generatorSeed: `seed-${index}`,
    };
  });
  const documents = sources.map((source, index) => {
    const text = secret && index === 0 ? 'secret: token000' : `approved prose ${index}`;
    const relativePath = `${source.contentRoot}/document-${index}.md`;
    const bytes = Buffer.from(text, 'utf8');
    writeFileSync(path.join(workspaceRoot, relativePath), bytes);
    return {
      documentId: `document-${index}`,
      sourceId: source.id,
      language: source.language,
      category: source.category,
      relativePath,
      split: 'train',
      bytes: bytes.byteLength,
      sha256: sha256(bytes),
      normalizedSha256: sha256(text),
    };
  });
  const selectionPath = 'selection.json';
  const registryPath = 'sources.json';
  writeFileSync(
    path.join(workspaceRoot, selectionPath),
    JSON.stringify({
      schema: 'jotluck.autocomplete.v2r-corpus-selection.v1',
      schemaVersion: 1,
      datasetId: 'fixture',
      selectionSha256: 'a'.repeat(64),
      sources,
      documents,
    }),
  );
  writeFileSync(path.join(workspaceRoot, registryPath), JSON.stringify(sources));
  return { workspaceRoot, selectionPath, registryPath };
}

describe('V2 free licensed corpus selection', () => {
  it('accepts balanced train-only sources and binds every byte identity', async () => {
    const fixture = createSelectionFixture();
    try {
      const selection = await buildV2FreeLicensedCorpusSelection({
        workspaceRoot: fixture.workspaceRoot,
        selectionPath: fixture.selectionPath,
        sourceRegistryPath: fixture.registryPath,
        createdAt: '2026-08-05T00:00:00.000Z',
      });
      expect(selection).toMatchObject({
        governanceVersion: 3,
        exactDuplicates: 0,
        validationExactOverlaps: 0,
        splitDocuments: { train: 4, development: 1 },
      });
      expect(selection.documents).toHaveLength(5);
      expect(
        selection.documents.filter((document) => document.split === 'development'),
      ).toHaveLength(1);
      expect(selection.splitBytes.train + selection.splitBytes.development).toBe(
        selection.selectedBytes,
      );
      const boundInputTree = selection.documents.map(({ documentId, sha256, split }) => ({
        documentId,
        sha256,
        split,
      }));
      expect(selection.inputTreeSha256).toBe(sha256(canonicalJson(boundInputTree)));
      const changedSplit = structuredClone(selection);
      changedSplit.documents[0]!.split =
        changedSplit.documents[0]!.split === 'train' ? 'development' : 'train';
      const changedInputTree = changedSplit.documents.map(({ documentId, sha256, split }) => ({
        documentId,
        sha256,
        split,
      }));
      expect(sha256(canonicalJson(changedInputTree))).not.toBe(selection.inputTreeSha256);
      expect(() => assertV2FreeSelectionStage(changedSplit, 'governance')).toThrow(
        'deterministic 5%',
      );
      expect(selection.sources.every((source) => source.licenseEvidenceBytes > 0)).toBe(true);
    } finally {
      rmSync(fixture.workspaceRoot, { recursive: true, force: true });
    }
  });

  it('rejects credential-shaped training text before producing a selection', async () => {
    const fixture = createSelectionFixture(true);
    try {
      await expect(
        buildV2FreeLicensedCorpusSelection({
          workspaceRoot: fixture.workspaceRoot,
          selectionPath: fixture.selectionPath,
          sourceRegistryPath: fixture.registryPath,
        }),
      ).rejects.toThrow('contains secret');
    } finally {
      rmSync(fixture.workspaceRoot, { recursive: true, force: true });
    }
  });

  it('rejects exact train/development leakage before partitioning', async () => {
    const fixture = createSelectionFixture();
    try {
      const manifestPath = path.join(fixture.workspaceRoot, fixture.selectionPath);
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
        documents: Array<{
          relativePath: string;
          bytes: number;
          sha256: string;
          normalizedSha256: string;
        }>;
      };
      const duplicate = readFileSync(
        path.join(fixture.workspaceRoot, manifest.documents[0]!.relativePath),
      );
      writeFileSync(
        path.join(fixture.workspaceRoot, manifest.documents[1]!.relativePath),
        duplicate,
      );
      manifest.documents[1]!.bytes = duplicate.byteLength;
      manifest.documents[1]!.sha256 = sha256(duplicate);
      manifest.documents[1]!.normalizedSha256 = sha256(duplicate);
      writeFileSync(manifestPath, JSON.stringify(manifest));
      await expect(
        buildV2FreeLicensedCorpusSelection({
          workspaceRoot: fixture.workspaceRoot,
          selectionPath: fixture.selectionPath,
          sourceRegistryPath: fixture.registryPath,
        }),
      ).rejects.toThrow('exact duplicate');
    } finally {
      rmSync(fixture.workspaceRoot, { recursive: true, force: true });
    }
  });

  it('fails closed before writing an undersized formal 32 MiB smoke selection', async () => {
    const fixture = createSelectionFixture();
    const output = 'formal-selection.json';
    try {
      expect(5 * Buffer.byteLength('approved prose 0')).toBeLessThan(
        V2_FREE_FORMAL_SMOKE_MINIMUM_BYTES,
      );
      await expect(
        runV2FreeCli([
          'build-selection',
          '--workspace-root',
          fixture.workspaceRoot,
          '--v2r-selection',
          fixture.selectionPath,
          '--source-registry',
          fixture.registryPath,
          '--output',
          output,
          '--stage',
          'formal-32mib-smoke',
        ]),
      ).rejects.toThrow('undersized');
      expect(existsSync(path.join(fixture.workspaceRoot, output))).toBe(false);
    } finally {
      rmSync(fixture.workspaceRoot, { recursive: true, force: true });
    }
  });
});
