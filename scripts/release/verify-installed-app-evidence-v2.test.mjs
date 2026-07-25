import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { verifyInstalledAppEvidenceV2 } from './verify-installed-app-evidence-v2.mjs';
import { verifyPreviewReleaseGate } from './verify-preview-release-gate.mjs';

const roots = [];
const projectRoot = path.resolve(import.meta.dirname, '../..');
const cases = [
  'GUI-01-NOTE-LIFECYCLE',
  'GUI-02-FILE-DRAWER',
  'GUI-03-SEARCH-EDIT',
  'GUI-04-LIVE-PREVIEW',
  'GUI-05-SETTINGS-PERSISTENCE',
  'GUI-06-EXPORT-CONTENT',
  'GUI-07-IMAGE-ASSET',
  ...Array.from({ length: 10 }, (_, index) => `RF-${String(index + 1).padStart(2, '0')}`),
  'VER-01',
  'ASSOC-01-MD',
  'ASSOC-02-MARKDOWN',
  'ASSOC-03-MDX',
  'ASSOC-04-TXT',
  'ASSOC-05-NO-DEFAULT-OVERRIDE',
  'ASSOC-06-UNINSTALL',
];
const performance = {
  coldStartMs: Array(20).fill(100),
  hotWindowMs: Array(30).fill(80),
  coldStartP90Ms: 100,
  hotWindowP90Ms: 80,
};

afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

describe('installed-app evidence v2', () => {
  it('accepts a tracked two-commit fixture with conserved counters and p90 samples', () => {
    const fixture = makeFixture();
    expect(
      verifyInstalledAppEvidenceV2({
        rootDir: fixture.root,
        releaseId: fixture.releaseId,
        installerPath: fixture.installerPath,
      }),
    ).toMatchObject({ candidateCommit: fixture.candidate, evidenceCommit: fixture.evidence });
  }, 20_000);

  it('fails closed when a tracked raw output is altered after evidence commit', () => {
    const fixture = makeFixture();
    writeFileSync(
      path.join(fixture.root, fixture.base, 'attachments', 'GUI-01-NOTE-LIFECYCLE.json'),
      'tampered',
    );
    expect(() =>
      verifyInstalledAppEvidenceV2({
        rootDir: fixture.root,
        releaseId: fixture.releaseId,
        installerPath: fixture.installerPath,
      }),
    ).toThrow(/hash or byte count|execution output changed|working tree/u);
  }, 20_000);

  it('rejects a skipped case even when raw, transcript, and hashes agree', () => {
    const fixture = makeFixture({
      mutateCaseResults(results) {
        results[0].counters = { executed: 1, passed: 0, failed: 0, skipped: 1 };
      },
    });
    expect(() =>
      verifyInstalledAppEvidenceV2({
        rootDir: fixture.root,
        releaseId: fixture.releaseId,
        installerPath: fixture.installerPath,
      }),
    ).toThrow(/skipped, failed, or zero execution/u);
  }, 20_000);

  it('rejects self-attested PASS fields even when the evidence is tracked and hash-bound', () => {
    const fixture = makeFixture({
      mutateCaseResults(results) {
        results[0].status = 'PASS';
      },
    });
    expect(() =>
      verifyInstalledAppEvidenceV2({
        rootDir: fixture.root,
        releaseId: fixture.releaseId,
        installerPath: fixture.installerPath,
      }),
    ).toThrow(/strict schema|self-attested/u);
  }, 20_000);

  it('accepts preview evidence only when both audits, full tests, and production inventories pass', () => {
    const fixture = makeFixture();
    expect(
      verifyPreviewReleaseGate({
        rootDir: fixture.root,
        releaseId: fixture.releaseId,
        evidencePath: `${fixture.base}/preview-gate.json`,
        installerPath: fixture.installerPath,
        bundlePath: fixture.bundlePath,
      }),
    ).toMatchObject({ releaseId: fixture.releaseId, reasonCode: 'development-oracle-ceiling' });
  }, 20_000);

  it('rejects an inventory that omits a file from the downloaded candidate bundle', () => {
    const fixture = makeFixture();
    writeFileSync(path.join(fixture.bundlePath, 'public-v2s.worker.js'), 'worker');
    expect(() =>
      verifyPreviewReleaseGate({
        rootDir: fixture.root,
        releaseId: fixture.releaseId,
        evidencePath: `${fixture.base}/preview-gate.json`,
        installerPath: fixture.installerPath,
        bundlePath: fixture.bundlePath,
      }),
    ).toThrow(/Public V2S|does not exactly match/u);
  }, 20_000);
});

