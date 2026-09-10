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
const isV25AutocompleteE2E = process.env.JOTLUCK_AUTOCOMPLETE_V25_E2E === '1';
const isV25FocuslessE2E = process.env.JOTLUCK_AUTOCOMPLETE_V25_FOCUSLESS === '1';
const isV25ManualFocusAssisted = process.env.JOTLUCK_AUTOCOMPLETE_V25_MANUAL_FOCUS === '1';
const isV25OsFocusHelper = process.env.JOTLUCK_AUTOCOMPLETE_V25_OS_FOCUS_HELPER === '1';
const v25CasesPath = process.env.JOTLUCK_AUTOCOMPLETE_V25_E2E_CASES
  ? resolve(process.env.JOTLUCK_AUTOCOMPLETE_V25_E2E_CASES)
  : null;
const v25FocusSignalPath = process.env.JOTLUCK_AUTOCOMPLETE_V25_FOCUS_SIGNAL
  ? resolve(process.env.JOTLUCK_AUTOCOMPLETE_V25_FOCUS_SIGNAL)
  : null;

if ([isAutocompleteRc, isV2RAutocompleteRc, isV25AutocompleteE2E].filter(Boolean).length > 1) {
  throw new Error('Autocomplete Tauri smoke modes are mutually exclusive.');
}

