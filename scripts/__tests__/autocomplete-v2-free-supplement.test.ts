import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

import {
  V2_FREE_SUPPLEMENT_PLAN_SCHEMA,
  materializeV2FreeSupplement,
  type V2FreeSupplementPlan,
} from '../autocomplete-v2-free/supplement';

const REPOSITORY_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const TEST_ROOT = path.join(
  REPOSITORY_ROOT,
  'scripts/corpus/_web-cache/autocomplete-v2-free-supplement-tests',
);

interface Fixture {
  workspaceRoot: string;
  configPath: string;
  packPath: string;
  outputRoot: string;
  outputManifest: string;
}

function sha256(value: Buffer | string): string {
  return createHash('sha256').update(value).digest('hex');
}

function normalize(value: string): string {
  return value.normalize('NFKC').replace(/\s+/gu, ' ').trim().toLocaleLowerCase('en-US');
}

function writeUtf8(root: string, relativePath: string, value: string): Buffer {
  const bytes = Buffer.from(value, 'utf8');
  const target = path.join(root, ...relativePath.split('/'));
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, bytes);
  return bytes;
}

function pin(relativePath: string, bytes: Buffer) {
  return { path: relativePath, bytes: bytes.byteLength, sha256: sha256(bytes) };
}

function createFixture(
  options: { unsafeProjectText?: boolean; escapedOutput?: boolean } = {},
): Fixture {
  mkdirSync(TEST_ROOT, { recursive: true });
  const workspaceRoot = mkdtempSync(path.join(TEST_ROOT, 'case-'));
  const mit = writeUtf8(workspaceRoot, 'LICENSE', 'MIT License\n');
  const cc0 = writeUtf8(workspaceRoot, 'scripts/corpus/licenses/tatoeba-cc0.md', 'CC0 1.0\n');
  const overlappingText = 'This sentence already exists.';
  const baseline = Buffer.from(
    JSON.stringify({
      inputTreeSha256: 'a'.repeat(64),
      documents: [{ normalizedSha256: sha256(normalize(overlappingText)) }],
    }),
    'utf8',
  );
  writeUtf8(
    workspaceRoot,
    'scripts/corpus/_web-cache/autocomplete-v2-free/baseline.json',
    baseline.toString('utf8'),
  );

  const projectRecords = {
    zh: [
      { documentId: 'zh01', text: '今天整理项目记录并确认下一步。', family: 'zh' },
      {
        documentId: 'zh02',
        text: options.unsafeProjectText
          ? '详情见 https://example.com/private'
          : '下午继续核对计划中的剩余事项。',
        family: 'zh',
      },
    ],
    en: [
      { documentId: 'en01', text: 'Review the plan before the next step.', family: 'en' },
      { documentId: 'en02', text: 'Keep the final note short and clear.', family: 'en' },
    ],
  };
  const projectSources = Object.entries(projectRecords).map(([language, records]) => {
    const relativePath = `synthetic-${language}/pack-01.jsonl`;
    const packBytes = writeUtf8(
      workspaceRoot,
      `scripts/corpus/_web-cache/generated-project-owned/${relativePath}`,
      `${records.map((record) => JSON.stringify(record)).join('\n')}\n`,
    );
    return {
      id: `synthetic-${language}`,
      language,
      category: language === 'zh' ? 'zh-note' : 'en-note',
      licenseId: 'MIT',
      logicalDocuments: records.length,
      packCount: 1,
      familyCode: language,
      packs: [
        {
          relativePath,
          logicalDocuments: records.length,
          physicalBytes: packBytes.byteLength,
          sha256: sha256(packBytes),
        },
      ],
    };
  });
  const metadata = Buffer.from(
    JSON.stringify({
      schemaVersion: 1,
      generatorVersion: 'fixture-generator-v1',
      seed: 'fixture-seed',
      licenseId: 'MIT',
      licenseEvidence: '../../../../LICENSE',
      totalLogicalDocuments: 4,
      totalPacks: 2,
      sources: projectSources,
    }),
    'utf8',
  );
  writeUtf8(
    workspaceRoot,
    'scripts/corpus/_web-cache/generated-project-owned/_metadata.json',
    metadata.toString('utf8'),
  );

  const tatoebaBytes = writeUtf8(
    workspaceRoot,
    'scripts/corpus/_web-cache/autocomplete-v2r/external/tatoeba/cleaned.jsonl',
    `${[
      { id: 1, text: overlappingText },
      { id: 2, text: 'A fresh public-domain sentence.' },
      { id: 3, text: 'Another public-domain note.' },
    ]
      .map((record) => JSON.stringify(record))
      .join('\n')}\n`,
  );
  const report = Buffer.from(
    JSON.stringify({
      schema: 'jotluck.autocomplete.v2r-tatoeba-cleaning.v1',
      schemaVersion: 1,
      cleanerVersion: 'fixture-cleaner-v1',
      outputSha256: sha256(tatoebaBytes),
      outputBytes: tatoebaBytes.byteLength,
    }),
    'utf8',
  );
  writeUtf8(
    workspaceRoot,
    'scripts/corpus/_web-cache/autocomplete-v2r/external/tatoeba/report.json',
    report.toString('utf8'),
  );

  const outputRoot = options.escapedOutput
    ? '../escaped-output'
    : 'scripts/corpus/_web-cache/autocomplete-v2-free/supplement';
  const outputManifest = 'scripts/corpus/_web-cache/autocomplete-v2-free/supplement.manifest.json';
  const configPath = 'scripts/corpus/autocomplete-v2-free-supplement.json';
  const plan: V2FreeSupplementPlan = {
    schema: V2_FREE_SUPPLEMENT_PLAN_SCHEMA,
    schemaVersion: 1,
    datasetId: 'fixture-supplement-v1',
    materializerVersion: 'fixture-materializer-v1',
    selectionSeed: 'fixture-seed',
    baselineSelection: {
      ...pin('scripts/corpus/_web-cache/autocomplete-v2-free/baseline.json', baseline),
      inputTreeSha256: 'a'.repeat(64),
    },
    outputRoot,
    outputManifest,
    targets: {
      minimumTotalBytes: 48,
      languageBytes: { zh: 16, en: 32 },
    },
    projectOwned: {
      metadata: pin('scripts/corpus/_web-cache/generated-project-owned/_metadata.json', metadata),
      licenseEvidence: { ...pin('LICENSE', mit), spdx: 'MIT' },
      sources: [
        {
          metadataSourceId: 'synthetic-zh',
          outputSourceId: 'supplement-zh',
          targetBytes: 16,
        },
        {
          metadataSourceId: 'synthetic-en',
          outputSourceId: 'supplement-en',
          targetBytes: 16,
        },
      ],
    },
    tatoeba: {
      outputSourceId: 'supplement-tatoeba-en',
      language: 'en',
      category: 'reading-note',
      targetBytes: 16,
      cleaned: pin(
        'scripts/corpus/_web-cache/autocomplete-v2r/external/tatoeba/cleaned.jsonl',
        tatoebaBytes,
      ),
      cleaningReport: pin(
        'scripts/corpus/_web-cache/autocomplete-v2r/external/tatoeba/report.json',
        report,
      ),
      licenseEvidence: {
        ...pin('scripts/corpus/licenses/tatoeba-cc0.md', cc0),
        spdx: 'CC0-1.0',
      },
      cleanerVersion: 'fixture-cleaner-v1',
    },
  };
  writeUtf8(workspaceRoot, configPath, JSON.stringify(plan));
  return {
    workspaceRoot,
    configPath,
    packPath: 'scripts/corpus/_web-cache/generated-project-owned/synthetic-zh/pack-01.jsonl',
    outputRoot,
    outputManifest,
  };
}