function makeFixture(options = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'jotluck-installed-evidence-'));
  roots.push(root);
  git(root, ['init']);
  git(root, ['config', 'user.email', 'fixture@example.test']);
  git(root, ['config', 'user.name', 'Fixture']);
  writeJson(root, 'spec/release/required-cases/installed-app-v2.json', {
    schema: 'jotluck.installed-app.required-cases.v2',
    version: 2,
    cases,
    performance: {
      coldStartSamples: 20,
      hotWindowSamples: 30,
      coldStartP90MaxMs: 2000,
      hotWindowP90MaxMs: 1000,
    },
  });
  writeJson(root, 'package.json', { version: '0.1.0-preview' });
  writeFile(root, 'README.md', 'fixture');
  writeFile(
    root,
    'scripts/corpus/autocomplete-v2s-architecture-stop.json',
    readFileSync(
      path.join(projectRoot, 'scripts/corpus/autocomplete-v2s-architecture-stop.json'),
      'utf8',
    ),
  );
  git(root, ['add', '.']);
  git(root, ['commit', '-m', 'candidate']);
  const candidate = git(root, ['rev-parse', 'HEAD']).trim();
  const releaseId = 'preview-fixture';
  const base = `release-evidence/installed-app/v2/${releaseId}`;
  const now = '2026-07-25T00:00:00Z';
  const caseResults = cases.map((caseId) => ({
    schema: 'jotluck.installed-app.case-execution.v2',
    caseId,
    command: `run ${caseId}`,
    startedAt: now,
    finishedAt: now,
    exitCode: 0,
    counters: { executed: 1, passed: 1, failed: 0, skipped: 0 },
    artifacts: [],
  }));
  options.mutateCaseResults?.(caseResults);
  const outputs = caseResults.map((result) => {
    const outputPath = `${base}/attachments/${result.caseId}.json`;
    writeCanonical(root, outputPath, result);
    return {
      ...metadata(root, outputPath),
      caseId: result.caseId,
      kind: 'case-result',
    };
  });
  const installerPath = `${root}-JotLuck_0.1.0-preview_x64-setup.exe`;
  writeFileSync(installerPath, 'installer');
  roots.push(installerPath);
  const raw = {
    schema: 'jotluck.installed-app.raw-report.v2',
    releaseId,
    candidateCommit: candidate,
    runner: { id: 'independent-fixture', role: 'independent-readonly' },
    startedAt: now,
    finishedAt: now,
    executions: caseResults.map((result, index) => ({
      caseId: result.caseId,
      command: result.command,
      startedAt: result.startedAt,
      finishedAt: result.finishedAt,
      exitCode: result.exitCode,
      counters: result.counters,
      output: artifactRef(outputs[index]),
    })),
    performance,
  };
  writeCanonical(root, `${base}/raw-report.json`, raw);
  const transcript = {
    schema: 'jotluck.installed-app.transcript.v2',
    releaseId,
    candidateCommit: candidate,
    rawReportSha256: hash(canonical(raw)),
    transcriber: { id: 'independent-fixture', role: 'independent-readonly' },
    executions: raw.executions.map((entry) => ({
      caseId: entry.caseId,
      counters: entry.counters,
      outputSha256: entry.output.sha256,
    })),
    performance,
  };
  writeCanonical(root, `${base}/transcript.json`, transcript);
  const productionDependencyAudit = commandEvidence(
    root,
    base,
    'audit-production',
    'pnpm audit --prod --audit-level high',
    now,
  );
  const fullDependencyAudit = commandEvidence(
    root,
    base,
    'audit-all',
    'pnpm audit --audit-level high',
    now,
  );
  const fullTest = commandEvidence(root, base, 'test-all', 'pnpm test', now);
  const productionBuild = commandEvidence(root, base, 'build-production', 'pnpm build', now);
  const bundlePath = `${root}-bundle`;
  mkdirSync(path.join(bundlePath, 'assets'), { recursive: true });
  writeFileSync(path.join(bundlePath, 'assets', 'index.js'), 'bundle js\n');
  roots.push(bundlePath);
  const bundleBytes = readFileSync(path.join(bundlePath, 'assets', 'index.js'));
  const bundleInventoryPath = `${base}/release/bundle-inventory.json`;
  const installerInventoryPath = `${base}/release/installer-inventory.json`;
  writeCanonical(root, bundleInventoryPath, {
    schema: 'jotluck.production-file-inventory.v1',
    candidateCommit: candidate,
    scope: 'bundle',
    entries: [
      {
        path: 'assets/index.js',
        bytes: bundleBytes.byteLength,
        sha256: hash(bundleBytes),
      },
    ],
  });
  writeCanonical(root, installerInventoryPath, {
    schema: 'jotluck.production-file-inventory.v1',
    candidateCommit: candidate,
    scope: 'installer',
    entries: [
      {
        path: installerMetadata(installerPath).fileName,
        bytes: installerMetadata(installerPath).bytes,
        sha256: installerMetadata(installerPath).sha256,
      },
    ],
  });
  writeCanonical(root, `${base}/preview-gate.json`, {
    schema: 'jotluck.preview-release-gate.v2',
    releaseId,
    productionDependencyAudit,
    fullDependencyAudit,
    fullTest,
    productionBuild: {
      execution: productionBuild,
      bundleInventory: metadata(root, bundleInventoryPath),
      installerInventory: metadata(root, installerInventoryPath),
    },
  });
  git(root, ['add', '.']);
  git(root, ['commit', '-m', 'evidence']);
  const manifest = {
    schema: 'jotluck.installed-app.manifest.v2',
    releaseId,
    candidate: { commit: candidate, version: '0.1.0-preview' },
    ci: { provider: 'github-actions', runId: '123', artifactId: '456' },
    installer: installerMetadata(installerPath),
    catalog: metadata(root, 'spec/release/required-cases/installed-app-v2.json'),
    rawReport: metadata(root, `${base}/raw-report.json`),
    transcript: metadata(root, `${base}/transcript.json`),
    attachments: outputs,
    requiredCasesTree: {
      commit: candidate,
      gitTreeSha: git(root, ['rev-parse', `${candidate}:spec/release/required-cases`]).trim(),
    },
    performance,
  };
  writeCanonical(root, `${base}/manifest.json`, manifest);
  git(root, ['add', '.']);
  git(root, ['commit', '-m', 'manifest']);
  return {
    root,
    releaseId,
    base,
    candidate,
    installerPath,
    bundlePath,
    evidence: git(root, ['rev-parse', 'HEAD']).trim(),
  };
}

