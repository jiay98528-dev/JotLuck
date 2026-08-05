import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { Document, Packer, Paragraph } from 'docx';
import { createTauriDriverHost } from './tauri-webdriver-host.mjs';

const PROJECT_ROOT = path.resolve(import.meta.dirname, '../..');
const NOTE_EXTENSIONS = ['.md', '.markdown', '.mdx', '.txt'];
const DOCUMENT_EXTENSIONS = ['.docx', '.pdf', '.xlsx', '.xls'];
const SUPPORTED_EXTENSIONS = [...NOTE_EXTENSIONS, ...DOCUMENT_EXTENSIONS];
const PERFORMANCE_SAMPLE_COUNTS = Object.freeze({ coldStart: 20, hotWindow: 30 });
const state = {
  candidate: null,
  installed: null,
  host: null,
  childProcesses: new Set(),
  shellProcessIds: new Set(),
  installEvents: [],
  performance: {
    coldStartMs: [],
    hotWindowMs: [],
    processLifecycle: [],
    hotWindowLifecycle: [],
    finalProcesses: [],
  },
  preInstallRegistry: null,
  seededOpenWithBackup: null,
};

const ADAPTERS = new Map([
  ['gui-note-lifecycle', guiNoteLifecycle],
  ['gui-file-drawer', guiFileDrawer],
  ['gui-search-edit', guiSearchEdit],
  ['gui-live-preview', guiLivePreview],
  ['gui-settings-persistence', guiSettingsPersistence],
  ['gui-export-content', guiExportContent],
  ['gui-image-asset', guiImageAsset],
  ['rf-cold-open-supported-files', rfColdOpenSupportedFiles],
  ['rf-runtime-new-window', rfRuntimeNewWindow],
  ['rf-path-deduplication', rfPathDeduplication],
  ['rf-external-edit', rfExternalEdit],
  ['rf-promote-notebook', rfPromoteNotebook],
  ['rf-workspace-isolation', rfWorkspaceIsolation],
  ['rf-window-close-isolation', rfWindowCloseIsolation],
  ['rf-reader-security', rfReaderSecurity],
  ['rf-reader-bundle-isolation', rfReaderBundleIsolation],
  ['rf-installed-windows-journey', rfInstalledWindowsJourney],
  ['version-consistency', versionConsistency],
  ['association-md', associationMd],
  ['association-markdown', associationMarkdown],
  ['association-mdx', associationMdx],
  ['association-txt', associationTxt],
  ['association-docx', associationDocx],
  ['association-pdf', associationPdf],
  ['association-xlsx', associationXlsx],
  ['association-xls', associationXls],
  ['association-default-preservation', associationDefaultPreservation],
  ['association-uninstall-cleanup', associationUninstallCleanup],
]);

export async function runInstalledAppCase({ definition, candidateRoot, workRoot }) {
  assertDefinition(definition);
  const adapter = ADAPTERS.get(definition.adapter);
  if (!adapter) throw new Error(`unknown fixed installed-app adapter: ${definition.adapter}`);
  await ensureInstalledCandidate(candidateRoot);
  mkdirSync(workRoot, { recursive: true });
  const trace = new EvidenceTrace(definition.id, definition.adapter, workRoot);
  const startedAt = new Date().toISOString();
  try {
    const artifacts = await adapter({ definition, workRoot, trace });
    const expected = definition.requiredArtifactKinds.filter((kind) => kind !== 'execution-log');
    if (expected.includes('adapter-action-log')) {
      artifacts.push(artifact(workRoot, 'adapter-action-log', 'ndjson'));
    }
    const actual = artifacts.map((artifact) => artifact.kind);
    assert.deepEqual(
      actual.sort(),
      [...expected].sort(),
      `${definition.id} artifact kinds drifted`,
    );
    trace.record('adapter-observations-complete', { artifactKinds: actual.sort() });
    if (expected.includes('webdriver-trace')) {
      const webdriverTrace = artifacts.find((artifact) => artifact.kind === 'webdriver-trace');
      trace.flushWebDriver(webdriverTrace.path);
    }
    if (expected.includes('adapter-action-log')) {
      const adapterLog = artifacts.find((artifact) => artifact.kind === 'adapter-action-log');
      trace.flushAdapter(adapterLog.path);
    }
    for (const artifact of artifacts) assertNonEmptyRegularFile(artifact.path, artifact.kind);
    return {
      startedAt,
      finishedAt: new Date().toISOString(),
      exitCode: 0,
      counters: { executed: 1, passed: 1, failed: 0, skipped: 0 },
      artifacts,
    };
  } catch (error) {
    trace.record('adapter-failed', {
      name: error instanceof Error ? error.name : 'Error',
      message: error instanceof Error ? error.message : String(error),
    });
    trace.flushFailure(path.join(workRoot, 'failure-adapter-action-log.ndjson'));
    trace.flushWebDriverFailure(path.join(workRoot, 'failure-webdriver-trace.ndjson'));
    throw error;
  }
}

export async function readPerformanceSummary() {
  return {
    coldStartMs: [...state.performance.coldStartMs],
    hotWindowMs: [...state.performance.hotWindowMs],
  };
}

export async function disposeInstalledAppEvidence() {
  const cleanupErrors = [];
  try {
    await state.host?.dispose();
  } catch (error) {
    cleanupErrors.push(error);
  }
  state.host = null;
  for (const child of state.childProcesses) {
    if (child.exitCode === null) child.kill();
  }
  state.childProcesses.clear();
  for (const processId of state.shellProcessIds) stopObservedProcess(processId);
  state.shellProcessIds.clear();
  try {
    await uninstallCandidate();
  } catch (error) {
    cleanupErrors.push(error);
  }
  try {
    clearSeededOpenWithOrder();
  } catch (error) {
    cleanupErrors.push(error);
  }
  if (cleanupErrors.length > 0) {
    throw new AggregateError(cleanupErrors, 'installed-app evidence cleanup failed');
  }
}

export const __test = Object.freeze({
  adapterNames: () => [...ADAPTERS.keys()].sort(),
  discoverCandidate,
  assertDefinition,
  parseInstalledEntry,
  inspectReaderBundle,
  isQuotedJotLuckOpenCommand,
  openCommandTargetsApplication,
  assertMatchingExecutableIdentities,
  resolveAssociationProcessId,
  sanitizeTraceValue,
  supportedExtensions: () => [...SUPPORTED_EXTENSIONS],
  progIdForExtension,
  createSupportedFixture,
});

class EvidenceTrace {
  constructor(caseId, adapter, workRoot) {
    this.caseId = caseId;
    this.adapter = adapter;
    this.workRoot = workRoot;
    this.adapterEvents = [];
    this.webdriverEvents = [];
    this.adapterSequence = 0;
    this.webdriverSequence = 0;
  }

  record(action, details = {}) {
    this.adapterEvents.push({
      schema: 'jotluck.installed-app.adapter-action-event.v1',
      sequence: ++this.adapterSequence,
      timestamp: new Date().toISOString(),
      caseId: this.caseId,
      adapter: this.adapter,
      action,
      details: sanitizeTraceValue(details),
    });
  }

  recordWebDriver(observation) {
    this.webdriverEvents.push({
      schema: 'jotluck.installed-app.webdriver-event.v3',
      sequence: ++this.webdriverSequence,
      timestamp: new Date().toISOString(),
      caseId: this.caseId,
      adapter: this.adapter,
      ...sanitizeTraceValue(observation),
    });
  }

  flushWebDriver(targetPath) {
    if (!this.webdriverEvents.some((event) => event.event === 'webdriver-command-complete')) {
      throw new Error(`${this.caseId} produced no completed WebDriver command observations`);
    }
    this.writeEvents(targetPath, this.webdriverEvents);
  }

  flushAdapter(targetPath) {
    if (this.adapterEvents.length === 0)
      throw new Error(`${this.caseId} produced an empty adapter action log`);
    this.writeEvents(targetPath, this.adapterEvents);
  }

  flushFailure(targetPath) {
    this.writeEvents(targetPath, this.adapterEvents);
  }

  flushWebDriverFailure(targetPath) {
    this.writeEvents(targetPath, this.webdriverEvents);
  }

  writeEvents(targetPath, events) {
    if (events.length === 0) return;
    writeFileSync(
      targetPath,
      `${events.map((event) => JSON.stringify(event)).join('\n')}\n`,
      'utf8',
    );
  }
}

async function ensureInstalledCandidate(candidateRoot) {
  const resolvedRoot = path.resolve(candidateRoot);
  if (!state.candidate) state.candidate = discoverCandidate(resolvedRoot);
  else if (state.candidate.root !== resolvedRoot)
    throw new Error('candidate root changed during capture');
  if (state.installed) return state.installed;
  if (process.platform !== 'win32' || process.env.GITHUB_ACTIONS !== 'true') {
    throw new Error('formal installed-app adapters only execute on GitHub Actions Windows runners');
  }
  state.preInstallRegistry = readAssociationSnapshot();
  const install = await runProcess(state.candidate.installer, ['/S'], 180_000);
  state.installEvents.push({ action: 'install', ...install });
  if (install.exitCode !== 0)
    throw new Error(`candidate installer failed with ${install.exitCode}`);
  const entry = queryInstalledEntry();
  state.installed = parseInstalledEntry(entry);
  assertNonEmptyRegularFile(state.installed.application, 'installed application');
  const packagedApplication = executableIdentity(state.candidate.packagedApplication);
  const installedApplication = executableIdentity(state.installed.application);
  assertMatchingExecutableIdentities(packagedApplication, installedApplication);
  state.installed.applicationIdentity = installedApplication;
  state.installed.packagedApplicationIdentity = packagedApplication;
  state.host = createTauriDriverHost({ logLevel: 'error' });
  return state.installed;
}

