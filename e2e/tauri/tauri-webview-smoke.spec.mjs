import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { dirname, resolve } from 'node:path';
import { createTauriDriverHost } from './tauri-webdriver-host.mjs';
import {
  UNICODE_NOTE_MARKER,
  UNICODE_NOTEBOOK_NAME,
  createUnicodeAuditFixture,
} from '../../scripts/audit/create-unicode-notebook-fixture.mjs';

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

let browser;
const driverHost = createTauriDriverHost({ logLevel: 'info' });
const webdriverEvents = [];
const webdriverTracePath = evidencePath.endsWith('.json')
  ? `${evidencePath.slice(0, -'.json'.length)}.webdriver.ndjson`
  : `${evidencePath}.webdriver.ndjson`;

function recordWebDriverEvent(event) {
  webdriverEvents.push({
    schema: 'jotluck.tauri-webview-smoke.webdriver-event.v1',
    sequence: webdriverEvents.length + 1,
    timestamp: new Date().toISOString(),
    ...event,
  });
}

async function main() {
  if (process.platform !== 'win32') {
    throw new Error('Tauri WebView release smoke must run on Windows/WebView2');
  }
  await assertFreshEvidenceTargets();

  let temporaryRoot = null;
  let fixture = null;
  let binaryBinding = null;
  let isolatedAppData = null;
  let previousAppData = null;
  let unicodeGui = null;
  let executionError = null;
  let cleanupError = null;
  let result = null;
  try {
    temporaryRoot = await mkdtemp(resolve(os.tmpdir(), 'jotluck-tauri-webview-smoke-'));
    fixture = await createUnicodeAuditFixture(temporaryRoot);
    isolatedAppData = await createIsolatedAppData(temporaryRoot);
    previousAppData = isolateAppDataEnvironment(isolatedAppData);
    const binary = await readFile(binaryPath);
    const binaryStats = await stat(binaryPath);
    binaryBinding = {
      path: binaryPath,
      bytes: binaryStats.size,
      sha256: createHash('sha256').update(binary).digest('hex'),
    };
    browser = await driverHost.createSession({
      application: binaryPath,
      onEvent: recordWebDriverEvent,
    });

    await waitForGuidedSampleWorkspace();
    await browser.execute((root) => {
      localStorage.setItem('jotluck-recent-notebooks', JSON.stringify([root]));
    }, fixture.notebookRoot);
    await browser.refresh();
    await waitForTauriAppReady({ expectedNotebookName: fixture.notebookName });
    unicodeGui = await openUnicodeNoteThroughGui(fixture);
    result = isV2RAutocompleteRc ? await runV2RWebviewSmoke() : await runLegacyWebviewSmoke();
  } catch (error) {
    executionError = error;
  } finally {
    try {
      await driverHost.deleteSession(browser);
      await driverHost.dispose();
    } catch (error) {
      cleanupError = error;
      if (!executionError) executionError = error;
    }
    try {
      restoreAppDataEnvironment(previousAppData);
      previousAppData = null;
      await cleanupTemporaryRoot(temporaryRoot);
      temporaryRoot = null;
    } catch (error) {
      cleanupError = cleanupError
        ? new AggregateError([cleanupError, error], 'Tauri WebView smoke cleanup failed')
        : error;
      if (!executionError) executionError = cleanupError;
    }
  }

  if (!executionError) {
    try {
      assertWebDriverEvidenceObserved();
    } catch (error) {
      executionError = error;
    }
  }

  let webdriverTrace = null;
  try {
    webdriverTrace = await writeWebDriverTrace({
      status: executionError ? 'failed' : 'passed',
      executionError,
      cleanupError,
    });
  } catch (error) {
    executionError = executionError
      ? new AggregateError(
          [executionError, error],
          'Smoke execution and evidence trace both failed',
        )
      : error;
    webdriverTrace = {
      path: webdriverTracePath,
      status: 'write-failed',
      failure: serializeError(error),
    };
  }
  const evidence = executionError
    ? {
        schema: 'jotluck.tauri-webview-smoke.v2',
        schemaVersion: 2,
        classification: 'tauri-webview-offline-smoke',
        status: 'failed',
        completedAt: new Date().toISOString(),
        platform: process.platform,
        arch: process.arch,
        webview: 'WebView2',
        binary: binaryBinding,
        unicodeFixture: summarizeUnicodeFixture(fixture),
        unicodeGui,
        webdriverTrace,
        failure: serializeError(executionError),
        cleanupFailure: cleanupError ? serializeError(cleanupError) : null,
      }
    : isV2RAutocompleteRc
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
          unicodeFixture: summarizeUnicodeFixture(fixture),
          unicodeGui,
          webdriverTrace,
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
          unicodeFixture: summarizeUnicodeFixture(fixture),
          unicodeGui,
          webdriverTrace,
          ...result,
        };
  await mkdir(dirname(evidencePath), { recursive: true });
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
  });
  if (executionError) throw executionError;
}

