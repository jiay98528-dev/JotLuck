#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validatePerformanceEvidence } from './installed-app-performance.mjs';

const EVIDENCE_ROOT = 'release-evidence/installed-app/v2';
const REQUIRED_CASES_PATH = 'spec/release/required-cases/installed-app-v2.json';
const RAW_SCHEMA = 'jotluck.installed-app.raw-report.v2';
const PROVENANCE_SCHEMA = 'jotluck.github-actions.capture-provenance.v1';
const SHA256 = /^[a-f0-9]{64}$/u;
const COMMIT = /^[a-f0-9]{40}$/u;

export function materializeInstalledAppEvidenceV2({
  rootDir,
  releaseId,
  candidateRoot,
  executionRoot,
  provenancePath,
  outputRoot,
}) {
  assertSafeSegment(releaseId, 'release id');
  const root = regularDirectory(rootDir, 'repository root');
  const candidate = regularDirectory(candidateRoot, 'candidate root');
  const execution = regularDirectory(executionRoot, 'execution evidence root');
  const output = path.resolve(outputRoot);
  if (existsSync(output)) throw new Error('materialization output already exists');
  const provenance = readStrictJsonFile(provenancePath, 'trusted provenance');
  validateProvenance(provenance, releaseId);
  const catalog = readStrictJsonFile(path.join(root, REQUIRED_CASES_PATH), 'required-case catalog');
  const raw = readStrictJsonFile(path.join(execution, 'raw-report.json'), 'raw execution report');
  validateRawIdentity(raw, catalog, provenance, releaseId);
  const executionFiles = validateExecutionSnapshot(execution, raw, releaseId, catalog);
  const candidateFiles = discoverCandidate(candidate);
  const temporary = mkdtempSync(path.join(os.tmpdir(), 'jotluck-evidence-materialize-'));
  const base = `${EVIDENCE_ROOT}/${releaseId}`;
  const evidenceDirectory = path.join(temporary, ...base.split('/'));
  try {
    mkdirSync(evidenceDirectory, { recursive: true });
    for (const record of executionFiles) {
      const target = path.join(evidenceDirectory, ...record.path.split('/'));
      mkdirSync(path.dirname(target), { recursive: true });
      copyFileSync(path.join(execution, ...record.path.split('/')), target);
    }
    const transcript = buildTranscript(raw);
    writeCanonical(path.join(evidenceDirectory, 'transcript.json'), transcript);
    const bundleInventory = buildInventory(candidateFiles.dist, 'bundle', provenance.headSha);
    const installerInventory = {
      schema: 'jotluck.production-file-inventory.v1',
      candidateCommit: provenance.headSha,
      scope: 'installer',
      entries: [relativeMetadata(candidateFiles.installer, path.dirname(candidateFiles.installer))],
    };
    writeCanonical(
      path.join(evidenceDirectory, 'release', 'bundle-inventory.json'),
      bundleInventory,
    );
    writeCanonical(
      path.join(evidenceDirectory, 'release', 'installer-inventory.json'),
      installerInventory,
    );
    const previewGate = {
      schema: 'jotluck.preview-release-gate.v2',
      releaseId,
      productionBuild: {
        bundleInventory: managedMetadata(evidenceDirectory, base, 'release/bundle-inventory.json'),
        installerInventory: managedMetadata(
          evidenceDirectory,
          base,
          'release/installer-inventory.json',
        ),
      },
    };
    writeCanonical(path.join(evidenceDirectory, 'preview-gate.json'), previewGate);
    const outputMetadata = raw.executions.map((entry) => ({
      ...entry.output,
      caseId: entry.caseId,
      kind: 'case-result',
    }));
    const artifactMetadata = raw.executions.flatMap((entry) => {
      const result = readStrictJsonFile(
        path.join(execution, ...stripEvidenceBase(entry.output.path, releaseId).split('/')),
        `case result ${entry.caseId}`,
      );
      return result.artifacts.map((artifact) => ({
        path: artifact.path,
        bytes: artifact.bytes,
        sha256: artifact.sha256,
        caseId: entry.caseId,
        kind: 'case-artifact',
      }));
    });
    const version = JSON.parse(git(root, ['show', `${provenance.headSha}:package.json`])).version;
    const manifest = {
      schema: 'jotluck.installed-app.manifest.v2',
      releaseId,
      candidate: { commit: provenance.headSha, version },
      ci: {
        provider: 'github-actions',
        repository: provenance.repository,
        runId: provenance.runId,
        runAttempt: provenance.runAttempt,
        candidateArtifact: provenance.candidateArtifact,
        evidenceArtifact: provenance.evidenceArtifact,
        materialization: provenance.materialization,
      },
      installer: fileMetadata(candidateFiles.installer, true),
      application: {
        fileName: 'jotluck.exe',
        ...fileMetadata(candidateFiles.executable),
      },
      catalog: fileMetadata(path.join(root, REQUIRED_CASES_PATH), false, REQUIRED_CASES_PATH),
      rawReport: managedMetadata(evidenceDirectory, base, 'raw-report.json'),
      transcript: managedMetadata(evidenceDirectory, base, 'transcript.json'),
      attachments: [...outputMetadata, ...artifactMetadata],
      requiredCasesTree: {
        commit: provenance.headSha,
        gitTreeSha: git(root, [
          'rev-parse',
          `${provenance.headSha}:spec/release/required-cases`,
        ]).trim(),
      },
      performance: raw.performance,
    };
    writeCanonical(path.join(evidenceDirectory, 'manifest.json'), manifest);
    verifyMaterializedStructure({
      evidenceDirectory,
      execution,
      executionFiles,
      manifest,
      previewGate,
    });
    mkdirSync(path.dirname(output), { recursive: true });
    renameSync(temporary, output);
    return {
      status: 'structural-diagnostic',
      releaseId,
      evidenceDirectory: path.join(output, ...base.split('/')),
      files: collectSnapshotFiles(path.join(output, ...base.split('/'))).length,
      warnings: raw.performance.advisories,
    };
  } catch (error) {
    rmSync(temporary, { recursive: true, force: true });
    throw error;
  }
}