function discoverCandidate(candidateRoot) {
  const rootInfo = lstatSync(candidateRoot);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) {
    throw new Error('candidate root must be a regular directory');
  }
  const files = collectFiles(candidateRoot);
  const installers = files.filter((file) => /-setup\.exe$/iu.test(path.basename(file)));
  const executables = files.filter((file) => /^jotluck\.exe$/iu.test(path.basename(file)));
  const distRoots = files
    .filter((file) => path.basename(file).toLowerCase() === 'index.html')
    .map((file) => path.dirname(file))
    .filter((directory) => path.basename(directory).toLowerCase() === 'dist');
  if (installers.length !== 1 || executables.length !== 1 || distRoots.length !== 1) {
    throw new Error(
      `candidate artifact must contain exactly one installer, executable, and dist: ${installers.length}/${executables.length}/${distRoots.length}`,
    );
  }
  return {
    root: path.resolve(candidateRoot),
    installer: installers[0],
    packagedApplication: executables[0],
    dist: distRoots[0],
  };
}

function collectFiles(root) {
  const files = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      const info = lstatSync(absolute);
      if (info.isSymbolicLink()) throw new Error(`candidate contains a symbolic link: ${absolute}`);
      if (info.isDirectory()) visit(absolute);
      else if (info.isFile()) files.push(absolute);
      else throw new Error(`candidate contains a non-regular entry: ${absolute}`);
    }
  };
  visit(root);
  return files;
}

function queryInstalledEntry() {
  const script = String.raw`
$entries = @(
  Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*' -ErrorAction SilentlyContinue
  Get-ItemProperty 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*' -ErrorAction SilentlyContinue
  Get-ItemProperty 'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*' -ErrorAction SilentlyContinue
) | Where-Object { $_.DisplayName -eq 'JotLuck' }
if ($entries.Count -ne 1) { throw "expected one JotLuck uninstall entry, found $($entries.Count)" }
$entries[0] | Select-Object DisplayName,DisplayVersion,InstallLocation,DisplayIcon,UninstallString | ConvertTo-Json -Compress
`;
  return JSON.parse(runPowerShell(script));
}

function parseInstalledEntry(entry) {
  if (!entry || entry.DisplayName !== 'JotLuck')
    throw new Error('installed JotLuck entry is invalid');
  const installLocation = String(entry.InstallLocation ?? '')
    .trim()
    .replace(/^"|"$/gu, '');
  const displayIcon = String(entry.DisplayIcon ?? '')
    .trim()
    .replace(/^"|"$/gu, '')
    .split(',')[0];
  const applicationCandidates = [
    installLocation ? path.join(installLocation, 'JotLuck.exe') : '',
    displayIcon,
  ].filter(Boolean);
  const application = applicationCandidates.find((candidate) => existsSync(candidate));
  if (!application)
    throw new Error('installed JotLuck executable cannot be resolved from registry');
  const uninstallString = String(entry.UninstallString ?? '').trim();
  if (!uninstallString) throw new Error('installed JotLuck uninstall command is missing');
  return {
    application: path.resolve(application),
    version: String(entry.DisplayVersion ?? ''),
    uninstallString,
  };
}

async function uninstallCandidate() {
  if (!state.installed) return;
  const command = state.installed.uninstallString;
  const script = String.raw`
$raw = $env:JOTLUCK_UNINSTALL_COMMAND
$exe = if ($raw.StartsWith('"')) { $raw.Split('"')[1] } else { $raw.Split(' ')[0] }
if (Test-Path -LiteralPath $exe) {
  $process = Start-Process -FilePath $exe -ArgumentList '/S' -Wait -PassThru
  if ($process.ExitCode -ne 0) { throw "uninstaller failed with $($process.ExitCode)" }
}
`;
  const output = runPowerShell(script, { JOTLUCK_UNINSTALL_COMMAND: command });
  state.installEvents.push({ action: 'uninstall', exitCode: 0, stdout: output });
  state.installed = null;
}

function runPowerShell(script, extraEnv = {}) {
  const result = spawnSyncChecked(
    'powershell.exe',
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
    120_000,
    extraEnv,
  );
  return result.stdout.trim();
}

