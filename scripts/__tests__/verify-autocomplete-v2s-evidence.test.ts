import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { canonicalJson } from '../autocomplete-evidence-integrity.mjs';
// @ts-expect-error See scripts/verify-autocomplete-v2s-evidence.mjs.
import {
  inspectAutocompletePublicState,
  prepareAutocompleteV2SPublication,
  verifyAutocompleteV2SEvidence,
} from '../verify-autocomplete-v2s-evidence.mjs';

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('V2S release evidence verifier', () => {
  it('allows CI to report an unpublished model as disabled but keeps RC fail-closed', () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jotluck-v2s-disabled-'));
    temporaryRoots.push(rootDir);
    fs.mkdirSync(path.join(rootDir, 'packages/app/public'), { recursive: true });
    expect(verifyAutocompleteV2SEvidence({ rootDir, mode: 'ci' })).toEqual({
      status: 'disabled-fail-closed',
      publicState: 'missing',
      releaseEligible: false,
    });
    expect(() => verifyAutocompleteV2SEvidence({ rootDir, mode: 'rc' })).toThrow(
      /Canonical V2S public state is required/u,
    );
  });

  it('recomputes every evidence hash, metric and release id', () => {
    const fixture = createFixture();
    installPreparedFixture(fixture);

    const verified = verifyAutocompleteV2SEvidence({
      rootDir: fixture.rootDir,
      expectedEvaluatorFiles: ['evaluator.ts'],
    });

    expect(verified.status).toBe('release-evidence-verified-v2s');
    expect(verified.metrics.validation).toMatchObject({
      cold: {
        opportunities: 200,
        b0: { usable: 50 },
        publicOracle: {
          oracleAt8Hits: 80,
          oracleAt32Hits: 90,
          newCoverageOnB0Misses: 30,
        },
        triggered: 76,
        usable: 76,
        falseTriggers: 0,
        mixed: 0,
        allRequestP90Ms: 20,
        visiblePredictionP90Ms: 20,
      },
      workspace: { triggered: 76, usable: 76 },
    });
    expect(verified.metrics.runtime).toMatchObject({
      allRequestP90Ms: 20,
      visiblePredictionP90Ms: 20,
      timeoutCount: 0,
    });
  });

  it('rejects selected documents that cannot be traced to an approved upstream source', () => {
    const fixture = createFixture();
    mutateSelection(fixture, (selection) => {
      const documents = selection.documents as Array<Record<string, unknown>>;
      documents[0]!.sourceId = 'unknown-web-source';
    });
    expect(() => installPreparedFixture(fixture)).toThrow(/unknown or unapproved source/u);
  });

  it('rejects source-license drift and selected paths outside the approved content root', () => {
    const licenseDrift = createFixture();
    mutateUpstreamSelection(licenseDrift, (upstream) => {
      const sources = upstream.sources as Array<Record<string, unknown>>;
      sources[0]!.licenseSpdx = 'CC-BY-4.0';
    });
    expect(() => installPreparedFixture(licenseDrift)).toThrow(
      /approved deterministic project source/u,
    );

    const escapedRoot = createFixture();
    mutateSelection(escapedRoot, (selection) => {
      const documents = selection.documents as Array<Record<string, unknown>>;
      documents[0]!.relativePath = 'candidate/doc-1.md';
    });
    expect(() => installPreparedFixture(escapedRoot)).toThrow(/contentRoot/u);
  });

  it('rejects a selected document removed from the bound upstream registry', () => {
    const fixture = createFixture();
    mutateUpstreamSelection(fixture, (upstream) => {
      upstream.documents = [];
    });
    expect(() => installPreparedFixture(fixture)).toThrow(/no document registry/u);
  });

  it('recomputes governance metrics from raw document entries', () => {
    const fixture = createFixture();
    mutateJsonFile(fixture, 'governance', (governance) => {
      const metrics = governance.metrics as Record<string, unknown>;
      metrics.privacyFindings = 1;
    });
    expect(() => installPreparedFixture(fixture)).toThrow(/not recomputed from raw entries/u);

    const tampered = createFixture();
    mutateJsonFile(tampered, 'governance', (governance) => {
      const entries = governance.rawEntries as Array<Record<string, unknown>>;
      entries[0]!.sha256 = '0'.repeat(64);
    });
    expect(() => installPreparedFixture(tampered)).toThrow(/detached from selection/u);
  });

  it('rejects evidence tampering even when all qualification booleans remain true', () => {
    const fixture = createFixture();
    installPreparedFixture(fixture);
    const finalPath = path.join(fixture.rootDir, fixture.evidencePaths.coldFinal);
    const finalEvidence = JSON.parse(fs.readFileSync(finalPath, 'utf8')) as {
      observations: Array<{
        usable?: boolean;
        combinedTop1: { text: string; providerId: string; sourceLayer: string } | null;
      }>;
    };
    finalEvidence.observations[0]!.usable = true;
    finalEvidence.observations[0]!.combinedTop1 = {
      text: '的',
      providerId: 'public-v2s-mkn-v1',
      sourceLayer: 'l3',
    };
    fs.writeFileSync(finalPath, JSON.stringify(finalEvidence, null, 2));

    expect(() =>
      verifyAutocompleteV2SEvidence({
        rootDir: fixture.rootDir,
        expectedEvaluatorFiles: ['evaluator.ts'],
      }),
    ).toThrow(
      /holdout failed gates|final consumption receipt|independently recomputed release evidence/u,
    );
  });

  it.each([
    'b0Top1',
    'publicCandidates',
    'combinedTop1',
    'allRequestLatencyMs',
    'visibleLatencyMs',
    'fallback',
    'timeout',
    'rejectionReasons',
  ])('rejects a raw observation missing %s', (field) => {
    const fixture = createFixture();
    installPreparedFixture(fixture);
    mutateObservationEvidence(fixture, 'coldValidation', (observations) => {
      delete observations[0]![field];
    });
    expectVerificationFailure(fixture, /invalid observation/u);
  });

  it('independently enforces Oracle@8 and Oracle@32', () => {
    const oracle8 = createFixture();
    installPreparedFixture(oracle8);
    mutateObservationEvidence(oracle8, 'coldValidation', (observations) => {
      observations[0]!.publicCandidates = [];
    });
    expectVerificationFailure(oracle8, /Oracle@8 absolute rate is below 40%/u);

    const oracle32 = createFixture();
    installPreparedFixture(oracle32);
    mutateObservationEvidence(oracle32, 'workspaceValidation', (observations) => {
      observations[8]!.publicCandidates = [];
    });
    expectVerificationFailure(oracle32, /Oracle@32 absolute rate is below 45%/u);
  });

  it('enforces per-language Oracle, cold B0-miss coverage and paired B0 regression', () => {
    const languageOracle = createFixture();
    installPreparedFixture(languageOracle);
    mutateObservationEvidence(languageOracle, 'coldValidation', (observations) => {
      for (const observation of observations
        .filter((item) => item.language === 'zh' && hasUsableOracleAt8(item))
        .slice(0, 9)) {
        observation.publicCandidates = [];
      }
    });
    expectVerificationFailure(languageOracle, /zh Public Oracle@8 absolute rate is below 32%/u);

    const coverage = createFixture();
    installPreparedFixture(coverage);
    mutateObservationEvidence(coverage, 'coldValidation', (observations) => {
      for (const observation of observations) {
        if (hasUsableOracleAt8(observation))
          observation.b0Top1 = validCandidate(observation.language);
      }
    });
    expectVerificationFailure(coverage, /less than 8pp coverage on B0 misses/u);

    const regression = createFixture();
    installPreparedFixture(regression);
    mutateObservationEvidence(regression, 'workspaceValidation', (observations) => {
      for (const observation of observations) {
        if (hasUsableOracleAt8(observation))
          observation.b0Top1 = validCandidate(observation.language);
      }
    });
    expectVerificationFailure(regression, /regresses the paired Public-off B0/u);
  });

  it('enforces validation margins and release latency from per-checkpoint samples', () => {
    const margin = createFixture();
    installPreparedFixture(margin);
    mutateObservationEvidence(margin, 'coldValidation', (observations) => {
      for (const observation of observations.filter((item) => item.combinedTop1).slice(0, 3)) {
        observation.combinedTop1 = null;
        delete observation.visibleLatencyMs;
      }
    });
    expectVerificationFailure(margin, /Validation trigger rate|Validation absolute usable rate/u);

    const validationLatency = createFixture();
    installPreparedFixture(validationLatency);
    mutateObservationEvidence(validationLatency, 'workspaceValidation', (observations) => {
      for (const observation of observations.slice(-21)) observation.allRequestLatencyMs = 121;
    });
    expectVerificationFailure(validationLatency, /at or below 120ms/u);

    const finalLatency = createFixture();
    installPreparedFixture(finalLatency);
    mutateObservationEvidence(finalLatency, 'workspaceFinal', (observations) => {
      for (const observation of observations.slice(-21)) observation.allRequestLatencyMs = 141;
    });
    expectVerificationFailure(finalLatency, /p90 exceeds 140ms/u);
  });

  it('enforces zero validation false triggers and scans the complete public candidate pool', () => {
    const falseTrigger = createFixture();
    installPreparedFixture(falseTrigger);
    mutateObservationEvidence(falseTrigger, 'coldValidation', (observations) => {
      const silence = observations.find((item) => item.kind === 'silence')!;
      silence.combinedTop1 = validCandidate(silence.language);
      silence.visibleLatencyMs = 20;
    });
    expectVerificationFailure(falseTrigger, /zero silence false triggers/u);

    const mixed = createFixture();
    installPreparedFixture(mixed);
    mutateObservationEvidence(mixed, 'workspaceValidation', (observations) => {
      observations[10]!.publicCandidates = [
        ...observations[10]!.publicCandidates,
        { text: '补充abc材料', providerId: 'public-v2s-mkn-v1', sourceLayer: 'l3' },
      ];
    });
    expectVerificationFailure(mixed, /Mixed-language candidates must be zero/u);
  });

  it('enforces the remaining release trigger, usable, language, category and false-trigger gates', () => {
    const trigger = createFixture();
    installPreparedFixture(trigger);
    mutateObservationEvidence(trigger, 'coldFinal', (observations) => {
      for (const observation of observations
        .filter((item) => item.kind === 'complete' && !item.combinedTop1)
        .slice(0, 9)) {
        observation.combinedTop1 = validCandidate(observation.language);
        observation.visibleLatencyMs = 20;
      }
    });
    expectVerificationFailure(trigger, /outside 35%-42%/u);

    const usable = createFixture();
    installPreparedFixture(usable);
    mutateObservationEvidence(usable, 'workspaceFinal', (observations) => {
      for (const observation of observations.filter((item) => item.combinedTop1).slice(0, 7)) {
        observation.combinedTop1 = invalidCandidate();
      }
    });
    expectVerificationFailure(usable, /absolute usable rate is below 35%/u);

    const language = createFixture();
    installPreparedFixture(language);
    mutateObservationEvidence(language, 'workspaceFinal', (observations) => {
      for (const observation of observations
        .filter((item) => item.language === 'zh' && item.combinedTop1)
        .slice(0, 9)) {
        observation.combinedTop1 = invalidCandidate();
      }
    });
    expectVerificationFailure(language, /zh absolute usable rate is below 30%/u);

    const category = createFixture();
    installPreparedFixture(category);
    mutateObservationEvidence(category, 'workspaceFinal', (observations) => {
      for (const observation of observations
        .filter((item) => item.category === 'household-plan' && item.combinedTop1)
        .slice(0, 5)) {
        observation.combinedTop1 = invalidCandidate();
      }
    });
    expectVerificationFailure(category, /household-plan absolute usable rate is below 25%/u);

    const falseTriggers = createFixture();
    installPreparedFixture(falseTriggers);
    mutateObservationEvidence(falseTriggers, 'workspaceFinal', (observations) => {
      for (const observation of observations
        .filter((item) => item.kind === 'silence')
        .slice(0, 2)) {
        observation.combinedTop1 = validCandidate(observation.language);
        observation.visibleLatencyMs = 20;
      }
    });
    expectVerificationFailure(falseTriggers, /false triggers exceed 1\/50/u);
  });

  it('requires an untampered, ordered final-consumption receipt and a later WebView smoke', () => {
    const missing = createFixture();
    installPreparedFixture(missing);
    fs.unlinkSync(path.join(missing.rootDir, missing.evidencePaths.finalConsumption));
    expectVerificationFailure(missing, /does not exist/u);

    const tampered = createFixture();
    installPreparedFixture(tampered);
    mutateJsonFile(tampered, 'finalConsumption', (receipt) => {
      receipt.finalPairSha256 = '0'.repeat(64);
    });
    expectVerificationFailure(tampered, /final consumption receipt/u);

    const reversed = createFixture();
    installPreparedFixture(reversed);
    mutateJsonFile(reversed, 'finalConsumption', (receipt) => {
      receipt.claimedAt = '2026-07-13T00:02:00.000Z';
    });
    expectVerificationFailure(reversed, /final consumption receipt/u);

    const staleWebview = createFixture();
    installPreparedFixture(staleWebview);
    mutateJsonFile(staleWebview, 'webview', (webview) => {
      webview.completedAt = '2026-07-13T00:00:30.000Z';
    });
    expectVerificationFailure(staleWebview, /real Tauri WebView/u);
  });

  it('rejects a manifest whose asset filename is not content-addressed', () => {
    const fixture = createFixture();
    installPreparedFixture(fixture);
    const manifestPath = path.join(
      fixture.rootDir,
      'packages/app/public/autocomplete/autocomplete-public.manifest.json',
    );
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as {
      asset: { file: string };
    };
    const oldAsset = path.join(
      fixture.rootDir,
      'packages/app/public/autocomplete',
      manifest.asset.file,
    );
    manifest.asset.file = 'model.bin';
    fs.renameSync(oldAsset, path.join(path.dirname(oldAsset), manifest.asset.file));
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

    expect(() =>
      verifyAutocompleteV2SEvidence({
        rootDir: fixture.rootDir,
        expectedEvaluatorFiles: ['evaluator.ts'],
      }),
    ).toThrow(/content-addressed/u);
  });

  it('reports stopped V2R residues as an invalid public state', () => {
    const fixture = createFixture();
    fs.writeFileSync(
      path.join(fixture.rootDir, 'packages/app/public/public-phrase-transformer-v1.int8.onnx'),
      'residue',
    );
    expect(inspectAutocompletePublicState(fixture.rootDir)).toMatchObject({
      kind: 'invalid',
      reason: 'stopped-v2r-public-residue',
    });
  });
});

