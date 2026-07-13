import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const binaryPath = resolve(
  process.env.JOTLUCK_TAURI_BINARY ?? 'packages/app/src-tauri/target/release/jotluck.exe',
);
const evidencePath = resolve(
  process.env.JOTLUCK_TAURI_WEBVIEW_EVIDENCE ??
    'scripts/corpus/_web-cache/autocomplete-candidates/tauri-webview-smoke.json',
);
const expectedModelSha256 = process.env.JOTLUCK_AUTOCOMPLETE_EXPECTED_MODEL_SHA;
const expectedV2RAssets = {
  model: expectedModelSha256,
  phraseBank: process.env.JOTLUCK_AUTOCOMPLETE_EXPECTED_PHRASE_BANK_SHA,
  metadata: process.env.JOTLUCK_AUTOCOMPLETE_EXPECTED_METADATA_SHA,
  runtime: process.env.JOTLUCK_AUTOCOMPLETE_EXPECTED_RUNTIME_SHA,
};
const isAutocompleteRc = process.env.JOTLUCK_AUTOCOMPLETE_RC === '1';
const isV2RAutocompleteRc = process.env.JOTLUCK_AUTOCOMPLETE_V2R_RC === '1';

if (isAutocompleteRc && isV2RAutocompleteRc) {
  throw new Error('Legacy and V2R autocomplete RC smoke modes are mutually exclusive.');
}

describe('Windows Tauri WebView offline smoke', () => {
  it('loads packaged assets in a real WebView2 and survives reload', async () => {
    if (process.platform !== 'win32') {
      throw new Error('Tauri WebView release smoke must run on Windows/WebView2');
    }

    const appRoot = await $('#jotluck-app');
    await appRoot.waitForExist();
    const result = isV2RAutocompleteRc ? await runV2RWebviewSmoke() : await runLegacyWebviewSmoke();

    const binary = await readFile(binaryPath);
    const binaryStats = await stat(binaryPath);
    const binaryBinding = {
      path: binaryPath,
      bytes: binaryStats.size,
      sha256: createHash('sha256').update(binary).digest('hex'),
    };
    const evidence = isV2RAutocompleteRc
      ? {
          schema: 'jotluck.autocomplete.v2r-webview-smoke.v1',
          schemaVersion: 1,
          classification: 'tauri-webview-offline-smoke',
          status: 'pass',
          candidateId: result.beforeReload.manifest.candidateId,
          modelSha256: result.beforeReload.assetSha256.model,
          phraseBankSha256: result.beforeReload.assetSha256.phraseBank,
          metadataSha256: result.beforeReload.assetSha256.metadata,
          runtimeSha256: result.beforeReload.assetSha256.runtime,
          completedAt: new Date().toISOString(),
          platform: process.platform,
          arch: process.arch,
          webview: 'WebView2',
          tauriWebviewExecuted: true,
          offlineReloadPassed: true,
          workerInferencePassed: true,
          webBuildSubstitute: false,
          binary: binaryBinding,
          ...result,
        }
      : {
          schemaVersion: 1,
          classification: 'tauri-webview-offline-smoke',
          status: 'pass',
          modelSha256: result.beforeReload.modelSha256,
          completedAt: new Date().toISOString(),
          platform: process.platform,
          arch: process.arch,
          webview: 'WebView2',
          binary: binaryBinding,
          ...result,
        };
    await mkdir(dirname(evidencePath), { recursive: true });
    await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
    });
  });
});

async function runLegacyWebviewSmoke() {
  const beforeReload = await collectLegacyPackagedRuntimeFacts();
  assertLegacyPackagedRuntimeFacts(beforeReload);
  assertLegacyExpectedCandidate(beforeReload);

  await browser.refresh();
  await (await $('#jotluck-app')).waitForExist();
  const afterReload = await collectLegacyPackagedRuntimeFacts();
  assertLegacyPackagedRuntimeFacts(afterReload);
  assertLegacyExpectedCandidate(afterReload);

  assert.equal(afterReload.location, beforeReload.location);
  assert.equal(afterReload.modelSha256, beforeReload.modelSha256);
  assert.equal(afterReload.manifestSha256, beforeReload.manifestSha256);
  return { beforeReload, afterReload };
}

