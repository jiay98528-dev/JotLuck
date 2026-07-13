import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildAutocompleteV2REvaluationBundle } from '../build-autocomplete-v2r-evaluation-bundle';
import {
  canonicalSha256,
  sha256,
  V2R_CACHE_RELATIVE_ROOT,
  V2R_REPOSITORY_ROOT,
} from '../autocomplete-v2r/index';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe('V2R evaluation-only bundle', () => {
  it('stages a frozen candidate in dist without touching packages/app/public', async () => {
    const fixture = await createEligibleCandidate();
    const manifestPath = await buildAutocompleteV2REvaluationBundle({
      workspaceRoot: fixture.workspaceRoot,
      candidateDir: fixture.candidateDir,
      buildApp: false,
    });

    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<string, unknown>;
    expect(manifest).toMatchObject({
      schema: 'jotluck.autocomplete.public-model.v5',
      engine: 'public-phrase-transformer-v1',
      evaluationOnly: true,
      candidateId: 'candidate-8192-98528',
      runtimeEligible: true,
      qualityGatePassed: false,
      releaseEligible: false,
    });
    expect(
      Array.from(await readFile(path.join(path.dirname(manifestPath), 'model.int8.onnx'))),
    ).toEqual(Array.from(fixture.model));
    expect(
      await readFile(path.join(fixture.workspaceRoot, 'packages/app/public/sentinel.txt'), 'utf8'),
    ).toBe('untouched');
    await expect(
      readFile(
        path.join(
          fixture.workspaceRoot,
          'packages/app/public/autocomplete-v2r-evaluation/manifest.json',
        ),
      ),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('refuses a candidate that has not passed the internal quality gates', async () => {
    const fixture = await createEligibleCandidate();
    const reportPath = path.join(
      fixture.workspaceRoot,
      fixture.candidateDir,
      'training-report.json',
    );
    const report = JSON.parse(await readFile(reportPath, 'utf8')) as Record<string, unknown>;
    report.internalQualityGatePassed = false;
    report.candidateEligible = false;
    await writeJson(reportPath, report);

    await expect(
      buildAutocompleteV2REvaluationBundle({
        workspaceRoot: fixture.workspaceRoot,
        candidateDir: fixture.candidateDir,
        buildApp: false,
      }),
    ).rejects.toThrow('internally eligible');
  });

  it('rejects a cache that labels a phrase-bank miss as silence', async () => {
    const fixture = await createEligibleCandidate();
    const reportPath = path.join(
      fixture.workspaceRoot,
      V2R_CACHE_RELATIVE_ROOT,
      'training',
      '8192',
      'training-data-report.json',
    );
    const report = JSON.parse(await readFile(reportPath, 'utf8')) as Record<string, unknown>;
    const samples = report.samples as Record<string, Record<string, unknown>>;
    samples.train!.abstainReasons = { bankMiss: 1, documentEnd: 9 };
    const identity = { ...report };
    delete identity.reportSha256;
    report.reportSha256 = canonicalSha256(identity);
    await writeJson(reportPath, report);
    const trainingReportPath = path.join(
      fixture.workspaceRoot,
      fixture.candidateDir,
      'training-report.json',
    );
    const trainingReport = JSON.parse(await readFile(trainingReportPath, 'utf8')) as Record<
      string,
      unknown
    >;
    trainingReport.trainingDataReportSha256 = report.reportSha256;
    await writeJson(trainingReportPath, trainingReport);

    await expect(
      buildAutocompleteV2REvaluationBundle({
        workspaceRoot: fixture.workspaceRoot,
        candidateDir: fixture.candidateDir,
        buildApp: false,
      }),
    ).rejects.toThrow('non-silence abstain');
  });

  it('rejects generator provenance that diverges from the source registry', async () => {
    const fixture = await createEligibleCandidate();
    const generatorPath = path.join(
      fixture.workspaceRoot,
      V2R_CACHE_RELATIVE_ROOT,
      'generator-report.json',
    );
    const generator = JSON.parse(await readFile(generatorPath, 'utf8')) as Record<string, unknown>;
    generator.generatorSeed = 'tampered-seed';
    await writeJson(generatorPath, generator);

    await expect(
      buildAutocompleteV2REvaluationBundle({
        workspaceRoot: fixture.workspaceRoot,
        candidateDir: fixture.candidateDir,
        buildApp: false,
      }),
    ).rejects.toThrow('frozen generator identity');
  });
});

async function createEligibleCandidate(): Promise<{
  workspaceRoot: string;
  candidateDir: string;
  model: Uint8Array;
}> {
  const workspaceRoot = await mkdtemp(path.join(V2R_REPOSITORY_ROOT, '.tmp-v2r-eval-'));
  temporaryRoots.push(workspaceRoot);
  const candidateDir = `${V2R_CACHE_RELATIVE_ROOT}/candidates/candidate-8192-98528`;
  const candidateRoot = path.join(workspaceRoot, candidateDir);
  const cacheRoot = path.join(workspaceRoot, V2R_CACHE_RELATIVE_ROOT);
  const trainingRoot = path.join(cacheRoot, 'training', '8192');
  const publicRoot = path.join(workspaceRoot, 'packages', 'app', 'public');
  await Promise.all([
    mkdir(candidateRoot, { recursive: true }),
    mkdir(trainingRoot, { recursive: true }),
    mkdir(publicRoot, { recursive: true }),
  ]);
  await writeFile(path.join(publicRoot, 'sentinel.txt'), 'untouched', 'utf8');

  const model = Uint8Array.from([1, 4, 9, 16, 25]);
  const operatorConfig = new TextEncoder().encode('ai.onnx;13;Add,MatMul\n');
  const runtime = Uint8Array.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);
  const phraseBank = new TextEncoder().encode(
    `${Array.from({ length: 8192 }, (_, index) =>
      JSON.stringify({ id: `en.${index}`, text: ` phrase number ${index}`, language: 'en' }),
    ).join('\n')}\n`,
  );
  const metadata = new TextEncoder().encode(
    `${JSON.stringify({
      schema: 'jotluck.autocomplete.public-runtime-metadata.v1',
      schemaVersion: 1,
      abstainIndex: 8192,
      byteTokenizer: { sequenceLength: 192, patchBytes: 4, alignment: 'right' },
    })}\n`,
  );
  const phrasePath = `${V2R_CACHE_RELATIVE_ROOT}/training/8192/phrase-bank.jsonl`;
  await Promise.all([
    writeFile(path.join(candidateRoot, 'model.int8.onnx'), model),
    writeFile(path.join(candidateRoot, 'runtime-metadata.json'), metadata),
    writeFile(path.join(candidateRoot, 'required-operators.config'), operatorConfig),
    writeFile(path.join(candidateRoot, 'ort-wasm-simd-threaded.reduced.wasm'), runtime),
    writeFile(path.join(trainingRoot, 'phrase-bank.jsonl'), phraseBank),
  ]);

  const sourceRegistry = [
    {
      id: 'project-v3-fixture',
      kind: 'project-owned',
      licenseSpdx: 'MIT',
      generatorVersion: 'jotluck-project-owned-short-notes-v3.1',
      generatorSeed: 'v2r-project-owned-2026-07-12-b',
    },
  ];
  const selectionDocuments = [{ documentId: 'fixture-document', sha256: '2'.repeat(64) }];
  const selectionWithoutIdentity = {
    schema: 'jotluck.autocomplete.v2r-corpus-selection.v1',
    schemaVersion: 1,
    datasetId: 'fixture-selection',
    createdAt: '2026-07-12T00:00:00.000Z',
    status: 'complete',
    sources: sourceRegistry,
    documents: selectionDocuments,
    selectedBytes: { train: 1024, development: 512, internalSelection: 512 },
  };
  const selectionSha256 = canonicalSha256(selectionWithoutIdentity);
  const selection = { ...selectionWithoutIdentity, selectionSha256 };
  const governance = {
    selectionSha256,
    exactDuplicates: 0,
    nearDuplicates: 0,
    forbiddenTextMatches: 0,
    unapprovedLicenseSources: 0,
    isolatedNovelZhReferences: 0,
    maxDocumentTrigramRatio: 0.05,
    holdoutDocumentsAudited: 200,
    holdoutInputTreeSha256: '5'.repeat(64),
  };
  const generator = {
    schema: 'jotluck.autocomplete.v2r-generator-report.v1',
    schemaVersion: 1,
    generatorVersion: 'jotluck-project-owned-short-notes-v3.1',
    generatorSeed: 'v2r-project-owned-2026-07-12-b',
    selectionSha256,
    inputTreeSha256: canonicalSha256(
      selectionDocuments.map((document) => ({
        id: document.documentId,
        sha256: document.sha256,
      })),
    ),
    sourceTreeSha256: canonicalSha256(sourceRegistry),
    governanceSha256: canonicalSha256(governance),
    holdoutTreeSha256: '6'.repeat(64),
    holdoutScope: 'validation-only-before-candidate-freeze-v1',
    holdoutDocumentsAudited: 200,
    releaseEvidence: true,
  };
  const trainingInputWithoutIdentity = {
    schema: 'jotluck.autocomplete.v2r-training-data.v3',
    schemaVersion: 3,
    phraseBankSize: 8192,
    selectionSha256,
    phraseBankSha256: sha256(phraseBank),
    phraseBankBytes: phraseBank.byteLength,
    maxPhraseDocumentRatio: 0.05,
    maxStructuralPhraseDocumentRatio: 0.04,
    samples: Object.fromEntries(
      ['train', 'development', 'internalSelection'].map((split) => [
        split,
        { abstain: 10, abstainReasons: { bankMiss: 0, documentEnd: 10 } },
      ]),
    ),
  };
  const trainingDataReportSha256 = canonicalSha256(trainingInputWithoutIdentity);
  const trainingInput = {
    ...trainingInputWithoutIdentity,
    reportSha256: trainingDataReportSha256,
  };
  const quantizationReport = { schema: 'fixture-quantization', passed: true };
  const quantizationBytes = new TextEncoder().encode(`${JSON.stringify(quantizationReport)}\n`);
  const trainingReport = {
    schema: 'jotluck.autocomplete.v2r-training-report.v1',
    schemaVersion: 1,
    engine: 'public-phrase-transformer-v1',
    architecture: {
      phraseBankSize: 8192,
      hiddenSize: 96,
      layers: 2,
      attentionHeads: 4,
      contextUtf8Bytes: 192,
      contextPatchBytes: 4,
    },
    seed: 98528,
    trainingDataReportSha256,
    labelSemantics: {
      kind: 'multi-target-complete-prefix-v1',
      maximumAcceptableLabels: 32,
      abstainClassWeight: 1,
      abstainReasonPolicy: 'document-end-only-v1',
      bankMissIsCoverageOnly: true,
    },
    assets: {
      int8: { bytes: model.byteLength, sha256: sha256(model) },
      phraseBank: { path: phrasePath, bytes: phraseBank.byteLength, sha256: sha256(phraseBank) },
      metadata: { bytes: metadata.byteLength, sha256: sha256(metadata) },
      operatorConfig: {
        bytes: operatorConfig.byteLength,
        sha256: sha256(operatorConfig),
      },
    },
    quantizationReport: { path: 'quantization-report.json', sha256: sha256(quantizationBytes) },
    quantizationPassed: true,
    candidateCapabilityPassed: true,
    thresholdCalibrationPassed: true,
    internalQualityGatePassed: true,
    candidateEligible: true,
    releaseEligible: false,
  };
  const runtimeBuildWithoutIdentity = {
    schema: 'jotluck.autocomplete.v2r-runtime-build.v1',
    schemaVersion: 1,
    reducedOperatorBuild: true,
    modelSha256: sha256(model),
    operatorConfigSha256: sha256(operatorConfig),
    runtimeSha256: sha256(runtime),
    runtimeBytes: runtime.byteLength,
    passed: true,
  };
  const runtimeBuild = {
    ...runtimeBuildWithoutIdentity,
    reportSha256: canonicalSha256(runtimeBuildWithoutIdentity),
  };
  await Promise.all([
    writeJson(path.join(cacheRoot, 'selection-manifest.json'), selection),
    writeJson(path.join(cacheRoot, 'source-registry.json'), sourceRegistry),
    writeJson(path.join(cacheRoot, 'governance-report.json'), governance),
    writeJson(path.join(cacheRoot, 'generator-report.json'), generator),
    writeJson(path.join(trainingRoot, 'training-data-report.json'), trainingInput),
    writeJson(path.join(candidateRoot, 'training-report.json'), trainingReport),
    writeFile(path.join(candidateRoot, 'quantization-report.json'), quantizationBytes),
    writeJson(path.join(candidateRoot, 'runtime-build-report.json'), runtimeBuild),
  ]);
  return { workspaceRoot, candidateDir, model };
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}
