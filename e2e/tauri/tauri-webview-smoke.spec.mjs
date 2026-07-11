import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import assert from 'node:assert/strict';

const binaryPath = resolve(
  process.env.JOTLUCK_TAURI_BINARY ?? 'packages/app/src-tauri/target/release/jotluck.exe',
);
const evidencePath = resolve(
  process.env.JOTLUCK_TAURI_WEBVIEW_EVIDENCE ??
    'scripts/corpus/_web-cache/autocomplete-candidates/tauri-webview-smoke.json',
);
const expectedModelSha256 = process.env.JOTLUCK_AUTOCOMPLETE_EXPECTED_MODEL_SHA;
const isAutocompleteRc = process.env.JOTLUCK_AUTOCOMPLETE_RC === '1';

describe('Windows Tauri WebView offline smoke', () => {
  it('loads packaged assets in a real WebView2 and survives reload', async () => {
    if (process.platform !== 'win32') {
      throw new Error('Tauri WebView release smoke must run on Windows/WebView2');
    }

    const appRoot = await $('#jotluck-app');
    await appRoot.waitForExist();
    const beforeReload = await collectPackagedRuntimeFacts();
    assertPackagedRuntimeFacts(beforeReload);
    assertExpectedCandidate(beforeReload);

    await browser.refresh();
    await (await $('#jotluck-app')).waitForExist();
    const afterReload = await collectPackagedRuntimeFacts();
    assertPackagedRuntimeFacts(afterReload);
    assertExpectedCandidate(afterReload);

    assert.equal(afterReload.location, beforeReload.location);
    assert.equal(afterReload.modelSha256, beforeReload.modelSha256);
    assert.equal(afterReload.manifestSha256, beforeReload.manifestSha256);

    const binary = await readFile(binaryPath);
    const binaryStats = await stat(binaryPath);
    const evidence = {
      schemaVersion: 1,
      classification: 'tauri-webview-offline-smoke',
      status: 'pass',
      modelSha256: beforeReload.modelSha256,
      completedAt: new Date().toISOString(),
      platform: process.platform,
      arch: process.arch,
      webview: 'WebView2',
      binary: {
        path: binaryPath,
        bytes: binaryStats.size,
        sha256: createHash('sha256').update(binary).digest('hex'),
      },
      beforeReload,
      afterReload,
    };
    await mkdir(dirname(evidencePath), { recursive: true });
    await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
    });
  });
});

async function collectPackagedRuntimeFacts() {
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
  });
}

function assertPackagedRuntimeFacts(facts) {
  assert.equal(facts.appMounted, true);
  assert.equal(facts.shellMounted, true);
  assert.equal(facts.hasTauriInternals, true);
  assert.equal(facts.hasProductionE2EBridge, false);
  assert.equal(
    facts.protocol === 'tauri:' ||
      facts.hostname === 'localhost' ||
      facts.hostname.endsWith('.localhost'),
    true,
  );
  assert.match(facts.userAgent, /(?:Edg|WebView2)\//u);
  assert.deepEqual(facts.externalResources, []);
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

function assertExpectedCandidate(facts) {
  if (!isAutocompleteRc) return;
  assert.match(
    expectedModelSha256 ?? '',
    /^[a-f0-9]{64}$/u,
    'RC smoke requires JOTLUCK_AUTOCOMPLETE_EXPECTED_MODEL_SHA',
  );
  assert.equal(
    facts.modelSha256,
    expectedModelSha256,
    'packaged Tauri model does not match the selected autocomplete candidate',
  );
}
