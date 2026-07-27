import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { materializeInstalledAppEvidenceV2 } from './materialize-installed-app-evidence-v2.mjs';

const roots = [];
const releaseId = 'preview-materializer-fixture';
const projectRoot = path.resolve(import.meta.dirname, '../..');

afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

describe('installed-app evidence materializer', () => {
  it('copies the trusted execution artifact exactly and emits only a structural diagnostic', () => {
    const fixture = makeFixture();
    const result = materializeInstalledAppEvidenceV2(fixture.input);
    expect(result).toMatchObject({ status: 'structural-diagnostic', releaseId });
    const base = path.join(fixture.output, 'release-evidence', 'installed-app', 'v2', releaseId);
    expect(JSON.parse(readFileSync(path.join(base, 'manifest.json'), 'utf8'))).toMatchObject({
      candidate: { commit: fixture.commit },
      ci: { candidateArtifact: { sizeInBytes: 1024 } },
      application: { fileName: 'jotluck.exe' },
    });
    expect(readFileSync(path.join(base, 'raw-report.json'))).toEqual(
      readFileSync(path.join(fixture.execution, 'raw-report.json')),
    );
  });

  it.each([
    [
      'wrong candidate SHA',
      (fixture) =>
        mutateJson(fixture.provenance, (value) => ({ ...value, headSha: 'b'.repeat(40) })),
    ],
    [
      'extra execution file',
      (fixture) => writeFileSync(path.join(fixture.execution, 'unexpected.txt'), 'extra'),
    ],
    [
      'changed execution file',
      (fixture) =>
        writeFileSync(
          path.join(fixture.execution, 'attachments', 'GUI-01-NOTE-LIFECYCLE.json'),
          '{}',
        ),
    ],
    [
      'duplicate candidate installer',
      (fixture) => writeFileSync(path.join(fixture.candidate, 'duplicate-setup.exe'), 'duplicate'),
    ],
    [
      'path traversal in raw execution metadata',
      (fixture) =>
        mutateJson(path.join(fixture.execution, 'raw-report.json'), (value) => {
          value.executions[0].output.path = `${managed('attachments')}/../outside.json`;
          return value;
        }),
    ],
  ])('fails closed for %s', (_label, mutate) => {
    const fixture = makeFixture();
    mutate(fixture);
    expect(() => materializeInstalledAppEvidenceV2(fixture.input)).toThrow();
  });

  it('refuses to overwrite an existing output directory', () => {
    const fixture = makeFixture();
    mkdirSync(fixture.output, { recursive: true });
    expect(() => materializeInstalledAppEvidenceV2(fixture.input)).toThrow(/already exists/u);
  });

  it('rejects symbolic links in candidate artifacts', () => {
    const fixture = makeFixture();
    const external = temp('jotluck-materializer-link-target-');
    symlinkSync(external, path.join(fixture.candidate, 'linked-directory'), 'junction');
    expect(() => materializeInstalledAppEvidenceV2(fixture.input)).toThrow(/symbolic link/u);
  });
});

