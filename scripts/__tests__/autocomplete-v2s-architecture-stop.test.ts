import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  assertV2SArchitectureActive,
  readV2SArchitectureStop,
  writeV2SArchitectureStop,
} from '../autocomplete-v2s/architecture-stop';
import { runV2SCli } from '../autocomplete-v2s/cli';
import { combineV2SLanguageCandidates } from '../autocomplete-v2s/combine-language-candidates';
import { canonicalJson, V2S_ENGINE_ID } from '../autocomplete-v2s/common';
import { V2S_ARCHITECTURE_STOP_PATH } from '../autocomplete-v2s/metrics';
import { repackV2SCandidateGate } from '../autocomplete-v2s/repack-gate';
import { trainV2SCandidate } from '../autocomplete-v2s/trainer';
import { publishAutocompleteV2SFinal } from '../publish-autocomplete-v2s-final';
// @ts-expect-error The production verifier is an ESM JavaScript evidence boundary.
import {
  inspectV2SArchitectureStop,
  verifyAutocompleteV2SEvidence,
} from '../verify-autocomplete-v2s-evidence.mjs';

const roots: string[] = [];
const repositoryRoot = path.resolve(import.meta.dirname, '../..');
const testParent = path.join(
  repositoryRoot,
  'scripts/corpus/_web-cache/autocomplete-v2s/test-workspaces',
);

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe('V2S architecture stop', () => {
  it('blocks every mutating model path before it reads candidate inputs', async () => {
    const root = await createWorkspace();
    const stop = writeV2SArchitectureStop(root, createStop());

    expect(readV2SArchitectureStop(root)).toEqual(stop);
    expect(() => assertV2SArchitectureActive(root)).toThrow(/architecture.*stopped/iu);
    await expect(
      runV2SCli(
        [
          'train',
          '--selection',
          'missing-selection.json',
          '--matrix-id',
          '3mib-bpe-g0',
          '--candidate-id',
          'blocked-cli-train',
          '--gate-samples',
          'missing-gate-samples.json',
        ],
        root,
      ),
    ).rejects.toThrow(/architecture.*stopped/iu);
    await expect(
      runV2SCli(
        [
          'repack-gate',
          '--source-candidate',
          'missing-source',
          '--candidate-id',
          'blocked-cli-repack',
          '--gate-samples',
          'missing-gate-samples.json',
        ],
        root,
      ),
    ).rejects.toThrow(/architecture.*stopped/iu);
    await expect(
      trainV2SCandidate({
        workspaceRoot: root,
        selectionPath: 'missing-selection.json',
        matrixId: '3mib-bpe-g0',
        candidateId: 'blocked-train',
        gateKind: 'g0',
        gateSamples: [],
      }),
    ).rejects.toThrow(/architecture.*stopped/iu);
    await expect(
      combineV2SLanguageCandidates({
        workspaceRoot: root,
        zhCandidateId: 'missing-zh',
        enCandidateId: 'missing-en',
        candidateId: 'blocked-combination',
      }),
    ).rejects.toThrow(/architecture.*stopped/iu);
    await expect(
      repackV2SCandidateGate({
        workspaceRoot: root,
        sourceCandidateId: 'missing-source',
        candidateId: 'blocked-gate',
        gateKind: 'g0',
        gateSamples: [],
        gateSamplesPath: 'missing-gate-samples.json',
      }),
    ).rejects.toThrow(/architecture.*stopped/iu);
    expect(() =>
      publishAutocompleteV2SFinal({ rootDir: root, candidatePath: 'missing-candidate.json' }),
    ).toThrow(/architecture.*stopped/iu);
    expect(
      verifyAutocompleteV2SEvidence({ rootDir: root, mode: 'ci', expectedEvaluatorFiles: [] }),
    ).toMatchObject({
      status: 'architecture-stopped-fail-closed',
      releaseEligible: false,
    });
    expect(() =>
      verifyAutocompleteV2SEvidence({ rootDir: root, mode: 'rc', expectedEvaluatorFiles: [] }),
    ).toThrow(/architecture.*stopped/iu);
  });

  it('fails closed when the stop record is tampered', async () => {
    const root = await createWorkspace();
    writeV2SArchitectureStop(root, createStop());
    const target = path.join(root, ...V2S_ARCHITECTURE_STOP_PATH.split('/'));
    const parsed = JSON.parse(await readFile(target, 'utf8')) as Record<string, unknown>;
    parsed.reasonCode = 'quality-gate-passed';
    await writeFile(target, JSON.stringify(parsed), 'utf8');

    expect(() => assertV2SArchitectureActive(root)).toThrow(/invalid V2S architecture stop/iu);
  });

  it('rejects semantic tampering even when the stop self-hash is recomputed', async () => {
    const root = await createWorkspace();
    writeV2SArchitectureStop(root, createStop());
    const target = path.join(root, ...V2S_ARCHITECTURE_STOP_PATH.split('/'));
    const parsed = JSON.parse(await readFile(target, 'utf8')) as Record<string, unknown>;
    parsed.lifecycle = {
      gateTrainingStarted: true,
      finalHoldoutsRead: false,
      publicWritten: false,
      v21Unlocked: false,
    };
    delete parsed.recordSha256;
    parsed.recordSha256 = createHash('sha256').update(canonicalJson(parsed)).digest('hex');
    await writeFile(target, JSON.stringify(parsed), 'utf8');

    expect(() => inspectV2SArchitectureStop(root)).toThrow(/architecture-stop record is invalid/iu);
  });
});