function validateProvenance(value, releaseId) {
  assertObject(value, 'trusted provenance');
  assertExactKeys(
    value,
    [
      'schema',
      'repository',
      'workflow',
      'event',
      'branch',
      'headSha',
      'runId',
      'runAttempt',
      'candidateArtifact',
      'evidenceArtifact',
      'materialization',
    ],
    'trusted provenance',
  );
  if (
    value.schema !== PROVENANCE_SCHEMA ||
    !/^[^/]+\/[^/]+$/u.test(String(value.repository)) ||
    value.workflow !== '.github/workflows/ci.yml' ||
    value.event !== 'workflow_dispatch' ||
    value.branch !== 'main' ||
    !COMMIT.test(String(value.headSha)) ||
    !/^[1-9]\d*$/u.test(String(value.runId)) ||
    !Number.isInteger(value.runAttempt) ||
    value.runAttempt <= 0
  ) {
    throw new Error('trusted provenance identity is invalid');
  }
  validateArtifactBinding(value.candidateArtifact, 'jotluck-windows-candidate');
  validateArtifactBinding(value.evidenceArtifact, `jotluck-installed-app-evidence-v2-${releaseId}`);
  assertObject(value.materialization, 'materialization binding');
  assertExactKeys(value.materialization, ['job', 'step'], 'materialization binding');
  if (
    value.materialization.job !== 'Installed-app Evidence Materialization' ||
    value.materialization.step !== 'Materialize managed evidence bundle'
  ) {
    throw new Error('materialization job or step identity is invalid');
  }
}

function validateArtifactBinding(value, expectedName) {
  assertObject(value, `${expectedName} artifact`);
  assertExactKeys(value, ['id', 'name', 'digest', 'sizeInBytes'], `${expectedName} artifact`);
  if (
    !/^[1-9]\d*$/u.test(String(value.id)) ||
    value.name !== expectedName ||
    !/^sha256:[a-f0-9]{64}$/u.test(String(value.digest)) ||
    !Number.isInteger(value.sizeInBytes) ||
    value.sizeInBytes <= 0
  ) {
    throw new Error(`${expectedName} artifact binding is invalid`);
  }
}

