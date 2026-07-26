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
const requiredCatalog = JSON.parse(
  readFileSync(path.join(projectRoot, 'spec/release/required-cases/installed-app-v2.json'), 'utf8'),
);
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
        executionEvidencePath: fixture.executionEvidencePath,
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
        executionEvidencePath: fixture.executionEvidencePath,
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
        executionEvidencePath: fixture.executionEvidencePath,
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
        executionEvidencePath: fixture.executionEvidencePath,
      }),
    ).toThrow(/strict schema|self-attested/u);
  }, 20_000);

  it('rejects the former artifacts-empty self-report fixture', () => {
    const fixture = makeFixture({
      mutateCaseResults(results) {
        results[0].artifacts = [];
      },
    });
    expect(() =>
      verifyInstalledAppEvidenceV2({
        rootDir: fixture.root,
        releaseId: fixture.releaseId,
        installerPath: fixture.installerPath,
        executionEvidencePath: fixture.executionEvidencePath,
      }),
    ).toThrow(/artifacts are invalid|required artifact/u);
  }, 20_000);

  it('rejects a non-empty fake JSON file used as the execution log', () => {
    const fixture = makeFixture({
      mutateArtifactFiles(root, base, results, attachments) {
        const artifactPath = `${base}/attachments/GUI-01-NOTE-LIFECYCLE/execution-log.ndjson`;
        writeFile(root, artifactPath, '{}\n');
        const changed = metadata(root, artifactPath);
        Object.assign(
          results[0].artifacts.find((artifact) => artifact.kind === 'execution-log'),
          changed,
        );
        Object.assign(
          attachments.find((artifact) => artifact.path === artifactPath),
          artifactRef(changed),
        );
      },
    });
    expect(() =>
      verifyInstalledAppEvidenceV2({
        rootDir: fixture.root,
        releaseId: fixture.releaseId,
        installerPath: fixture.installerPath,
        executionEvidencePath: fixture.executionEvidencePath,
      }),
    ).toThrow(/execution log/u);
  }, 20_000);

  it('rejects a downloaded execution artifact with missing or additional files', () => {
    const fixture = makeFixture();
    writeFileSync(path.join(fixture.executionEvidencePath, 'unexpected.txt'), 'unexpected');
    expect(() =>
      verifyInstalledAppEvidenceV2({
        rootDir: fixture.root,
        releaseId: fixture.releaseId,
        installerPath: fixture.installerPath,
        executionEvidencePath: fixture.executionEvidencePath,
      }),
    ).toThrow(/does not exactly match/u);
  }, 20_000);

  it('accepts structural preview evidence only with exact production inventories', () => {
    const fixture = makeFixture();
    expect(
      verifyPreviewReleaseGate({
        rootDir: fixture.root,
        releaseId: fixture.releaseId,
        evidencePath: `${fixture.base}/preview-gate.json`,
        installerPath: fixture.installerPath,
        bundlePath: fixture.bundlePath,
        executionEvidencePath: fixture.executionEvidencePath,
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
        executionEvidencePath: fixture.executionEvidencePath,
      }),
    ).toThrow(/Public V2S|does not exactly match/u);
  }, 20_000);
});