let browser;
const driverHost = createTauriDriverHost({ logLevel: 'info' });
const webdriverEvents = [];
const v25JourneyEvents = [];
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
  if (process.platform === 'linux') {
    throw new Error(
      'Linux WebView smoke runs via scripts/release/linux-preview-pack.sh (window mapping + backend init); webdriver-based smoke here requires tauri-driver setup that is not wired yet',
    );
  }
  if (process.platform !== 'win32') {
    throw new Error(
      'Tauri WebView release smoke must run on Windows/WebView2 (or Linux via linux-preview-pack.sh)',
    );
  }
  if (!isV25AutocompleteE2E) await assertFreshEvidenceTargets();

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
    result = isV25AutocompleteE2E
      ? await runV25WebviewJourney()
      : isV2RAutocompleteRc
        ? await runV2RWebviewSmoke()
        : await runLegacyWebviewSmoke();
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
        classification:
          isV25AutocompleteE2E && isV25FocuslessE2E
            ? 'real-tauri-webview2-focusless-autocomplete-journey'
            : isV25AutocompleteE2E
              ? 'real-tauri-webview2-autocomplete-journey'
              : 'tauri-webview-offline-smoke',
        focusless: isV25AutocompleteE2E ? isV25FocuslessE2E : undefined,
        status: 'failed',
        completedAt: new Date().toISOString(),
        platform: process.platform,
        arch: process.arch,
        webview: 'WebView2',
        manualFocusAssisted: isV25AutocompleteE2E ? isV25ManualFocusAssisted : undefined,
        osFocusHelper: isV25AutocompleteE2E ? isV25OsFocusHelper : undefined,
        binary: binaryBinding,
        unicodeFixture: summarizeUnicodeFixture(fixture),
        unicodeGui,
        webdriverTrace,
        journeyEvents: isV25AutocompleteE2E ? v25JourneyEvents : undefined,
        failure: serializeError(executionError),
        cleanupFailure: cleanupError ? serializeError(cleanupError) : null,
      }
    : isV25AutocompleteE2E
      ? {
          schema: 'jotluck.autocomplete.v2.5-tauri-e2e.v1',
          schemaVersion: 1,
          classification: isV25FocuslessE2E
            ? 'real-tauri-webview2-focusless-inference-smoke'
            : 'real-tauri-webview2-autocomplete-journey',
          status: 'pass',
          completedAt: new Date().toISOString(),
          platform: process.platform,
          arch: process.arch,
          webview: 'WebView2',
          manualFocusAssisted: isV25ManualFocusAssisted,
          osFocusHelper: isV25OsFocusHelper,
          binary: binaryBinding,
          unicodeFixture: summarizeUnicodeFixture(fixture),
          unicodeGui,
          webdriverTrace,
          ...result,
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
    flag: isV25AutocompleteE2E ? 'w' : 'wx',
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
  await writeFile(webdriverTracePath, traceBytes, { flag: isV25AutocompleteE2E ? 'w' : 'wx' });
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

async function runV25WebviewJourney() {
  if (!v25CasesPath) {
    throw new Error('V2.5 Tauri E2E requires JOTLUCK_AUTOCOMPLETE_V25_E2E_CASES.');
  }
  await waitForTauriAppReady({
    requireEvaluationBridge: true,
    expectedNotebookName: UNICODE_NOTEBOOK_NAME,
  });
  await browser.execute(() => {
    localStorage.setItem(
      'jotluck:autocomplete:settings',
      JSON.stringify({
        enabled: true,
        aggressiveness: 'balanced',
        backgroundTraining: false,
        maxSuggestionLength: 32,
        minConfidence: 0,
        showDebugStats: false,
      }),
    );
    localStorage.setItem('jotluck:autocomplete:enabled', 'true');
    // The first-run welcome dialog's focus trap (useDialogFocus) yanks focus back
    // to its next button within a microtask, which starves the editor of focus
    // and drops every prediction before display. Complete it before the journey.
    localStorage.setItem('jotluck:welcome:completed', '1');
  });
  await browser.refresh();
  await waitForTauriAppReady({
    requireEvaluationBridge: true,
    expectedNotebookName: UNICODE_NOTEBOOK_NAME,
  });
  await browser.switchToWindow(await browser.getWindowHandle());
  await browser.maximizeWindow();
  await browser.execute(() => {
    const focusLog = (window.__jotluckFocusLog = window.__jotluckFocusLog || []);
    if (window.__jotluckFocusLogInstalled) return;
    window.__jotluckFocusLogInstalled = true;
    const push = (ev, detail) =>
      focusLog.push({ t: Math.round(performance.now()), ev, ...(detail ?? {}) });
    push('logger-installed');
    window.addEventListener('blur', () => push('win-blur'));
    window.addEventListener('focus', () => push('win-focus'));
    document.addEventListener('focusin', (e) =>
      push('focusin', { cls: e.target instanceof Element ? e.target.className : null }),
    );
    document.addEventListener('focusout', (e) =>
      push('focusout', { cls: e.target instanceof Element ? e.target.className : null }),
    );
    document.addEventListener('visibilitychange', () =>
      push('visibility', { state: document.visibilityState }),
    );
  });

  const cases = await loadV25Cases(v25CasesPath);
  const events = v25JourneyEvents;
  const record = (action, details) => {
    events.push({
      sequence: events.length + 1,
      timestamp: new Date().toISOString(),
      action,
      ...details,
    });
  };

  await browser.waitUntil(
    async () => {
      const diagnostics = await requestV25Diagnostics(cases.positives[0]);
      return diagnostics?.publicEngine?.health !== null;
    },
    {
      timeout: 30_000,
      interval: 100,
      timeoutMsg: 'V2.5 public engine did not finish asynchronous installation.',
    },
  );

  let warmup = null;
  for (const item of cases.positives) {
    warmup = await requestV25Diagnostics(item);
    if (
      warmup?.publicEngine?.attempted === true &&
      warmup.publicEngine.timedOut === false &&
      warmup.publicEngine.fellBack === false
    ) {
      break;
    }
  }
  assert.equal(warmup?.publicEngine?.attempted, true, 'V2.5 engine was never attempted');
  assert.equal(warmup?.publicEngine?.timedOut, false, 'V2.5 warmup timed out');
  assert.equal(warmup?.publicEngine?.fellBack, false, 'V2.5 warmup fell back');
  record('warmup', { publicEngine: summarizePublicEngine(warmup?.publicEngine) });

  if (isV25FocuslessE2E) {
    return runV25FocuslessJourney(cases, record, warmup);
  }

  const positiveResults = [];
  for (const item of cases.positives) {
    await clearV25LearningState();
    await setV25EditorCase(item);
    const prediction = await waitForV25PredictionRescheduled(item.timeoutMs, false);
    let denseProbe = null;
    let ghostEngineProbe = null;
    if (prediction === null) {
      denseProbe = await v25DenseDisplayProbe();
      await browser.pause(300);
      // Capture the probe while the dense-probe's ghost request is still the
      // most recent one — before the bridge request overwrites it.
      ghostEngineProbe = await v25GhostEngineHealth();
    }
    const diagnostics = await requestV25Diagnostics(item);
    const ghostDebug = await v25GhostDebugState();
    const engineProbe = diagnostics.publicEngine?.health
      ? {
          lastRequestProbe: diagnostics.publicEngine.health.lastRequestProbe ?? null,
          staleResponses: diagnostics.publicEngine.health.staleResponses ?? 0,
          lastError: diagnostics.publicEngine.health.lastError ?? null,
        }
      : null;
    const resolverProbe = {
      trace: diagnostics.resolverTrace ?? null,
      ranked: (diagnostics.rankedCandidates ?? []).slice(0, 4).map((candidate) => ({
        text: candidate.text,
        provider: candidate.providerId,
        layer: candidate.sourceLayer,
        score: Number((candidate.calibratedScore ?? candidate.confidence ?? 0).toFixed(3)),
      })),
      result: diagnostics.result
        ? { text: diagnostics.result.text, provider: diagnostics.result.providerId }
        : null,
    };
    const displayed = prediction !== null;
    const actualText = predictionText(prediction);
    const useful = displayed && item.acceptableTexts.includes(actualText);
    const profile = v25RuntimeProfile(item);
    positiveResults.push({
      id: item.id,
      route: item.route,
      language: item.language,
      profile,
      displayed,
      useful,
      acceptableTexts: item.acceptableTexts,
      actualText,
      prediction,
      denseProbe,
      ghostEngineProbe,
      ghostDebug,
      engineProbe,
      resolverProbe,
      publicEngine: diagnostics.publicEngine,
    });
    record('display-probe', {
      caseId: item.id,
      profile,
      displayed,
      useful,
      acceptableTexts: item.acceptableTexts,
      actualText,
      prediction,
      denseProbe,
      ghostEngineProbe,
      ghostDebug,
      engineProbe,
      resolverProbe,
      publicEngine: summarizePublicEngine(diagnostics.publicEngine),
    });
  }
  const interaction = positiveResults.find((item) => item.useful && item.prediction?.v25Validation);
  assert.ok(interaction, 'No production-validated V2.5 prediction was visible for interaction E2E');
  const interactionCase = cases.positives.find((item) => item.id === interaction.id);
  assert.ok(interactionCase, 'Visible V2.5 interaction case disappeared');

  await setV25EditorCase(interactionCase);
  const escapePrediction = await waitForV25PredictionRescheduled(interactionCase.timeoutMs, true);
  const escapeBefore = await editorContent();
  await browser.keys('Escape');
  await waitForV25Prediction(1_500, false, true);
  assert.equal(await editorContent(), escapeBefore, 'Escape changed editor content');
  record('escape', {
    caseId: interactionCase.id,
    before: escapeBefore,
    prediction: escapePrediction,
  });

  const positiveProfiles = [...new Set(cases.positives.map(v25RuntimeProfile))].sort();
  const profileInteractions = [];
  for (const profile of positiveProfiles) {
    // Code profiles come from probe-only cases without ground truth (the V2.5
    // engine is a writing-only contract); they cannot yield a useful positive.
    if (profile.startsWith('code:')) continue;
    const profileResult = positiveResults.find(
      (item) => item.profile === profile && item.useful && item.prediction?.v25Validation,
    );
    assert.ok(profileResult, `No useful production-validated V2.5 prediction for ${profile}`);
    const profileCase = cases.positives.find((item) => item.id === profileResult.id);
    assert.ok(profileCase, `V2.5 interaction case disappeared for ${profile}`);
    const accepted = await acceptV25Case(profileCase);
    profileInteractions.push({ profile, ...accepted });
    record('profile-tab-accept', { profile, ...accepted });
  }

  const reverted = await acceptV25Case(interactionCase);
  await browser.keys(['Control', 'z']);
  await browser.waitUntil(async () => (await editorContent()) === reverted.before, {
    timeout: 3_000,
    interval: 50,
    timeoutMsg: 'Ctrl+Z did not revert an accepted V2.5 completion',
  });
  record('undo-revert', { ...reverted, revertedContent: await editorContent() });

  const modified = await acceptV25Case(interactionCase);
  const acceptedText = predictionText(modified.prediction);
  await browser.keys('Backspace');
  await browser.waitUntil(async () => (await editorContent()) !== modified.after, {
    timeout: 3_000,
    interval: 50,
    timeoutMsg: 'Backspace did not modify the accepted V2.5 completion',
  });
  const modifiedContent = await editorContent();
  assert.notEqual(
    modifiedContent,
    modified.after,
    'Backspace did not modify the accepted completion',
  );
  // A single-code-point completion is fully erased by one Backspace, which
  // legitimately collapses back to the untouched prefix.
  if ([...acceptedText].length > 1) {
    assert.notEqual(
      modifiedContent,
      modified.before,
      'Modification collapsed to the untouched prefix',
    );
  }
  await blurV25Editor();
  record('modify', { ...modified, modifiedContent });

  const retained = await acceptV25Case(interactionCase);
  await blurV25Editor();
  await browser.pause(750);
  assert.equal(
    await editorContent(),
    retained.after,
    'A retained V2.5 completion changed after blur',
  );
  record('retain', retained);

  const silenceResults = [];
  for (const item of cases.silences) {
    await clearV25LearningState();
    await setV25EditorCase(item);
    // Any visible suggestion during the observation window reached the user,
    // even if a later refresh removed it before a single end-of-window snapshot.
    const prediction = await waitForV25Prediction(item.settleMs, false);
    const diagnostics = await requestV25Diagnostics(item);
    const intrusive = prediction !== null;
    const profile = v25RuntimeProfile(item);
    silenceResults.push({
      id: item.id,
      profile,
      intrusive,
      prediction,
      publicEngine: diagnostics.publicEngine,
    });
    record('silence-probe', {
      caseId: item.id,
      profile,
      intrusive,
      prediction,
      publicEngine: summarizePublicEngine(diagnostics.publicEngine),
    });
  }

  const displayRate = positiveResults.filter((item) => item.useful).length / positiveResults.length;
  const intrusionRate =
    silenceResults.filter((item) => item.intrusive).length / silenceResults.length;
  const profileDisplayRates = Object.fromEntries(
    positiveProfiles.map((profile) => {
      const values = positiveResults.filter((item) => item.profile === profile);
      return [profile, values.filter((item) => item.useful).length / values.length];
    }),
  );
  const silenceProfiles = [...new Set(silenceResults.map((item) => item.profile))].sort();
  const profileIntrusionRates = Object.fromEntries(
    silenceProfiles.map((profile) => {
      const values = silenceResults.filter((item) => item.profile === profile);
      return [profile, values.filter((item) => item.intrusive).length / values.length];
    }),
  );
  const finalDiagnostics = await requestV25Diagnostics(interactionCase);
  const visibleInferenceP90Ms = finalDiagnostics?.publicEngine?.health?.visibleInferenceP90Ms;
  assert.equal(
    typeof visibleInferenceP90Ms === 'number' && Number.isFinite(visibleInferenceP90Ms),
    true,
    'V2.5 Tauri runtime did not report visible inference P90',
  );
  assert.ok(
    visibleInferenceP90Ms <= cases.maximumVisibleP90Ms,
    `V2.5 visible inference P90 ${visibleInferenceP90Ms}ms exceeds ${cases.maximumVisibleP90Ms}ms`,
  );
  assert.ok(
    displayRate >= cases.minimumDisplayRate,
    `V2.5 Tauri display rate ${displayRate} is below ${cases.minimumDisplayRate}`,
  );
  for (const [profile, rate] of Object.entries(profileDisplayRates)) {
    assert.ok(
      rate >= cases.minimumDisplayRate,
      `V2.5 Tauri display rate ${rate} for ${profile} is below ${cases.minimumDisplayRate}`,
    );
  }
  assert.ok(
    intrusionRate <= cases.maximumIntrusionRate,
    `V2.5 Tauri intrusion rate ${intrusionRate} exceeds ${cases.maximumIntrusionRate}`,
  );
  for (const [profile, rate] of Object.entries(profileIntrusionRates)) {
    assert.ok(
      rate <= cases.maximumIntrusionRate,
      `V2.5 Tauri intrusion rate ${rate} for ${profile} exceeds ${cases.maximumIntrusionRate}`,
    );
  }
  record('summary', {
    positiveCases: positiveResults.length,
    silenceCases: silenceResults.length,
    displayRate,
    intrusionRate,
    profileDisplayRates,
    profileIntrusionRates,
    minimumDisplayRate: cases.minimumDisplayRate,
    maximumIntrusionRate: cases.maximumIntrusionRate,
    visibleInferenceP90Ms,
    maximumVisibleP90Ms: cases.maximumVisibleP90Ms,
  });

  return {
    casesPath: v25CasesPath,
    warmup: summarizePublicEngine(warmup.publicEngine),
    positiveResults,
    silenceResults,
    displayRate,
    intrusionRate,
    profileDisplayRates,
    profileIntrusionRates,
    minimumDisplayRate: cases.minimumDisplayRate,
    maximumIntrusionRate: cases.maximumIntrusionRate,
    visibleInferenceP90Ms,
    maximumVisibleP90Ms: cases.maximumVisibleP90Ms,
    interactions: {
      display: true,
      escape: true,
      tabAccept: true,
      undoRevert: true,
      modify: true,
      retain: true,
      silence: true,
      profileTabAccepts: profileInteractions,
    },
    events,
  };
}

async function runV25FocuslessJourney(cases, record, warmup) {
  const positiveResults = [];
  for (const item of cases.positives) {
    const diagnostics = await requestV25Diagnostics({
      ...item,
      deadlineMs: Math.max(1_000, item.deadlineMs),
    });
    const prediction = diagnostics?.result ?? null;
    const displayed = prediction !== null;
    const hostValidated = Boolean(prediction?.v25Validation);
    const actualText = predictionText(prediction);
    const useful = displayed && item.acceptableTexts.includes(actualText);
    const profile = v25RuntimeProfile(item);
    positiveResults.push({
      id: item.id,
      route: item.route,
      language: item.language,
      profile,
      displayed,
      hostValidated,
      useful,
      acceptableTexts: item.acceptableTexts,
      actualText,
      prediction,
      publicEngine: diagnostics?.publicEngine ?? null,
    });
    record('focusless-display-probe', {
      caseId: item.id,
      profile,
      displayed,
      hostValidated,
      useful,
      acceptableTexts: item.acceptableTexts,
      actualText,
      prediction,
      publicEngine: summarizePublicEngine(diagnostics?.publicEngine),
    });
  }

  const silenceResults = [];
  for (const item of cases.silences) {
    const diagnostics = await requestV25Diagnostics({
      ...item,
      deadlineMs: Math.max(1_000, item.deadlineMs),
    });
    const prediction = diagnostics?.result ?? null;
    const intrusive = prediction !== null;
    const profile = v25RuntimeProfile(item);
    silenceResults.push({
      id: item.id,
      profile,
      intrusive,
      prediction,
      publicEngine: diagnostics?.publicEngine ?? null,
    });
    record('focusless-silence-probe', {
      caseId: item.id,
      profile,
      intrusive,
      prediction,
      publicEngine: summarizePublicEngine(diagnostics?.publicEngine),
    });
  }

  const positiveProfiles = [...new Set(cases.positives.map(v25RuntimeProfile))].sort();
  const hostValidatedDisplayRate =
    positiveResults.filter((item) => item.hostValidated).length / positiveResults.length;
  const exactReferenceRate =
    positiveResults.filter((item) => item.useful).length / positiveResults.length;
  const profileHostValidatedDisplayRates = Object.fromEntries(
    positiveProfiles.map((profile) => {
      const values = positiveResults.filter((item) => item.profile === profile);
      return [profile, values.filter((item) => item.hostValidated).length / values.length];
    }),
  );
  const intrusionRate =
    silenceResults.filter((item) => item.intrusive).length / silenceResults.length;
  const silenceProfiles = [...new Set(silenceResults.map((item) => item.profile))].sort();
  const profileIntrusionRates = Object.fromEntries(
    silenceProfiles.map((profile) => {
      const values = silenceResults.filter((item) => item.profile === profile);
      return [profile, values.filter((item) => item.intrusive).length / values.length];
    }),
  );

  const finalDiagnostics = await requestV25Diagnostics({
    ...cases.positives[0],
    deadlineMs: Math.max(1_000, cases.positives[0].deadlineMs),
  });
  const visibleInferenceP90Ms = finalDiagnostics?.publicEngine?.health?.visibleInferenceP90Ms;
  assert.equal(
    typeof visibleInferenceP90Ms === 'number' && Number.isFinite(visibleInferenceP90Ms),
    true,
    'V2.5 focusless runtime did not report inference P90',
  );
  for (const [profile, rate] of Object.entries(profileHostValidatedDisplayRates)) {
    assert.ok(rate > 0, `V2.5 focusless smoke observed no host-validated result for ${profile}`);
  }
  for (const item of [...positiveResults, ...silenceResults]) {
    assert.equal(
      item.publicEngine?.attempted,
      true,
      `V2.5 engine was not attempted for ${item.id}`,
    );
    assert.equal(item.publicEngine?.timedOut, false, `V2.5 engine timed out for ${item.id}`);
    assert.equal(item.publicEngine?.fellBack, false, `V2.5 engine fell back for ${item.id}`);
  }
  assert.ok(
    intrusionRate <= cases.maximumIntrusionRate,
    `V2.5 focusless intrusion rate ${intrusionRate} exceeds ${cases.maximumIntrusionRate}`,
  );
  for (const [profile, rate] of Object.entries(profileIntrusionRates)) {
    assert.ok(
      rate <= cases.maximumIntrusionRate,
      `V2.5 focusless intrusion rate ${rate} for ${profile} exceeds ${cases.maximumIntrusionRate}`,
    );
  }

  record('focusless-summary', {
    positiveCases: positiveResults.length,
    silenceCases: silenceResults.length,
    hostValidatedDisplayRate,
    exactReferenceRate,
    intrusionRate,
    profileHostValidatedDisplayRates,
    profileIntrusionRates,
    minimumDisplayRate: cases.minimumDisplayRate,
    maximumIntrusionRate: cases.maximumIntrusionRate,
    visibleInferenceP90Ms,
    maximumVisibleP90Ms: cases.maximumVisibleP90Ms,
  });

  return {
    casesPath: v25CasesPath,
    focusless: true,
    focuslessLimitations: [
      'ghost-text-rendering',
      'native-keyboard-input',
      'tab-accept',
      'escape-dismiss',
      'ime-composition',
      'os-window-focus',
    ],
    warmup: summarizePublicEngine(warmup.publicEngine),
    positiveResults,
    silenceResults,
    hostValidatedDisplayRate,
    exactReferenceRate,
    intrusionRate,
    profileHostValidatedDisplayRates,
    profileIntrusionRates,
    minimumDisplayRate: cases.minimumDisplayRate,
    maximumIntrusionRate: cases.maximumIntrusionRate,
    visibleInferenceP90Ms,
    maximumVisibleP90Ms: cases.maximumVisibleP90Ms,
    productGateEvaluated: false,
    productObservations: {
      p90WithinTarget: visibleInferenceP90Ms <= cases.maximumVisibleP90Ms,
      exactReferenceRateWithinTarget: exactReferenceRate >= cases.minimumDisplayRate,
      terminalIntrusionWithinTarget: intrusionRate <= cases.maximumIntrusionRate,
    },
    interactions: {
      displayDecision: true,
      silenceDecision: true,
      ghostTextRendering: false,
      escape: false,
      tabAccept: false,
      undoRevert: false,
      modify: false,
      retain: false,
    },
    events: v25JourneyEvents,
  };
}

async function loadV25Cases(path) {
  const value = JSON.parse(await readFile(path, 'utf8'));
  const normalize = (item, index, kind) => {
    assert.equal(typeof item?.content, 'string', `${kind}[${index}] content is invalid`);
    const cursorOffset = item.cursorOffset ?? item.content.length;
    assert.equal(Number.isInteger(cursorOffset), true, `${kind}[${index}] cursor is invalid`);
    assert.ok(
      cursorOffset >= 0 && cursorOffset <= item.content.length,
      `${kind}[${index}] cursor escapes content`,
    );
    const acceptableTexts = Array.isArray(item.acceptableTexts)
      ? [
          ...new Set(
            item.acceptableTexts.filter((text) => typeof text === 'string' && text.length > 0),
          ),
        ]
      : typeof item.expectedText === 'string'
        ? [item.expectedText]
        : [];
    if (kind === 'positive') {
      assert.ok(acceptableTexts.length > 0, `${kind}[${index}] has no acceptable completion`);
    }
    return {
      id: typeof item.id === 'string' ? item.id : `${kind}-${index}`,
      content: item.content,
      cursorOffset,
      route: typeof item.route === 'string' ? item.route : null,
      language: typeof item.language === 'string' ? item.language : null,
      acceptableTexts,
      deadlineMs: Number.isFinite(item.deadlineMs) ? item.deadlineMs : 5_000,
      timeoutMs: Number.isFinite(item.timeoutMs) ? item.timeoutMs : 12_000,
      settleMs: Number.isFinite(item.settleMs) ? item.settleMs : 1_500,
    };
  };
  assert.ok(
    Array.isArray(value?.positives) && value.positives.length > 0,
    'V2.5 E2E has no positive cases',
  );
  assert.ok(
    Array.isArray(value?.silences) && value.silences.length > 0,
    'V2.5 E2E has no Silence cases',
  );
  return {
    positives: value.positives.map((item, index) => normalize(item, index, 'positive')),
    silences: value.silences.map((item, index) => normalize(item, index, 'silence')),
    minimumDisplayRate: finiteRate(value.minimumDisplayRate, 0.5),
    maximumIntrusionRate: finiteRate(value.maximumIntrusionRate, 0.05),
    maximumVisibleP90Ms:
      typeof value.maximumVisibleP90Ms === 'number' &&
      Number.isFinite(value.maximumVisibleP90Ms) &&
      value.maximumVisibleP90Ms > 0
        ? value.maximumVisibleP90Ms
        : 200,
  };
}

function finiteRate(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
    ? value
    : fallback;
}

function v25RuntimeProfile(item) {
  if (item.route === 'code') return 'code:en';
  return `writing:${item.language === 'zh' ? 'zh' : 'en'}`;
}

async function setV25EditorCase(item) {
  await browser.execute(({ content, cursorOffset }) => {
    window.__jotluck_e2e?.editor?.setContent(content);
    window.__jotluck_e2e?.editor?.setCursor(cursorOffset);
  }, item);
  await browser.waitUntil(
    async () =>
      browser.execute(
        ({ content, cursorOffset }) =>
          window.__jotluck_e2e?.editor?.getContent() === content &&
          window.__jotluck_e2e?.editor?.getCursor() === cursorOffset,
        item,
      ),
    { timeout: 3_000, interval: 50, timeoutMsg: `Editor did not apply V2.5 case ${item.id}` },
  );
  await browser.execute(() => {
    void window.__jotluck_e2e?.focusWindow?.();
    return true;
  });
  await browser.pause(250);
  const focusDeadline =
    Date.now() + (isV25ManualFocusAssisted || isV25OsFocusHelper ? 60_000 : 3_000);
  let focusDiagnostics = null;
  while (Date.now() < focusDeadline) {
    focusDiagnostics = await browser.execute(() => {
      window.__jotluck_e2e?.editor?.focus();
      const editor = document.querySelector('.cm-content');
      if (!(editor instanceof HTMLElement)) throw new Error('CodeMirror content is unavailable');
      window.focus();
      editor.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      editor.click();
      editor.focus({ preventScroll: true });
      return {
        documentHasFocus: document.hasFocus(),
        editorConnected: editor.isConnected,
        editorCount: document.querySelectorAll('.cm-content').length,
        contentEditable: editor.getAttribute('contenteditable'),
        tabIndex: editor.tabIndex,
        editorContainsActive: editor.contains(document.activeElement),
        activeTag: document.activeElement?.tagName ?? null,
        activeClass:
          document.activeElement instanceof HTMLElement ? document.activeElement.className : null,
      };
    });
    if (focusDiagnostics?.editorContainsActive) {
      if (v25FocusSignalPath) {
        await mkdir(dirname(v25FocusSignalPath), { recursive: true });
        await writeFile(v25FocusSignalPath, `${new Date().toISOString()}\n`, 'utf8');
        await browser.pause(750);
        await browser.execute(() => window.__jotluck_e2e?.editor?.focus());
      }
      if (item.cursorOffset > 0) {
        const beforeNudge = await editorContent();
        await browser.execute(
          (cursorOffset) => window.__jotluck_e2e?.editor?.setCursor(cursorOffset - 1),
          item.cursorOffset,
        );
        await browser.pause(100);
        await browser.execute(
          (cursorOffset) => window.__jotluck_e2e?.editor?.setCursor(cursorOffset),
          item.cursorOffset,
        );
        await browser.waitUntil(
          () =>
            browser.execute(
              (cursorOffset) => window.__jotluck_e2e?.editor?.getCursor() === cursorOffset,
              item.cursorOffset,
            ),
          { timeout: 3_000, interval: 50, timeoutMsg: 'Cursor nudge did not restore its position' },
        );
        assert.equal(await editorContent(), beforeNudge, 'Cursor nudge changed editor content');
      }
      await waitForV25EngineIdle();
      await browser.execute(() => {
        const host = document.querySelector('.cm-editor');
        host?.__jotluckScheduleGhostPrediction?.();
      });
      return;
    }
    await browser.pause(250);
  }
  v25JourneyEvents.push({
    sequence: v25JourneyEvents.length + 1,
    timestamp: new Date().toISOString(),
    action: 'focus-failed',
    diagnostics: focusDiagnostics,
  });
  throw new Error(`CodeMirror did not receive focus: ${JSON.stringify(focusDiagnostics)}`);
}

async function visibleV25Prediction() {
  return browser.execute(
    () => window.__jotluck_e2e?.editor?.getVisiblePredictionDiagnostics()?.prediction ?? null,
  );
}

async function v25GhostDebugState() {
  return browser.execute(() => {
    const host = document.querySelector('.cm-editor');
    return {
      base: host?.__jotluckGetGhostDebugState?.() ?? null,
      documentHasFocus: document.hasFocus(),
      visibilityState: document.visibilityState,
      activeTag: document.activeElement?.tagName ?? null,
      activeClass:
        document.activeElement instanceof HTMLElement ? document.activeElement.className : null,
      perfNow: Math.round(performance.now()),
      focusLog: (window.__jotluckFocusLog || []).slice(-40),
    };
  });
}

async function v25DenseDisplayProbe(durationMs = 4000) {
  return browser.execute(
    (duration) =>
      new Promise((resolve) => {
        const host = document.querySelector('.cm-editor');
        if (!host) {
          resolve({ error: 'no cm-editor host' });
          return;
        }
        const readState = () => host.__jotluckGetGhostDebugState?.() ?? null;
        const readVisible = () =>
          window.__jotluck_e2e?.editor?.getVisiblePredictionDiagnostics()?.prediction ?? null;
        const timeline = [];
        const t0 = performance.now();
        host.__jotluckScheduleGhostPrediction?.();
        const timer = setInterval(() => {
          const t = Math.round(performance.now() - t0);
          const state = readState();
          const prediction = readVisible();
          timeline.push({
            t,
            ghost: state?.currentGhostText ?? '',
            scheduled: state?.predictionScheduled ?? null,
            epoch: state?.predictionEpoch ?? null,
            requestKey: state?.activeRequestKey ?? null,
            focus: state?.viewHasFocus ?? null,
            visible: prediction ? (prediction.displayText ?? prediction.text ?? '?') : null,
          });
          if (t >= duration) {
            clearInterval(timer);
            resolve({
              durationMs: duration,
              timeline: timeline.filter(
                (entry, index, all) =>
                  index === 0 ||
                  entry.ghost !== all[index - 1].ghost ||
                  entry.scheduled !== all[index - 1].scheduled ||
                  entry.epoch !== all[index - 1].epoch ||
                  entry.requestKey !== all[index - 1].requestKey ||
                  entry.visible !== all[index - 1].visible,
              ),
            });
          }
        }, 20);
      }),
    durationMs,
  );
}

async function waitForV25Prediction(timeoutMs, required, requireAbsent = false) {
  if (!required && !requireAbsent) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const value = await visibleV25Prediction();
      if (value !== null) return value;
      await browser.pause(50);
    }
    return null;
  }
  await browser.waitUntil(
    async () => {
      const value = await visibleV25Prediction();
      return requireAbsent ? value === null : required ? value !== null : true;
    },
    {
      timeout: timeoutMs,
      interval: 50,
      timeoutMsg: requireAbsent
        ? 'V2.5 ghost text did not disappear'
        : 'V2.5 ghost text did not become visible',
    },
  );
  return visibleV25Prediction();
}