async function assertFreshEvidenceTargets() {
  for (const target of [evidencePath, webdriverTracePath]) {
    try {
      await stat(target);
    } catch (error) {
      if (error?.code === 'ENOENT') continue;
      throw error;
    }
    throw new Error(
      `Refusing to overwrite immutable Tauri smoke evidence at ${target}. ` +
        'Set JOTLUCK_TAURI_WEBVIEW_EVIDENCE to a fresh path for this run.',
    );
  }
}

async function writeWebDriverTrace({ status, executionError, cleanupError }) {
  const events = [
    ...webdriverEvents,
    {
      schema: 'jotluck.tauri-webview-smoke.webdriver-event.v1',
      sequence: webdriverEvents.length + 1,
      timestamp: new Date().toISOString(),
      event: 'smoke-complete',
      status,
      executionError: executionError ? serializeError(executionError) : null,
      cleanupError: cleanupError ? serializeError(cleanupError) : null,
    },
  ];
  const traceBytes = Buffer.from(
    `${events.map((event) => JSON.stringify(event)).join('\n')}\n`,
    'utf8',
  );
  await mkdir(dirname(webdriverTracePath), { recursive: true });
  await writeFile(webdriverTracePath, traceBytes, { flag: 'wx' });
  const actualTraceBytes = await readFile(webdriverTracePath);
  const actualTraceEvents = actualTraceBytes
    .toString('utf8')
    .trimEnd()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  assert.equal(
    actualTraceEvents.length,
    events.length,
    'WebDriver NDJSON event count drifted on disk',
  );
  return {
    path: webdriverTracePath,
    bytes: actualTraceBytes.byteLength,
    sha256: createHash('sha256').update(actualTraceBytes).digest('hex'),
    eventCount: actualTraceEvents.length,
    completedCommandCount: actualTraceEvents.filter(
      (event) => event.event === 'webdriver-command-complete',
    ).length,
  };
}

function summarizeUnicodeFixture(fixture) {
  if (!fixture) return null;
  return {
    schema: fixture.schema,
    notebookName: fixture.notebookName,
    marker: fixture.marker,
    manifestSha256: fixture.manifestSha256,
    note: fixture.note,
  };
}

async function createIsolatedAppData(temporaryRoot) {
  const appData = resolve(temporaryRoot, 'appdata');
  const localAppData = resolve(temporaryRoot, 'localappdata');
  await Promise.all([
    mkdir(appData, { recursive: true }),
    mkdir(localAppData, { recursive: true }),
  ]);
  return { appData, localAppData };
}

function isolateAppDataEnvironment({ appData, localAppData }) {
  const previous = {
    APPDATA: process.env.APPDATA,
    LOCALAPPDATA: process.env.LOCALAPPDATA,
  };
  process.env.APPDATA = appData;
  process.env.LOCALAPPDATA = localAppData;
  recordWebDriverEvent({ event: 'appdata-isolated', appData, localAppData });
  return previous;
}