function validateRawIdentity(raw, catalog, provenance, releaseId) {
  assertObject(raw, 'raw execution report');
  if (
    raw.schema !== RAW_SCHEMA ||
    raw.releaseId !== releaseId ||
    raw.candidateCommit !== provenance.headSha ||
    raw.runner?.provider !== 'github-actions' ||
    raw.runner?.repository?.toLowerCase() !== provenance.repository.toLowerCase() ||
    raw.runner?.runId !== provenance.runId ||
    raw.runner?.runAttempt !== provenance.runAttempt ||
    raw.runner?.headSha !== provenance.headSha
  ) {
    throw new Error('raw execution report is not bound to trusted provenance');
  }
  if (!Array.isArray(raw.executions) || raw.executions.length !== catalog.cases.length) {
    throw new Error('raw execution report case count is invalid');
  }
  const expectedCases = catalog.cases.map(({ id, adapter }) => ({ id, adapter }));
  const actualCases = raw.executions.map(({ caseId: id, adapter }) => ({ id, adapter }));
  if (canonicalJson(expectedCases) !== canonicalJson(actualCases)) {
    throw new Error('raw execution report case identity or order is invalid');
  }
  validatePerformanceEvidence(raw.performance, catalog.performance);
}

function validateExecutionSnapshot(execution, raw, releaseId, catalog) {
  const expected = new Map();
  const rawReportPath = path.join(execution, 'raw-report.json');
  const rawBytes = readFileSync(rawReportPath);
  if (!rawBytes.equals(Buffer.from(canonicalJson(raw)))) {
    throw new Error('raw execution report must use canonical JSON encoding');
  }
  addExpected(expected, 'raw-report.json', fileMetadata(rawReportPath));
  for (const executionRecord of raw.executions) {
    const definition = catalog.cases.find((entry) => entry.id === executionRecord.caseId);
    if (!definition) throw new Error(`unknown raw execution case: ${executionRecord.caseId}`);
    const outputRelative = stripEvidenceBase(executionRecord.output.path, releaseId);
    addExpected(expected, outputRelative, executionRecord.output);
    const resultPath = path.join(execution, ...outputRelative.split('/'));
    const result = readStrictJsonFile(resultPath, `case result ${executionRecord.caseId}`);
    if (
      result.schema !== 'jotluck.installed-app.case-execution.v2' ||
      result.caseId !== executionRecord.caseId ||
      result.adapter !== executionRecord.adapter ||
      canonicalJson(result.producer) !== canonicalJson(raw.runner) ||
      result.startedAt !== executionRecord.startedAt ||
      result.finishedAt !== executionRecord.finishedAt ||
      result.exitCode !== 0 ||
      result.counters?.executed <= 0 ||
      result.counters?.passed !== result.counters?.executed ||
      result.counters?.failed !== 0 ||
      result.counters?.skipped !== 0 ||
      !Array.isArray(result.artifacts) ||
      result.artifacts.length < 2
    ) {
      throw new Error(`case result is not a successful real execution: ${executionRecord.caseId}`);
    }
    const kinds = result.artifacts.map((artifact) => artifact.kind);
    if (
      new Set(kinds).size !== kinds.length ||
      canonicalJson([...kinds].sort()) !==
        canonicalJson([...definition.requiredArtifactKinds].sort())
    ) {
      throw new Error(`case result artifact kinds drifted: ${executionRecord.caseId}`);
    }
    const resultBytes = readFileSync(resultPath);
    if (!resultBytes.equals(Buffer.from(canonicalJson(result)))) {
      throw new Error(`case result must use canonical JSON encoding: ${executionRecord.caseId}`);
    }
    for (const artifact of result.artifacts) {
      addExpected(expected, stripEvidenceBase(artifact.path, releaseId), artifact);
    }
  }
  const actual = collectSnapshotFiles(execution);
  if (canonicalJson(actual) !== canonicalJson([...expected.values()].sort(comparePath))) {
    throw new Error('trusted execution artifact contains missing, additional, or changed files');
  }
  return actual;
}

