import { describe, expect, it } from 'vitest';
import {
  assertV2RPostFinalEvidenceReady,
  assertV2RWebviewSmoke,
  type EvaluationManifest,
  type V2RWebviewSmoke,
} from '../run-autocomplete-v2r-post-final-rc';

const SHA = {
  model: '1'.repeat(64),
  phraseBank: '2'.repeat(64),
  metadata: '3'.repeat(64),
  runtime: '4'.repeat(64),
};

describe('V2R post-final RC guards', () => {
  it('stops before WebView work when aggregate final evidence is absent', () => {
    expect(() =>
      assertV2RPostFinalEvidenceReady(
        {
          schema: 'jotluck.autocomplete.v2r-quality-report.v1',
          releaseEligible: false,
        },
        {
          schema: 'jotluck.autocomplete.v2r-runtime-report.v1',
          workerOnly: true,
          mainThreadModelLongTasksOver50Ms: 0,
        },
        {
          schema: 'jotluck.autocomplete.v2r-final-consumption.v1',
          status: 'passed',
          consumedOnce: true,
        },
      ),
    ).toThrow(/Tauri smoke was not started/u);
  });

  it('accepts only a real evaluation-candidate WebView receipt bound to all assets', () => {
    const manifest = makeManifest();
    const smoke = makeSmoke();
    expect(() => assertV2RWebviewSmoke(smoke, manifest, SHA)).not.toThrow();
    expect(() =>
      assertV2RWebviewSmoke({ ...smoke, workerInferencePassed: false }, manifest, SHA),
    ).toThrow(/did not bind/u);
    expect(() =>
      assertV2RWebviewSmoke({ ...smoke, runtimeSha256: '5'.repeat(64) }, manifest, SHA),
    ).toThrow(/did not bind/u);
  });
});

function makeManifest(): EvaluationManifest {
  return {
    schema: 'jotluck.autocomplete.public-model.v5',
    schemaVersion: 5,
    engine: 'public-phrase-transformer-v1',
    profile: 'web-local',
    candidateId: 'candidate-8192-98528',
    evaluationOnly: true,
    runtimeEligible: true,
    qualityGatePassed: false,
    releaseEligible: false,
    assets: [
      { role: 'model', sha256: SHA.model },
      { role: 'phrase-bank', sha256: SHA.phraseBank },
      { role: 'metadata', sha256: SHA.metadata },
      { role: 'runtime', sha256: SHA.runtime },
    ],
  };
}

function makeSmoke(): V2RWebviewSmoke {
  return {
    schema: 'jotluck.autocomplete.v2r-webview-smoke.v1',
    schemaVersion: 1,
    status: 'pass',
    candidateId: 'candidate-8192-98528',
    modelSha256: SHA.model,
    phraseBankSha256: SHA.phraseBank,
    metadataSha256: SHA.metadata,
    runtimeSha256: SHA.runtime,
    tauriWebviewExecuted: true,
    offlineReloadPassed: true,
    workerInferencePassed: true,
    webBuildSubstitute: false,
    completedAt: '2026-07-12T00:00:00.000Z',
  };
}