async function runV2RWebviewSmoke() {
  assertExpectedV2RAssets();
  await browser.execute(() => {
    localStorage.setItem(
      'jotluck:autocomplete:settings',
      JSON.stringify({
        enabled: true,
        aggressiveness: 'balanced',
        backgroundTraining: false,
        maxSuggestionLength: 12,
        minConfidence: 0.18,
        showDebugStats: false,
      }),
    );
    localStorage.setItem('jotluck:autocomplete:enabled', 'true');
  });
  await browser.refresh();
  await waitForV2REvaluationBridge();

  const beforeReload = await collectV2RPackagedRuntimeFacts();
  assertV2RPackagedRuntimeFacts(beforeReload);
  assertV2RExpectedCandidate(beforeReload);

  await browser.refresh();
  await waitForV2REvaluationBridge();
  const afterReload = await collectV2RPackagedRuntimeFacts();
  assertV2RPackagedRuntimeFacts(afterReload);
  assertV2RExpectedCandidate(afterReload);

  assert.equal(afterReload.location, beforeReload.location);
  assert.equal(afterReload.manifestSha256, beforeReload.manifestSha256);
  assert.deepEqual(afterReload.assetSha256, beforeReload.assetSha256);
  return { beforeReload, afterReload };
}

async function waitForV2REvaluationBridge() {
  await (await $('#jotluck-app')).waitForExist();
  await browser.waitUntil(
    () =>
      browser.execute(
        () => typeof window.__jotluck_e2e?.editor?.requestCompletionDiagnostics === 'function',
      ),
    {
      timeout: 20_000,
      interval: 100,
      timeoutMsg: 'V2R evaluation bridge did not attach to the Tauri WebView.',
    },
  );
}

