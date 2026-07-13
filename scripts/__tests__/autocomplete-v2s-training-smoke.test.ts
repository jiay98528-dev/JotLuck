import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { canonicalJson, sha256, V2S_ENGINE_ID } from '../autocomplete-v2s/common';
import { combineV2SLanguageCandidates } from '../autocomplete-v2s/combine-language-candidates';
import { runV2SCli } from '../autocomplete-v2s/cli';
import { unpackV2SContainer, verifyV2SManifest } from '../autocomplete-v2s/container-v6';
import { deriveV2SSelection } from '../autocomplete-v2s/selection';
import { repackV2SCandidateGate } from '../autocomplete-v2s/repack-gate';
import { trainV2SCandidate } from '../autocomplete-v2s/trainer';
import { parsePublicV2sModel } from '../../packages/app/src/services/completion/public-v2s-binary';

const roots: string[] = [];
const repositoryRoot = path.resolve(import.meta.dirname, '../..');
const testParent = path.join(
  repositoryRoot,
  'scripts/corpus/_web-cache/autocomplete-v2s/test-workspaces',
);

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe('V2S candidate training smoke', () => {
  it('trains a small bilingual fixture into one fail-closed bin under the candidate cache', async () => {
    const fixture = await createTrainingFixture();
    const selection = await deriveV2SSelection({
      workspaceRoot: fixture.root,
      sourceSelectionPath: fixture.sourceSelectionPath,
    });
    const selectionPath =
      'scripts/corpus/_web-cache/autocomplete-v2s/candidates/fixture-selection/selection.json';
    const selectionAbsolutePath = path.join(fixture.root, ...selectionPath.split('/'));
    await mkdir(path.dirname(selectionAbsolutePath), { recursive: true });
    await writeFile(selectionAbsolutePath, `${canonicalJson(selection)}\n`, 'utf8');

    const gateSamples = [
      {
        features: [1, 0.8, 1, 0.5, 0.6, 1, 0, 0, 1, 0],
        label: 'show' as const,
        group: 'fit-show-zh',
        language: 'zh' as const,
        expectedBehavior: 'complete' as const,
        calibrationRole: 'fit' as const,
      },
      {
        features: [0.1, 0, 0.4, 0.1, 0.2, 0, 1, 0, 0, 1],
        label: 'silence' as const,
        group: 'fit-silence-en',
        language: 'en' as const,
        expectedBehavior: 'silence' as const,
        calibrationRole: 'fit' as const,
      },
      {
        features: [0, 0, 0, 0, 0, 0, 0, 1, 1, 0],
        label: 'bank-miss' as const,
        group: 'calibration-bank-zh',
        language: 'zh' as const,
        expectedBehavior: 'complete' as const,
        calibrationRole: 'calibration' as const,
      },
    ];
    const gateSamplesPath =
      'scripts/corpus/_web-cache/autocomplete-v2s/candidates/fixture-selection/gate-samples.json';
    await writeFile(
      path.join(fixture.root, ...gateSamplesPath.split('/')),
      `${JSON.stringify(gateSamples, null, 2)}\n`,
      'utf8',
    );
    const result = await trainV2SCandidate({
      workspaceRoot: fixture.root,
      selectionPath,
      matrixId: '3mib-bpe-3mib',
      candidateId: 'smoke-bpe-g1',
      gateKind: 'g1',
      gateSamples,
      vocabularyLimit: 64,
      maxOrder: 3,
    });
    expect(result.directory.replaceAll('\\', '/')).toContain(
      '/scripts/corpus/_web-cache/autocomplete-v2s/candidates/smoke-bpe-g1',
    );
    expect(result.manifest.engine).toBe(V2S_ENGINE_ID);
    expect(result.manifest.releaseEligible).toBe(false);
    expect(result.report.formalResult).toBe(false);
    expect(result.report.excludedBankMisses).toBe(1);
    expect(result.manifest.architecture).toMatchObject({
      ngramOrders: [2, 3],
      gateKind: 'g1-mlp16-int8',
      quantization: 'probability-q16+gate-int8',
    });
    expect(() => verifyV2SManifest(result.manifest)).not.toThrow();

    const binary = await readFile(path.join(result.directory, 'public-v2s.bin'));
    const unpacked = unpackV2SContainer(binary);
    expect([...unpacked.sections.keys()]).toEqual([
      'tokenizer.zh',
      'tokenizer.en',
      'lm.zh',
      'lm.en',
      'gate',
      'metadata',
    ]);
    const runtime = await parsePublicV2sModel(binary);
    expect(runtime.metadata).toMatchObject({
      schemaVersion: 6,
      engine: V2S_ENGINE_ID,
      candidateId: 'smoke-bpe-g1',
      maxOrder: 3,
      byteLength: binary.byteLength,
      gateFeatureSchema: 'v2s-gate-features-v1',
      gateKind: 'g1-mlp16-int8',
    });

    const unigram = await trainV2SCandidate({
      workspaceRoot: fixture.root,
      selectionPath,
      matrixId: '3mib-unigram-3mib',
      candidateId: 'smoke-unigram-g1',
      gateKind: 'g1',
      gateSamples,
      vocabularyLimit: 64,
      maxOrder: 3,
    });
    const combined = await combineV2SLanguageCandidates({
      workspaceRoot: fixture.root,
      zhCandidateId: 'smoke-unigram-g1',
      enCandidateId: 'smoke-bpe-g1',
      candidateId: 'smoke-mixed-tokenizers-g1',
    });
    expect(combined.manifest.architecture.tokenizers).toEqual({ zh: 'unigram', en: 'bpe' });
    expect(combined.manifest.releaseEligible).toBe(false);
    const combinedSections = unpackV2SContainer(
      await readFile(path.join(combined.directory, 'public-v2s.bin')),
    ).sections;
    const unigramSections = unpackV2SContainer(
      await readFile(path.join(unigram.directory, 'public-v2s.bin')),
    ).sections;
    expect(combinedSections.get('tokenizer.zh')).toEqual(unigramSections.get('tokenizer.zh'));
    expect(combinedSections.get('lm.zh')).toEqual(unigramSections.get('lm.zh'));
    expect(combinedSections.get('tokenizer.en')).toEqual(unpacked.sections.get('tokenizer.en'));
    expect(combinedSections.get('lm.en')).toEqual(unpacked.sections.get('lm.en'));

    const repacked = await repackV2SCandidateGate({
      workspaceRoot: fixture.root,
      sourceCandidateId: 'smoke-bpe-g1',
      candidateId: 'smoke-bpe-g0-repacked',
      gateKind: 'g0',
      gateSamples,
      gateSamplesPath,
    });
    const repackedBinary = await readFile(path.join(repacked.directory, 'public-v2s.bin'));
    const repackedSections = unpackV2SContainer(repackedBinary).sections;
    expect(repackedSections.get('lm.zh')).toEqual(unpacked.sections.get('lm.zh'));
    expect(repackedSections.get('lm.en')).toEqual(unpacked.sections.get('lm.en'));
    const repackedRuntime = await parsePublicV2sModel(repackedBinary);
    expect(repackedRuntime.metadata).toMatchObject({
      candidateId: 'smoke-bpe-g0-repacked',
      gateKind: 'g0-rules',
    });
    expect(repacked.manifest.architecture).toMatchObject({
      ngramOrders: [2, 3],
      gateKind: 'g0-rules',
      quantization: 'probability-q16+gate-q16',
    });
    expect(repacked.manifest.evidenceBindings).toMatchObject({
      gateSamples: { path: gateSamplesPath, sha256: expect.stringMatching(/^[0-9a-f]{64}$/u) },
      gateSamplesCanonical: {
        path: expect.stringMatching(/gate-samples\.canonical\.json$/u),
        sha256: expect.stringMatching(/^[0-9a-f]{64}$/u),
      },
    });
    const repackedReport = JSON.parse(
      await readFile(path.join(repacked.directory, 'training-report.json'), 'utf8'),
    ) as Record<string, unknown>;
    expect(repackedReport).toMatchObject({
      gateCalibrationStatus: 'calibration-failed',
      gateSamples: {
        path: gateSamplesPath,
        count: 3,
        labels: { show: 1, silence: 1, 'bank-miss': 1 },
        calibrationRoles: { fit: 2, calibration: 1 },
        languages: { zh: 2, en: 1 },
      },
    });
    const canonicalGateSamples = await readFile(
      path.join(repacked.directory, 'gate-samples.canonical.json'),
    );
    expect(sha256(canonicalGateSamples)).toBe(
      repacked.manifest.evidenceBindings.gateSamplesCanonical!.sha256,
    );

    await expect(
      runV2SCli(
        [
          'train',
          '--selection',
          selectionPath,
          '--matrix-id',
          '3mib-bpe-3mib',
          '--candidate-id',
          'escape-attempt',
          '--gate-samples',
          '../outside.json',
        ],
        fixture.root,
      ),
    ).rejects.toThrow(/repository-relative path without traversal/u);
  });
});

