import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { canonicalJson } from '../autocomplete-evidence-integrity.mjs';
import { publishAutocompleteV2SFinal } from '../publish-autocomplete-v2s-final';
// @ts-expect-error See scripts/verify-autocomplete-v2s-evidence.mjs.
import { verifyAutocompleteV2SEvidence } from '../verify-autocomplete-v2s-evidence.mjs';

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('V2S final publisher', () => {
  it('atomically migrates legacy fail-closed files to one content-addressed asset', () => {
    const fixture = createFixture();
    const publicDir = path.join(fixture.rootDir, 'packages/app/public');
    fs.writeFileSync(path.join(publicDir, 'baseline-ngram.web-local.compact.txt'), 'legacy');
    fs.writeFileSync(
      path.join(publicDir, 'baseline-ngram.web-local.compact.manifest.json'),
      '{"runtimeEligible":false}',
    );

    const result = publishAutocompleteV2SFinal({
      rootDir: fixture.rootDir,
      candidatePath: fixture.candidatePath,
      expectedEvaluatorFiles: ['evaluator.ts'],
    });

    expect(fs.existsSync(path.join(publicDir, 'baseline-ngram.web-local.compact.txt'))).toBe(false);
    expect(
      fs.existsSync(path.join(publicDir, 'baseline-ngram.web-local.compact.manifest.json')),
    ).toBe(false);
    const canonicalDir = path.join(publicDir, 'autocomplete');
    expect(fs.readdirSync(canonicalDir).sort()).toEqual([
      'autocomplete-public.manifest.json',
      path.basename(result.assetPath),
    ]);
    expect(path.basename(result.assetPath)).toMatch(/^public-v2s-mkn-v1\.[a-f0-9]{64}\.bin$/u);
    expect(
      verifyAutocompleteV2SEvidence({
        rootDir: fixture.rootDir,
        expectedEvaluatorFiles: ['evaluator.ts'],
      }).releaseId,
    ).toBe(result.releaseId);
    expect(() =>
      publishAutocompleteV2SFinal({
        rootDir: fixture.rootDir,
        candidatePath: fixture.candidatePath,
        expectedEvaluatorFiles: ['evaluator.ts'],
      }),
    ).toThrow(/already consumed and published/u);
    expect(fs.readdirSync(canonicalDir).sort()).toEqual([
      'autocomplete-public.manifest.json',
      path.basename(result.assetPath),
    ]);
  });

  it('performs zero public writes when governance fails', () => {
    const fixture = createFixture();
    const publicDir = path.join(fixture.rootDir, 'packages/app/public');
    const legacyModel = path.join(publicDir, 'baseline-ngram.web-local.compact.txt');
    const legacyManifest = path.join(publicDir, 'baseline-ngram.web-local.compact.manifest.json');
    fs.writeFileSync(legacyModel, 'legacy-model');
    fs.writeFileSync(legacyManifest, 'legacy-manifest');
    const governance = JSON.parse(
      fs.readFileSync(path.join(fixture.rootDir, fixture.governancePath), 'utf8'),
    ) as { passed: boolean };
    governance.passed = false;
    fs.writeFileSync(
      path.join(fixture.rootDir, fixture.governancePath),
      JSON.stringify(governance, null, 2),
    );

    expect(() =>
      publishAutocompleteV2SFinal({
        rootDir: fixture.rootDir,
        candidatePath: fixture.candidatePath,
        expectedEvaluatorFiles: ['evaluator.ts'],
      }),
    ).toThrow(/governance/u);
    expect(fs.readFileSync(legacyModel, 'utf8')).toBe('legacy-model');
    expect(fs.readFileSync(legacyManifest, 'utf8')).toBe('legacy-manifest');
    expect(fs.existsSync(path.join(publicDir, 'autocomplete'))).toBe(false);
  });
});