function makeFixture(options = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'jotluck-installed-evidence-'));
  roots.push(root);
  git(root, ['init']);
  git(root, ['config', 'core.autocrlf', 'false']);
  git(root, ['config', 'user.email', 'fixture@example.test']);
  git(root, ['config', 'user.name', 'Fixture']);
  writeJson(root, 'spec/release/required-cases/installed-app-v2.json', requiredCatalog);
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
  const runner = {
    id: 'github-runner-fixture',
    role: 'independent-readonly',
    provider: 'github-actions',
    repository: 'fixture/jotluck',
    runId: '123',
    runAttempt: 1,
    headSha: candidate,
  };
  const artifactAttachments = [];
  const caseResults = requiredCatalog.cases.map((requiredCase) => {
    const counters = { executed: 1, passed: 1, failed: 0, skipped: 0 };
    const observedArtifacts = requiredCase.requiredArtifactKinds
      .filter((kind) => kind !== 'execution-log')
      .map((kind) => {
        const artifactPath = `${base}/attachments/${requiredCase.id}/${kind}.txt`;
        writeFile(root, artifactPath, `${requiredCase.id}:${kind}\n`);
        const artifact = { kind, ...metadata(root, artifactPath) };
        artifactAttachments.push({
          ...artifactRef(artifact),
          caseId: requiredCase.id,
          kind: 'case-artifact',
        });
        return artifact;
      });
    const executionLogPath = `${base}/attachments/${requiredCase.id}/execution-log.ndjson`;
    writeFile(
      root,
      executionLogPath,
      makeExecutionLog(requiredCase, runner, observedArtifacts, counters, now),
    );
    const executionLog = { kind: 'execution-log', ...metadata(root, executionLogPath) };
    artifactAttachments.push({
      ...artifactRef(executionLog),
      caseId: requiredCase.id,
      kind: 'case-artifact',
    });
    return {
      schema: 'jotluck.installed-app.case-execution.v2',
      caseId: requiredCase.id,
      adapter: requiredCase.adapter,
      producer: runner,
      startedAt: now,
      finishedAt: now,
      exitCode: 0,
      counters,
      artifacts: [executionLog, ...observedArtifacts],
    };
  });
  options.mutateCaseResults?.(caseResults);
  options.mutateArtifactFiles?.(root, base, caseResults, artifactAttachments);
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
    runner,
    startedAt: now,
    finishedAt: now,
    executions: caseResults.map((result, index) => ({
      caseId: result.caseId,
      adapter: result.adapter,
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
    transcriber: { id: runner.id, role: 'independent-readonly' },
    executions: raw.executions.map((entry) => ({
      caseId: entry.caseId,
      adapter: entry.adapter,
      counters: entry.counters,
      outputSha256: entry.output.sha256,
    })),
    performance,
  };
  writeCanonical(root, `${base}/transcript.json`, transcript);
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
    productionBuild: {
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
    ci: {
      provider: 'github-actions',
      repository: 'fixture/jotluck',
      runId: '123',
      runAttempt: 1,
      candidateArtifact: {
        id: '456',
        name: 'jotluck-windows-candidate',
        digest: `sha256:${'1'.repeat(64)}`,
      },
      evidenceArtifact: {
        id: '789',
        name: `jotluck-installed-app-evidence-v2-${releaseId}`,
        digest: `sha256:${'2'.repeat(64)}`,
      },
    },
    installer: installerMetadata(installerPath),
    catalog: metadata(root, 'spec/release/required-cases/installed-app-v2.json'),
    rawReport: metadata(root, `${base}/raw-report.json`),
    transcript: metadata(root, `${base}/transcript.json`),
    attachments: [...outputs, ...artifactAttachments],
    requiredCasesTree: {
      commit: candidate,
      gitTreeSha: git(root, ['rev-parse', `${candidate}:spec/release/required-cases`]).trim(),
    },
    performance,
  };
  writeCanonical(root, `${base}/manifest.json`, manifest);
  git(root, ['add', '.']);
  git(root, ['commit', '-m', 'manifest']);
  const executionEvidencePath = `${root}-execution-evidence`;
  roots.push(executionEvidencePath);
  for (const artifact of [manifest.rawReport, ...manifest.attachments]) {
    const relative = artifact.path.slice(base.length + 1);
    const target = path.join(executionEvidencePath, ...relative.split('/'));
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, readFile(root, artifact.path));
  }
  return {
    root,
    releaseId,
    base,
    candidate,
    installerPath,
    bundlePath,
    executionEvidencePath,
    evidence: git(root, ['rev-parse', 'HEAD']).trim(),
  };
}

function writeJson(root, relative, value) {
  writeFile(root, relative, `${JSON.stringify(value)}\n`);
}
function makeExecutionLog(requiredCase, runner, artifacts, counters, now) {
  const common = {
    schema: 'jotluck.installed-app.execution-event.v2',
    timestamp: now,
    caseId: requiredCase.id,
    adapter: requiredCase.adapter,
  };
  const events = [
    { ...common, sequence: 1, event: 'adapter-start', producer: runner },
    ...artifacts.map((artifact, index) => ({
      ...common,
      sequence: index + 2,
      event: 'artifact-observed',
      artifactKind: artifact.kind,
      path: artifact.path,
      bytes: artifact.bytes,
      sha256: artifact.sha256,
    })),
    {
      ...common,
      sequence: artifacts.length + 2,
      event: 'adapter-finish',
      exitCode: 0,
      counters,
    },
  ];
  return `${events.map((event) => canonical(event)).join('\n')}\n`;
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