interface Fixture {
  rootDir: string;
  candidatePath: string;
  evidencePaths: Record<string, string>;
}

function createFixture(): Fixture {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jotluck-v2s-verify-'));
  temporaryRoots.push(rootDir);
  fs.mkdirSync(path.join(rootDir, 'packages/app/public'), { recursive: true });
  fs.mkdirSync(path.join(rootDir, 'candidate'), { recursive: true });
  const writeJson = (relativePath: string, value: unknown): void => {
    const target = path.join(rootDir, relativePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`);
  };
  const assetPath = 'candidate/model.bin';
  const assetBytes = createV2SAsset('v2s-fixture-model');
  fs.writeFileSync(path.join(rootDir, assetPath), assetBytes);
  const modelSha256 = sha256(assetBytes);
  const documents = [
    {
      documentId: 'doc-1',
      sourceId: 'project-v3-zh-meeting-note',
      language: 'zh',
      category: 'meeting-note',
      relativePath:
        'scripts/corpus/_web-cache/autocomplete-v2r/generated-project-owned-v3.1/zh/meeting-note/doc-1.md',
      split: 'train',
      sha256: sha256('doc-1'),
      bytes: 5,
    },
  ];
  const inputTreeSha256 = sha256(
    canonicalJson(
      documents.map(({ documentId, sha256: digest }) => ({ documentId, sha256: digest })),
    ),
  );
  const evidencePaths = {
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
  fs.writeFileSync(selectedDocumentPath, 'doc-1');
  fs.writeFileSync(path.join(rootDir, 'LICENSE'), 'MIT fixture license\n');
  const upstreamSelection = {
    schema: 'jotluck.autocomplete.v2r-corpus-selection.v1',
    schemaVersion: 1,
    sources: [
      {
        id: documents[0]!.sourceId,
        kind: 'project-owned',
        language: 'zh',
        category: 'meeting-note',
        contentRoot:
          'scripts/corpus/_web-cache/autocomplete-v2r/generated-project-owned-v3.1/zh/meeting-note',
        licenseSpdx: 'MIT',
        licenseEvidencePath: 'LICENSE',
        cleanerVersion: 'jotluck-project-owned-short-notes-v3.1',
        generatorVersion: 'jotluck-project-owned-short-notes-v3.1',
        generatorSeed: 'v2r-project-owned-2026-07-12-b',
      },
    ],
    documents,
  };
  writeJson('candidate/upstream-selection.json', upstreamSelection);
  const evaluatorText = 'export const evaluator = 1;\n';
  const evaluatorFiles = [{ path: 'evaluator.ts', sha256: sha256(evaluatorText) }];
  const evaluatorTreeSha256 = sha256(canonicalJson(evaluatorFiles));
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
    selectedBytes: 5,
    documents,
    inputTreeSha256,
  };
  const selection = {
    ...unsignedSelection,
    selectionSha256: sha256(canonicalJson(unsignedSelection)),
  };
  writeJson(evidencePaths.selection, selection);
  writeJson(evidencePaths.governance, {
    schemaVersion: 1,
    classification: 'autocomplete-v2s-governance',
    passed: true,
    inputTreeSha256,
    selectionSha256: selection.selectionSha256,
    metrics: {
      unknownLicenseSources: 0,
      privacyFindings: 0,
      holdoutOverlapCount: 0,
      exactDuplicateRate: 0,
      nearDuplicateRate: 0,
    },
    rawEntries: [
      {
        documentId: documents[0]!.documentId,
        sourceId: documents[0]!.sourceId,
        sha256: documents[0]!.sha256,
        normalizedSha256: sha256('doc-1'),
        privacyFindings: [],
        holdoutOverlaps: [],
      },
    ],
    nearDuplicatePairs: [],
  });
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
    const observations = buildObservations();
    const holdoutPath = `candidate/${classification}.holdout.json`;
    writeJson(holdoutPath, buildFrozenHoldout(classification, observations));
    const holdoutSha256 = sha256(fs.readFileSync(path.join(rootDir, holdoutPath)));
    writeJson(evidencePaths[key], {
      schema: 'jotluck.autocomplete.v2s-observation-evidence.v1',
      schemaVersion: 1,
      classification,
      modelSha256,
      inputTreeSha256,
      holdoutPath,
      holdoutSha256,
      evaluatorTreeSha256,
      observations,
    });
    if (key === 'coldFinal' || key === 'workspaceFinal') {
      finalBindings[key] = {
        holdoutSha256,
        evidenceSha256: sha256(fs.readFileSync(path.join(rootDir, evidencePaths[key]))),
      };
    }
  }
  const finalPair = {
    modelSha256,
    coldFinal: finalBindings.coldFinal,
    workspaceFinal: finalBindings.workspaceFinal,
  };
  writeJson(evidencePaths.finalConsumption, {
    schema: 'jotluck.autocomplete.v2s-final-consumption.v1',
    schemaVersion: 1,
    status: 'consumed',
    ...finalPair,
    finalPairSha256: sha256(canonicalJson(finalPair)),
    claimedAt: '2026-07-13T00:00:00.000Z',
    consumedAt: '2026-07-13T00:01:00.000Z',
  });
  writeJson(evidencePaths.runtime, {
    schemaVersion: 1,
    classification: 'autocomplete-v2s-runtime-evidence',
    modelSha256,
    productionRouterObserved: true,
    workerObserved: true,
    mainThreadSynchronousInference: false,
    requests: Array.from({ length: 200 }, (_, index) => ({
      id: `request-${index}`,
      latencyMs: 20,
      visibleLatencyMs: index < 76 ? 20 : null,
      fallback: false,
      timedOut: false,
      warming: false,
    })),
  });
  fs.writeFileSync(path.join(rootDir, 'evaluator.ts'), evaluatorText);
  writeJson(evidencePaths.evaluator, {
    schemaVersion: 1,
    files: evaluatorFiles,
    treeSha256: evaluatorTreeSha256,
  });
  writeJson(evidencePaths.webview, {
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
    training: { selectionSha256: selection.selectionSha256, inputTreeSha256 },
    evidence: evidencePaths,
  });
  return { rootDir, candidatePath, evidencePaths };
}

function installPreparedFixture(fixture: Fixture): void {
  const prepared = prepareAutocompleteV2SPublication({
    rootDir: fixture.rootDir,
    candidatePath: fixture.candidatePath,
    expectedEvaluatorFiles: ['evaluator.ts'],
  });
  for (const [relativePath, bytes] of [
    [prepared.assetTarget, prepared.assetBytes],
    [prepared.manifestTarget, Buffer.from(prepared.manifestText, 'utf8')],
  ] as const) {
    const target = path.join(fixture.rootDir, relativePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, bytes);
  }
}

function buildObservations(): Array<Record<string, unknown>> {
  const categories = [
    'field-observation',
    'maintenance-log',
    'meeting-note',
    'reading-note',
    'household-plan',
  ];
  const output: Array<Record<string, unknown>> = [];
  for (const category of categories) {
    for (const language of ['zh', 'en']) {
      for (let index = 0; index < 20; index += 1) {
        const complete = index < 15;
        const groupIndex = output.length / 20;
        const visible = index < (groupIndex < 6 ? 8 : 7);
        const candidate = validCandidate(language);
        const filler = invalidCandidate();
        output.push({
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
          allRequestLatencyMs: 20,
          ...(visible ? { visibleLatencyMs: 20 } : {}),
          fallback: false,
          timeout: false,
          rejectionReasons: [],
        });
      }
    }
  }
  return output;
}

interface ObservedCandidate {
  text: string;
  providerId: string;
  sourceLayer: string;
}

type Observation = Record<string, unknown> & {
  language: string;
  category: string;
  kind: string;
  b0Top1: ObservedCandidate | null;
  publicCandidates: ObservedCandidate[];
  combinedTop1: ObservedCandidate | null;
  allRequestLatencyMs: number;
  visibleLatencyMs?: number;
};

function mutateObservationEvidence(
  fixture: Fixture,
  key: keyof Fixture['evidencePaths'],
  mutate: (observations: Observation[]) => void,
): void {
  mutateJsonFile(fixture, key, (value) => mutate(value.observations as Observation[]));
}

function mutateSelection(
  fixture: Fixture,
  mutate: (selection: Record<string, unknown>) => void,
): void {
  const selectionPath = path.join(fixture.rootDir, fixture.evidencePaths.selection);
  const selection = JSON.parse(fs.readFileSync(selectionPath, 'utf8')) as Record<string, unknown>;
  mutate(selection);
  delete selection.selectionSha256;
  selection.selectionSha256 = sha256(canonicalJson(selection));
  fs.writeFileSync(selectionPath, `${JSON.stringify(selection, null, 2)}\n`);
  const candidatePath = path.join(fixture.rootDir, fixture.candidatePath);
  const candidate = JSON.parse(fs.readFileSync(candidatePath, 'utf8')) as {
    training: { selectionSha256: string };
  };
  candidate.training.selectionSha256 = selection.selectionSha256 as string;
  fs.writeFileSync(candidatePath, `${JSON.stringify(candidate, null, 2)}\n`);
}

function mutateUpstreamSelection(
  fixture: Fixture,
  mutate: (upstream: Record<string, unknown>) => void,
): void {
  const upstreamPath = path.join(fixture.rootDir, 'candidate/upstream-selection.json');
  const upstream = JSON.parse(fs.readFileSync(upstreamPath, 'utf8')) as Record<string, unknown>;
  mutate(upstream);
  fs.writeFileSync(upstreamPath, `${JSON.stringify(upstream, null, 2)}\n`);
  mutateSelection(fixture, (selection) => {
    const sourceSelection = selection.sourceSelection as Record<string, unknown>;
    sourceSelection.sha256 = sha256(fs.readFileSync(upstreamPath));
  });
}

function mutateJsonFile(
  fixture: Fixture,
  key: keyof Fixture['evidencePaths'],
  mutate: (value: Record<string, unknown>) => void,
): void {
  const filePath = path.join(fixture.rootDir, fixture.evidencePaths[key]);
  const value = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Record<string, unknown>;
  mutate(value);
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function expectVerificationFailure(fixture: Fixture, pattern: RegExp): void {
  expect(() =>
    verifyAutocompleteV2SEvidence({
      rootDir: fixture.rootDir,
      expectedEvaluatorFiles: ['evaluator.ts'],
    }),
  ).toThrow(pattern);
}

function validCandidate(language: unknown): ObservedCandidate {
  return {
    text: language === 'zh' ? '补充记录材料' : ' records update',
    providerId: 'public-v2s-mkn-v1',
    sourceLayer: 'l3',
  };
}

function invalidCandidate(): ObservedCandidate {
  return { text: '。', providerId: 'public-v2s-mkn-v1', sourceLayer: 'l3' };
}

function hasUsableOracleAt8(observation: Observation): boolean {
  return observation.publicCandidates
    .slice(0, 8)
    .some((candidate) =>
      candidate.text.includes(observation.language === 'zh' ? '补充记录材料' : 'records update'),
    );
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

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
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
