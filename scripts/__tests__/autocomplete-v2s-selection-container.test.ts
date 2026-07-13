import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import {
  finalizeV2SManifest,
  packV2SContainer,
  unpackV2SContainer,
  verifyV2SManifest,
} from '../autocomplete-v2s/container-v6';
import { calculateAbsoluteOracle } from '../autocomplete-v2s/metrics';
import { deriveV2SSelection, verifyV2SSelection } from '../autocomplete-v2s/selection';
import { sha256, V2S_ENGINE_ID } from '../autocomplete-v2s/common';
import { trainV2SCandidate } from '../autocomplete-v2s/trainer';
// @ts-expect-error See scripts/verify-autocomplete-v2s-evidence.mjs.
import {
  createV2SObservationReplay,
  verifyV2SObservationReplay,
} from '../verify-autocomplete-v2s-evidence.mjs';

const roots: string[] = [];
const execFileAsync = promisify(execFile);
const repositoryRoot = path.resolve(import.meta.dirname, '../..');
const testParent = path.join(
  repositoryRoot,
  'scripts/corpus/_web-cache/autocomplete-v2s/test-workspaces',
);

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe('V2S selection and v6 container', () => {
  it('derives a selection only from listed v3.1 documents and recomputes the input tree', async () => {
    const fixture = await createSelectionFixture();
    const selection = await deriveV2SSelection({
      workspaceRoot: fixture.root,
      sourceSelectionPath: fixture.selectionPath,
    });
    expect(selection.documentCount).toBe(2);
    expect(selection.inputTreeSha256).toMatch(/^[0-9a-f]{64}$/u);
    await expect(verifyV2SSelection(selection, fixture.root)).resolves.toBe(selection);

    await writeFile(fixture.documentPaths[0]!, 'tampered', 'utf8');
    await expect(verifyV2SSelection(selection, fixture.root)).rejects.toThrow(/does not match/iu);
  });

  it('accepts only the frozen Tatoeba CC0 source metadata and rejects unknown sources', async () => {
    const fixture = await createSelectionFixture({ external: true });
    await expect(
      deriveV2SSelection({
        workspaceRoot: fixture.root,
        sourceSelectionPath: fixture.selectionPath,
      }),
    ).resolves.toMatchObject({ documentCount: 2 });

    const sourcePath = path.join(fixture.root, ...fixture.selectionPath.split('/'));
    const source = JSON.parse(await readFile(sourcePath, 'utf8')) as {
      sources: Array<Record<string, unknown>>;
    };
    source.sources[0]!.id = 'unknown-web-source';
    await writeFile(sourcePath, JSON.stringify(source), 'utf8');
    await expect(
      deriveV2SSelection({
        workspaceRoot: fixture.root,
        sourceSelectionPath: fixture.selectionPath,
      }),
    ).rejects.toThrow(/unknown V2S source/iu);
  });

  it('executes the derive CLI from another CWD and writes under the injected workspace', async () => {
    const fixture = await createSelectionFixture();
    const cliPath = path.join(repositoryRoot, 'scripts/autocomplete-v2s/cli.ts');
    const tsxPath = path.join(repositoryRoot, 'node_modules/tsx/dist/cli.mjs');
    const { stdout } = await execFileAsync(
      process.execPath,
      [
        tsxPath,
        cliPath,
        'derive',
        '--source',
        fixture.selectionPath,
        '--candidate-id',
        'cli-entry-smoke',
        '--max-documents',
        '2',
        '--workspace-root',
        fixture.root,
      ],
      { cwd: path.join(repositoryRoot, 'packages/app') },
    );
    const expected = path.join(
      fixture.root,
      'scripts/corpus/_web-cache/autocomplete-v2s/candidates/cli-entry-smoke/selection.json',
    );
    expect(stdout.trim()).toBe(expected);
    await expect(readFile(expected, 'utf8')).resolves.toContain(
      'jotluck.autocomplete.v2s-corpus-selection.v1',
    );
  });

  it('packs one deterministic container and rejects section corruption', () => {
    const packed = packV2SContainer([
      { id: 'tokenizer.zh', bytes: new TextEncoder().encode('zh') },
      { id: 'lm.zh', bytes: new Uint8Array([1, 2, 3]) },
    ]);
    const unpacked = unpackV2SContainer(packed.bytes);
    expect(unpacked.header.engine).toBe(V2S_ENGINE_ID);
    expect([...unpacked.sections.keys()]).toEqual(['tokenizer.zh', 'lm.zh']);
    expect(unpacked.headerSha256).toBe(packed.headerSha256);

    const corrupted = packed.bytes.slice();
    corrupted[corrupted.length - 1] ^= 0xff;
    expect(() => unpackV2SContainer(corrupted)).toThrow(/SHA-256/iu);
  });

  it('rejects perfect-looking observation JSON that disagrees with actual bound-model replay', async () => {
    const fixture = await createSelectionFixture();
    const selection = await deriveV2SSelection({
      workspaceRoot: fixture.root,
      sourceSelectionPath: fixture.selectionPath,
    });
    const selectionPath = 'scripts/corpus/_web-cache/autocomplete-v2s/candidates/rs/selection.json';
    const selectionAbsolutePath = path.join(fixture.root, ...selectionPath.split('/'));
    await mkdir(path.dirname(selectionAbsolutePath), { recursive: true });
    await writeFile(selectionAbsolutePath, JSON.stringify(selection), 'utf8');
    await rm(path.join(fixture.root, 'scripts/corpus/_web-cache/autocomplete-v2s/candidates/r'), {
      recursive: true,
      force: true,
    });
    const result = await trainV2SCandidate({
      workspaceRoot: fixture.root,
      selectionPath,
      matrixId: '3mib-bpe-3mib',
      candidateId: 'r',
      gateKind: 'g0',
      gateSamples: [
        {
          features: [1, 0.8, 1, 0.5, 0.6, 1, 0, 0, 1, 0],
          label: 'show',
          group: 'fit-show-zh',
          language: 'zh',
          expectedBehavior: 'complete',
          calibrationRole: 'fit',
        },
        {
          features: [0.1, 0, 0.4, 0.1, 0.2, 0, 1, 0, 0, 1],
          label: 'silence',
          group: 'fit-silence-en',
          language: 'en',
          expectedBehavior: 'silence',
          calibrationRole: 'fit',
        },
        {
          features: [0, 0, 0, 0, 0, 0, 0, 1, 1, 0],
          label: 'bank-miss',
          group: 'calibration-bank-zh',
          language: 'zh',
          expectedBehavior: 'complete',
          calibrationRole: 'calibration',
        },
      ],
      vocabularyLimit: 64,
      maxOrder: 3,
    });
    const assetBytes = await readFile(path.join(result.directory, 'public-v2s.bin'));
    const modelSha256 = sha256(assetBytes);
    const options = {
      rootDir: repositoryRoot,
      assetBytes,
      modelSha256,
      holdoutSha256: 'a'.repeat(64),
      evaluatorTreeSha256: 'b'.repeat(64),
      classification: 'cold-validation-v2s-v1',
      checkpoints: [
        {
          checkpointId: 'replay-en-1',
          text: 'Meeting notes are ready, confirm the owner next.',
          cursorOffset: 'Meeting notes are ready'.length,
          language: 'en',
        },
      ],
    };
    const actual = createV2SObservationReplay(options);
    expect(actual).toHaveLength(1);
    expect(() =>
      verifyV2SObservationReplay({
        ...options,
        observations: [
          {
            checkpointId: 'replay-en-1',
            publicCandidates: [
              {
                text: ' fabricated perfect completion',
                providerId: 'public-v2s-mkn-v1',
                sourceLayer: 'l3',
              },
            ],
            replayReceipt: actual[0]!.receipt,
          },
        ],
      }),
    ).toThrow(/inconsistent with actual bound-model output/u);
  });

  it('keeps candidate manifests fail-closed and counts Oracle against every opportunity', () => {
    const manifest = finalizeV2SManifest({
      schema: 'jotluck.autocomplete.public-model.v6',
      schemaVersion: 6,
      engine: V2S_ENGINE_ID,
      profile: 'candidate',
      candidateId: 'fixture',
      architecture: {
        languages: ['zh', 'en'],
        tokenizers: { zh: 'bpe', en: 'bpe' },
        vocabularyLimitPerLanguage: 64,
        ngramOrders: [2, 5],
        gateKind: 'g0-rules',
        quantization: 'probability-q16+gate-q16',
        assetBudgetBytes: 1024,
      },
      asset: {
        path: 'scripts/corpus/_web-cache/autocomplete-v2s/candidates/fixture/public-v2s.bin',
        bytes: 32,
        sha256: 'a'.repeat(64),
        containerHeaderSha256: 'b'.repeat(64),
      },
      training: {
        selectionPath: 'selection.json',
        selectionSha256: 'c'.repeat(64),
        inputTreeSha256: 'd'.repeat(64),
        selectedDocumentCount: 2,
        selectedBytes: 100,
      },
      evidenceBindings: {},
      runtimeEligible: false,
      qualityGatePassed: false,
      releaseEligible: false,
      formalResult: false,
    });
    expect(() => verifyV2SManifest(manifest)).not.toThrow();
    expect(() =>
      finalizeV2SManifest({
        ...manifest,
        runtimeEligible: true,
        manifestSha256: undefined,
      } as never),
    ).toThrow(/fail-closed/iu);

    const oracle = calculateAbsoluteOracle([
      { kind: 'complete', representable: true, oracleHit: true, language: 'zh' },
      { kind: 'complete', representable: false, oracleHit: false, language: 'en' },
      { kind: 'silence', representable: false, oracleHit: false, language: 'en' },
    ]);
    expect(oracle.absoluteOracleRate).toBeCloseTo(1 / 3);
    expect(oracle.conditionalRepresentableRate).toBe(1);
    expect(oracle.denominator).toBe('all-opportunities');
  });
});