function makeFixture() {
  const root = temp('jotluck-materializer-repo-');
  const candidate = temp('jotluck-materializer-candidate-');
  const execution = temp('jotluck-materializer-execution-');
  const output = path.join(temp('jotluck-materializer-parent-'), 'managed');
  rmSync(output, { recursive: true, force: true });
  const catalog = JSON.parse(
    readFileSync(
      path.join(projectRoot, 'spec/release/required-cases/installed-app-v2.json'),
      'utf8',
    ),
  );
  writeJson(root, 'spec/release/required-cases/installed-app-v2.json', catalog);
  writeJson(root, 'package.json', { version: '0.1.0-preview' });
  git(root, ['init']);
  git(root, ['config', 'user.email', 'fixture@example.test']);
  git(root, ['config', 'user.name', 'Fixture']);
  git(root, ['add', '.']);
  git(root, ['commit', '-m', 'candidate']);
  const commit = git(root, ['rev-parse', 'HEAD']).trim();
  mkdirSync(path.join(candidate, 'web', 'dist', 'assets'), { recursive: true });
  writeFileSync(path.join(candidate, 'JotLuck_0.1.0-preview_x64-setup.exe'), 'installer');
  writeFileSync(path.join(candidate, 'jotluck.exe'), 'application');
  writeFileSync(path.join(candidate, 'web', 'dist', 'index.html'), '<main>JotLuck</main>');
  writeFileSync(path.join(candidate, 'web', 'dist', 'assets', 'index.js'), 'bundle');
  const now = '2026-07-27T00:00:00Z';
  const runner = {
    id: 'fixture/jotluck/123/1',
    role: 'independent-readonly',
    provider: 'github-actions',
    repository: 'fixture/jotluck',
    runId: '123',
    runAttempt: 1,
    headSha: commit,
  };
  const executions = catalog.cases.map((definition) => {
    const observed = definition.requiredArtifactKinds.map((kind) => {
      const extension = kind === 'execution-log' ? 'ndjson' : 'txt';
      const relative = `attachments/${definition.id}/${kind}.${extension}`;
      writeFile(execution, relative, `${definition.id}:${kind}\n`);
      return { kind, path: managed(relative), ...metadata(path.join(execution, relative)) };
    });
    const result = {
      schema: 'jotluck.installed-app.case-execution.v2',
      caseId: definition.id,
      adapter: definition.adapter,
      producer: runner,
      startedAt: now,
      finishedAt: now,
      exitCode: 0,
      counters: { executed: 1, passed: 1, failed: 0, skipped: 0 },
      artifacts: observed,
    };
    const outputRelative = `attachments/${definition.id}.json`;
    writeCanonical(execution, outputRelative, result);
    return {
      caseId: definition.id,
      adapter: definition.adapter,
      startedAt: now,
      finishedAt: now,
      exitCode: 0,
      counters: result.counters,
      output: { path: managed(outputRelative), ...metadata(path.join(execution, outputRelative)) },
    };
  });
  const performance = {
    coldStartMs: Array(20).fill(100),
    hotWindowMs: Array(30).fill(80),
    coldStartP90Ms: 100,
    hotWindowP90Ms: 80,
    advisories: [],
  };
  writeCanonical(execution, 'raw-report.json', {
    schema: 'jotluck.installed-app.raw-report.v2',
    releaseId,
    candidateCommit: commit,
    runner,
    startedAt: now,
    finishedAt: now,
    executions,
    performance,
  });
  const provenance = path.join(root, 'provenance.json');
  writeFileSync(
    provenance,
    JSON.stringify({
      schema: 'jotluck.github-actions.capture-provenance.v1',
      repository: 'fixture/jotluck',
      workflow: '.github/workflows/ci.yml',
      event: 'workflow_dispatch',
      branch: 'main',
      headSha: commit,
      runId: '123',
      runAttempt: 1,
      candidateArtifact: {
        id: '456',
        name: 'jotluck-windows-candidate',
        digest: `sha256:${'1'.repeat(64)}`,
        sizeInBytes: 1024,
      },
      evidenceArtifact: {
        id: '789',
        name: `jotluck-installed-app-evidence-v2-${releaseId}`,
        digest: `sha256:${'2'.repeat(64)}`,
        sizeInBytes: 2048,
      },
      materialization: {
        job: 'Installed-app Evidence Materialization',
        step: 'Materialize managed evidence bundle',
      },
    }),
  );
  return {
    root,
    candidate,
    execution,
    output,
    provenance,
    commit,
    input: {
      rootDir: root,
      releaseId,
      candidateRoot: candidate,
      executionRoot: execution,
      provenancePath: provenance,
      outputRoot: output,
    },
  };
}

function managed(relative) {
  return `release-evidence/installed-app/v2/${releaseId}/${relative}`;
}
function temp(prefix) {
  const value = mkdtempSync(path.join(os.tmpdir(), prefix));
  roots.push(value);
  return value;
}
function writeJson(root, relative, value) {
  writeFile(root, relative, `${JSON.stringify(value)}\n`);
}
function writeCanonical(root, relative, value) {
  writeFile(root, relative, JSON.stringify(sortValue(value)));
}
function writeFile(root, relative, value) {
  const target = path.join(root, ...relative.split('/'));
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, value);
}
function metadata(file) {
  const value = readFileSync(file);
  return { bytes: value.byteLength, sha256: createHash('sha256').update(value).digest('hex') };
}
function mutateJson(file, mutate) {
  writeFileSync(file, JSON.stringify(mutate(JSON.parse(readFileSync(file, 'utf8')))));
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
function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' });
}