function createFixture(): { rootDir: string; candidatePath: string; governancePath: string } {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jotluck-v2s-publish-'));
  temporaryRoots.push(rootDir);
  fs.mkdirSync(path.join(rootDir, 'packages/app/public'), { recursive: true });
  fs.mkdirSync(path.join(rootDir, 'candidate'), { recursive: true });
  const writeJson = (relativePath: string, value: unknown): void => {
    fs.writeFileSync(path.join(rootDir, relativePath), `${JSON.stringify(value, null, 2)}\n`);
  };
  const assetPath = 'candidate/model.bin';
  const asset = createV2SAsset('publish-fixture-model');
  fs.writeFileSync(path.join(rootDir, assetPath), asset);
  const modelSha256 = sha256(asset);
  const documents = [
    {
      documentId: 'doc',
      sourceId: 'project-v3-en-reading-note',
      language: 'en',
      category: 'reading-note',
      relativePath:
        'scripts/corpus/_web-cache/autocomplete-v2r/generated-project-owned-v3.1/en/reading-note/doc.md',
      split: 'train',
      sha256: sha256('doc'),
      bytes: 3,
    },
  ];
  const selectionTree = sha256(
    canonicalJson(
      documents.map(({ documentId, sha256: digest }) => ({ documentId, sha256: digest })),
    ),
  );
  const paths = {
    selection: 'candidate/selection.json',
    governance: 'candidate/governance.json',
    coldValidation: 'candidate/cold-validation.json',
    workspaceValidation: 'candidate/workspace-validation.json',
    coldFinal: 'candidate/cold-final.json',
    workspaceFinal: 'candidate/workspace-final.json',
    finalConsumption: 'candidate/final-consumption.json',
    runtime: 'candidate/runtime.json',
    evaluator: 'candidate/evaluator.json',
    webview: 'candidate/webview.json',
  };
  const selectedDocumentPath = path.join(rootDir, documents[0]!.relativePath);
  fs.mkdirSync(path.dirname(selectedDocumentPath), { recursive: true });
  fs.writeFileSync(selectedDocumentPath, 'doc');
  writeJson('candidate/upstream-selection.json', {
    schema: 'jotluck.autocomplete.v2r-corpus-selection.v1',
    sources: [{ id: documents[0]!.sourceId }],
  });
  const unsignedSelection = {
    schema: 'jotluck.autocomplete.v2s-corpus-selection.v1',
    schemaVersion: 1 as const,
    sourceSelection: {
      path: 'candidate/upstream-selection.json',
      sha256: sha256(fs.readFileSync(path.join(rootDir, 'candidate/upstream-selection.json'))),
      schema: 'jotluck.autocomplete.v2r-corpus-selection.v1',
    },
    generator: {
      version: 'jotluck-project-owned-short-notes-v3.1',
      seed: 'v2r-project-owned-2026-07-12-b',
    },
    documentCount: documents.length,
    selectedBytes: 3,
    documents,
    inputTreeSha256: selectionTree,
  };
  const selection = {
    ...unsignedSelection,
    selectionSha256: sha256(canonicalJson(unsignedSelection)),
  };
  writeJson(paths.selection, selection);
  writeJson(paths.governance, {
    schemaVersion: 1,
    classification: 'autocomplete-v2s-governance',
    passed: true,
    inputTreeSha256: selectionTree,
    selectionSha256: selection.selectionSha256,
    metrics: {
      unknownLicenseSources: 0,
      privacyFindings: 0,
      holdoutOverlapCount: 0,
      exactDuplicateRate: 0,
      nearDuplicateRate: 0,
    },
  });
  const evaluatorText = 'export const evaluator = 1;\n';
  const evaluatorFiles = [{ path: 'evaluator.ts', sha256: sha256(evaluatorText) }];
  const evaluatorTreeSha256 = sha256(canonicalJson(evaluatorFiles));
  const observations = buildObservations();
  const finalBindings: Record<
    'coldFinal' | 'workspaceFinal',
    { holdoutSha256: string; evidenceSha256: string }
  > = {} as Record<
    'coldFinal' | 'workspaceFinal',
    { holdoutSha256: string; evidenceSha256: string }
  >;
  for (const [key, classification] of [
    ['coldValidation', 'cold-validation-v2s-v1'],
    ['workspaceValidation', 'workspace-validation-v2s-v1'],
    ['coldFinal', 'cold-final-v2s-v1'],
    ['workspaceFinal', 'workspace-final-v2s-v1'],
  ] as const) {
    const holdoutPath = `candidate/${classification}.holdout.json`;
    writeJson(holdoutPath, buildFrozenHoldout(classification, observations));
    const holdoutSha256 = sha256(fs.readFileSync(path.join(rootDir, holdoutPath)));
    writeJson(paths[key], {
      schema: 'jotluck.autocomplete.v2s-observation-evidence.v1',
      schemaVersion: 1,
      classification,
      modelSha256,
      inputTreeSha256: selectionTree,
      holdoutPath,
      holdoutSha256,
      evaluatorTreeSha256,
      observations,
    });
    if (key === 'coldFinal' || key === 'workspaceFinal') {
      finalBindings[key] = {
        holdoutSha256,
        evidenceSha256: sha256(fs.readFileSync(path.join(rootDir, paths[key]))),
      };
    }
  }
  const finalPair = {
    modelSha256,
    coldFinal: finalBindings.coldFinal,
    workspaceFinal: finalBindings.workspaceFinal,
  };
  writeJson(paths.finalConsumption, {
    schema: 'jotluck.autocomplete.v2s-final-consumption.v1',
    schemaVersion: 1,
    status: 'consumed',
    ...finalPair,
    finalPairSha256: sha256(canonicalJson(finalPair)),
    claimedAt: '2026-07-13T00:00:00.000Z',
    consumedAt: '2026-07-13T00:01:00.000Z',
  });
  writeJson(paths.runtime, {
    schemaVersion: 1,
    classification: 'autocomplete-v2s-runtime-evidence',
    modelSha256,
    productionRouterObserved: true,
    workerObserved: true,
    mainThreadSynchronousInference: false,
    requests: Array.from({ length: 200 }, (_, index) => ({
      id: `request-${index}`,
      latencyMs: 16,
      visibleLatencyMs: index < 76 ? 16 : null,
      fallback: false,
      timedOut: false,
      warming: false,
    })),
  });
  fs.writeFileSync(path.join(rootDir, 'evaluator.ts'), evaluatorText);
  writeJson(paths.evaluator, {
    schemaVersion: 1,
    files: evaluatorFiles,
    treeSha256: evaluatorTreeSha256,
  });
  writeJson(paths.webview, {
    schemaVersion: 1,
    classification: 'tauri-webview-offline-smoke',
    status: 'pass',
    modelSha256,
    completedAt: '2026-07-13T00:02:00.000Z',
    offlineReload: true,
    workerInferenceObserved: true,
  });
  const candidatePath = 'candidate/candidate.json';
  writeJson(candidatePath, {
    schemaVersion: 1,
    classification: 'autocomplete-v2s-release-candidate',
    engine: 'public-v2s-mkn-v1',
    assetPath,
    training: {
      selectionSha256: selection.selectionSha256,
      inputTreeSha256: selectionTree,
    },
    evidence: paths,
  });
  return { rootDir, candidatePath, governancePath: paths.governance };
}

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function buildObservations(): Array<Record<string, unknown>> {
  const categories = [
    'field-observation',
    'maintenance-log',
    'meeting-note',
    'reading-note',
    'household-plan',
  ];
  return categories.flatMap((category) =>
    ['zh', 'en'].flatMap((language) =>
      Array.from({ length: 20 }, (_, index) => {
        const complete = index < 15;
        const groupIndex = categories.indexOf(category) * 2 + (language === 'en' ? 1 : 0);
        const visible = index < (groupIndex < 6 ? 8 : 7);
        const candidate = validCandidate(language);
        const filler = invalidCandidate();
        return {
          checkpointId: `${category}-${language}-${index}`,
          language,
          category,
          kind: complete ? 'complete' : 'silence',
          expectedBehavior: complete ? 'complete' : 'silence',
          acceptableSuffixes: complete
            ? [language === 'zh' ? '补充记录材料并确认结果' : ' records update details']
            : [],
          b0Top1: index < 5 ? { ...candidate, providerId: 'recent', sourceLayer: 'l1' } : null,
          publicCandidates:
            index < 8 ? [candidate] : index === 8 ? [...Array(8).fill(filler), candidate] : [],
          combinedTop1: visible ? candidate : null,
          allRequestLatencyMs: 16,
          ...(visible ? { visibleLatencyMs: 16 } : {}),
          fallback: false,
          timeout: false,
          rejectionReasons: [],
        };
      }),
    ),
  );
}

