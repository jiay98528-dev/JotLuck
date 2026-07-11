import { existsSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  assertFinalRuntimeEvidence,
  claimFinalHoldoutConsumption,
  finalHoldoutConsumptionReceiptPath,
} from '../run-autocomplete-final-evaluation';
import { runAutocompleteWorkspaceFinalRuntime } from '../run-autocomplete-workspace-final-runtime';
import { selectPostFinalCandidate } from '../run-autocomplete-post-final-rc';
import { resolveWorkspaceInput, resolveWorkspaceOutput } from '../workspace-paths';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const tempRoot = path.join(root, 'scripts/__tests__/.final-consumption-test');

afterEach(() => {
  if (existsSync(tempRoot)) rmSync(tempRoot, { recursive: true, force: true });
});

describe('workspace final one-shot consumption', () => {
  it('exposes a dedicated one-shot production runtime orchestrator', () => {
    expect(typeof runAutocompleteWorkspaceFinalRuntime).toBe('function');
  });

  it('starts post-final Tauri smoke only for the exact eligible candidate', () => {
    const curve = {
      schemaVersion: 2 as const,
      selectedTier: '1mib',
      releaseEligible: false as const,
      finalHoldoutConsumed: false as const,
      tiers: [
        {
          id: '1mib',
          modelSha256: 'a'.repeat(64),
          modelBytes: 100,
          candidateDirectory: 'candidate',
          eligible: true,
        },
      ],
    };
    expect(
      selectPostFinalCandidate(curve, {
        classification: 'workspace-final-v2-evidence',
        releaseEligible: true,
        finalHoldoutConsumed: true,
        modelSha256: 'a'.repeat(64),
      }).id,
    ).toBe('1mib');
    expect(() =>
      selectPostFinalCandidate(
        { ...curve, selectedTier: null },
        {
          classification: 'workspace-final-v2-evidence',
          releaseEligible: true,
          finalHoldoutConsumed: true,
          modelSha256: 'a'.repeat(64),
        },
      ),
    ).toThrow(/No validation tier/u);
  });
  it('claims a candidate/holdout pair once and refuses overwrite', () => {
    mkdirSync(tempRoot, { recursive: true });
    const receipt = path.join(tempRoot, 'receipt.json');
    claimFinalHoldoutConsumption(receipt, { modelSha256: 'a'.repeat(64) });
    expect(() => claimFinalHoldoutConsumption(receipt, { modelSha256: 'b'.repeat(64) })).toThrow(
      /already been consumed/u,
    );
  });

  it('uses one receipt per frozen holdout, regardless of candidate model', () => {
    mkdirSync(tempRoot, { recursive: true });
    const holdoutSha = 'c'.repeat(64);
    const firstCandidateReceipt = finalHoldoutConsumptionReceiptPath(tempRoot, holdoutSha);
    const secondCandidateReceipt = finalHoldoutConsumptionReceiptPath(tempRoot, holdoutSha);
    expect(firstCandidateReceipt).toBe(secondCandidateReceipt);
    claimFinalHoldoutConsumption(firstCandidateReceipt, {
      finalHoldoutSha256: holdoutSha,
      modelSha256: 'a'.repeat(64),
    });
    expect(() =>
      claimFinalHoldoutConsumption(secondCandidateReceipt, {
        finalHoldoutSha256: holdoutSha,
        modelSha256: 'b'.repeat(64),
      }),
    ).toThrow(/already been consumed/u);
  });

  it('rejects final input and output paths that escape through a junction', () => {
    const workspace = path.join(tempRoot, 'workspace');
    const outside = path.join(tempRoot, 'outside');
    mkdirSync(workspace, { recursive: true });
    mkdirSync(outside, { recursive: true });
    writeFileSync(path.join(outside, 'evidence.json'), '{}\n', 'utf8');
    try {
      symlinkSync(outside, path.join(workspace, 'linked'), 'junction');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EPERM') return;
      throw error;
    }

    expect(() => resolveWorkspaceInput(workspace, 'linked/evidence.json')).toThrow(
      /symlink or junction/u,
    );
    expect(() => resolveWorkspaceOutput(workspace, 'linked/output.json')).toThrow(
      /symlink or junction/u,
    );
  });

  it('rejects final runtime evidence from a different model', () => {
    const evidence = {
      schemaVersion: 1,
      classification: 'workspace-final-v2-runtime-evidence',
      stage: 'final',
      productionRouterObserved: true,
      modelSha256: 'a'.repeat(64),
      finalHoldoutSha256: 'b'.repeat(64),
      opportunities: 200,
      requestCount: 200,
      visibleSampleCount: 72,
      triggerRate: 0.36,
      usableRate: 0.36,
      falseTriggerRate: 0.01,
      mixedCandidateRate: 0,
      allRequestP90Ms: 100,
      visiblePredictionP90Ms: 105,
      oracleAt8Rate: 0.45,
      top1Rate: 0.36,
      language: {
        zh: { top1Rate: 0.36, usableRate: 0.36, v1Top1Rate: 0.35, v1UsableRate: 0.35 },
        en: { top1Rate: 0.36, usableRate: 0.36, v1Top1Rate: 0.35, v1UsableRate: 0.35 },
      },
    } as const;
    expect(() => assertFinalRuntimeEvidence(evidence, 'c'.repeat(64), 'b'.repeat(64))).toThrow(
      /identity is invalid/u,
    );
    expect(() =>
      assertFinalRuntimeEvidence(
        { ...evidence, modelSha256: 'c'.repeat(64), visibleSampleCount: 0 },
        'c'.repeat(64),
        'b'.repeat(64),
      ),
    ).toThrow(/identity is invalid/u);
  });
});
