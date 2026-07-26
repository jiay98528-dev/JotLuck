#!/usr/bin/env node
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildPerformanceEvidence } from './installed-app-performance.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const [releaseId, candidatePath, outputPath] = process.argv.slice(2);

if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(String(releaseId ?? ''))) {
  fail('a safe release id is required');
}
if (!candidatePath || !outputPath) {
  fail('usage: capture-installed-app-evidence-v2 <release-id> <candidate-root> <output-root>');
}
if (!process.env.GITHUB_ACTIONS || process.env.GITHUB_EVENT_NAME !== 'workflow_dispatch') {
  fail('formal installed-app capture is restricted to GitHub workflow_dispatch');
}
if (
  !process.env.GITHUB_REPOSITORY ||
  !process.env.GITHUB_RUN_ID ||
  !process.env.GITHUB_RUN_ATTEMPT ||
  !/^[a-f0-9]{40}$/u.test(String(process.env.GITHUB_SHA))
) {
  fail('GitHub Actions run provenance environment is incomplete');
}

const candidateRoot = path.resolve(candidatePath);
if (!lstatSync(candidateRoot).isDirectory()) fail('candidate root is not a directory');
const outputRoot = path.resolve(outputPath);
try {
  lstatSync(outputRoot);
  fail('capture output already exists');
} catch (error) {
  if (error?.code !== 'ENOENT') throw error;
}

const catalog = JSON.parse(
  readFileSync(path.join(root, 'spec/release/required-cases/installed-app-v2.json'), 'utf8'),
);
const adapterModulePath = path.join(root, 'e2e/tauri/installed-app-evidence-adapters.mjs');
let adapters;
try {
  adapters = await import(pathToFileURL(adapterModulePath).href);
} catch (error) {
  fail(`fixed installed-app adapter module is unavailable: ${error.message}`);
}
if (typeof adapters.runInstalledAppCase !== 'function') {
  fail('fixed installed-app adapter module does not export runInstalledAppCase');
}

const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), 'jotluck-installed-capture-'));
const startedAt = new Date().toISOString();
const runner = {
  id: `${process.env.GITHUB_REPOSITORY}/${process.env.GITHUB_RUN_ID}/${process.env.GITHUB_RUN_ATTEMPT}`,
  role: 'independent-readonly',
  provider: 'github-actions',
  repository: process.env.GITHUB_REPOSITORY,
  runId: process.env.GITHUB_RUN_ID,
  runAttempt: Number(process.env.GITHUB_RUN_ATTEMPT),
  headSha: process.env.GITHUB_SHA,
};
const evidenceBase = `release-evidence/installed-app/v2/${releaseId}`;

let captureError = null;
let completedCases = 0;
try {
  const executions = [];
  for (const definition of catalog.cases) {
    const workRoot = path.join(temporaryRoot, '_work', definition.id);
    mkdirSync(workRoot, { recursive: true });
    const result = await adapters.runInstalledAppCase({
      definition,
      candidateRoot,
      workRoot,
    });
    const execution = materializeCaseResult({
      definition,
      result,
      runner,
      temporaryRoot,
      evidenceBase,
    });
    executions.push(execution);
  }
  if (typeof adapters.readPerformanceSummary !== 'function') {
    throw new Error('fixed installed-app adapter module does not export readPerformanceSummary');
  }
  const performance = buildPerformanceEvidence(
    await adapters.readPerformanceSummary(),
    catalog.performance,
  );
  const rawReport = {
    schema: 'jotluck.installed-app.raw-report.v2',
    releaseId,
    candidateCommit: process.env.GITHUB_SHA,
    runner,
    startedAt,
    finishedAt: new Date().toISOString(),
    executions,
    performance,
  };
  writeCanonical(path.join(temporaryRoot, 'raw-report.json'), rawReport);
  rmSync(path.join(temporaryRoot, '_work'), { recursive: true, force: true });
  mkdirSync(path.dirname(outputRoot), { recursive: true });
  renameSync(temporaryRoot, outputRoot);
  completedCases = executions.length;
} catch (error) {
  captureError = error instanceof Error ? error : new Error(String(error));
} finally {
  if (typeof adapters.disposeInstalledAppEvidence === 'function') {
    try {
      await adapters.disposeInstalledAppEvidence();
    } catch (error) {
      if (!captureError) {
        captureError = error instanceof Error ? error : new Error(String(error));
      }
    }
  }
}
if (captureError) {
  const diagnosticRoot = `${outputRoot}-diagnostics`;
  try {
    const sourceRoot = existsSync(outputRoot) ? outputRoot : temporaryRoot;
    writeCanonical(path.join(sourceRoot, 'failure.json'), {
      schema: 'jotluck.installed-app.capture-failure.v1',
      releaseId,
      candidateCommit: process.env.GITHUB_SHA,
      runner,
      startedAt,
      finishedAt: new Date().toISOString(),
      error: { name: captureError.name, message: captureError.message },
    });
    mkdirSync(path.dirname(diagnosticRoot), { recursive: true });
    renameSync(sourceRoot, diagnosticRoot);
  } catch (diagnosticError) {
    fail(
      `${captureError.message}; diagnostic preservation failed: ${
        diagnosticError instanceof Error ? diagnosticError.message : String(diagnosticError)
      }`,
    );
  }
  fail(captureError.message);
}
console.log(JSON.stringify({ releaseId, cases: completedCases, outputRoot }));