afterAll(() => {
  rmSync(TEST_ROOT, { recursive: true, force: true });
});

describe('V2 free supplement materializer', () => {
  it('materializes deterministic bilingual documents and excludes baseline identities', async () => {
    const first = createFixture();
    const second = createFixture();
    const firstManifest = await materializeV2FreeSupplement(first);
    const secondManifest = await materializeV2FreeSupplement(second);

    expect(firstManifest.schema).toBe('jotluck.autocomplete.v2-free-supplement.v1');
    expect(firstManifest.selectedBytes).toBeGreaterThanOrEqual(48);
    expect(firstManifest.languageBytes.zh).toBeGreaterThanOrEqual(16);
    expect(firstManifest.languageBytes.en).toBeGreaterThanOrEqual(32);
    expect(firstManifest.inputTreeSha256).toBe(secondManifest.inputTreeSha256);
    expect(firstManifest.documents).toEqual(secondManifest.documents);
    expect(firstManifest.documents).not.toContainEqual(
      expect.objectContaining({
        normalizedSha256: sha256(normalize('This sentence already exists.')),
      }),
    );
    expect(
      firstManifest.documents.every((document) =>
        existsSync(path.join(first.workspaceRoot, ...document.relativePath.split('/'))),
      ),
    ).toBe(true);
  });

  it('fails closed when a project-owned pack no longer matches its pinned SHA', async () => {
    const fixture = createFixture();
    writeFileSync(path.join(fixture.workspaceRoot, ...fixture.packPath.split('/')), 'tampered\n');
    await expect(materializeV2FreeSupplement(fixture)).rejects.toThrow(
      /project-owned pack (?:byte|SHA-256) identity mismatch/u,
    );
    expect(existsSync(path.join(fixture.workspaceRoot, ...fixture.outputRoot.split('/')))).toBe(
      false,
    );
  });

  it('rejects URLs before materializing any training document', async () => {
    const fixture = createFixture({ unsafeProjectText: true });
    await expect(materializeV2FreeSupplement(fixture)).rejects.toThrow('contains URL');
    expect(existsSync(path.join(fixture.workspaceRoot, ...fixture.outputRoot.split('/')))).toBe(
      false,
    );
  });

  it('rejects output path traversal before creating files', async () => {
    const fixture = createFixture({ escapedOutput: true });
    await expect(materializeV2FreeSupplement(fixture)).rejects.toThrow(
      'Repository-relative path is invalid',
    );
    expect(existsSync(path.join(fixture.workspaceRoot, 'escaped-output'))).toBe(false);
  });
});