function spawnSyncChecked(command, args, timeoutMs, extraEnv = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    timeout: timeoutMs,
    windowsHide: true,
    env: { ...process.env, ...extraEnv },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} failed (${result.status}): ${result.stderr || result.stdout}`);
  }
  return { stdout: result.stdout ?? '', stderr: result.stderr ?? '', exitCode: result.status };
}

async function runProcess(command, args, timeoutMs) {
  const startedAt = new Date().toISOString();
  const started = Date.now();
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    state.childProcesses.add(child);
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk) => (stdout += String(chunk)));
    child.stderr?.on('data', (chunk) => (stderr += String(chunk)));
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`process timed out: ${path.basename(command)}`));
    }, timeoutMs);
    child.once('error', (error) => {
      clearTimeout(timer);
      state.childProcesses.delete(child);
      reject(error);
    });
    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      state.childProcesses.delete(child);
      resolvePromise({
        startedAt,
        finishedAt: new Date().toISOString(),
        durationMs: Date.now() - started,
        exitCode: code ?? -1,
        signal,
        stdout,
        stderr,
      });
    });
  });
}

function assertDefinition(definition) {
  if (!definition || typeof definition !== 'object' || Array.isArray(definition)) {
    throw new Error('fixed adapter definition is required');
  }
  const keys = Object.keys(definition).sort();
  assert.deepEqual(keys, ['adapter', 'id', 'requiredArtifactKinds']);
  if (!/^[A-Z0-9][A-Z0-9-]*$/u.test(String(definition.id))) {
    throw new Error('case id is invalid');
  }
  if (!ADAPTERS.has(definition.adapter)) throw new Error(`unknown adapter: ${definition.adapter}`);
  if (
    !Array.isArray(definition.requiredArtifactKinds) ||
    !definition.requiredArtifactKinds.includes('execution-log') ||
    new Set(definition.requiredArtifactKinds).size !== definition.requiredArtifactKinds.length
  ) {
    throw new Error('required artifact kinds are invalid');
  }
}

function sanitizeTraceValue(value, seen = new WeakSet(), depth = 0) {
  if (typeof value === 'string' && value.length > 500) {
    return {
      bytes: Buffer.byteLength(value, 'utf8'),
      sha256: sha256(Buffer.from(value, 'utf8')),
    };
  }
  if (!value || typeof value !== 'object') return value;
  if (seen.has(value)) return { circularReference: true };
  if (depth >= 5) return { truncatedType: traceObjectType(value) };
  seen.add(value);
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((child) => sanitizeTraceValue(child, seen, depth + 1));
  }
  try {
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, 50)
        .map(([key, child]) => [key, sanitizeTraceValue(child, seen, depth + 1)]),
    );
  } catch {
    return { unreadableType: traceObjectType(value) };
  }
}

function traceObjectType(value) {
  try {
    return value.constructor?.name ?? 'Object';
  } catch {
    return 'Object';
  }
}

function assertNonEmptyRegularFile(filePath, label) {
  const info = lstatSync(path.resolve(filePath));
  if (info.isSymbolicLink() || !info.isFile() || info.size <= 0) {
    throw new Error(`${label} must be a non-empty regular file`);
  }
}

function artifact(workRoot, kind, extension = 'json') {
  return { kind, path: path.join(workRoot, `${kind}.${extension}`) };
}

function writeJsonArtifact(workRoot, kind, value) {
  const result = artifact(workRoot, kind, 'json');
  writeFileSync(result.path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  return result;
}

function webdriverArtifact(workRoot) {
  return artifact(workRoot, 'webdriver-trace', 'ndjson');
}

function createNotebook(workRoot, files) {
  const root = path.join(workRoot, 'notebook');
  mkdirSync(root, { recursive: true });
  for (const [relative, content] of Object.entries(files)) {
    const target = path.join(root, ...relative.split('/'));
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, content, 'utf8');
  }
  return root;
}

async function withSession(trace, args, callback) {
  const installed = state.installed;
  if (!installed || !state.host) throw new Error('installed candidate session is unavailable');
  trace.record('webdriver-session-create-requested', { application: installed.application, args });
  const browser = await state.host.createSession({
    application: installed.application,
    args,
    onEvent: (event) => trace.recordWebDriver(event),
  });
  try {
    await waitForSelector(
      browser,
      '#jotluck-app, [data-testid="notebook-open-gate"]',
      trace,
      20_000,
    );
    return await callback(browser);
  } finally {
    trace.record('webdriver-session-delete-requested', { sessionId: browser.sessionId });
    await state.host.deleteSession(browser);
  }
}

async function waitForSelector(browser, selector, trace, timeout = 10_000) {
  trace.record('wait-for-selector', { selector, timeout });
  const element = await browser.$(selector);
  await element.waitForExist({ timeout });
  await element.waitForDisplayed({ timeout });
  return element;
}

async function clickSelector(browser, selector, trace, timeout = 10_000) {
  const element = await waitForSelector(browser, selector, trace, timeout);
  trace.record('click', { selector });
  await element.click();
  return element;
}

async function clickText(browser, tag, text, trace, timeout = 10_000) {
  return clickSelector(browser, `${tag}=${text}`, trace, timeout);
}

async function setEditorContent(browser, content, trace) {
  const editor = await waitForSelector(browser, '.cm-content', trace, 15_000);
  await editor.click();
  trace.record('editor-replace-content', {
    bytes: Buffer.byteLength(content, 'utf8'),
    sha256: sha256(Buffer.from(content, 'utf8')),
  });
  await browser.keys(['Control', 'a']);
  await browser.keys('Backspace');
  await editor.addValue(content);
}

async function waitForSaved(browser, trace) {
  await waitForSelector(browser, '.status-saved', trace, 15_000);
}

async function waitForReader(browser, expectedText, trace) {
  await waitForSelector(browser, '[data-testid="external-file-session"]', trace, 20_000);
  await browser.waitUntil(
    async () => {
      const text = await (await browser.$('[data-testid="external-file-session"]')).getText();
      return text.includes(expectedText);
    },
    { timeout: 20_000, interval: 100, timeoutMsg: `reader did not display ${expectedText}` },
  );
  trace.record('reader-ready', { expectedText });
}

async function promoteToNotebook(browser, trace) {
  await clickText(browser, 'button', '添加到笔记', trace, 15_000);
  await waitForSelector(browser, '.editor-shell-frame .cm-content', trace, 20_000);
  trace.record('promoted-to-notebook');
}

async function enableExternalEdit(browser, trace) {
  await clickText(browser, 'button', '启用编辑', trace, 15_000);
  const confirm = await browser.$('button=仅编辑当前文件');
  if (await confirm.isExisting()) {
    trace.record('click', { selector: 'button=仅编辑当前文件' });
    await confirm.click();
  }
  await waitForSelector(browser, '.editor-shell-frame .cm-content, .cm-content', trace, 20_000);
  trace.record('external-edit-enabled');
}

async function readVisibleEditor(browser) {
  return browser.execute(() =>
    Array.from(document.querySelectorAll('.cm-content .cm-line'))
      .map((line) => line.textContent ?? '')
      .join('\n'),
  );
}

async function snapshotWindows(browser, trace) {
  const original = await browser.getWindowHandle();
  const handles = await browser.getWindowHandles();
  const windows = [];
  for (const handle of handles) {
    await browser.switchToWindow(handle);
    windows.push({
      handle,
      title: await browser.getTitle(),
      url: await browser.getUrl(),
      reader: await (await browser.$('[data-testid="external-file-session"]')).isExisting(),
    });
  }
  if (handles.includes(original)) await browser.switchToWindow(original);
  trace.record('window-snapshot', { count: windows.length, windows });
  return windows;
}

async function spawnAssociatedFile(filePath, trace) {
  const installed = state.installed;
  if (!installed) throw new Error('installed candidate is unavailable');
  trace.record('spawn-associated-file', { filePath });
  const child = spawn(installed.application, [filePath], {
    windowsHide: true,
    detached: false,
    stdio: 'ignore',
  });
  state.childProcesses.add(child);
  child.once('exit', () => state.childProcesses.delete(child));
  return child;
}

function shellExecuteAssociatedFile(filePath, trace, className = 'JotLuck.Note') {
  trace.record('shell-execute-associated-file-requested', {
    filePath,
    className,
  });
  const script = String.raw`
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class JotLuckShellEvidence {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct SHELLEXECUTEINFO {
    public int cbSize;
    public uint fMask;
    public IntPtr hwnd;
    [MarshalAs(UnmanagedType.LPWStr)] public string lpVerb;
    [MarshalAs(UnmanagedType.LPWStr)] public string lpFile;
    [MarshalAs(UnmanagedType.LPWStr)] public string lpParameters;
    [MarshalAs(UnmanagedType.LPWStr)] public string lpDirectory;
    public int nShow;
    public IntPtr hInstApp;
    public IntPtr lpIDList;
    [MarshalAs(UnmanagedType.LPWStr)] public string lpClass;
    public IntPtr hkeyClass;
    public uint dwHotKey;
    public IntPtr hIconOrMonitor;
    public IntPtr hProcess;
  }
  [DllImport("shell32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  public static extern bool ShellExecuteExW(ref SHELLEXECUTEINFO info);
  [DllImport("kernel32.dll")]
  public static extern uint GetProcessId(IntPtr process);
  [DllImport("kernel32.dll")]
  [return: MarshalAs(UnmanagedType.Bool)]
  public static extern bool CloseHandle(IntPtr handle);
}
'@
$info = New-Object JotLuckShellEvidence+SHELLEXECUTEINFO
$info.cbSize = [Runtime.InteropServices.Marshal]::SizeOf($info)
$info.fMask = 0x00000001 -bor 0x00000040 -bor 0x00000100
$info.lpVerb = 'open'
$info.lpFile = $env:JOTLUCK_ASSOCIATED_FILE
$info.lpClass = $env:JOTLUCK_ASSOCIATION_CLASS
$info.nShow = 1
if (-not [JotLuckShellEvidence]::ShellExecuteExW([ref]$info)) {
  throw "ShellExecuteExW failed: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())"
}
$processId = [JotLuckShellEvidence]::GetProcessId($info.hProcess)
[void][JotLuckShellEvidence]::CloseHandle($info.hProcess)
[pscustomobject]@{
  method = 'ShellExecuteExW'
  className = $env:JOTLUCK_ASSOCIATION_CLASS
  processId = [int]$processId
} | ConvertTo-Json -Compress
`;
  const result = JSON.parse(
    runPowerShell(script, {
      JOTLUCK_ASSOCIATED_FILE: path.resolve(filePath),
      JOTLUCK_ASSOCIATION_CLASS: className,
    }),
  );
  if (result.method !== 'ShellExecuteExW' || result.className !== className) {
    throw new Error('Windows Shell launch observation is invalid');
  }
  trace.record('shell-execute-associated-file-complete', result);
  return result;
}

async function waitForHandleCount(browser, count, trace, timeout = 15_000) {
  await browser.waitUntil(async () => (await browser.getWindowHandles()).length === count, {
    timeout,
    interval: 50,
    timeoutMsg: `window handle count did not reach ${count}`,
  });
  trace.record('window-count-reached', { count });
}

async function waitForFileContent(filePath, expected, timeout = 15_000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (existsSync(filePath) && readFileSync(filePath, 'utf8').includes(expected)) return;
    await delay(100);
  }
  throw new Error(`file content was not persisted: ${filePath}`);
}

async function waitForPathAbsent(filePath, timeout = 10_000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (!existsSync(filePath)) return;
    await delay(100);
  }
  throw new Error(`path remained after cleanup: ${filePath}`);
}

function readInstalledApplicationProcesses() {
  const application = state.installed?.application;
  if (!application) throw new Error('installed application is unavailable');
  const script = String.raw`
$target = [IO.Path]::GetFullPath($env:JOTLUCK_APPLICATION)
@(
  Get-CimInstance Win32_Process -Filter "Name = 'JotLuck.exe'" -ErrorAction Stop |
    Where-Object {
      $_.ExecutablePath -and
      [IO.Path]::GetFullPath([string]$_.ExecutablePath).Equals(
        $target,
        [StringComparison]::OrdinalIgnoreCase
      )
    } |
    ForEach-Object { [pscustomobject]@{ processId = [int]$_.ProcessId; executablePath = $_.ExecutablePath } }
) | ConvertTo-Json -Compress
`;
  const output = runPowerShell(script, { JOTLUCK_APPLICATION: application });
  if (!output) return [];
  const parsed = JSON.parse(output);
  return Array.isArray(parsed) ? parsed : [parsed];
}

async function waitForInstalledApplicationExit(timeout = 15_000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const processes = readInstalledApplicationProcesses();
    if (processes.length === 0) return processes;
    await delay(100);
  }
  throw new Error('installed JotLuck process remained after WebDriver session cleanup');
}

function snapshotTree(root) {
  return collectFiles(root)
    .map((file) => ({
      path: path.relative(root, file).replaceAll('\\', '/'),
      bytes: statSync(file).size,
      sha256: sha256(readFileSync(file)),
    }))
    .sort((left, right) => left.path.localeCompare(right.path));
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function executableIdentity(filePath) {
  const resolvedPath = path.resolve(filePath);
  assertNonEmptyRegularFile(resolvedPath, 'candidate executable');
  return {
    path: resolvedPath,
    bytes: statSync(resolvedPath).size,
    sha256: sha256(readFileSync(resolvedPath)),
  };
}

function assertMatchingExecutableIdentities(packaged, installed) {
  if (packaged.sha256 !== installed.sha256 || packaged.bytes !== installed.bytes) {
    throw new Error('installed application does not match the packaged candidate executable');
  }
}

function readAssociationSnapshot() {
  const script = String.raw`
$extensions = @('.md','.markdown','.mdx','.txt','.docx','.pdf','.xlsx','.xls')
$items = foreach ($extension in $extensions) {
  $classPath = "HKCU:\Software\Classes\$extension"
  $userChoicePath = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\$extension\UserChoice"
  $userChoiceLatestPath = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\$extension\UserChoiceLatest\ProgId"
  $openWithPath = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\$extension\OpenWithList"
  $class = Get-ItemProperty $classPath -ErrorAction SilentlyContinue
  $choice = Get-ItemProperty $userChoicePath -ErrorAction SilentlyContinue
  $latestChoice = Get-ItemProperty $userChoiceLatestPath -ErrorAction SilentlyContinue
  $openWith = Get-ItemProperty $openWithPath -ErrorAction SilentlyContinue
  [pscustomobject]@{
    extension = $extension
    defaultProgId = if ($class) { $class.'(default)' } else { $null }
    userChoiceProgId = if ($choice) { $choice.ProgId } else { $null }
    userChoiceLatestProgId = if ($latestChoice) { $latestChoice.ProgId } else { $null }
    mruList = if ($openWith) { $openWith.MRUList } else { $null }
  }
}
$items | ConvertTo-Json -Compress
`;
  const parsed = JSON.parse(runPowerShell(script) || '[]');
  return Array.isArray(parsed) ? parsed : [parsed];
}

function writeInstallerLog(workRoot) {
  return writeJsonArtifact(workRoot, 'installer-log', {
    candidateInstaller: state.candidate?.installer,
    installedApplication: state.installed?.application ?? null,
    events: state.installEvents,
  });
}

async function openWorkspaceFixture(workRoot, trace, files, entry = 'home.md') {
  const root = createNotebook(workRoot, files);
  const entryPath = path.join(root, ...entry.split('/'));
  return {
    root,
    entryPath,
    run: (callback) =>
      withSession(trace, [entryPath], async (browser) => {
        await waitForReader(browser, path.basename(entryPath), trace);
        await promoteToNotebook(browser, trace);
        return callback(browser, root, entryPath);
      }),
  };
}

async function openFileDrawer(browser, trace) {
  const existing = await browser.$('.file-drawer');
  if (await existing.isDisplayed().catch(() => false)) return existing;
  const menu = await browser.$('.topbar-btn--menu');
  if (await menu.isExisting()) await menu.click();
  const drawerAction = await browser.$('button=文件');
  if (await drawerAction.isExisting()) await drawerAction.click();
  return waitForSelector(browser, '.file-drawer', trace, 10_000);
}

async function clickTreeFile(browser, fileName, trace) {
  const items = await browser.$$('.tree-item');
  for (const item of items) {
    const text = await item.getText();
    if (text.includes(fileName)) {
      trace.record('tree-file-click', { fileName });
      await item.click();
      return item;
    }
  }
  throw new Error(`file drawer does not contain ${fileName}`);
}

async function guiNoteLifecycle({ workRoot, trace }) {
  const fixture = await openWorkspaceFixture(workRoot, trace, { 'home.md': '# Evidence home\n' });
  const marker = `installed-lifecycle-${randomUUID()}`;
  const noteName = `evidence-${Date.now()}.md`;
  const notePath = path.join(fixture.root, noteName);
  const observation = await fixture.run(async (browser) => {
    await openFileDrawer(browser, trace);
    await clickSelector(browser, '.new-note-btn', trace);
    const input = await waitForSelector(browser, '.file-name-input', trace);
    await input.setValue(noteName);
    await browser.keys('Enter');
    await waitForSelector(browser, '.cm-content', trace);
    await setEditorContent(browser, `# ${marker}\n\nDurable installed-app evidence.`, trace);
    await waitForSaved(browser, trace);
    await waitForFileContent(notePath, marker);
    await browser.refresh();
    await waitForSelector(browser, '.cm-content', trace, 20_000);
    const restored = await readVisibleEditor(browser);
    if (!restored.includes(marker)) throw new Error('created note was not restored after refresh');
    await openFileDrawer(browser, trace);
    const item = await clickTreeFile(browser, noteName, trace);
    await item.click({ button: 'right' });
    await clickSelector(browser, '.context-menu-item--danger', trace);
    const confirm = await browser.$('.confirm-btn--danger');
    if (await confirm.isExisting()) await confirm.click();
    await browser.waitUntil(() => !existsSync(notePath), {
      timeout: 10_000,
      timeoutMsg: 'deleted note remained on disk',
    });
    const drawerText = await (await browser.$('.file-drawer')).getText();
    if (drawerText.includes(noteName)) throw new Error('deleted note remained in the file drawer');
    return { noteName, marker, restored, deleted: true };
  });
  return [
    webdriverArtifact(workRoot),
    writeJsonArtifact(workRoot, 'filesystem-readback', observation),
  ];
}