async function createWorkspace(): Promise<string> {
  await mkdir(testParent, { recursive: true });
  const root = await mkdtemp(path.join(testParent, 'architecture-stop-'));
  roots.push(root);
  await mkdir(path.join(root, 'scripts/corpus'), { recursive: true });
  return root;
}

function createStop() {
  const digest = 'a'.repeat(64);
  return {
    schema: 'jotluck.autocomplete.v2s-architecture-stop.v1' as const,
    schemaVersion: 1 as const,
    engine: V2S_ENGINE_ID,
    status: 'architecture-blocked' as const,
    architectureId: V2S_ENGINE_ID,
    formalResult: false as const,
    releaseEvidence: false as const,
    stopLongTraining: true as const,
    reasonCode: 'development-oracle-ceiling' as const,
    recordedAt: '2026-07-13T08:00:00.000Z',
    sourceCommit: 'b'.repeat(40),
    workingTreeClean: false as const,
    gates: {
      oracleAt8AbsoluteMinimum: 0.4 as const,
      oracleAt32AbsoluteMinimum: 0.45 as const,
      perLanguageOracleAt8AbsoluteMinimum: 0.32 as const,
    },
    oracle: {
      denominator: 'all-development-opportunities' as const,
      opportunities: 200,
      completeOpportunities: 150,
      silenceOpportunities: 50,
      at8: {
        hits: 70,
        absoluteRate: 0.35,
        byLanguage: {
          zh: { opportunities: 100, hits: 40, absoluteRate: 0.4 },
          en: { opportunities: 100, hits: 30, absoluteRate: 0.3 },
        },
      },
      at32: {
        hits: 80,
        absoluteRate: 0.4,
        byLanguage: {
          zh: { opportunities: 100, hits: 45, absoluteRate: 0.45 },
          en: { opportunities: 100, hits: 35, absoluteRate: 0.35 },
        },
      },
    },
    frontierDerivation: 'per-language-max-over-fixed-matrix' as const,
    bestFixedMatrixFrontier: {
      denominator: 'all-development-opportunities' as const,
      opportunities: 200,
      completeOpportunities: 150,
      silenceOpportunities: 50,
      at8: {
        hits: 75,
        absoluteRate: 0.375,
        byLanguage: {
          zh: { opportunities: 100, hits: 43, absoluteRate: 0.43 },
          en: { opportunities: 100, hits: 32, absoluteRate: 0.32 },
        },
      },
      at32: {
        hits: 81,
        absoluteRate: 0.405,
        byLanguage: {
          zh: { opportunities: 100, hits: 45, absoluteRate: 0.45 },
          en: { opportunities: 100, hits: 36, absoluteRate: 0.36 },
        },
      },
    },
    candidateId: '24mib-mixed-g0-5m5-method-v1',
    methodCorrection: 'bpe-en+unigram-zh' as const,
    evidenceBindings: {
      selection: { path: 'selection.json', sha256: digest },
      candidateManifest: { path: 'manifest.json', sha256: digest },
      model: { path: 'public-v2s.bin', sha256: digest },
      diagnostic: { path: 'development-diagnostic.json', sha256: digest },
    },
    lifecycle: {
      gateTrainingStarted: false as const,
      finalHoldoutsRead: false as const,
      publicWritten: false as const,
      v21Unlocked: false as const,
    },
  };
}
