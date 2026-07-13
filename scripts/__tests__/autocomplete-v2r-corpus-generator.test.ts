import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { sha256 } from '../autocomplete-v2r/common';
import {
  findNearDuplicatePairs,
  selectV2RCorpus,
  validateV2RCorpusSelection,
  type V2RCorpusCandidate,
  type V2RCorpusSource,
} from '../autocomplete-v2r/corpus-governance';
import {
  generateProjectOwnedDocumentsV3,
  PROJECT_OWNED_GENERATOR_V3,
  PROJECT_OWNED_SOURCE_PLANS_V3,
  resolveProjectOwnedV3Root,
} from '../autocomplete-v2r/generator-v3';
import { V2R_REPOSITORY_ROOT } from '../autocomplete-v2r/workspace';

const CREATED_AT = '2026-07-12T00:00:00.000Z';

function letterText(id: string): string {
  return sha256(id)
    .slice(0, 10)
    .replace(/0/gu, 'k')
    .replace(/1/gu, 'l')
    .replace(/2/gu, 'm')
    .replace(/3/gu, 'n')
    .replace(/4/gu, 'p')
    .replace(/5/gu, 'q')
    .replace(/6/gu, 'r')
    .replace(/7/gu, 's')
    .replace(/8/gu, 't')
    .replace(/9/gu, 'v');
}

function makeSmallCorpus(): { sources: V2RCorpusSource[]; documents: V2RCorpusCandidate[] } {
  const plans = PROJECT_OWNED_SOURCE_PLANS_V3;
  const sources = plans.map<V2RCorpusSource>((plan) => ({
    id: plan.id,
    kind: 'project-owned',
    language: plan.language,
    category: plan.category,
    contentRoot: plan.relativeDirectory,
    licenseSpdx: 'MIT',
    licenseEvidencePath: 'LICENSE',
    contentTreeSha256: 'a'.repeat(64),
    collectedAt: CREATED_AT,
    cleanerVersion: PROJECT_OWNED_GENERATOR_V3,
    generatorVersion: PROJECT_OWNED_GENERATOR_V3,
    generatorSeed: 'unit-seed',
  }));
  const documents = Array.from({ length: 100 }, (_, index): V2RCorpusCandidate => {
    const plan = plans[index % plans.length]!;
    const documentId = `document-${index.toString().padStart(3, '0')}`;
    return {
      documentId,
      sourceId: plan.id,
      language: plan.language,
      category: plan.category,
      relativePath: `${plan.relativeDirectory}/${documentId}.md`,
      text: letterText(documentId),
    };
  });
  return { sources, documents };
}