async function guiFileDrawer({ workRoot, trace }) {
  const fixture = await openWorkspaceFixture(workRoot, trace, {
    'home.md': '# Home\n',
    'nested/target.md': '# Nested target\n',
  });
  const marker = `drawer-${randomUUID()}`;
  const targetPath = path.join(fixture.root, 'nested', 'target.md');
  const readback = await fixture.run(async (browser) => {
    await openFileDrawer(browser, trace);
    const chevrons = await browser.$$('.tree-chevron');
    if (chevrons.length > 0) await chevrons[0].click();
    await clickTreeFile(browser, 'target.md', trace);
    await setEditorContent(browser, `# Nested target\n\n${marker}`, trace);
    await waitForSaved(browser, trace);
    await waitForFileContent(targetPath, marker);
    return { path: 'nested/target.md', content: readFileSync(targetPath, 'utf8') };
  });
  return [
    webdriverArtifact(workRoot),
    writeJsonArtifact(workRoot, 'filesystem-readback', readback),
  ];
}

async function guiSearchEdit({ workRoot, trace }) {
  const needle = `search-${randomUUID()}`;
  const fixture = await openWorkspaceFixture(workRoot, trace, {
    'home.md': '# Search home\n',
    'target.md': `# Target\n\n${needle}`,
  });
  const marker = `edited-${randomUUID()}`;
  const targetPath = path.join(fixture.root, 'target.md');
  const readback = await fixture.run(async (browser) => {
    await clickSelector(browser, '.topbar-search-hint', trace);
    const input = await waitForSelector(browser, '.search-input', trace);
    await input.setValue(needle);
    const result = await waitForSelector(browser, '.result-item', trace, 15_000);
    if (!(await result.getText()).includes('target'))
      throw new Error('search did not return target note');
    await result.click();
    await waitForSelector(browser, '.cm-content', trace);
    await setEditorContent(browser, `# Target\n\n${needle}\n${marker}`, trace);
    await waitForSaved(browser, trace);
    await waitForFileContent(targetPath, marker);
    return { path: 'target.md', content: readFileSync(targetPath, 'utf8') };
  });
  return [
    webdriverArtifact(workRoot),
    writeJsonArtifact(workRoot, 'filesystem-readback', readback),
  ];
}

async function guiLivePreview({ workRoot, trace }) {
  const fixture = await openWorkspaceFixture(workRoot, trace, {
    'home.md': '# Live preview evidence\n\nParagraph for rendering.\n',
  });
  const screenshot = artifact(workRoot, 'screenshot', 'png');
  await fixture.run(async (browser) => {
    const block = await waitForSelector(browser, '.cm-live-block', trace, 15_000);
    await block.click();
    await waitForSelector(browser, '.cm-line', trace);
    await browser.keys('Escape');
    await waitForSelector(browser, '.cm-live-block', trace);
    await browser.saveScreenshot(screenshot.path);
    trace.record('screenshot', { kind: screenshot.kind, bytes: statSync(screenshot.path).size });
  });
  return [webdriverArtifact(workRoot), screenshot];
}

async function guiSettingsPersistence({ workRoot, trace }) {
  const fixture = await openWorkspaceFixture(workRoot, trace, { 'home.md': '# Settings\n' });
  const snapshot = await fixture.run(async (browser) => {
    await clickSelector(browser, '[aria-label="设置"]', trace);
    await waitForSelector(browser, '[role="dialog"]', trace);
    const nav = await browser.$('button=文字补全');
    if (await nav.isExisting()) await nav.click();
    const toggle = await waitForSelector(browser, '[aria-label="启用幽灵文本补全"]', trace);
    const before = await toggle.getAttribute('aria-checked');
    await toggle.click();
    const expected = before === 'true' ? 'false' : 'true';
    await browser.waitUntil(async () => (await toggle.getAttribute('aria-checked')) === expected, {
      timeout: 5_000,
    });
    await browser.refresh();
    await waitForSelector(browser, '.editor-shell-frame', trace, 20_000);
    await clickSelector(browser, '[aria-label="设置"]', trace);
    const navAfter = await browser.$('button=文字补全');
    if (await navAfter.isExisting()) await navAfter.click();
    const restored = await waitForSelector(browser, '[aria-label="启用幽灵文本补全"]', trace);
    const after = await restored.getAttribute('aria-checked');
    if (after !== expected) throw new Error('completion setting did not persist across refresh');
    return browser.execute(
      (values) => ({
        ...values,
        localStorage: Object.fromEntries(
          Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index))
            .filter(Boolean)
            .map((key) => [key, localStorage.getItem(key)]),
        ),
      }),
      { before, expected, after },
    );
  });
  return [webdriverArtifact(workRoot), writeJsonArtifact(workRoot, 'settings-snapshot', snapshot)];
}

async function guiExportContent({ workRoot, trace }) {
  const marker = `export-${randomUUID()}`;
  const fixture = await openWorkspaceFixture(workRoot, trace, {
    'home.md': `# Export\n\n${marker}`,
  });
  const downloads = path.join(os.homedir(), 'Downloads');
  const before = existsSync(downloads) ? new Set(readdirSync(downloads)) : new Set();
  const readback = await fixture.run(async (browser) => {
    await clickSelector(browser, '[aria-label="导出笔记"]', trace);
    await waitForSelector(browser, '[role="dialog"]', trace);
    await clickText(browser, 'button', 'TXT', trace);
    await clickText(browser, 'button', '导出', trace);
    let exported = null;
    await browser.waitUntil(
      async () => {
        if (!existsSync(downloads)) return false;
        exported = readdirSync(downloads)
          .filter((name) => !before.has(name) && name.toLowerCase().endsWith('.txt'))
          .map((name) => path.join(downloads, name))
          .find((file) => readFileSync(file, 'utf8').includes(marker));
        return Boolean(exported);
      },
      { timeout: 15_000, interval: 250, timeoutMsg: 'TXT export was not observed on disk' },
    );
    const content = readFileSync(exported, 'utf8');
    rmSync(exported, { force: true });
    return { format: 'txt', marker, content, cleaned: true };
  });
  return [webdriverArtifact(workRoot), writeJsonArtifact(workRoot, 'export-readback', readback)];
}

async function guiImageAsset({ workRoot, trace }) {
  const fixture = await openWorkspaceFixture(workRoot, trace, { 'home.md': '# Image evidence\n' });
  const pngBytes = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlKQAAAAASUVORK5CYII=',
    'base64',
  );
  const snapshot = await fixture.run(async (browser) => {
    const dropError = await browser.executeAsync((base64, done) => {
      const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
      const file = new File([bytes], 'evidence-pixel.png', { type: 'image/png' });
      const transfer = new DataTransfer();
      transfer.items.add(file);
      const target = document.querySelector('.markdown-editor');
      if (!target) return done('missing markdown editor');
      target.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: transfer }));
      done(null);
    }, pngBytes.toString('base64'));
    if (dropError) throw new Error(`image drop failed: ${dropError}`);
    await browser.waitUntil(() => existsSync(path.join(fixture.root, 'assets')), {
      timeout: 15_000,
      timeoutMsg: 'image asset directory was not created',
    });
    const editorText = await readVisibleEditor(browser);
    if (!editorText.includes('assets/')) throw new Error('image drop did not insert an asset path');
    await openFileDrawer(browser, trace);
    const drawerText = await (await browser.$('.file-drawer')).getText();
    if (/evidence-pixel|assets/iu.test(drawerText))
      throw new Error('asset internals leaked into file drawer');
    return { editorText, tree: snapshotTree(fixture.root) };
  });
  return [
    webdriverArtifact(workRoot),
    writeJsonArtifact(workRoot, 'filesystem-snapshot', snapshot),
  ];
}