function materializeCaseResult({ definition, result, runner, temporaryRoot, evidenceBase }) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    throw new Error(`adapter returned no result: ${definition.id}`);
  }
  if (
    result.exitCode !== 0 ||
    result.counters?.executed <= 0 ||
    result.counters?.passed !== result.counters?.executed ||
    result.counters?.failed !== 0 ||
    result.counters?.skipped !== 0 ||
    !Array.isArray(result.artifacts)
  ) {
    throw new Error(`adapter did not complete successfully: ${definition.id}`);
  }
  const byKind = new Map(result.artifacts.map((artifact) => [artifact.kind, artifact]));
  const artifacts = definition.requiredArtifactKinds
    .filter((kind) => kind !== 'execution-log')
    .map((kind) => {
      const source = byKind.get(kind);
      if (!source || !source.path) throw new Error(`adapter is missing ${kind}: ${definition.id}`);
      const absolute = path.resolve(source.path);
      const info = lstatSync(absolute);
      if (info.isSymbolicLink() || !info.isFile() || info.size <= 0) {
        throw new Error(
          `adapter artifact is not a non-empty regular file: ${definition.id}/${kind}`,
        );
      }
      const relative = `attachments/${definition.id}/${safeArtifactName(kind, absolute)}`;
      const target = path.join(temporaryRoot, ...relative.split('/'));
      mkdirSync(path.dirname(target), { recursive: true });
      copyFileSync(absolute, target);
      return { kind, path: `${evidenceBase}/${relative}`, ...metadata(target) };
    });
  if (byKind.size !== artifacts.length) {
    throw new Error(`adapter returned undeclared or duplicate artifacts: ${definition.id}`);
  }
  const executionLogRelative = `attachments/${definition.id}/execution-log.ndjson`;
  const executionLogPath = path.join(temporaryRoot, ...executionLogRelative.split('/'));
  writeFileSync(executionLogPath, makeExecutionLog(definition, runner, artifacts, result), 'utf8');
  const executionLog = {
    kind: 'execution-log',
    path: `${evidenceBase}/${executionLogRelative}`,
    ...metadata(executionLogPath),
  };
  const caseResult = {
    schema: 'jotluck.installed-app.case-execution.v2',
    caseId: definition.id,
    adapter: definition.adapter,
    producer: runner,
    startedAt: result.startedAt,
    finishedAt: result.finishedAt,
    exitCode: result.exitCode,
    counters: result.counters,
    artifacts: [executionLog, ...artifacts],
  };
  const outputPath = `attachments/${definition.id}.json`;
  const absoluteOutput = path.join(temporaryRoot, ...outputPath.split('/'));
  writeCanonical(absoluteOutput, caseResult);
  return {
    caseId: definition.id,
    adapter: definition.adapter,
    startedAt: result.startedAt,
    finishedAt: result.finishedAt,
    exitCode: result.exitCode,
    counters: result.counters,
    output: { path: `${evidenceBase}/${outputPath}`, ...metadata(absoluteOutput) },
  };
}

function makeExecutionLog(definition, runner, artifacts, result) {
  const common = {
    schema: 'jotluck.installed-app.execution-event.v2',
    caseId: definition.id,
    adapter: definition.adapter,
  };
  const events = [
    {
      ...common,
      sequence: 1,
      timestamp: result.startedAt,
      event: 'adapter-start',
      producer: runner,
    },
    ...artifacts.map((artifact, index) => ({
      ...common,
      sequence: index + 2,
      timestamp: result.finishedAt,
      event: 'artifact-observed',
      artifactKind: artifact.kind,
      path: artifact.path,
      bytes: artifact.bytes,
      sha256: artifact.sha256,
    })),
    {
      ...common,
      sequence: artifacts.length + 2,
      timestamp: result.finishedAt,
      event: 'adapter-finish',
      exitCode: result.exitCode,
      counters: result.counters,
    },
  ];
  return `${events.map((event) => JSON.stringify(sortValue(event))).join('\n')}\n`;
}

function safeArtifactName(kind, sourcePath) {
  const extension = path.extname(sourcePath).toLowerCase();
  if (!/^\.[a-z0-9]{1,8}$/u.test(extension)) return `${kind}.bin`;
  return `${kind}${extension}`;
}

function metadata(filePath) {
  const bytes = readFileSync(filePath);
  return { bytes: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex') };
}

function writeCanonical(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(sortValue(value)), 'utf8');
}

function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortValue(value[key])]),
    );
  }
  return value;
}

function fail(message) {
  console.error(`[installed-app-capture-v2] FAIL: ${message}`);
  process.exit(14);
}