describe('V2R corpus selection and project-owned generator v3', () => {
  it('resolves the generated root from module location and supports root injection', () => {
    expect(resolveProjectOwnedV3Root()).toBe(
      path.join(
        V2R_REPOSITORY_ROOT,
        'scripts/corpus/_web-cache/autocomplete-v2r/generated-project-owned-v3.1',
      ),
    );
    expect(resolveProjectOwnedV3Root('D:/isolated-workspace')).toBe(
      path.resolve(
        'D:/isolated-workspace/scripts/corpus/_web-cache/autocomplete-v2r/generated-project-owned-v3.1',
      ),
    );
  });

  it('generates ten deterministic language/category families without writing files', () => {
    const first = generateProjectOwnedDocumentsV3(3);
    const second = generateProjectOwnedDocumentsV3(3);

    expect(PROJECT_OWNED_SOURCE_PLANS_V3).toHaveLength(10);
    expect(new Set(first.map((document) => `${document.language}:${document.category}`)).size).toBe(
      10,
    );
    expect(first).toEqual(second);
    expect(new Set(first.map((document) => document.sha256)).size).toBe(first.length);
    expect(
      first.every((document) => document.generatorVersion === PROJECT_OWNED_GENERATOR_V3),
    ).toBe(true);
  });

  it('keeps generated note skeletons diverse at document level', () => {
    const documents = generateProjectOwnedDocumentsV3(500);
    const templates = new Map<string, number>();
    const trigramDocuments = new Map<string, number>();

    for (const document of documents) {
      templates.set(document.templateId, (templates.get(document.templateId) ?? 0) + 1);
      const units =
        document.language === 'en'
          ? (document.text
              .normalize('NFKC')
              .toLocaleLowerCase('en-US')
              .match(/[a-z]+(?:['’-][a-z]+)*/gu) ?? [])
          : Array.from(document.text.normalize('NFKC')).filter((point) =>
              /\p{Script=Han}/u.test(point),
            );
      const trigrams = new Set<string>();
      for (let index = 0; index <= units.length - 3; index++) {
        trigrams.add(units.slice(index, index + 3).join(document.language === 'en' ? ' ' : ''));
      }
      for (const trigram of trigrams) {
        trigramDocuments.set(trigram, (trigramDocuments.get(trigram) ?? 0) + 1);
      }
    }

    expect(Math.max(...templates.values()) / documents.length).toBeLessThanOrEqual(0.005);
    expect(Math.max(...trigramDocuments.values()) / documents.length).toBeLessThanOrEqual(0.08);
    expect(
      documents.some((document) =>
        /(?:^记录[一二三四]：|^Entry [A-D]:|review stayed within)/imu.test(document.text),
      ),
    ).toBe(false);
  });

  it('builds a deterministic 80/10/10 member manifest and validates byte identity and quotas', () => {
    const { sources, documents } = makeSmallCorpus();
    const options = {
      datasetId: 'unit-v2r-corpus',
      createdAt: CREATED_AT,
      selectionSeed: 'selection-seed',
      targetBytes: { train: 800, development: 100, internalSelection: 100 },
    } as const;
    const first = selectV2RCorpus(documents, sources, options);
    const second = selectV2RCorpus(documents, sources, options);

    expect(first).toEqual(second);
    expect(first.status).toBe('complete');
    expect(first.selectedBytes).toEqual(options.targetBytes);
    expect(validateV2RCorpusSelection(first, documents)).toMatchObject({
      totalBytes: 1000,
      projectOwnedRatio: 1,
      exactDuplicates: 0,
      holdoutExactOverlaps: 0,
    });
  });

  it('fails closed on novel-zh, unknown license, duplicate, and holdout leakage', () => {
    const { sources, documents } = makeSmallCorpus();
    const options = {
      datasetId: 'unit-v2r-corpus',
      createdAt: CREATED_AT,
      selectionSeed: 'selection-seed',
      targetBytes: { train: 800, development: 100, internalSelection: 100 },
    } as const;

    const isolated = structuredClone(documents);
    isolated[0]!.relativePath = 'scripts/corpus/_web-cache/autocomplete-v2r/novel-zh/forbidden.md';
    expect(() => selectV2RCorpus(isolated, sources, options)).toThrow(/novel-zh/u);

    const badSources = structuredClone(sources);
    badSources[0]!.kind = 'tatoeba-cc0';
    expect(() =>
      validateV2RCorpusSelection(selectV2RCorpus(documents, badSources, options), documents),
    ).toThrow(/CC0-1.0/u);

    const duplicateDocuments = structuredClone(documents);
    duplicateDocuments[1]!.text = duplicateDocuments[0]!.text;
    const duplicateManifest = selectV2RCorpus(duplicateDocuments, sources, options);
    expect(() => validateV2RCorpusSelection(duplicateManifest, duplicateDocuments)).toThrow(
      /exact duplicates/u,
    );

    const manifest = selectV2RCorpus(documents, sources, options);
    expect(() =>
      validateV2RCorpusSelection(manifest, documents, [
        { id: 'held-out', text: documents[0]!.text },
      ]),
    ).toThrow(/exact holdout overlap/u);
  });

  it('rejects a document-level repeated skeleton even when every document is unique', () => {
    const { sources, documents } = makeSmallCorpus();
    for (const [index, document] of documents.entries()) {
      const unique = Array.from({ length: 4 }, (_, position) =>
        String.fromCharCode(97 + (Math.floor(index / 26 ** position) % 26)),
      ).join('');
      document.text = `a b c ${unique}`;
    }
    const options = {
      datasetId: 'unit-v2r-collapsed-corpus',
      createdAt: CREATED_AT,
      selectionSeed: 'selection-seed',
      targetBytes: { train: 800, development: 100, internalSelection: 100 },
    } as const;
    const manifest = selectV2RCorpus(documents, sources, options);

    expect(() =>
      validateV2RCorpusSelection(manifest, documents, [], {
        nearDuplicateThreshold: 1,
      }),
    ).toThrow(/document-level 3-gram ratio exceeds 8%/iu);
  });

  it('detects near-duplicate prose without an all-pairs corpus scan', () => {
    const pairs = findNearDuplicatePairs(
      [
        { id: 'a', text: 'The careful review recorded the same stable observation before lunch.' },
        { id: 'b', text: 'The careful review recorded the same stable observation before dinner.' },
        { id: 'c', text: 'A separate household plan covers groceries and storage.' },
      ],
      0.75,
    );

    expect(pairs).toContainEqual(['a', 'b']);
    expect(pairs).not.toContainEqual(['a', 'c']);
  });
});
