#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectV2SArchitectureStop } from '../verify-autocomplete-v2s-evidence.mjs';
import {
  verifyInstalledAppEvidenceV2,
  verifyTrackedArtifact,
} from './verify-installed-app-evidence-v2.mjs';

const SCHEMA = 'jotluck.preview-release-gate.v2';
const COMMAND_SCHEMA = 'jotluck.release-command-execution.v2';
const INVENTORY_SCHEMA = 'jotluck.production-file-inventory.v1';
const SHA256 = /^[a-f0-9]{64}$/u;
const ISO_TIME = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/u;
const PUBLIC_V2S = /(?:public-v2s|autocomplete-public\.manifest|public-v2s\.worker)/iu;

export function verifyPreviewReleaseGate({
  rootDir,
  releaseId,
  evidencePath,
  installerPath,
  bundlePath,
}) {
  const root = realpathSync(path.resolve(rootDir));
  const stop = inspectV2SArchitectureStop(root);
  if (!stop) throw new Error('preview gate requires a verified V2S architecture-stop record');
  const expectedPath = `release-evidence/installed-app/v2/${releaseId}/preview-gate.json`;
  if (evidencePath !== expectedPath) throw new Error('preview evidence path is not fixed');
  const evidence = readEvidence(root, evidencePath);
  assertExactKeys(
    evidence,
    [
      'schema',
      'releaseId',
      'productionDependencyAudit',
      'fullDependencyAudit',
      'fullTest',
      'productionBuild',
    ],
    'preview evidence',
  );
  if (evidence.schema !== SCHEMA || evidence.releaseId !== releaseId)
    throw new Error('preview gate evidence schema or release id is invalid');

  const installed = verifyInstalledAppEvidenceV2({ rootDir: root, releaseId, installerPath });
  verifyExecution(root, evidence.productionDependencyAudit, 'production dependency audit');
  verifyExecution(root, evidence.fullDependencyAudit, 'full dependency audit');
  verifyExecution(root, evidence.fullTest, 'full test');
  verifyProductionBuild(
    root,
    evidence.productionBuild,
    installed.candidateCommit,
    bundlePath,
    installerPath,
  );
  return { releaseId, architectureStop: stop.architectureId, reasonCode: stop.reasonCode };
}

function readEvidence(root, evidencePath) {
  if (
    !evidencePath ||
    path.isAbsolute(evidencePath) ||
    evidencePath.includes('\\') ||
    evidencePath.split('/').some((part) => !part || part === '.' || part === '..')
  )
    throw new Error('preview evidence path is unsafe');
  try {
    return JSON.parse(readFileSync(path.resolve(root, evidencePath), 'utf8'));
  } catch {
    throw new Error('preview evidence JSON is invalid');
  }
}

function verifyExecution(root, value, label) {
  assertObject(value, `${label} execution`);
  assertExactKeys(
    value,
    ['command', 'startedAt', 'finishedAt', 'exitCode', 'counters', 'output'],
    `${label} execution`,
  );
  validateSuccessfulExecution(value, label);
  verifyTrackedArtifact(root, value.output, `${label} output`);
  const parsed = JSON.parse(readFileSync(path.join(root, value.output.path), 'utf8'));
  assertObject(parsed, `${label} parsed output`);
  assertExactKeys(
    parsed,
    ['schema', 'command', 'startedAt', 'finishedAt', 'exitCode', 'counters'],
    `${label} parsed output`,
  );
  if (
    parsed.schema !== COMMAND_SCHEMA ||
    parsed.command !== value.command ||
    parsed.startedAt !== value.startedAt ||
    parsed.finishedAt !== value.finishedAt ||
    parsed.exitCode !== value.exitCode ||
    canonicalJson(parsed.counters) !== canonicalJson(value.counters)
  ) {
    throw new Error(`${label} summary does not match its parsed execution output`);
  }
  validateSuccessfulExecution(parsed, `${label} parsed output`);
}

function validateSuccessfulExecution(value, label) {
  assertObject(value.counters, `${label} counters`);
  assertExactKeys(value.counters, ['executed', 'passed', 'failed', 'skipped'], `${label} counters`);
  const counters = value.counters;
  if (
    value.exitCode !== 0 ||
    !Number.isInteger(counters.executed) ||
    !Number.isInteger(counters.passed) ||
    !Number.isInteger(counters.failed) ||
    !Number.isInteger(counters.skipped) ||
    counters.executed <= 0 ||
    counters.passed !== counters.executed ||
    counters.failed !== 0 ||
    counters.skipped !== 0 ||
    typeof value.command !== 'string' ||
    value.command.length === 0 ||
    !ISO_TIME.test(String(value.startedAt)) ||
    !ISO_TIME.test(String(value.finishedAt))
  ) {
    throw new Error(`${label} is not strict successful execution evidence`);
  }
}

function verifyProductionBuild(root, value, candidateCommit, bundlePath, installerPath) {
  assertObject(value, 'production build');
  assertExactKeys(
    value,
    ['execution', 'bundleInventory', 'installerInventory'],
    'production build',
  );
  verifyExecution(root, value.execution, 'production build');
  verifyInventory(root, value.bundleInventory, 'bundle', candidateCommit, bundlePath);
  verifyInventory(root, value.installerInventory, 'installer', candidateCommit, installerPath);
}