// The plugin predicts once per editor interaction: a response that races past the
// 200 ms deadline or gets superseded is never retried until the next interaction.
// A real user keeps typing and reschedules naturally; re-fire the debug hook on
// the same cadence so one slow request does not fail the whole probe.
async function v25EngineIdle() {
  return browser.execute(() => {
    const host = document.querySelector('.cm-editor');
    const state = host?.__jotluckGetGhostDebugState?.() ?? null;
    return (
      state === null || (state.activeRequestKey === null && state.predictionScheduled !== true)
    );
  });
}

async function waitForV25EngineIdle(timeoutMs = 500) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await v25EngineIdle()) return;
    await browser.pause(20);
  }
}

async function clearV25LearningState() {
  await browser.execute(() => {
    window.__jotluck_e2e?.editor?.clearLearningState?.();
  });
}

async function v25GhostEngineHealth() {
  return browser.execute(() => {
    const health = window.__jotluck_e2e?.editor?.getCompletionEngineHealthSnapshot?.() ?? null;
    if (!health) return null;
    return {
      lastRequestProbe: health.lastRequestProbe ?? null,
      staleResponses: health.staleResponses ?? 0,
      lastError: health.lastError ?? null,
    };
  });
}

async function waitForV25PredictionRescheduled(timeoutMs, required) {
  const attempts = 4;
  const sliceMs = Math.max(1_000, Math.floor(timeoutMs / attempts));
  let lastValue = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (attempt > 0) {
      await waitForV25EngineIdle();
      await browser.pause(150);
      await browser.execute(() => {
        const host = document.querySelector('.cm-editor');
        host?.__jotluckScheduleGhostPrediction?.();
      });
    }
    lastValue = await waitForV25Prediction(sliceMs, false);
    if (lastValue !== null) return lastValue;
  }
  if (required) throw new Error('V2.5 ghost text did not become visible');
  return null;
}