function isDocumentExtension(extension) {
  return DOCUMENT_EXTENSIONS.includes(extension);
}

function progIdForExtension(extension) {
  return isDocumentExtension(extension) ? 'JotLuck.DocumentImport' : 'JotLuck.Note';
}

function pdfFixture(text) {
  const escaped = text.replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)');
  const stream = `BT /F1 12 Tf 72 720 Td (${escaped}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>',
  ];
  const chunks = [Buffer.from('%PDF-1.4\n', 'ascii')];
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(chunks.reduce((total, chunk) => total + chunk.length, 0));
    chunks.push(Buffer.from(`${index + 1} 0 obj\n${object}\nendobj\n`, 'ascii'));
  }
  const xrefOffset = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const xref = [
    `xref\n0 ${objects.length + 1}\n`,
    '0000000000 65535 f \n',
    ...offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`),
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`,
  ].join('');
  return Buffer.concat([...chunks, Buffer.from(xref, 'ascii')]);
}

async function createSupportedFixture(target, extension, marker) {
  if (extension === '.txt') {
    const content = `<b>${marker}</b>\n# must remain text\n[link](https://example.invalid)`;
    writeFileSync(target, content, 'utf8');
    return { expectedText: marker, binary: false };
  }
  if (NOTE_EXTENSIONS.includes(extension)) {
    writeFileSync(target, `# ${marker}\n\n[link](https://example.invalid)`, 'utf8');
    return { expectedText: marker, binary: false };
  }
  if (extension === '.docx') {
    const document = new Document({
      sections: [{ children: [new Paragraph({ text: marker })] }],
    });
    writeFileSync(target, await Packer.toBuffer(document));
    return { expectedText: marker, binary: true };
  }
  if (extension === '.pdf') {
    writeFileSync(target, pdfFixture(marker));
    return { expectedText: marker, binary: true };
  }
  if (extension === '.xlsx') {
    const moduleUrl = pathToFileURL(
      path.join(PROJECT_ROOT, 'packages/app/node_modules/write-excel-file/node/index.js'),
    ).href;
    const { default: writeXlsxFile } = await import(moduleUrl);
    await writeXlsxFile([[marker]], { sheet: 'Sheet1' }).toFile(target);
    return { expectedText: marker, binary: true };
  }
  if (extension === '.xls') {
    const encoded = readFileSync(
      path.join(PROJECT_ROOT, 'packages/app/src-tauri/fixtures/biff5_write.xls.b64'),
      'utf8',
    ).trim();
    writeFileSync(target, Buffer.from(encoded, 'base64'));
    return { expectedText: 'foo', binary: true };
  }
  throw new Error(`unsupported fixture extension: ${extension}`);
}

async function rfColdOpenSupportedFiles({ workRoot, trace }) {
  const observations = [];
  for (const extension of SUPPORTED_EXTENSIONS) {
    const marker = `cold-${extension.slice(1)}-${randomUUID()}`;
    const target = path.join(workRoot, `cold${extension}`);
    const fixture = await createSupportedFixture(target, extension, marker);
    await withSession(trace, [target], async (browser) => {
      const started = Date.now();
      await waitForReader(browser, fixture.expectedText, trace);
      const readyMs = Date.now() - started;
      const reader = await browser.$('[data-testid="external-file-session"]');
      const title = await browser.getTitle();
      const html = await reader.getHTML();
      const heavyweightShell = await browser.execute(() => ({
        editor: Boolean(document.querySelector('.cm-content')),
        fileDrawer: Boolean(document.querySelector('.file-drawer')),
        workspace: Boolean(document.querySelector('.editor-shell-frame')),
      }));
      if (Object.values(heavyweightShell).some(Boolean)) {
        throw new Error(`cold reader initialized the heavyweight workspace shell: ${extension}`);
      }
      if (extension === '.txt' && html.includes(`<b>${marker}</b>`)) {
        throw new Error('TXT reader interpreted HTML instead of displaying plain text');
      }
      observations.push({
        extension,
        marker,
        title,
        readyMs,
        heavyweightShell,
        readback: textFileReadback(target, !fixture.binary),
      });
    });
  }
  return [webdriverArtifact(workRoot), writeJsonArtifact(workRoot, 'file-readback', observations)];
}

async function rfRuntimeNewWindow({ workRoot, trace }) {
  const first = path.join(workRoot, 'first.md');
  writeFileSync(first, '# Runtime first\n', 'utf8');
  let snapshot;
  await withSession(trace, [first], async (browser) => {
    await waitForReader(browser, 'Runtime first', trace);
    const original = await browser.getWindowHandle();
    const openedHandles = new Set(await browser.getWindowHandles());
    const runtimeFixtures = [
      { extension: '.md', marker: 'Runtime second' },
      ...DOCUMENT_EXTENSIONS.map((extension) => ({
        extension,
        marker: `runtime-${extension.slice(1)}-${randomUUID()}`,
      })),
    ];
    for (const fixture of runtimeFixtures) {
      const target = path.join(workRoot, `runtime-${randomUUID()}${fixture.extension}`);
      const created = await createSupportedFixture(target, fixture.extension, fixture.marker);
      await spawnAssociatedFile(target, trace);
      await waitForHandleCount(browser, openedHandles.size + 1, trace);
      const newHandle = (await browser.getWindowHandles()).find(
        (handle) => !openedHandles.has(handle),
      );
      if (!newHandle) throw new Error(`runtime ${fixture.extension} window was not created`);
      openedHandles.add(newHandle);
      await browser.switchToWindow(newHandle);
      await waitForReader(browser, created.expectedText, trace);
      await browser.switchToWindow(original);
      await waitForReader(browser, 'Runtime first', trace);
    }
    snapshot = await snapshotWindows(browser, trace);
    if (snapshot.length !== runtimeFixtures.length + 1)
      throw new Error('runtime files did not each open in a distinct window');
  });
  return [webdriverArtifact(workRoot), writeJsonArtifact(workRoot, 'window-snapshot', snapshot)];
}

async function rfPathDeduplication({ workRoot, trace }) {
  const target = path.join(workRoot, 'CasePath.md');
  writeFileSync(target, '# Path identity\n', 'utf8');
  let snapshot;
  await withSession(trace, [target], async (browser) => {
    await waitForReader(browser, 'Path identity', trace);
    const before = (await browser.getWindowHandles()).length;
    const variants = [
      path.resolve(target),
      path.relative(process.cwd(), target),
      target.toUpperCase(),
    ];
    for (const variant of variants) {
      await spawnAssociatedFile(variant, trace);
      await delay(400);
      const count = (await browser.getWindowHandles()).length;
      if (count !== before) throw new Error(`path variant created a duplicate window: ${variant}`);
    }
    snapshot = { before, after: (await browser.getWindowHandles()).length, variants };
  });
  return [webdriverArtifact(workRoot), writeJsonArtifact(workRoot, 'window-snapshot', snapshot)];
}

async function rfExternalEdit({ workRoot, trace }) {
  const target = path.join(workRoot, 'editable.md');
  const sibling = path.join(workRoot, 'sibling.md');
  writeFileSync(target, '# Editable\n', 'utf8');
  writeFileSync(sibling, '# Must remain unchanged\n', 'utf8');
  const siblingBefore = readFileSync(sibling, 'utf8');
  const marker = `external-edit-${randomUUID()}`;
  await withSession(trace, [target], async (browser) => {
    await waitForReader(browser, 'Editable', trace);
    await enableExternalEdit(browser, trace);
    await setEditorContent(browser, `# Editable\n\n${marker}`, trace);
    await waitForSaved(browser, trace);
    await waitForFileContent(target, marker);
    if (readFileSync(sibling, 'utf8') !== siblingBefore)
      throw new Error('external edit changed a sibling file');
    const drawer = await browser.$('.file-drawer');
    if (await drawer.isExisting()) throw new Error('external edit initialized the file drawer');
  });
  return [
    webdriverArtifact(workRoot),
    writeJsonArtifact(workRoot, 'file-readback', {
      target: readFileSync(target, 'utf8'),
      sibling: readFileSync(sibling, 'utf8'),
    }),
  ];
}

async function rfPromoteNotebook({ workRoot, trace }) {
  const target = path.join(workRoot, 'promote.md');
  const sibling = path.join(workRoot, 'sibling.md');
  writeFileSync(target, '# Promote target\n', 'utf8');
  writeFileSync(sibling, '# Visible after promote\n', 'utf8');
  let snapshot;
  await withSession(trace, [target], async (browser) => {
    await waitForReader(browser, 'Promote target', trace);
    await promoteToNotebook(browser, trace);
    await openFileDrawer(browser, trace);
    const beforeRefresh = {
      editor: await readVisibleEditor(browser),
      drawer: await (await browser.$('.file-drawer')).getText(),
    };
    await browser.refresh();
    await waitForSelector(browser, '.editor-shell-frame .cm-content', trace, 20_000);
    await openFileDrawer(browser, trace);
    const afterRefresh = {
      editor: await readVisibleEditor(browser),
      drawer: await (await browser.$('.file-drawer')).getText(),
    };
    if (
      !beforeRefresh.editor.includes('Promote target') ||
      !beforeRefresh.drawer.includes('sibling.md') ||
      !afterRefresh.editor.includes('Promote target') ||
      !afterRefresh.drawer.includes('sibling.md')
    ) {
      throw new Error('promotion did not preserve target and load its notebook');
    }
    snapshot = {
      beforeRefresh,
      afterRefresh,
      tree: snapshotTree(workRoot),
    };
  });
  return [
    webdriverArtifact(workRoot),
    writeJsonArtifact(workRoot, 'filesystem-snapshot', snapshot),
  ];
}