function validCandidate(language: string): Record<string, string> {
  return {
    text: language === 'zh' ? '补充记录材料' : ' records update',
    providerId: 'public-v2s-mkn-v1',
    sourceLayer: 'l3',
  };
}

function invalidCandidate(): Record<string, string> {
  return { text: '。', providerId: 'public-v2s-mkn-v1', sourceLayer: 'l3' };
}

function buildFrozenHoldout(
  classification: string,
  observations: Array<Record<string, unknown>>,
): Record<string, unknown> {
  return {
    schema: 'jotluck.autocomplete.v2s-holdout.v1',
    schemaVersion: 1,
    datasetId: `fixture-${classification}`,
    frozenAt: '2026-07-13T00:00:00.000Z',
    classification,
    authorship: 'independently-reviewed-manual',
    releaseEvidence: true,
    description: 'Unit fixture',
    supportDocuments: [],
    targets: Array.from({ length: 50 }, (_, index) => {
      const checkpoints = observations.slice(index * 4, index * 4 + 4);
      const first = checkpoints[0]!;
      return {
        id: `target-${index}`,
        path: `targets/target-${index}.md`,
        language: first.language,
        category: first.category,
        structureId: `structure-${index}`,
        text: 'fixture',
        checkpoints: checkpoints.map((checkpoint) => ({
          id: checkpoint.checkpointId,
          cursorOffset: 0,
          expectedBehavior: checkpoint.expectedBehavior,
          acceptableSuffixes: checkpoint.acceptableSuffixes,
        })),
      };
    }),
  };
}

function createV2SAsset(value: string): Buffer {
  const sectionIds = ['tokenizer.zh', 'tokenizer.en', 'lm.zh', 'lm.en', 'gate', 'metadata'];
  const payloads = sectionIds.map((id) => Buffer.from(`${id}:${value}`, 'utf8'));
  let relativeOffset = 0;
  const sections = sectionIds.map((id, index) => {
    const payload = payloads[index]!;
    const section = {
      id,
      relativeOffset,
      bytes: payload.byteLength,
      sha256: sha256(payload),
    };
    relativeOffset += payload.byteLength;
    return section;
  });
  const header = Buffer.from(
    canonicalJson({
      schema: 'jotluck.autocomplete.public-container.v6',
      schemaVersion: 6,
      engine: 'public-v2s-mkn-v1',
      sections,
      payloadBytes: relativeOffset,
    }),
    'utf8',
  );
  const prefix = Buffer.alloc(12);
  Buffer.from([0x4a, 0x4c, 0x56, 0x32, 0x53, 0x36, 0x00, 0x00]).copy(prefix);
  prefix.writeUInt32LE(header.byteLength, 8);
  return Buffer.concat([prefix, header, ...payloads]);
}