function writeJson(root, relative, value) {
  writeFile(root, relative, `${JSON.stringify(value)}\n`);
}
function writeCanonical(root, relative, value) {
  writeFile(root, relative, canonical(value));
}
function writeFile(root, relative, value) {
  const target = path.join(root, relative);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, value);
}
function metadata(root, relative) {
  const bytes = readFile(root, relative);
  return { path: relative, bytes: bytes.byteLength, sha256: hash(bytes) };
}
function artifactRef(value) {
  return { path: value.path, bytes: value.bytes, sha256: value.sha256 };
}
function installerMetadata(absolutePath) {
  const bytes = readFileSync(absolutePath);
  return {
    fileName: path.basename(absolutePath),
    bytes: bytes.byteLength,
    sha256: hash(bytes),
  };
}
function commandEvidence(root, base, id, command, now) {
  const outputPath = `${base}/release/${id}.json`;
  const counters = { executed: 1, passed: 1, failed: 0, skipped: 0 };
  writeCanonical(root, outputPath, {
    schema: 'jotluck.release-command-execution.v2',
    command,
    startedAt: now,
    finishedAt: now,
    exitCode: 0,
    counters,
  });
  return {
    command,
    startedAt: now,
    finishedAt: now,
    exitCode: 0,
    counters,
    output: metadata(root, outputPath),
  };
}
function readFile(root, relative) {
  return readFileSync(path.join(root, relative));
}
function hash(value) {
  return createHash('sha256').update(value).digest('hex');
}
function canonical(value) {
  return JSON.stringify(sort(value));
}
function sort(value) {
  if (Array.isArray(value)) return value.map(sort);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sort(value[key])]),
    );
  return value;
}
function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' });
}