async function rfWorkspaceIsolation({ workRoot, trace }) {
  const rootA = createNotebook(path.join(workRoot, 'a'), { 'a.md': '# Window A\n' });
  const rootB = createNotebook(path.join(workRoot, 'b'), { 'b.md': '# Window B\n' });
  const fileA = path.join(rootA, 'a.md');
  const fileB = path.join(rootB, 'b.md');
  let observation;
  await withSession(trace, [fileA, fileB], async (browser) => {
    await waitForHandleCount(browser, 2, trace);
    const handles = await browser.getWindowHandles();
    for (const handle of handles) {
      await browser.switchToWindow(handle);
      const reader = await waitForSelector(
        browser,
        '[data-testid="external-file-session"]',
        trace,
        20_000,
      );
      const readerText = await reader.getText();
      const marker = readerText.includes('Window A')
        ? 'isolated-a'
        : readerText.includes('Window B')
          ? 'isolated-b'
          : null;
      if (!marker) throw new Error('workspace isolation reader identity is ambiguous');
      await promoteToNotebook(browser, trace);
      await setEditorContent(browser, `# ${marker}`, trace);
      await waitForSaved(browser, trace);
    }
    await waitForFileContent(fileA, 'isolated-a');
    await waitForFileContent(fileB, 'isolated-b');
    observation = {
      windows: await snapshotWindows(browser, trace),
      fileA: readFileSync(fileA, 'utf8'),
      fileB: readFileSync(fileB, 'utf8'),
    };
  });
  return [webdriverArtifact(workRoot), writeJsonArtifact(workRoot, 'window-snapshot', observation)];
}

async function rfWindowCloseIsolation({ workRoot, trace }) {
  const rootA = path.join(workRoot, 'close-a-root');
  const rootB = path.join(workRoot, 'close-b-root');
  mkdirSync(rootA, { recursive: true });
  mkdirSync(rootB, { recursive: true });
  const first = path.join(rootA, 'close-a.md');
  const second = path.join(rootB, 'close-b.md');
  writeFileSync(first, '# Close A\n', 'utf8');
  writeFileSync(second, '# Close B\n', 'utf8');
  let observation;
  await withSession(trace, [first, second], async (browser) => {
    await waitForHandleCount(browser, 2, trace);
    const handles = await browser.getWindowHandles();
    const windowByTitle = new Map();
    for (const handle of handles) {
      await browser.switchToWindow(handle);
      windowByTitle.set(await browser.getTitle(), handle);
    }
    const firstHandle = [...windowByTitle].find(([title]) => title.includes('close-a'))?.[1];
    const secondHandle = [...windowByTitle].find(([title]) => title.includes('close-b'))?.[1];
    if (!firstHandle || !secondHandle)
      throw new Error('close isolation windows were not identified');
    await browser.switchToWindow(firstHandle);
    await waitForReader(browser, 'Close A', trace);
    await promoteToNotebook(browser, trace);
    const unavailableRoot = `${rootA}-unavailable`;
    renameSync(rootA, unavailableRoot);
    try {
      await setEditorContent(browser, '# Close A\n\nclose-must-be-blocked', trace);
      await delay(1_000);
      await browser.closeWindow();
      await delay(500);
      const afterFailedClose = await browser.getWindowHandles();
      if (!afterFailedClose.includes(firstHandle)) {
        throw new Error('save failure did not block the affected window close');
      }
      const visibleStatus = await browser.execute(() => document.body.textContent ?? '');
      if (!visibleStatus.includes('保存失败')) {
        throw new Error('save failure was not visible in the affected window');
      }
    } finally {
      if (existsSync(unavailableRoot) && !existsSync(rootA)) renameSync(unavailableRoot, rootA);
    }
    await browser.switchToWindow(secondHandle);
    await waitForReader(browser, 'Close B', trace);
    await enableExternalEdit(browser, trace);
    await setEditorContent(browser, '# Close B\n\nstill-writable', trace);
    await waitForSaved(browser, trace);
    await waitForFileContent(second, 'still-writable');
    observation = {
      failedCloseBlocked: true,
      remainingHandles: await browser.getWindowHandles(),
      survivingContent: readFileSync(second, 'utf8'),
    };
  });
  return [webdriverArtifact(workRoot), writeJsonArtifact(workRoot, 'window-snapshot', observation)];
}

async function rfReaderSecurity({ workRoot, trace }) {
  const markdown = path.join(workRoot, 'unsafe.md');
  const plain = path.join(workRoot, 'literal.txt');
  const oversized = path.join(workRoot, 'oversized.md');
  writeFileSync(
    markdown,
    '# Safe\n<img src=x onerror="window.__evidenceXss=1"><script>window.__evidenceXss=2</script>',
    'utf8',
  );
  writeFileSync(plain, '<b>literal</b>\n# not markdown\n[jump](javascript:alert(1))', 'utf8');
  writeFileSync(oversized, Buffer.alloc(5 * 1024 * 1024 + 1, 0x61));
  const security = {};
  await withSession(trace, [markdown], async (browser) => {
    await waitForReader(browser, 'Safe', trace);
    security.markdown = await browser.execute(() => ({
      scripts: document.querySelectorAll('script').length,
      eventHandlers: document.querySelectorAll('[onerror],[onclick]').length,
      xssFlag: window.__evidenceXss ?? null,
    }));
    if (security.markdown.scripts || security.markdown.eventHandlers || security.markdown.xssFlag) {
      throw new Error('Markdown reader did not sanitize executable content');
    }
  });
  await withSession(trace, [plain], async (browser) => {
    await waitForReader(browser, '<b>literal</b>', trace);
    security.txt = await browser.execute(() => ({
      boldElements: document.querySelectorAll('.external-reader__plain b').length,
      text: document.querySelector('.external-reader__plain')?.textContent ?? '',
    }));
    if (security.txt.boldElements !== 0 || !security.txt.text.includes('<b>literal</b>')) {
      throw new Error('TXT reader did not preserve literal text');
    }
  });
  await withSession(trace, [oversized], async (browser) => {
    const reader = await waitForSelector(
      browser,
      '[data-testid="external-file-session"]',
      trace,
      20_000,
    );
    const text = await reader.getText();
    security.oversized = { bytes: statSync(oversized).size, visibleMessage: text };
    if (!/5\s*MB|过大|超出/iu.test(text))
      throw new Error('oversized reader failure was not visible');
  });
  return [webdriverArtifact(workRoot), writeJsonArtifact(workRoot, 'security-snapshot', security)];
}

async function rfReaderBundleIsolation({ workRoot }) {
  const dist = state.candidate?.dist;
  if (!dist) throw new Error('candidate dist is unavailable');
  return [writeJsonArtifact(workRoot, 'bundle-inventory', inspectReaderBundle(dist))];
}