async function requestV25Diagnostics(item) {
  return browser.execute(
    ({ content, cursorOffset, deadlineMs }) =>
      window.__jotluck_e2e?.editor?.requestCompletionDiagnostics(content, cursorOffset, deadlineMs),
    item,
  );
}

async function editorContent() {
  return browser.execute(() => window.__jotluck_e2e?.editor?.getContent() ?? '');
}

function applyV25Prediction(content, prediction) {
  const edit = prediction.edit ?? {
    from: prediction.from,
    to: prediction.to ?? prediction.from,
    insertText: prediction.insertText ?? prediction.text,
  };
  assert.equal(Number.isInteger(edit.from), true, 'V2.5 prediction start is invalid');
  assert.equal(Number.isInteger(edit.to), true, 'V2.5 prediction end is invalid');
  assert.equal(typeof edit.insertText, 'string', 'V2.5 prediction insert text is invalid');
  return `${content.slice(0, edit.from)}${edit.insertText}${content.slice(edit.to)}`;
}

function predictionText(prediction) {
  if (!prediction) return '';
  return prediction.edit?.insertText ?? prediction.insertText ?? prediction.text ?? '';
}

async function acceptV25Case(item) {
  await setV25EditorCase(item);
  const prediction = await waitForV25PredictionRescheduled(item.timeoutMs, true);
  assert.ok(
    prediction?.v25Validation,
    'Visible completion did not pass the V2.5 production validator',
  );
  const before = await editorContent();
  const expected = applyV25Prediction(before, prediction);
  await browser.keys('Tab');
  await browser.waitUntil(async () => (await editorContent()) === expected, {
    timeout: 3_000,
    interval: 50,
    timeoutMsg: 'Tab did not apply the exact V2.5 completion edit',
  });
  return { caseId: item.id, before, prediction, after: await editorContent() };
}

async function blurV25Editor() {
  await browser.execute(() => {
    const target = document.querySelector('.wing-settings-btn');
    if (!(target instanceof HTMLElement)) throw new Error('Settings focus target is unavailable');
    target.focus();
  });
}

function summarizePublicEngine(value) {
  if (!value) return null;
  return {
    attempted: value.attempted,
    timedOut: value.timedOut,
    fellBack: value.fellBack,
    usedEngineId: value.usedEngineId,
    candidates: value.candidates,
    health: value.health,
  };
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