async function collectLegacyPackagedRuntimeFacts() {
  return browser.execute(async () => {
    const toHex = (bytes) =>
      Array.from(new Uint8Array(bytes), (value) => value.toString(16).padStart(2, '0')).join('');
    const digest = async (bytes) => toHex(await crypto.subtle.digest('SHA-256', bytes));
    const manifestResponse = await fetch('/baseline-ngram.web-local.compact.manifest.json', {
      cache: 'no-store',
    });
    const manifestBytes = await manifestResponse.arrayBuffer();
    const manifestText = new TextDecoder().decode(manifestBytes);
    const manifest = JSON.parse(manifestText);
    const modelResponse = await fetch(`/${manifest.modelFile}`, { cache: 'no-store' });
    const modelBytes = await modelResponse.arrayBuffer();

    return {
      ...collectBrowserFacts(),
      manifestStatus: manifestResponse.status,
      manifestSha256: await digest(manifestBytes),
      modelStatus: modelResponse.status,
      modelBytes: modelBytes.byteLength,
      modelSha256: await digest(modelBytes),
      manifest: {
        schemaVersion: manifest.schemaVersion,
        profile: manifest.profile,
        modelFile: manifest.modelFile,
        modelBytes: manifest.modelBytes,
        sha256: manifest.sha256,
        runtimeEligible: manifest.runtimeEligible,
        qualityGatePassed: manifest.qualityGatePassed,
        releaseEligible: manifest.releaseEligible,
      },
    };

    function collectBrowserFacts() {
      const externalResources = performance
        .getEntriesByType('resource')
        .map((entry) => entry.name)
        .filter((url) => {
          if (!/^https?:\/\//u.test(url)) return false;
          const hostname = new URL(url).hostname;
          return hostname !== 'localhost' && !hostname.endsWith('.localhost');
        });
      return {
        location: window.location.href,
        protocol: window.location.protocol,
        hostname: window.location.hostname,
        userAgent: navigator.userAgent,
        hasTauriInternals: '__TAURI_INTERNALS__' in window,
        hasProductionE2EBridge: '__jotluck_e2e' in window,
        appMounted: Boolean(document.querySelector('#jotluck-app')),
        shellMounted: Boolean(document.querySelector('.app-shell, .single-page-drawer-shell')),
        externalResources,
      };
    }
  });
}

async function collectV2RPackagedRuntimeFacts() {
  return browser.execute(async () => {
    const manifestUrl = '/autocomplete-v2r-evaluation/manifest.json';
    const toHex = (bytes) =>
      Array.from(new Uint8Array(bytes), (value) => value.toString(16).padStart(2, '0')).join('');
    const digest = async (bytes) => toHex(await crypto.subtle.digest('SHA-256', bytes));
    const manifestResponse = await fetch(manifestUrl, { cache: 'no-store' });
    const manifestBytes = await manifestResponse.arrayBuffer();
    const manifest = JSON.parse(new TextDecoder().decode(manifestBytes));
    const assetFacts = {};
    for (const binding of manifest.assets ?? []) {
      const publicPrefix = 'packages/app/public/';
      const packagedPath = binding.path.startsWith(publicPrefix)
        ? binding.path.slice(publicPrefix.length)
        : binding.path;
      const response = await fetch(new URL(packagedPath, new URL(manifestUrl, location.href)), {
        cache: 'no-store',
      });
      const bytes = await response.arrayBuffer();
      assetFacts[binding.role] = {
        status: response.status,
        bytes: bytes.byteLength,
        sha256: await digest(bytes),
      };
    }

    const probes = [
      'Meeting notes confirm the next action',
      'The maintenance log records the current',
      '今天的会议记录已经确认下一步',
      '本次维护记录需要继续检查',
    ];
    let diagnostics = null;
    for (let attempt = 0; attempt < 20; attempt++) {
      const probe = probes[attempt % probes.length];
      diagnostics =
        (await window.__jotluck_e2e?.editor?.requestCompletionDiagnostics?.(
          probe,
          probe.length,
          1_000,
        )) ?? null;
      if (
        diagnostics?.publicEngine?.attempted === true &&
        diagnostics.publicEngine.health?.backendKind === 'worker' &&
        diagnostics.publicEngine.health?.status === 'ready' &&
        diagnostics.publicEngine.health?.generateRequests >= 1 &&
        diagnostics.publicEngine.timedOut === false &&
        diagnostics.publicEngine.fellBack === false
      ) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    const externalResources = performance
      .getEntriesByType('resource')
      .map((entry) => entry.name)
      .filter((url) => {
        if (!/^https?:\/\//u.test(url)) return false;
        const hostname = new URL(url).hostname;
        return hostname !== 'localhost' && !hostname.endsWith('.localhost');
      });
    return {
      location: window.location.href,
      protocol: window.location.protocol,
      hostname: window.location.hostname,
      userAgent: navigator.userAgent,
      hasTauriInternals: '__TAURI_INTERNALS__' in window,
      hasEvaluationBridge: '__jotluck_e2e' in window,
      appMounted: Boolean(document.querySelector('#jotluck-app')),
      shellMounted: Boolean(document.querySelector('.app-shell, .single-page-drawer-shell')),
      externalResources,
      manifestStatus: manifestResponse.status,
      manifestSha256: await digest(manifestBytes),
      manifest: {
        schema: manifest.schema,
        schemaVersion: manifest.schemaVersion,
        engine: manifest.engine,
        profile: manifest.profile,
        candidateId: manifest.candidateId,
        evaluationOnly: manifest.evaluationOnly,
        runtimeEligible: manifest.runtimeEligible,
        qualityGatePassed: manifest.qualityGatePassed,
        releaseEligible: manifest.releaseEligible,
      },
      assetFacts,
      assetSha256: {
        model: assetFacts.model?.sha256 ?? '',
        phraseBank: assetFacts['phrase-bank']?.sha256 ?? '',
        metadata: assetFacts.metadata?.sha256 ?? '',
        runtime: assetFacts.runtime?.sha256 ?? '',
      },
      inference: diagnostics
        ? {
            attempted: diagnostics.publicEngine.attempted,
            timedOut: diagnostics.publicEngine.timedOut,
            fellBack: diagnostics.publicEngine.fellBack,
            usedEngineId: diagnostics.publicEngine.usedEngineId,
            candidates: diagnostics.publicEngine.candidates,
            health: diagnostics.publicEngine.health,
          }
        : null,
    };
  });
}

function assertLegacyPackagedRuntimeFacts(facts) {
  assertCommonRuntimeFacts(facts);
  assert.equal(facts.hasProductionE2EBridge, false);
  assert.equal(facts.manifestStatus, 200);
  assert.equal(facts.modelStatus, 200);
  assert.equal(facts.modelBytes, facts.manifest.modelBytes);
  assert.equal(facts.modelSha256, facts.manifest.sha256);

  const flags = [
    facts.manifest.runtimeEligible,
    facts.manifest.qualityGatePassed,
    facts.manifest.releaseEligible,
  ];
  assert.equal(new Set(flags).size, 1);
  if (isAutocompleteRc) assert.deepEqual(flags, [true, true, true]);
}

function assertV2RPackagedRuntimeFacts(facts) {
  assertCommonRuntimeFacts(facts);
  assert.equal(facts.hasEvaluationBridge, true);
  assert.equal(facts.manifestStatus, 200);
  assert.deepEqual(facts.manifest, {
    schema: 'jotluck.autocomplete.public-model.v5',
    schemaVersion: 5,
    engine: 'public-phrase-transformer-v1',
    profile: 'web-local',
    candidateId: facts.manifest.candidateId,
    evaluationOnly: true,
    runtimeEligible: true,
    qualityGatePassed: false,
    releaseEligible: false,
  });
  assert.match(facts.manifest.candidateId, /^[A-Za-z0-9._-]{3,160}$/u);
  for (const role of ['model', 'phrase-bank', 'metadata', 'runtime']) {
    const binding = facts.assetFacts[role];
    assert.equal(binding?.status, 200, `${role} was not packaged in the Tauri application`);
    assert.equal(binding?.bytes > 0, true, `${role} was empty`);
    assert.match(binding?.sha256 ?? '', /^[a-f0-9]{64}$/u);
  }
  assert.equal(facts.inference?.attempted, true);
  assert.equal(facts.inference?.timedOut, false);
  assert.equal(facts.inference?.fellBack, false);
  assert.equal(facts.inference?.usedEngineId, 'public-phrase-transformer-v1');
  assert.equal(facts.inference?.health?.backendKind, 'worker');
  assert.equal(facts.inference?.health?.status, 'ready');
  assert.equal(facts.inference?.health?.generateRequests >= 1, true);
  for (const candidate of facts.inference?.candidates ?? []) {
    assert.equal(candidate.source, 'neural');
    assert.equal(candidate.sourceLayer, 'l3');
  }
}

function assertCommonRuntimeFacts(facts) {
  assert.equal(facts.appMounted, true);
  assert.equal(facts.shellMounted, true);
  assert.equal(facts.hasTauriInternals, true);
  assert.equal(
    facts.protocol === 'tauri:' ||
      facts.hostname === 'localhost' ||
      facts.hostname.endsWith('.localhost'),
    true,
  );
  assert.match(facts.userAgent, /(?:Edg|WebView2)\//u);
  assert.deepEqual(facts.externalResources, []);
}

function assertLegacyExpectedCandidate(facts) {
  if (!isAutocompleteRc) return;
  assertSha256(expectedModelSha256, 'RC smoke requires JOTLUCK_AUTOCOMPLETE_EXPECTED_MODEL_SHA');
  assert.equal(
    facts.modelSha256,
    expectedModelSha256,
    'packaged Tauri model does not match the selected autocomplete candidate',
  );
}

function assertExpectedV2RAssets() {
  for (const [role, digest] of Object.entries(expectedV2RAssets)) {
    assertSha256(digest, `V2R RC smoke requires an expected ${role} SHA-256`);
  }
}

function assertV2RExpectedCandidate(facts) {
  assert.deepEqual(
    facts.assetSha256,
    expectedV2RAssets,
    'packaged Tauri V2R assets do not match the frozen candidate',
  );
}

function assertSha256(value, message) {
  assert.match(value ?? '', /^[a-f0-9]{64}$/u, message);
}