function inspectReaderBundle(dist, sourceRoot = process.cwd()) {
  const manifestPath = path.join(dist, '.vite', 'manifest.json');
  assertNonEmptyRegularFile(manifestPath, 'Vite manifest');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const entries = Object.entries(manifest);
  const main = entries.find(([key, value]) => key === 'src/main.ts' || value.isEntry === true);
  const bootstrap = entries.find(([key]) => /BootstrapPage\.vue$/u.test(key));
  const reader = entries.find(([key]) => /ExternalReaderPage\.vue$/u.test(key));
  if (!main || !bootstrap || !reader)
    throw new Error('main/reader/bootstrap entries are absent from Vite manifest');
  const closure = collectManifestClosure(manifest, [main[0], bootstrap[0], reader[0]]);
  const forbidden = /codemirror|NotebookHome|ExportDialog|FileDrawer|completion/iu;
  const forbiddenMatches = closure.filter((entry) =>
    forbidden.test(
      JSON.stringify({
        key: entry.key,
        file: entry.file,
        src: entry.src,
        imports: entry.imports,
        css: entry.css,
        assets: entry.assets,
      }),
    ),
  );
  if (forbiddenMatches.length > 0)
    throw new Error('reader bundle imports forbidden workspace modules');
  const readerSource = readFileSync(
    path.join(sourceRoot, 'packages/app/src/pages/ExternalReaderPage.vue'),
    'utf8',
  );
  const invokedCommands = [...readerSource.matchAll(/invoke(?:<[^>]+>)?\(['"]([^'"]+)['"]/gu)]
    .map((match) => match[1])
    .sort();
  const allowedCommands = new Set([
    'cancel_document_conversion',
    'enable_external_edit',
    'get_document_editor_candidate',
    'get_window_bootstrap',
    'open_document_source_in_editor',
    'promote_external_file_to_notebook',
    'read_document_conversion_asset',
    'read_external_note_file',
    'refresh_document_source_revision',
    'save_converted_document_as',
    'start_document_conversion',
  ]);
  if (invokedCommands.some((command) => !allowedCommands.has(command))) {
    throw new Error(`reader invokes a workspace-only command: ${invokedCommands.join(', ')}`);
  }
  return {
    manifestSha256: sha256(readFileSync(manifestPath)),
    entries: closure,
    deferredDynamicImports: [
      ...new Set(closure.flatMap((entry) => entry.dynamicImports ?? [])),
    ].sort(),
    invokedCommands,
    forbiddenMatches,
  };
}

async function rfInstalledWindowsJourney({ workRoot, trace }) {
  const journey = path.join(workRoot, 'journey.md');
  writeFileSync(journey, '# Installed journey\n', 'utf8');
  await withSession(trace, [journey], async (browser) => {
    await waitForReader(browser, 'Installed journey', trace);
    await enableExternalEdit(browser, trace);
    await setEditorContent(browser, '# Installed journey\n\nroundtrip', trace);
    await waitForSaved(browser, trace);
    await waitForFileContent(journey, 'roundtrip');
  });
  state.performance.coldStartMs = [];
  state.performance.processLifecycle = [];
  for (let index = 0; index < PERFORMANCE_SAMPLE_COUNTS.coldStart; index += 1) {
    const before = await waitForInstalledApplicationExit();
    trace.record('cold-start-process-baseline', { sample: index + 1, processCount: 0 });
    const startedAt = new Date().toISOString();
    const started = performance.now();
    await withSession(trace, [journey], (browser) =>
      waitForReader(browser, 'Installed journey', trace),
    );
    state.performance.coldStartMs.push(Math.max(1, Math.round(performance.now() - started)));
    const after = await waitForInstalledApplicationExit();
    trace.record('cold-start-process-cleanup', { sample: index + 1, processCount: 0 });
    state.performance.processLifecycle.push({
      sample: index + 1,
      startedAt,
      finishedAt: new Date().toISOString(),
      before,
      after,
    });
  }
  state.performance.hotWindowMs = [];
  state.performance.hotWindowLifecycle = [];
  await withSession(trace, [journey], async (browser) => {
    await waitForReader(browser, 'Installed journey', trace);
    const primaryHandle = await browser.getWindowHandle();
    for (let index = 0; index < PERFORMANCE_SAMPLE_COUNTS.hotWindow; index += 1) {
      const hot = path.join(workRoot, `hot-${index}.md`);
      writeFileSync(hot, `# Hot ${index}\n`, 'utf8');
      const before = (await browser.getWindowHandles()).length;
      const started = performance.now();
      await spawnAssociatedFile(hot, trace);
      await waitForHandleCount(browser, before + 1, trace);
      state.performance.hotWindowMs.push(Math.max(1, Math.round(performance.now() - started)));
      const handles = await browser.getWindowHandles();
      await browser.switchToWindow(handles.at(-1));
      await browser.closeWindow();
      await browser.switchToWindow(primaryHandle);
      await waitForHandleCount(browser, before, trace);
      const after = (await browser.getWindowHandles()).length;
      state.performance.hotWindowLifecycle.push({
        sample: index + 1,
        before,
        opened: handles.length,
        after,
      });
    }
  });
  state.performance.finalProcesses = await waitForInstalledApplicationExit();
  trace.record('hot-session-process-cleanup', {
    processCount: state.performance.finalProcesses.length,
  });
  return [
    webdriverArtifact(workRoot),
    writeInstallerLog(workRoot),
    writeJsonArtifact(workRoot, 'process-lifecycle', {
      schema: 'jotluck.installed-app.process-lifecycle.v2',
      application: {
        installed: state.installed?.applicationIdentity,
        packaged: state.installed?.packagedApplicationIdentity,
      },
      samples: state.performance.processLifecycle,
      hotWindowSamples: state.performance.hotWindowLifecycle,
      finalProcesses: state.performance.finalProcesses,
    }),
    writeJsonArtifact(workRoot, 'timing-samples', await readPerformanceSummary()),
  ];
}

async function versionConsistency({ workRoot, trace }) {
  const rootPackage = JSON.parse(readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'));
  const appPackage = JSON.parse(
    readFileSync(path.join(process.cwd(), 'packages/app/package.json'), 'utf8'),
  );
  const tauri = JSON.parse(
    readFileSync(path.join(process.cwd(), 'packages/app/src-tauri/tauri.conf.json'), 'utf8'),
  );
  const cargo = readFileSync(
    path.join(process.cwd(), 'packages/app/src-tauri/Cargo.toml'),
    'utf8',
  ).match(/^version\s*=\s*"([^"]+)"/mu)?.[1];
  const versions = [
    rootPackage.version,
    appPackage.version,
    tauri.version,
    cargo,
    state.installed?.version,
  ];
  if (new Set(versions).size !== 1 || versions[0] !== '0.1.0-preview') {
    throw new Error(`version facts diverged: ${versions.join(', ')}`);
  }
  const about = path.join(workRoot, 'version.md');
  writeFileSync(about, '# Version evidence\n', 'utf8');
  let displayed;
  await withSession(trace, [about], async (browser) => {
    await waitForReader(browser, 'Version evidence', trace);
    await promoteToNotebook(browser, trace);
    await clickSelector(browser, '[aria-label="设置"]', trace);
    const aboutButton = await browser.$('button=关于');
    if (await aboutButton.isExisting()) await aboutButton.click();
    displayed = await (await browser.$('[role="dialog"]')).getText();
    if (!displayed.includes('v0.1.0-preview'))
      throw new Error('About dialog displayed the wrong version');
  });
  return [
    webdriverArtifact(workRoot),
    writeJsonArtifact(workRoot, 'version-snapshot', { versions, displayed }),
  ];
}

async function associationMd(context) {
  return associationCase(context, '.md');
}
async function associationMarkdown(context) {
  return associationCase(context, '.markdown');
}
async function associationMdx(context) {
  return associationCase(context, '.mdx');
}
async function associationTxt(context) {
  return associationCase(context, '.txt');
}
async function associationDocx(context) {
  return associationCase(context, '.docx');
}
async function associationPdf(context) {
  return associationCase(context, '.pdf');
}
async function associationXlsx(context) {
  return associationCase(context, '.xlsx');
}
async function associationXls(context) {
  return associationCase(context, '.xls');
}

async function associationCase({ workRoot, trace }, extension) {
  const marker = `association-${extension.slice(1)}-${randomUUID()}`;
  const target = path.join(workRoot, `association evidence ${randomUUID()}${extension}`);
  const fixture = await createSupportedFixture(target, extension, marker);
  const before = textFileReadback(target, false);
  const launchedAt = new Date().toISOString();
  await waitForInstalledApplicationExit();
  const expectedProgId = progIdForExtension(extension);
  const shell = shellExecuteAssociatedFile(target, trace, expectedProgId);
  state.shellProcessIds.add(shell.processId);
  let processObserved;
  try {
    processObserved = await waitForProcessWindow(fixture.expectedText, target, shell.processId);
    const after = textFileReadback(target, !fixture.binary);
    const launchTrace = writeJsonArtifact(workRoot, 'launch-trace', {
      schema: 'jotluck.installed-app.association-launch.v2',
      launchedAt,
      target: {
        path: target,
        extension,
        marker,
        markerSha256: sha256(Buffer.from(marker, 'utf8')),
        before,
        after,
      },
      shell,
      processObserved,
      application: {
        installed: state.installed?.applicationIdentity,
        packaged: state.installed?.packagedApplicationIdentity,
      },
    });
    const registry = readDetailedAssociationSnapshot(extension);
    if (
      !registry.classOpenWithProgIds.includes(expectedProgId) ||
      !registry.explorerOpenWithProgIds.includes(expectedProgId) ||
      registry.supportedType !== true ||
      !isQuotedJotLuckOpenCommand(registry.openCommand) ||
      !isQuotedJotLuckOpenCommand(registry.progIdOpenCommand) ||
      registry.openCommand !== registry.progIdOpenCommand ||
      !openCommandTargetsApplication(registry.openCommand, state.installed?.application)
    ) {
      throw new Error(`${extension} is not registered as an Open With application`);
    }
    return [writeJsonArtifact(workRoot, 'registry-snapshot', registry), launchTrace];
  } finally {
    const processId = resolveAssociationProcessId(processObserved, shell);
    stopObservedProcess(processId);
    state.shellProcessIds.delete(processId);
    await waitForInstalledApplicationExit();
    trace.record('association-process-stopped', { processId, processCount: 0 });
  }
}

async function associationDefaultPreservation({ workRoot }) {
  const after = readAssociationSnapshot();
  if (!state.preInstallRegistry) throw new Error('pre-install registry snapshot is unavailable');
  for (const beforeEntry of state.preInstallRegistry) {
    const afterEntry = after.find((entry) => entry.extension === beforeEntry.extension);
    if (!afterEntry) throw new Error(`missing registry observation for ${beforeEntry.extension}`);
    if (
      beforeEntry.defaultProgId !== afterEntry.defaultProgId ||
      beforeEntry.userChoiceProgId !== afterEntry.userChoiceProgId ||
      beforeEntry.userChoiceLatestProgId !== afterEntry.userChoiceLatestProgId
    ) {
      throw new Error(`installer changed the default application for ${beforeEntry.extension}`);
    }
  }
  return [
    writeJsonArtifact(workRoot, 'registry-snapshot', { before: state.preInstallRegistry, after }),
  ];
}

async function associationUninstallCleanup({ workRoot }) {
  seedOpenWithOrder();
  try {
    const before = readDetailedAssociationSnapshot('.md');
    const installedApplication = state.installed?.application;
    if (!installedApplication)
      throw new Error('installed application is unavailable before uninstall');
    await state.host?.dispose().catch(() => undefined);
    state.host = null;
    await uninstallCandidate();
    const after = readDetailedAssociationSnapshot('.md');
    if (
      after.mruList !== 'ca' ||
      after.openWithSlots.a !== 'OtherEditor.exe' ||
      after.openWithSlots.c !== 'SecondEditor.exe'
    ) {
      throw new Error(
        `uninstall did not preserve the other Open With order: ${JSON.stringify(after)}`,
      );
    }
    if (Object.values(after.openWithSlots).some((value) => value.toLowerCase() === 'jotluck.exe')) {
      throw new Error('uninstall left a JotLuck Open With slot');
    }
    const extensionCleanup = SUPPORTED_EXTENSIONS.map((extension) =>
      readDetailedAssociationSnapshot(extension),
    );
    if (
      extensionCleanup.some((entry) => {
        const expectedProgId = progIdForExtension(entry.extension);
        return (
          entry.classOpenWithProgIds.includes(expectedProgId) ||
          entry.explorerOpenWithProgIds.includes(expectedProgId) ||
          entry.supportedType
        );
      })
    ) {
      throw new Error('uninstall left an optional JotLuck file association');
    }
    await waitForPathAbsent(installedApplication);
    return [
      writeJsonArtifact(workRoot, 'registry-snapshot', { before, after, extensionCleanup }),
      writeInstallerLog(workRoot),
    ];
  } finally {
    clearSeededOpenWithOrder();
  }
}

function collectManifestClosure(manifest, roots) {
  const visited = new Set();
  const visit = (key) => {
    if (visited.has(key)) return;
    const entry = manifest[key];
    if (!entry) throw new Error(`Vite manifest import is missing: ${key}`);
    visited.add(key);
    for (const dependency of entry.imports ?? []) visit(dependency);
  };
  for (const root of roots) visit(root);
  return [...visited].sort().map((key) => ({ key, ...manifest[key] }));
}

function readDetailedAssociationSnapshot(extension) {
  const expectedProgId = progIdForExtension(extension);
  const script = String.raw`
$extension = $env:JOTLUCK_EXTENSION
$classPath = "HKCU:\Software\Classes\$extension"
$userChoicePath = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\$extension\UserChoice"
$userChoiceLatestPath = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\$extension\UserChoiceLatest\ProgId"
$openWithPath = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\$extension\OpenWithList"
$classOpenWithProgIdsPath = "HKCU:\Software\Classes\$extension\OpenWithProgids"
$explorerOpenWithProgIdsPath = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\$extension\OpenWithProgids"
$applicationPath = 'HKCU:\Software\Classes\Applications\JotLuck.exe'
$supportedTypesPath = "$applicationPath\SupportedTypes"
$openCommandPath = "$applicationPath\shell\open\command"
$progIdOpenCommandPath = "HKCU:\Software\Classes\$env:JOTLUCK_ASSOCIATION_CLASS\shell\open\command"
$class = Get-ItemProperty $classPath -ErrorAction SilentlyContinue
$choice = Get-ItemProperty $userChoicePath -ErrorAction SilentlyContinue
$latestChoice = Get-ItemProperty $userChoiceLatestPath -ErrorAction SilentlyContinue
$openWith = Get-ItemProperty $openWithPath -ErrorAction SilentlyContinue
$classOpenWithProgIds = Get-ItemProperty $classOpenWithProgIdsPath -ErrorAction SilentlyContinue
$explorerOpenWithProgIds = Get-ItemProperty $explorerOpenWithProgIdsPath -ErrorAction SilentlyContinue
$supportedTypes = Get-ItemProperty $supportedTypesPath -ErrorAction SilentlyContinue
$openCommand = Get-ItemProperty $openCommandPath -ErrorAction SilentlyContinue
$progIdOpenCommand = Get-ItemProperty $progIdOpenCommandPath -ErrorAction SilentlyContinue
$slots = @{}
if ($openWith) {
  foreach ($property in $openWith.PSObject.Properties) {
    if ($property.Name -match '^[a-z]$') { $slots[$property.Name] = [string]$property.Value }
  }
}
[pscustomobject]@{
  extension = $extension
  openWithListExists = [bool](Test-Path -LiteralPath $openWithPath)
  defaultProgId = if ($class) { $class.'(default)' } else { $null }
  userChoiceProgId = if ($choice) { $choice.ProgId } else { $null }
  userChoiceLatestProgId = if ($latestChoice) { $latestChoice.ProgId } else { $null }
  mruList = if ($openWith) { $openWith.MRUList } else { $null }
  openWithSlots = $slots
  openWithExecutables = @($slots.Values)
  classOpenWithProgIds = @($classOpenWithProgIds.PSObject.Properties | Where-Object { $_.Name -notmatch '^PS' } | ForEach-Object { $_.Name })
  explorerOpenWithProgIds = @($explorerOpenWithProgIds.PSObject.Properties | Where-Object { $_.Name -notmatch '^PS' } | ForEach-Object { $_.Name })
  supportedType = [bool]($supportedTypes.PSObject.Properties.Name -contains $extension)
  openCommand = if ($openCommand) { [string]$openCommand.'(default)' } else { '' }
  progIdOpenCommand = if ($progIdOpenCommand) { [string]$progIdOpenCommand.'(default)' } else { '' }
} | ConvertTo-Json -Compress -Depth 4
`;
  return JSON.parse(
    runPowerShell(script, {
      JOTLUCK_EXTENSION: extension,
      JOTLUCK_ASSOCIATION_CLASS: expectedProgId,
    }),
  );
}

function isQuotedJotLuckOpenCommand(command) {
  return /^"[^"\r\n]*[\\/]JotLuck\.exe"\s+"%1"$/iu.test(String(command));
}