async function createSelectionFixture(options: { external?: boolean } = {}): Promise<{
  root: string;
  selectionPath: string;
  documentPaths: string[];
}> {
  await mkdir(testParent, { recursive: true });
  const root = await mkdtemp(path.join(testParent, 'selection-'));
  roots.push(root);
  const documentSpecs = options.external
    ? ([
        {
          id: 'tatoeba-cc0-en-100',
          language: 'en',
          text: 'The meeting notes remain local.',
          external: true,
        },
        {
          id: 'fixture-zh-001',
          language: 'zh',
          text: '# 会议记录\n\n下一步确认负责人。',
          external: false,
        },
      ] as const)
    : ([
        {
          id: 'fixture-zh-001',
          language: 'zh',
          text: '# 会议记录\n\n下一步确认负责人。',
          external: false,
        },
        {
          id: 'fixture-en-001',
          language: 'en',
          text: '# Meeting note\n\nConfirm the owner next.',
          external: false,
        },
      ] as const);
  const documents = [];
  const documentPaths: string[] = [];
  for (const spec of documentSpecs) {
    const relativePath = spec.external
      ? `scripts/corpus/_web-cache/autocomplete-v2r/generated-external/tatoeba/en/${spec.id}.md`
      : `scripts/corpus/_web-cache/autocomplete-v2r/generated-project-owned-v3.1/${spec.language}/meeting-note/${spec.id}.md`;
    const absolutePath = path.join(root, ...relativePath.split('/'));
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, spec.text, 'utf8');
    const bytes = await readFile(absolutePath);
    documentPaths.push(absolutePath);
    documents.push({
      documentId: spec.id,
      sourceId: spec.external
        ? 'tatoeba-cc0-en-2026-07-12'
        : `project-v3-${spec.language}-meeting-note`,
      language: spec.language,
      category: spec.external ? 'reading-note' : 'meeting-note',
      relativePath,
      split: 'train',
      bytes: bytes.byteLength,
      sha256: sha256(bytes),
    });
  }
  const source = {
    schema: 'jotluck.autocomplete.v2r-corpus-selection.v1',
    schemaVersion: 1,
    sources: documentSpecs.map((spec) =>
      spec.external
        ? {
            id: 'tatoeba-cc0-en-2026-07-12',
            kind: 'tatoeba-cc0',
            language: 'en',
            category: 'reading-note',
            contentRoot: 'scripts/corpus/_web-cache/autocomplete-v2r/generated-external/tatoeba/en',
            licenseSpdx: 'CC0-1.0',
            licenseEvidencePath: 'scripts/corpus/licenses/tatoeba-cc0.md',
            cleanerVersion: 'jotluck-tatoeba-cc0-cleaner-v1',
          }
        : approvedProjectSource(spec.language, 'meeting-note'),
    ),
    documents,
  };
  const selectionPath = 'scripts/corpus/_web-cache/autocomplete-v2r/selection-manifest.json';
  const selectionAbsolutePath = path.join(root, ...selectionPath.split('/'));
  await mkdir(path.dirname(selectionAbsolutePath), { recursive: true });
  await writeFile(selectionAbsolutePath, JSON.stringify(source), 'utf8');
  return { root, selectionPath, documentPaths };
}

function approvedProjectSource(language: 'zh' | 'en', category: string) {
  return {
    id: `project-v3-${language}-${category}`,
    kind: 'project-owned',
    language,
    category,
    contentRoot: `scripts/corpus/_web-cache/autocomplete-v2r/generated-project-owned-v3.1/${language}/${category}`,
    licenseSpdx: 'MIT',
    licenseEvidencePath: 'LICENSE',
    cleanerVersion: 'jotluck-project-owned-short-notes-v3.1',
    generatorVersion: 'jotluck-project-owned-short-notes-v3.1',
    generatorSeed: 'v2r-project-owned-2026-07-12-b',
  };
}