function verifyInventory(root, artifact, scope, candidateCommit, actualRoot) {
  verifyTrackedArtifact(root, artifact, `${scope} inventory`);
  const inventory = JSON.parse(readFileSync(path.join(root, artifact.path), 'utf8'));
  assertObject(inventory, `${scope} inventory`);
  assertExactKeys(
    inventory,
    ['schema', 'candidateCommit', 'scope', 'entries'],
    `${scope} inventory`,
  );
  if (
    inventory.schema !== INVENTORY_SCHEMA ||
    inventory.candidateCommit !== candidateCommit ||
    inventory.scope !== scope ||
    !Array.isArray(inventory.entries) ||
    inventory.entries.length === 0
  ) {
    throw new Error(`${scope} inventory identity is invalid`);
  }
  for (const entry of inventory.entries) {
    assertObject(entry, `${scope} inventory entry`);
    assertExactKeys(entry, ['path', 'bytes', 'sha256'], `${scope} inventory entry`);
    if (
      typeof entry.path !== 'string' ||
      entry.path.length === 0 ||
      entry.path.includes('\\') ||
      path.isAbsolute(entry.path) ||
      entry.path.split('/').some((part) => !part || part === '.' || part === '..') ||
      !Number.isInteger(entry.bytes) ||
      entry.bytes <= 0 ||
      !SHA256.test(String(entry.sha256))
    ) {
      throw new Error(`${scope} inventory entry is invalid`);
    }
    if (PUBLIC_V2S.test(entry.path))
      throw new Error(`${scope} inventory contains a Public V2S manifest, model, or worker chunk`);
  }
  if (scope === 'bundle') verifyActualBundle(inventory.entries, actualRoot);
  if (scope === 'installer') verifyActualInstaller(inventory.entries, actualRoot);
}

function verifyActualBundle(expectedEntries, bundlePath) {
  if (!bundlePath || !path.isAbsolute(bundlePath)) {
    throw new Error('preview gate requires an absolute candidate bundle path');
  }
  let actualRoot;
  try {
    actualRoot = realpathSync(bundlePath);
  } catch {
    throw new Error('candidate bundle path does not exist');
  }
  if (!lstatSync(actualRoot).isDirectory())
    throw new Error('candidate bundle path is not a directory');

  const actualEntries = collectBundleEntries(actualRoot).sort(compareEntryPath);
  const expected = [...expectedEntries].sort(compareEntryPath);
  if (canonicalJson(actualEntries) !== canonicalJson(expected)) {
    throw new Error('bundle inventory does not exactly match the downloaded candidate bundle');
  }
}

function collectBundleEntries(root) {
  const entries = [];
  const visit = (directory, prefix) => {
    for (const name of readdirSync(directory).sort()) {
      const absolute = path.join(directory, name);
      const relative = prefix ? `${prefix}/${name}` : name;
      const metadata = lstatSync(absolute);
      if (metadata.isSymbolicLink()) throw new Error('candidate bundle contains a symbolic link');
      if (metadata.isDirectory()) {
        visit(absolute, relative);
        continue;
      }
      if (!metadata.isFile()) throw new Error('candidate bundle contains a non-regular entry');
      const content = readFileSync(absolute);
      if (PUBLIC_V2S.test(relative) || PUBLIC_V2S.test(content.toString('utf8'))) {
        throw new Error('candidate bundle contains a Public V2S manifest, model, or worker chunk');
      }
      entries.push({
        path: relative,
        bytes: content.byteLength,
        sha256: createHash('sha256').update(content).digest('hex'),
      });
    }
  };
  visit(root, '');
  if (entries.length === 0) throw new Error('candidate bundle is empty');
  return entries;
}

function compareEntryPath(left, right) {
  return left.path.localeCompare(right.path);
}

function verifyActualInstaller(expectedEntries, installerPath) {
  if (!installerPath || !path.isAbsolute(installerPath)) {
    throw new Error('preview gate requires an absolute candidate installer path');
  }
  let actualPath;
  try {
    actualPath = realpathSync(installerPath);
  } catch {
    throw new Error('candidate installer path does not exist');
  }
  const metadata = lstatSync(actualPath);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error('candidate installer is not a regular file');
  }
  const content = readFileSync(actualPath);
  const actual = [
    {
      path: path.basename(actualPath),
      bytes: content.byteLength,
      sha256: createHash('sha256').update(content).digest('hex'),
    },
  ];
  if (canonicalJson(actual) !== canonicalJson(expectedEntries)) {
    throw new Error(
      'installer inventory does not exactly match the downloaded candidate installer',
    );
  }
}

function assertObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${label} must be an object`);
}

function assertExactKeys(value, expected, label) {
  if (canonicalJson(Object.keys(value).sort()) !== canonicalJson([...expected].sort()))
    throw new Error(`${label} fields do not match the strict schema`);
}

function canonicalJson(value) {
  if (Array.isArray(value)) return JSON.stringify(value.map(sortValue));
  return JSON.stringify(sortValue(value));
}

function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortValue(value[key])]),
    );
  return value;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [
    releaseId,
    evidencePath,
    installerPath = process.env.JOTLUCK_INSTALLER_PATH,
    bundlePath = process.env.JOTLUCK_PRODUCTION_BUNDLE_PATH,
  ] = process.argv.slice(2);
  if (!releaseId || !evidencePath || !installerPath || !bundlePath) {
    console.error(
      'usage: node scripts/release/verify-preview-release-gate.mjs <release-id> <preview-evidence.json> <installer-path> <bundle-path>',
    );
    process.exit(2);
  }
  try {
    console.log(
      JSON.stringify(
        verifyPreviewReleaseGate({
          rootDir: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'),
          releaseId,
          evidencePath,
          installerPath,
          bundlePath,
        }),
      ),
    );
  } catch (error) {
    console.error(`[preview-release-gate] FAIL: ${error.message}`);
    process.exit(12);
  }
}