function openCommandTargetsApplication(command, application) {
  if (!application) return false;
  const match = String(command).match(/^"([^"\r\n]+)"\s+"%1"$/u);
  return Boolean(
    match &&
    path.resolve(match[1]).localeCompare(path.resolve(application), undefined, {
      sensitivity: 'accent',
    }) === 0,
  );
}

function resolveAssociationProcessId(processObserved, shell) {
  const processId = processObserved?.process?.Id ?? shell?.processId;
  if (!Number.isInteger(processId) || processId <= 0) {
    throw new Error('association launch did not provide a cleanup process identity');
  }
  return processId;
}

async function waitForProcessWindow(marker, target, expectedProcessId) {
  const started = Date.now();
  while (Date.now() - started < 20_000) {
    const result = runPowerShell(
      String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
$expected = [IO.Path]::GetFileNameWithoutExtension($env:JOTLUCK_ASSOCIATED_FILE)
$expectedProcessId = [int]$env:JOTLUCK_ASSOCIATED_PROCESS_ID
$process = Get-Process -Id $expectedProcessId -ErrorAction SilentlyContinue |
  Where-Object { $_.MainWindowTitle -like "*$expected*" } |
  Select-Object -First 1
if ($process -and $process.MainWindowHandle -ne 0) {
  $window = [System.Windows.Automation.AutomationElement]::FromHandle($process.MainWindowHandle)
  $elements = $window.FindAll(
    [System.Windows.Automation.TreeScope]::Descendants,
    [System.Windows.Automation.Condition]::TrueCondition
  )
  $matchedText = $null
  foreach ($element in $elements) {
    try {
      if ([string]$element.Current.Name -like "*$env:JOTLUCK_ASSOCIATION_MARKER*") {
        $matchedText = [string]$element.Current.Name
        break
      }
    } catch {}
  }
  $processRecord = Get-CimInstance Win32_Process -Filter "ProcessId = $expectedProcessId" -ErrorAction SilentlyContinue
  if ($matchedText -and $processRecord -and $processRecord.ExecutablePath) {
    [pscustomobject]@{
      Id = $process.Id
      ProcessName = $process.ProcessName
      MainWindowTitle = $process.MainWindowTitle
      ExecutablePath = [string]$processRecord.ExecutablePath
      matchedText = $matchedText
      observationSource = 'Windows-UIAutomation'
    } | ConvertTo-Json -Compress
  }
}
`,
      {
        JOTLUCK_ASSOCIATED_FILE: target,
        JOTLUCK_ASSOCIATED_PROCESS_ID: String(expectedProcessId),
        JOTLUCK_ASSOCIATION_MARKER: marker,
      },
    );
    if (result) return { target, process: JSON.parse(result) };
    await delay(100);
  }
  throw new Error(`association launch did not expose the target body marker for ${target}`);
}

function textFileReadback(filePath, includeContent) {
  const content = readFileSync(path.resolve(filePath));
  const result = {
    bytes: content.byteLength,
    sha256: sha256(content),
  };
  if (includeContent) result.contentUtf8 = content.toString('utf8');
  return result;
}

function stopObservedProcess(processId) {
  if (!Number.isInteger(processId) || processId <= 0) return;
  runPowerShell(
    String.raw`
$process = Get-Process -Id ([int]$env:JOTLUCK_PROCESS_ID) -ErrorAction SilentlyContinue
if ($process) {
  Stop-Process -Id $process.Id -Force
  Wait-Process -Id $process.Id -Timeout 10 -ErrorAction SilentlyContinue
}
`,
    { JOTLUCK_PROCESS_ID: String(processId) },
  );
}

function seedOpenWithOrder() {
  if (state.seededOpenWithBackup) throw new Error('Open With fixture is already active');
  state.seededOpenWithBackup = readDetailedAssociationSnapshot('.md');
  const script = String.raw`
$path = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\.md\OpenWithList'
New-Item -Path $path -Force | Out-Null
New-ItemProperty -Path $path -Name a -Value 'OtherEditor.exe' -PropertyType String -Force | Out-Null
New-ItemProperty -Path $path -Name b -Value 'JotLuck.exe' -PropertyType String -Force | Out-Null
New-ItemProperty -Path $path -Name c -Value 'SecondEditor.exe' -PropertyType String -Force | Out-Null
New-ItemProperty -Path $path -Name MRUList -Value 'cba' -PropertyType String -Force | Out-Null
`;
  runPowerShell(script);
}

function clearSeededOpenWithOrder() {
  const backup = state.seededOpenWithBackup;
  if (!backup) return;
  const encodedBackup = Buffer.from(JSON.stringify(backup), 'utf8').toString('base64');
  const script = String.raw`
$path = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\.md\OpenWithList'
$backup = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:JOTLUCK_OPEN_WITH_BACKUP)) | ConvertFrom-Json
Remove-ItemProperty -Path $path -Name a,b,c,MRUList -ErrorAction SilentlyContinue
foreach ($name in @('a', 'b', 'c')) {
  $property = $backup.openWithSlots.PSObject.Properties[$name]
  if ($property) {
    New-ItemProperty -Path $path -Name $name -Value ([string]$property.Value) -PropertyType String -Force | Out-Null
  }
}
if ($null -ne $backup.mruList) {
  New-ItemProperty -Path $path -Name MRUList -Value ([string]$backup.mruList) -PropertyType String -Force | Out-Null
}
if (-not $backup.openWithListExists) {
  $remaining = Get-ItemProperty $path -ErrorAction SilentlyContinue
  $values = @($remaining.PSObject.Properties | Where-Object { $_.Name -notmatch '^PS' })
  if ($values.Count -eq 0) { Remove-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue }
}
`;
  try {
    runPowerShell(script, { JOTLUCK_OPEN_WITH_BACKUP: encodedBackup });
  } finally {
    state.seededOpenWithBackup = null;
  }
}