function restoreAppDataEnvironment(previous) {
  if (!previous) return;
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

async function cleanupTemporaryRoot(temporaryRoot) {
  if (!temporaryRoot) return;
  await rm(temporaryRoot, { recursive: true, force: false, maxRetries: 3, retryDelay: 100 });
  await assert.rejects(stat(temporaryRoot), { code: 'ENOENT' });
  recordWebDriverEvent({ event: 'temporary-root-cleaned', temporaryRoot });
}

async function waitForGuidedSampleWorkspace() {
  const editor = await browser.$('.cm-content');
  await editor.waitForExist({ timeout: 20_000 });
  await editor.waitForDisplayed({ timeout: 20_000 });
  const guidedText = await browser.execute(
    () => document.querySelector('.cm-content')?.textContent?.trim() ?? '',
  );
  assert.notEqual(guidedText, '', 'Guided sample workspace opened without visible note content');
  const gateCount = await browser.$$('[data-testid="notebook-open-gate"]');
  assert.equal(
    gateCount.length,
    0,
    'Fresh launch unexpectedly fell back to the notebook open gate',
  );
}

async function openUnicodeNoteThroughGui(fixture) {
  // msedgedriver 的 CDP Input 注入在 WebView2 150/151 上会挂起或断开会话（本地实测：
  // Runtime.evaluate 正常、Input.dispatchMouseEvent 必挂）。smoke 的目的是验证打包运行时
  // 行为而非 OS 输入管线（真实输入由 Playwright E2E 覆盖），故点击改走 DOM 合成事件。
  const menu = await browser.$('.topbar-btn--menu');
  await menu.waitForDisplayed({ timeout: 20_000 });
  await syntheticDomClick('.topbar-btn--menu');
  const drawer = await browser.$('.file-drawer');
  await drawer.waitForDisplayed({ timeout: 20_000 });
  const itemSelector = `//*[contains(concat(' ', normalize-space(@class), ' '), ' tree-item ') and contains(., "${fixture.note.fileName}")]`;
  const item = await browser.$(itemSelector);
  await item.waitForDisplayed({ timeout: 20_000 });
  await syntheticDomClick(itemSelector, item);
  await (await browser.$('.cm-content')).waitForDisplayed({ timeout: 20_000 });
  await browser.waitUntil(
    () =>
      browser.execute(
        (marker) => document.querySelector('.cm-content')?.textContent?.includes(marker) ?? false,
        UNICODE_NOTE_MARKER,
      ),
    {
      timeout: 20_000,
      interval: 100,
      timeoutMsg: 'Unicode notebook note did not display its UTF-8 marker after GUI open',
    },
  );
  const visibleText = await browser.execute(
    () => document.querySelector('.cm-content')?.textContent ?? '',
  );
  assert.equal(visibleText.includes(UNICODE_NOTE_MARKER), true);
  return {
    openedThrough: 'file-drawer',
    fileName: fixture.note.fileName,
    marker: UNICODE_NOTE_MARKER,
    markerSha256: createHash('sha256').update(UNICODE_NOTE_MARKER, 'utf8').digest('hex'),
  };
}

function serializeError(error) {
  return {
    name: error instanceof Error ? error.name : 'Error',
    message: error instanceof Error ? error.message : String(error),
  };
}

// 通过已解析的 WebdriverIO 元素（可见性检查仍走协议层）派发 DOM 合成点击，
// 规避 msedgedriver/WebView2 的 Input 域缺陷；见 openUnicodeNoteThroughGui 注释。
async function syntheticDomClick(selector, resolved = null) {
  const element = resolved ?? (await browser.$(selector));
  await browser.execute((target) => {
    target.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true, view: window }),
    );
  }, element);
}

function assertWebDriverEvidenceObserved() {
  assert.equal(
    webdriverEvents.some((event) => event.event === 'webdriver-session-handshake-complete'),
    true,
    'WebDriver smoke did not record a completed session handshake',
  );
  assert.equal(
    webdriverEvents.some((event) => event.event === 'webdriver-command-complete'),
    true,
    'WebDriver smoke did not record any completed protocol command',
  );
  assert.equal(
    webdriverEvents.some((event) => event.event === 'webdriver-session-deleted'),
    true,
    'WebDriver smoke did not record session cleanup',
  );
}

async function waitForTauriAppReady({
  requireEvaluationBridge = false,
  expectedNotebookName,
} = {}) {
  await browser.waitUntil(
    async () =>
      browser.execute(
        ({ needsEvaluationBridge, notebookName }) => {
          const shell = document.querySelector('.app-shell, .single-page-drawer-shell');
          const shellVisible =
            shell instanceof HTMLElement &&
            shell.getBoundingClientRect().width > 0 &&
            shell.getBoundingClientRect().height > 0;
          return Boolean(
            document.querySelector('#jotluck-app') &&
            shellVisible &&
            '__TAURI_INTERNALS__' in window &&
            (!notebookName || document.body.textContent?.includes(notebookName)) &&
            (!needsEvaluationBridge ||
              typeof window.__jotluck_e2e?.editor?.requestCompletionDiagnostics === 'function'),
          );
        },
        {
          needsEvaluationBridge: requireEvaluationBridge,
          notebookName: expectedNotebookName ?? null,
        },
      ),
    {
      timeout: 20_000,
      interval: 100,
      timeoutMsg: 'Tauri WebView did not reach a visible, initialized application shell.',
    },
  );
}

async function runLegacyWebviewSmoke() {
  const beforeReload = await collectLegacyPackagedRuntimeFacts();
  assertLegacyPackagedRuntimeFacts(beforeReload);
  assertLegacyExpectedCandidate(beforeReload);

  await browser.refresh();
  await (await browser.$('#jotluck-app')).waitForExist();
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
  await waitForTauriAppReady({
    requireEvaluationBridge: true,
    expectedNotebookName: UNICODE_NOTEBOOK_NAME,
  });
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

await main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