function addExpected(map, relative, metadata) {
  if (map.has(relative)) throw new Error(`duplicate trusted execution path: ${relative}`);
  if (!Number.isInteger(metadata.bytes) || metadata.bytes <= 0 || !SHA256.test(metadata.sha256)) {
    throw new Error(`trusted execution metadata is invalid: ${relative}`);
  }
  map.set(relative, { path: relative, bytes: metadata.bytes, sha256: metadata.sha256 });
}

function buildTranscript(raw) {
  return {
    schema: 'jotluck.installed-app.transcript.v2',
    releaseId: raw.releaseId,
    candidateCommit: raw.candidateCommit,
    rawReportSha256: sha256(Buffer.from(canonicalJson(raw))),
    transcriber: { id: raw.runner.id, role: 'independent-readonly' },
    executions: raw.executions.map((entry) => ({
      caseId: entry.caseId,
      adapter: entry.adapter,
      counters: entry.counters,
      outputSha256: entry.output.sha256,
    })),
    performance: raw.performance,
  };
}

function verifyMaterializedStructure({
  evidenceDirectory,
  execution,
  executionFiles,
  manifest,
  previewGate,
}) {
  for (const record of executionFiles) {
    const copied = fileMetadata(path.join(evidenceDirectory, ...record.path.split('/')));
    if (copied.bytes !== record.bytes || copied.sha256 !== record.sha256) {
      throw new Error(`materialized trusted execution file changed: ${record.path}`);
    }
    const original = fileMetadata(path.join(execution, ...record.path.split('/')));
    if (canonicalJson(copied) !== canonicalJson(original)) {
      throw new Error(`materialized trusted execution file differs: ${record.path}`);
    }
  }
  const manifestFiles = [manifest.rawReport, manifest.transcript, ...manifest.attachments];
  for (const record of manifestFiles) {
    const relative = record.path.split('/').slice(4).join('/');
    const actual = fileMetadata(path.join(evidenceDirectory, ...relative.split('/')));
    if (actual.bytes !== record.bytes || actual.sha256 !== record.sha256) {
      throw new Error(`manifest metadata drifted during materialization: ${record.path}`);
    }
  }
  if (previewGate.releaseId !== manifest.releaseId) throw new Error('preview gate release drifted');
}

function discoverCandidate(root) {
  const files = collectFiles(root);
  const installers = files.filter((file) => /-setup\.exe$/iu.test(path.basename(file)));
  const executables = files.filter((file) => /^jotluck\.exe$/iu.test(path.basename(file)));
  const dist = files
    .filter((file) => path.basename(file).toLowerCase() === 'index.html')
    .map((file) => path.dirname(file))
    .filter((directory) => path.basename(directory).toLowerCase() === 'dist');
  if (installers.length !== 1 || executables.length !== 1 || dist.length !== 1) {
    throw new Error('candidate must contain exactly one installer, executable, and dist directory');
  }
  return { installer: installers[0], executable: executables[0], dist: dist[0] };
}

function buildInventory(directory, scope, candidateCommit) {
  return {
    schema: 'jotluck.production-file-inventory.v1',
    candidateCommit,
    scope,
    entries: collectSnapshotFiles(directory),
  };
}

function collectSnapshotFiles(root, relative = '') {
  const result = [];
  for (const entry of readdirSync(path.join(root, relative), { withFileTypes: true })) {
    const childRelative = relative ? `${relative}/${entry.name}` : entry.name;
    const absolute = path.join(root, ...childRelative.split('/'));
    const info = lstatSync(absolute);
    if (info.isSymbolicLink()) throw new Error(`symbolic link is forbidden: ${childRelative}`);
    if (info.isDirectory()) result.push(...collectSnapshotFiles(root, childRelative));
    else if (info.isFile()) {
      const metadata = fileMetadata(absolute);
      if (metadata.bytes <= 0)
        throw new Error(`empty evidence file is forbidden: ${childRelative}`);
      result.push({ path: childRelative, ...metadata });
    } else throw new Error(`non-regular evidence entry is forbidden: ${childRelative}`);
  }
  return result.sort(comparePath);
}