async function createTrainingFixture(): Promise<{
  root: string;
  sourceSelectionPath: string;
}> {
  await mkdir(testParent, { recursive: true });
  const root = await mkdtemp(path.join(testParent, 'training-'));
  roots.push(root);
  const inputs = [
    ['zh', '会议记录已经整理，下一步确认负责人。'],
    ['en', 'Meeting notes are ready, confirm the owner next.'],
    ['zh', '维护记录保持离线，完成后更新检查结果。'],
    ['en', 'Maintenance notes stay local and record the final check.'],
  ] as const;
  const documents = [];
  const sources = [];
  for (const [index, [language, text]] of inputs.entries()) {
    const category = index < 2 ? 'meeting-note' : 'maintenance-log';
    const documentId = `fixture-${language}-${String(index).padStart(3, '0')}`;
    const sourceId = `project-v3-${language}-${category}`;
    const relativePath = `scripts/corpus/_web-cache/autocomplete-v2r/generated-project-owned-v3.1/${language}/${category}/${documentId}.md`;
    const absolutePath = path.join(root, ...relativePath.split('/'));
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, text, 'utf8');
    const bytes = await readFile(absolutePath);
    documents.push({
      documentId,
      sourceId,
      language,
      category,
      relativePath,
      split: 'train',
      bytes: bytes.byteLength,
      sha256: sha256(bytes),
    });
    sources.push({
      id: sourceId,
      kind: 'project-owned',
      language,
      category,
      contentRoot: `scripts/corpus/_web-cache/autocomplete-v2r/generated-project-owned-v3.1/${language}/${category}`,
      licenseSpdx: 'MIT',
      licenseEvidencePath: 'LICENSE',
      cleanerVersion: 'jotluck-project-owned-short-notes-v3.1',
      generatorVersion: 'jotluck-project-owned-short-notes-v3.1',
      generatorSeed: 'v2r-project-owned-2026-07-12-b',
    });
  }
  const sourceSelectionPath = 'scripts/corpus/_web-cache/autocomplete-v2r/selection-manifest.json';
  const sourceAbsolutePath = path.join(root, ...sourceSelectionPath.split('/'));
  await mkdir(path.dirname(sourceAbsolutePath), { recursive: true });
  await writeFile(
    sourceAbsolutePath,
    JSON.stringify({
      schema: 'jotluck.autocomplete.v2r-corpus-selection.v1',
      schemaVersion: 1,
      sources,
      documents,
    }),
    'utf8',
  );
  return { root, sourceSelectionPath };
}