function collectFiles(root) {
  return collectSnapshotFiles(root).map((entry) => path.join(root, ...entry.path.split('/')));
}

function stripEvidenceBase(value, releaseId) {
  const prefix = `${EVIDENCE_ROOT}/${releaseId}/`;
  if (typeof value !== 'string' || !value.startsWith(prefix)) {
    throw new Error(`execution path is outside the fixed release directory: ${value}`);
  }
  const relative = value.slice(prefix.length);
  assertSafeRelative(relative, 'execution path');
  return relative;
}

function managedMetadata(evidenceDirectory, base, relative) {
  return { path: `${base}/${relative}`, ...fileMetadata(path.join(evidenceDirectory, relative)) };
}

function relativeMetadata(filePath, parent) {
  return { path: path.relative(parent, filePath).replaceAll('\\', '/'), ...fileMetadata(filePath) };
}

function fileMetadata(filePath, includeFileName = false, fixedPath) {
  const absolute = path.resolve(filePath);
  const info = lstatSync(absolute);
  if (info.isSymbolicLink() || !info.isFile() || info.size <= 0) {
    throw new Error(`expected non-empty regular file: ${filePath}`);
  }
  const content = readFileSync(absolute);
  const result = { bytes: content.byteLength, sha256: sha256(content) };
  if (includeFileName) return { fileName: path.basename(absolute), ...result };
  if (fixedPath) return { path: fixedPath, ...result };
  return result;
}

function regularDirectory(value, label) {
  const absolute = path.resolve(value);
  const info = lstatSync(absolute);
  if (info.isSymbolicLink() || !info.isDirectory())
    throw new Error(`${label} must be a regular directory`);
  return absolute;
}

function readStrictJsonFile(filePath, label) {
  const info = lstatSync(path.resolve(filePath));
  if (info.isSymbolicLink() || !info.isFile() || info.size <= 0) {
    throw new Error(`${label} must be a non-empty regular JSON file`);
  }
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    throw new Error(`${label} is not valid JSON`);
  }
}

function writeCanonical(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, canonicalJson(value), 'utf8');
}

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' });
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function assertSafeSegment(value, label) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(String(value ?? '')))
    throw new Error(`${label} is unsafe`);
}

function assertSafeRelative(value, label) {
  if (
    !value ||
    path.isAbsolute(value) ||
    value.includes('\\') ||
    value.split('/').some((part) => !part || part === '.' || part === '..')
  ) {
    throw new Error(`${label} is unsafe`);
  }
}

function assertObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${label} must be an object`);
}

function assertExactKeys(value, keys, label) {
  if (canonicalJson(Object.keys(value).sort()) !== canonicalJson([...keys].sort())) {
    throw new Error(`${label} fields do not match the strict schema`);
  }
}

function canonicalJson(value) {
  return JSON.stringify(sortValue(value));
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

function comparePath(left, right) {
  return left.path.localeCompare(right.path);
}

async function main() {
  const [releaseId, candidateRoot, executionRoot, provenancePath, outputRoot] =
    process.argv.slice(2);
  if (!releaseId || !candidateRoot || !executionRoot || !provenancePath || !outputRoot) {
    throw new Error(
      'usage: materialize-installed-app-evidence-v2 <release-id> <candidate-root> <execution-root> <provenance-json> <output-root>',
    );
  }
  const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  console.log(
    JSON.stringify(
      materializeInstalledAppEvidenceV2({
        rootDir,
        releaseId,
        candidateRoot,
        executionRoot,
        provenancePath,
        outputRoot,
      }),
    ),
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(
      `[installed-app-materializer-v2] FAIL: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(15);
  });
}
