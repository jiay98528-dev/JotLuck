import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { __test, verifyInstalledAppEvidenceV2 } from './verify-installed-app-evidence-v2.mjs';
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
  advisories: [],
};
const candidateApplicationContent = Buffer.from('candidate-application', 'utf8');
const candidateApplicationIdentity = {
  bytes: candidateApplicationContent.byteLength,
  sha256: hash(candidateApplicationContent),
};
const shard = process.env.JOTLUCK_INSTALLED_EVIDENCE_TEST_SHARD;
const shardIt = (expected) => (shard === expected ? it : () => undefined);

afterEach(() =>
  roots.splice(0).forEach((root) =>
    rmSync(root, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 100,
    }),
  ),
);

describe('installed-app evidence v2', () => {
  shardIt('1')(
    'accepts a tracked two-commit fixture with conserved counters and p90 samples',
    () => {
      const fixture = makeFixture();
      expect(
        verifyInstalledAppEvidenceV2({
          rootDir: fixture.root,
          releaseId: fixture.releaseId,
          installerPath: fixture.installerPath,
          candidateApplicationPath: fixture.candidateApplicationPath,
          executionEvidencePath: fixture.executionEvidencePath,
        }),
      ).toMatchObject({ candidateCommit: fixture.candidate, evidenceCommit: fixture.evidence });
    },
    20_000,
  );

  shardIt('1')(
    'rejects a document Save As result whose source revision changed',
    () => {
      const fixture = makeFixture({
        mutateArtifactFiles(root, base, results, attachments) {
          const caseId = 'DOC-01-SAVE-AS-MARKDOWN';
          rewriteCaseArtifact(
            root,
            base,
            results,
            attachments,
            caseId,
            'document-save-readback',
            (content) => {
              const value = JSON.parse(content);
              value.source.after.sha256 = 'f'.repeat(64);
              return `${JSON.stringify(value)}\n`;
            },
          );
        },
      });
      expect(() =>
        verifyInstalledAppEvidenceV2({
          rootDir: fixture.root,
          releaseId: fixture.releaseId,
          installerPath: fixture.installerPath,
          candidateApplicationPath: fixture.candidateApplicationPath,
          executionEvidencePath: fixture.executionEvidencePath,
        }),
      ).toThrow(/changed its source/u);
    },
    20_000,
  );

  shardIt('2')(
    'fails closed when a tracked raw output is altered after evidence commit',
    () => {
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
          candidateApplicationPath: fixture.candidateApplicationPath,
          executionEvidencePath: fixture.executionEvidencePath,
        }),
      ).toThrow(/hash or byte count|execution output changed|working tree/u);
    },
    20_000,
  );

  shardIt('2')(
    'requires an absolute non-symlink candidate application with exact bytes',
    () => {
      const fixture = makeFixture();
      const verify = (candidateApplicationPath) =>
        verifyInstalledAppEvidenceV2({
          rootDir: fixture.root,
          releaseId: fixture.releaseId,
          installerPath: fixture.installerPath,
          candidateApplicationPath,
          executionEvidencePath: fixture.executionEvidencePath,
        });
      expect(() => verify(undefined)).toThrow(/candidate application path is required/u);
      expect(() => verify('jotluck.exe')).toThrow(/path must be absolute/u);
      expect(() => verify(path.join(fixture.root, 'missing', 'jotluck.exe'))).toThrow(
        /path does not exist/u,
      );
      expect(() => verify(fixture.installerPath)).toThrow(/file name does not match/u);

      const linkTarget = `${fixture.root}-candidate-link-target`;
      const linkRoot = `${fixture.root}-candidate-link`;
      const linkPath = path.join(linkRoot, 'jotluck.exe');
      mkdirSync(linkTarget, { recursive: true });
      mkdirSync(linkRoot, { recursive: true });
      symlinkSync(linkTarget, linkPath, 'junction');
      roots.push(linkTarget, linkRoot);
      expect(() => verify(linkPath)).toThrow(/non-empty regular file/u);

      const parentTarget = `${fixture.root}-candidate-parent-target`;
      const parentLink = `${fixture.root}-candidate-parent-link`;
      mkdirSync(parentTarget, { recursive: true });
      writeFileSync(path.join(parentTarget, 'jotluck.exe'), candidateApplicationContent);
      symlinkSync(parentTarget, parentLink, 'junction');
      roots.push(parentTarget, parentLink);
      expect(() => verify(path.join(parentLink, 'jotluck.exe'))).toThrow(/reparse point/u);

      writeFileSync(fixture.candidateApplicationPath, 'tampered-application');
      expect(() => verify(fixture.candidateApplicationPath)).toThrow(/hash or byte count/u);
    },
    20_000,
  );

  shardIt('1')(
    'rejects a skipped case even when raw, transcript, and hashes agree',
    () => {
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
          candidateApplicationPath: fixture.candidateApplicationPath,
          executionEvidencePath: fixture.executionEvidencePath,
        }),
      ).toThrow(/skipped, failed, or zero execution/u);
    },
    20_000,
  );

  shardIt('2')(
    'rejects self-attested PASS fields even when the evidence is tracked and hash-bound',
    () => {
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
          candidateApplicationPath: fixture.candidateApplicationPath,
          executionEvidencePath: fixture.executionEvidencePath,
        }),
      ).toThrow(/strict schema|self-attested/u);
    },
    20_000,
  );

  shardIt('1')(
    'rejects the former artifacts-empty self-report fixture',
    () => {
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
          candidateApplicationPath: fixture.candidateApplicationPath,
          executionEvidencePath: fixture.executionEvidencePath,
        }),
      ).toThrow(/artifacts are invalid|required artifact/u);
    },
    20_000,
  );

  shardIt('2')(
    'rejects a non-empty fake JSON file used as the execution log',
    () => {
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
          candidateApplicationPath: fixture.candidateApplicationPath,
          executionEvidencePath: fixture.executionEvidencePath,
        }),
      ).toThrow(/execution log/u);
    },
    20_000,
  );

  shardIt('1')('rejects an adapter narration relabeled as a WebDriver trace', () => {
    const execution = { caseId: 'GUI-01-NOTE-LIFECYCLE', adapter: 'gui-note-lifecycle' };
    expect(() =>
      __test.validateWebDriverEvents(
        [
          {
            schema: 'jotluck.installed-app.adapter-action-event.v1',
            sequence: 1,
            timestamp: '2026-07-25T00:00:00Z',
            ...execution,
            action: 'click',
            details: { selector: 'button' },
          },
        ],
        execution,
      ),
    ).toThrow(/WebDriver event identity/u);
  });

  shardIt('1')('rejects a WebDriver command trace without a successful session cleanup', () => {
    const definition = requiredCatalog.cases.find((entry) => entry.id === 'GUI-01-NOTE-LIFECYCLE');
    const execution = { caseId: definition.id, adapter: definition.adapter };
    const events = makeObservedArtifactFixture(
      definition,
      'webdriver-trace',
      '2026-07-25T00:00:00Z',
    )
      .content.trim()
      .split(/\r?\n/u)
      .map((line) => JSON.parse(line))
      .filter((event) => event.event !== 'webdriver-session-deleted');
    expect(() => __test.validateWebDriverEvents(events, execution)).toThrow(
      /lifecycle is incomplete/u,
    );
  });

  shardIt('1')('rejects the obsolete synthetic newSession trace protocol', () => {
    const execution = { caseId: 'GUI-04-LIVE-PREVIEW', adapter: 'gui-live-preview' };
    const common = {
      schema: 'jotluck.installed-app.webdriver-event.v2',
      timestamp: '2026-07-25T00:00:00Z',
      ...execution,
    };
    const events = [
      {
        ...common,
        sequence: 1,
        event: 'tauri-driver-ready',
        processId: 41,
        command: 'tauri-driver',
      },
      {
        ...common,
        sequence: 2,
        event: 'webdriver-command-start',
        correlationId: 'wd-1',
        commandName: 'getTitle',
        args: [],
      },
      {
        ...common,
        sequence: 3,
        event: 'webdriver-command-complete',
        correlationId: 'wd-1',
        commandName: 'getTitle',
        args: [],
        result: 'unrelated',
        error: null,
      },
      {
        ...common,
        sequence: 4,
        event: 'webdriver-session-created',
        sessionId: 'declared',
        capabilities: {},
      },
      { ...common, sequence: 5, event: 'webdriver-session-deleted', sessionId: 'declared' },
    ];
    expect(() => __test.validateWebDriverEvents(events, execution)).toThrow(
      /WebDriver event identity/u,
    );
  });

  shardIt('1')('rejects unrelated commands inside an otherwise closed v3 session', () => {
    const definition = requiredCatalog.cases.find((entry) => entry.id === 'GUI-04-LIVE-PREVIEW');
    const execution = { caseId: definition.id, adapter: definition.adapter };
    const events = makeObservedArtifactFixture(
      definition,
      'webdriver-trace',
      '2026-07-25T00:00:00Z',
    )
      .content.trim()
      .split(/\r?\n/u)
      .map((line) => JSON.parse(line))
      .map((event) =>
        event.commandName && event.commandName !== 'deleteSession'
          ? { ...event, commandName: 'getTitle' }
          : event,
      );
    expect(() => __test.validateWebDriverEvents(events, execution)).toThrow(
      /case commands are not closed in one session/u,
    );

    const wrapperEvents = makeObservedArtifactFixture(
      definition,
      'webdriver-trace',
      '2026-07-25T00:00:00Z',
    )
      .content.trim()
      .split(/\r?\n/u)
      .map((line) => JSON.parse(line));
    const wrapperStart = wrapperEvents.find(
      (event) => event.event === 'webdriver-command-start' && event.commandName !== 'deleteSession',
    );
    const wrapperComplete = wrapperEvents.find(
      (event) =>
        event.event === 'webdriver-command-complete' &&
        event.correlationId === wrapperStart.correlationId,
    );
    wrapperStart.commandName = 'click';
    wrapperComplete.commandName = 'click';
    expect(() => __test.validateWebDriverEvents(wrapperEvents, execution)).toThrow(
      /command start is invalid/u,
    );
  });

  shardIt('1')('rejects a forged handshake and correlation argument drift', () => {
    const definition = requiredCatalog.cases.find((entry) => entry.id === 'GUI-04-LIVE-PREVIEW');
    const execution = { caseId: definition.id, adapter: definition.adapter };
    const makeEvents = () =>
      makeObservedArtifactFixture(definition, 'webdriver-trace', '2026-07-25T00:00:00Z')
        .content.trim()
        .split(/\r?\n/u)
        .map((line) => JSON.parse(line));

    const forgedHandshake = makeEvents();
    forgedHandshake.find(
      (event) => event.event === 'webdriver-session-handshake-complete',
    ).capabilities = {};
    expect(() => __test.validateWebDriverEvents(forgedHandshake, execution)).toThrow(
      /session handshake is invalid/u,
    );

    const correlationDrift = makeEvents();
    const commandComplete = correlationDrift.find(
      (event) =>
        event.event === 'webdriver-command-complete' && event.commandName !== 'deleteSession',
    );
    commandComplete.args = ['different-command-arguments'];
    expect(() => __test.validateWebDriverEvents(correlationDrift, execution)).toThrow(
      /command completion is invalid/u,
    );
  });

  shardIt('1')('rejects commands appended after the real deleteSession command', () => {
    const definition = requiredCatalog.cases.find((entry) => entry.id === 'GUI-04-LIVE-PREVIEW');
    const execution = { caseId: definition.id, adapter: definition.adapter };
    const events = makeObservedArtifactFixture(
      definition,
      'webdriver-trace',
      '2026-07-25T00:00:00Z',
    )
      .content.trim()
      .split(/\r?\n/u)
      .map((line) => JSON.parse(line));
    const deleted = events.pop();
    const common = {
      schema: 'jotluck.installed-app.webdriver-event.v3',
      timestamp: '2026-07-25T00:00:00Z',
      caseId: definition.id,
      adapter: definition.adapter,
      attemptId: deleted.attemptId,
      sessionId: deleted.sessionId,
      correlationId: 'after-delete',
      commandName: 'getTitle',
      args: [],
    };
    events.push(
      { ...common, sequence: events.length + 1, event: 'webdriver-command-start' },
      {
        ...common,
        sequence: events.length + 2,
        event: 'webdriver-command-complete',
        result: 'unreachable',
        error: null,
      },
      { ...deleted, sequence: events.length + 3 },
    );
    expect(() => __test.validateWebDriverEvents(events, execution)).toThrow(
      /command start is invalid/u,
    );
  });

  shardIt('1')('rejects session ID drift and commands split across attempts', () => {
    const definition = requiredCatalog.cases.find((entry) => entry.id === 'GUI-04-LIVE-PREVIEW');
    const execution = { caseId: definition.id, adapter: definition.adapter };
    const base = makeObservedArtifactFixture(definition, 'webdriver-trace', '2026-07-25T00:00:00Z')
      .content.trim()
      .split(/\r?\n/u)
      .map((line) => JSON.parse(line));
    const drifted = base.map((event) => ({ ...event }));
    drifted.find((event) => event.event === 'webdriver-command-start').sessionId = 'other-session';
    expect(() => __test.validateWebDriverEvents(drifted, execution)).toThrow(
      /command start is invalid/u,
    );

    const attemptA = base.filter((event) => event.commandName !== 'takeScreenshot');
    const attemptB = base
      .filter((event) => !['elementClick', 'keys'].includes(event.commandName))
      .map((event) => ({
        ...event,
        attemptId: `${event.attemptId}-b`,
        ...(event.sessionId ? { sessionId: `${event.sessionId}-b` } : {}),
        ...(event.correlationId ? { correlationId: `${event.correlationId}-b` } : {}),
      }));
    const split = [...attemptA, ...attemptB].map((event, index) => ({
      ...event,
      sequence: index + 1,
    }));
    expect(() => __test.validateWebDriverEvents(split, execution)).toThrow(
      /case commands are not closed in one session/u,
    );
  });

  shardIt('1')(
    'rejects association evidence that bypasses ShellExecuteEx or omits quoted percent-one',
    () => {
      const execution = { caseId: 'ASSOC-01-MD', adapter: 'association-md' };
      const registry = associationRegistry('.md');
      registry.openCommand = 'C:\\Program Files\\JotLuck\\JotLuck.exe';
      registry.progIdOpenCommand = registry.openCommand;
      expect(() =>
        __test.validateAssociationObjects(
          registry,
          associationLaunch('.md'),
          execution,
          candidateApplicationFixture(),
        ),
      ).toThrow(/registry command is not exact/u);
    },
  );

  shardIt('1')('binds each association case to its extension and exact packaged executable', () => {
    const execution = { caseId: 'ASSOC-02-MARKDOWN', adapter: 'association-markdown' };
    const registry = associationRegistry('.markdown');
    const launch = associationLaunch('.md');
    expect(() =>
      __test.validateAssociationObjects(registry, launch, execution, candidateApplicationFixture()),
    ).toThrow(/Shell observation is invalid/u);
    const correctLaunch = associationLaunch('.markdown');
    correctLaunch.application.packaged.sha256 = 'b'.repeat(64);
    expect(() =>
      __test.validateAssociationObjects(
        registry,
        correctLaunch,
        execution,
        candidateApplicationFixture(),
      ),
    ).toThrow(/Shell observation is invalid/u);
    correctLaunch.application.installed.sha256 = 'b'.repeat(64);
    expect(() =>
      __test.validateAssociationObjects(
        registry,
        correctLaunch,
        execution,
        candidateApplicationFixture(),
      ),
    ).toThrow(/Shell observation is invalid/u);
  });

  shardIt('1')('rejects association readback, marker, and UIA executable tampering', () => {
    const execution = { caseId: 'ASSOC-01-MD', adapter: 'association-md' };
    const registry = associationRegistry('.md');
    const launch = associationLaunch('.md');
    launch.target.after.contentUtf8 = '# different\n';
    expect(() =>
      __test.validateAssociationObjects(registry, launch, execution, candidateApplicationFixture()),
    ).toThrow(/Shell observation is invalid/u);

    const wrongProcess = associationLaunch('.md');
    wrongProcess.processObserved.process.ExecutablePath = 'C:\\other\\evil.exe';
    expect(() =>
      __test.validateAssociationObjects(
        registry,
        wrongProcess,
        execution,
        candidateApplicationFixture(),
      ),
    ).toThrow(/Shell observation is invalid/u);
  });

  shardIt('1')('rejects incomplete or internally inconsistent ASSOC observations', () => {
    const execution = { caseId: 'ASSOC-01-MD', adapter: 'association-md' };
    const registry = associationRegistry('.md');
    const mutations = [
      (launch) => delete launch.target.before,
      (launch) => {
        launch.target.before.sha256 = 'e'.repeat(64);
      },
      (launch) => {
        launch.target.markerSha256 = 'e'.repeat(64);
      },
      (launch) => {
        launch.target.path = 'Z:\\does-not-exist\\space file.txt';
      },
      (launch) => {
        launch.processObserved.process.Id += 1;
      },
      (launch) => {
        launch.processObserved.process.MainWindowTitle = 'unrelated window';
      },
      (launch) => {
        launch.processObserved.process.matchedText = 'unrelated body';
      },
      (launch) => {
        launch.target.untrusted = true;
      },
    ];
    for (const mutate of mutations) {
      const launch = associationLaunch('.md');
      mutate(launch);
      expect(() =>
        __test.validateAssociationObjects(
          registry,
          launch,
          execution,
          candidateApplicationFixture(),
        ),
      ).toThrow();
    }
  });

  shardIt('1')('rejects cold-start samples without a zero-process boundary', () => {
    const lifecycle = JSON.parse(
      makeObservedArtifactFixture(
        { id: 'RF-10', adapter: 'rf-installed-windows-journey' },
        'process-lifecycle',
        '2026-07-25T00:00:00Z',
      ).content,
    );
    lifecycle.samples[0].after = [
      { processId: 99, executablePath: 'C:\\Program Files\\JotLuck\\JotLuck.exe' },
    ];
    expect(() => __test.validateColdStartLifecycleValue(lifecycle)).toThrow(
      /zero-process boundary/u,
    );
  });

  shardIt('1')(
    'rejects RF-10 hot-window samples without restored windows or final process cleanup',
    () => {
      const lifecycle = JSON.parse(
        makeObservedArtifactFixture(
          { id: 'RF-10', adapter: 'rf-installed-windows-journey' },
          'process-lifecycle',
          '2026-07-25T00:00:00Z',
        ).content,
      );
      lifecycle.hotWindowSamples[0].after = 2;
      expect(() => __test.validateColdStartLifecycleValue(lifecycle)).toThrow(/restored boundary/u);
      lifecycle.hotWindowSamples[0].after = 1;
      lifecycle.finalProcesses.push({ processId: 99 });
      expect(() => __test.validateColdStartLifecycleValue(lifecycle)).toThrow(
        /process lifecycle is invalid/u,
      );
    },
  );

  shardIt('1')('rejects RF-10 lifecycle evidence bound to an unrelated executable', () => {
    const lifecycle = JSON.parse(
      makeObservedArtifactFixture(
        { id: 'RF-10', adapter: 'rf-installed-windows-journey' },
        'process-lifecycle',
        '2026-07-25T00:00:00Z',
      ).content,
    );
    lifecycle.application.packaged.path = 'C:\\totally-unrelated\\evil.exe';
    expect(() =>
      __test.validateColdStartLifecycleValue(lifecycle, 20, 30, candidateApplicationFixture(), {
        applicationPaths: ['c:\\program files\\jotluck\\jotluck.exe'],
      }),
    ).toThrow(/process lifecycle is invalid/u);
  });

  shardIt('1')('rejects missing, changed, or extended RF-10 executable identities', () => {
    const makeLifecycle = () =>
      JSON.parse(
        makeObservedArtifactFixture(
          { id: 'RF-10', adapter: 'rf-installed-windows-journey' },
          'process-lifecycle',
          '2026-07-25T00:00:00Z',
        ).content,
      );
    const mutations = [
      (lifecycle) => delete lifecycle.application.installed,
      (lifecycle) => {
        lifecycle.application.packaged.sha256 = 'e'.repeat(64);
      },
      (lifecycle) => {
        lifecycle.application.untrusted = true;
      },
    ];
    for (const mutate of mutations) {
      const lifecycle = makeLifecycle();
      mutate(lifecycle);
      expect(() =>
        __test.validateColdStartLifecycleValue(lifecycle, 20, 30, candidateApplicationFixture(), {
          applicationPaths: ['c:\\program files\\jotluck\\jotluck.exe'],
        }),
      ).toThrow();
    }
  });

  shardIt('1')(
    'rejects a downloaded execution artifact with missing or additional files',
    () => {
      const fixture = makeFixture();
      writeFileSync(path.join(fixture.executionEvidencePath, 'unexpected.txt'), 'unexpected');
      expect(() =>
        verifyInstalledAppEvidenceV2({
          rootDir: fixture.root,
          releaseId: fixture.releaseId,
          installerPath: fixture.installerPath,
          candidateApplicationPath: fixture.candidateApplicationPath,
          executionEvidencePath: fixture.executionEvidencePath,
        }),
      ).toThrow(/does not exactly match/u);
    },
    20_000,
  );

  shardIt('2')(
    'binds every WebDriver session to the installed application observed by RF-10',
    () => {
      const fixture = makeFixture({
        mutateArtifactFiles(root, base, results, attachments) {
          rewriteCaseArtifact(
            root,
            base,
            results,
            attachments,
            'GUI-01-NOTE-LIFECYCLE',
            'webdriver-trace',
            (content) =>
              `${content
                .trim()
                .split(/\r?\n/u)
                .map((line) => JSON.parse(line))
                .map((event) =>
                  event.event === 'webdriver-session-handshake-complete'
                    ? {
                        ...event,
                        requested: {
                          ...event.requested,
                          application: 'C:\\Other\\JotLuck.exe',
                        },
                      }
                    : event,
                )
                .map(canonical)
                .join('\n')}\n`,
          );
        },
      });
      expect(() =>
        verifyInstalledAppEvidenceV2({
          rootDir: fixture.root,
          releaseId: fixture.releaseId,
          installerPath: fixture.installerPath,
          candidateApplicationPath: fixture.candidateApplicationPath,
          executionEvidencePath: fixture.executionEvidencePath,
        }),
      ).toThrow(/WebDriver sessions are not bound/u);
    },
    20_000,
  );

  shardIt('2')(
    'accepts structural preview evidence only with exact production inventories',
    () => {
      const fixture = makeFixture();
      expect(
        verifyPreviewReleaseGate({
          rootDir: fixture.root,
          releaseId: fixture.releaseId,
          evidencePath: `${fixture.base}/preview-gate.json`,
          installerPath: fixture.installerPath,
          candidateApplicationPath: fixture.candidateApplicationPath,
          bundlePath: fixture.bundlePath,
          executionEvidencePath: fixture.executionEvidencePath,
        }),
      ).toMatchObject({
        status: 'pass',
        releaseId: fixture.releaseId,
        reasonCode: 'development-oracle-ceiling',
        warnings: [],
      });
    },
    20_000,
  );

  shardIt('1')(
    'downgrades reproducible performance reference misses to non-blocking warnings',
    () => {
      const fixture = makeFixture({
        performance: {
          coldStartMs: Array(20).fill(2100),
          hotWindowMs: Array(30).fill(1100),
          coldStartP90Ms: 2100,
          hotWindowP90Ms: 1100,
          advisories: [
            { code: 'PERF-COLD-START-P90', actualMs: 2100, referenceMs: 2000 },
            { code: 'PERF-HOT-WINDOW-P90', actualMs: 1100, referenceMs: 1000 },
          ],
        },
      });
      const result = verifyPreviewReleaseGate({
        rootDir: fixture.root,
        releaseId: fixture.releaseId,
        evidencePath: `${fixture.base}/preview-gate.json`,
        installerPath: fixture.installerPath,
        candidateApplicationPath: fixture.candidateApplicationPath,
        bundlePath: fixture.bundlePath,
        executionEvidencePath: fixture.executionEvidencePath,
      });
      expect(result.status).toBe('pass-with-warnings');
      expect(result.warnings.map((warning) => warning.code)).toEqual([
        'PERF-COLD-START-P90',
        'PERF-HOT-WINDOW-P90',
      ]);
    },
    20_000,
  );

  shardIt('2')(
    'rejects missing samples and forged performance advisories',
    () => {
      const missing = makeFixture({
        performance: {
          ...performance,
          coldStartMs: Array(19).fill(100),
        },
      });
      expect(() =>
        verifyInstalledAppEvidenceV2({
          rootDir: missing.root,
          releaseId: missing.releaseId,
          installerPath: missing.installerPath,
          candidateApplicationPath: missing.candidateApplicationPath,
          executionEvidencePath: missing.executionEvidencePath,
        }),
      ).toThrow(/exactly 20/u);

      const forged = makeFixture({
        performance: {
          ...performance,
          advisories: [{ code: 'PERF-COLD-START-P90', actualMs: 100, referenceMs: 2000 }],
        },
      });
      expect(() =>
        verifyInstalledAppEvidenceV2({
          rootDir: forged.root,
          releaseId: forged.releaseId,
          installerPath: forged.installerPath,
          candidateApplicationPath: forged.candidateApplicationPath,
          executionEvidencePath: forged.executionEvidencePath,
        }),
      ).toThrow(/advisories are not reproducible/u);
    },
    30_000,
  );

  shardIt('1')(
    'rejects an inventory that omits a file from the downloaded candidate bundle',
    () => {
      const fixture = makeFixture();
      writeFileSync(path.join(fixture.bundlePath, 'public-v2s.worker.js'), 'worker');
      expect(() =>
        verifyPreviewReleaseGate({
          rootDir: fixture.root,
          releaseId: fixture.releaseId,
          evidencePath: `${fixture.base}/preview-gate.json`,
          installerPath: fixture.installerPath,
          candidateApplicationPath: fixture.candidateApplicationPath,
          bundlePath: fixture.bundlePath,
          executionEvidencePath: fixture.executionEvidencePath,
        }),
      ).toThrow(/Public V2S|does not exactly match/u);
    },
    20_000,
  );
});

function makeFixture(options = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'jotluck-installed-evidence-'));
  roots.push(root);
  git(root, ['init']);
  git(root, ['config', 'gc.auto', '0']);
  git(root, ['config', 'maintenance.auto', 'false']);
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
        const fixture = makeObservedArtifactFixture(requiredCase, kind, now);
        const artifactPath = `${base}/attachments/${requiredCase.id}/${kind}.${fixture.extension}`;
        writeFile(root, artifactPath, fixture.content);
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
  const candidateApplicationRoot = `${root}-candidate`;
  const candidateApplicationPath = path.join(candidateApplicationRoot, 'jotluck.exe');
  mkdirSync(candidateApplicationRoot, { recursive: true });
  writeFileSync(candidateApplicationPath, candidateApplicationContent);
  roots.push(candidateApplicationRoot);
  const fixturePerformance = options.performance ?? performance;
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
    performance: fixturePerformance,
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
    performance: fixturePerformance,
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
        sizeInBytes: 100,
      },
      evidenceArtifact: {
        id: '789',
        name: `jotluck-installed-app-evidence-v2-${releaseId}`,
        digest: `sha256:${'2'.repeat(64)}`,
        sizeInBytes: 200,
      },
      materialization: {
        job: 'Installed-app Evidence Materialization',
        step: 'Materialize managed evidence bundle',
      },
    },
    installer: installerMetadata(installerPath),
    application: { fileName: 'jotluck.exe', ...candidateApplicationIdentity },
    catalog: metadata(root, 'spec/release/required-cases/installed-app-v2.json'),
    rawReport: metadata(root, `${base}/raw-report.json`),
    transcript: metadata(root, `${base}/transcript.json`),
    attachments: [...outputs, ...artifactAttachments],
    requiredCasesTree: {
      commit: candidate,
      gitTreeSha: git(root, ['rev-parse', `${candidate}:spec/release/required-cases`]).trim(),
    },
    performance: fixturePerformance,
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
    candidateApplicationPath,
    bundlePath,
    executionEvidencePath,
    evidence: git(root, ['rev-parse', 'HEAD']).trim(),
  };
}

function makeObservedArtifactFixture(requiredCase, kind, now) {
  if (kind === 'adapter-action-log') {
    return {
      extension: 'ndjson',
      content: `${canonical({
        schema: 'jotluck.installed-app.adapter-action-event.v1',
        sequence: 1,
        timestamp: now,
        caseId: requiredCase.id,
        adapter: requiredCase.adapter,
        action: 'fixture-action-complete',
        details: {},
      })}\n`,
    };
  }
  if (kind === 'webdriver-trace') {
    const attemptId = `attempt-${requiredCase.id}`;
    const sessionId = `session-${requiredCase.id}`;
    const common = {
      schema: 'jotluck.installed-app.webdriver-event.v3',
      timestamp: now,
      caseId: requiredCase.id,
      adapter: requiredCase.adapter,
    };
    const events = [
      {
        ...common,
        sequence: 1,
        event: 'tauri-driver-ready',
        attemptId,
        processId: 41,
        driver: {
          path: 'C:\\tools\\tauri-driver.exe',
          bytes: 100,
          sha256: 'c'.repeat(64),
        },
        nativeDriver: {
          path: 'C:\\tools\\msedgedriver.exe',
          bytes: 200,
          sha256: 'd'.repeat(64),
        },
      },
      {
        ...common,
        sequence: 2,
        event: 'webdriver-session-handshake-complete',
        attemptId,
        sessionId,
        capabilities: { browserName: 'webview2' },
        requested: {
          application: 'C:\\Program Files\\JotLuck\\JotLuck.exe',
          args: ['C:\\evidence\\case.md'],
        },
      },
    ];
    for (const commandName of __test.webdriverCaseCommands[requiredCase.id] ?? []) {
      const correlationId = `wd-${events.length}`;
      events.push({
        ...common,
        sequence: events.length + 1,
        event: 'webdriver-command-start',
        attemptId,
        sessionId,
        correlationId,
        commandName,
        args: [],
      });
      events.push({
        ...common,
        sequence: events.length + 1,
        event: 'webdriver-command-complete',
        attemptId,
        sessionId,
        correlationId,
        commandName,
        args: [],
        result: null,
        error: null,
      });
    }
    const deleteCorrelation = `wd-${events.length}`;
    events.push(
      {
        ...common,
        sequence: events.length + 1,
        event: 'webdriver-command-start',
        attemptId,
        sessionId,
        correlationId: deleteCorrelation,
        commandName: 'deleteSession',
        args: [],
      },
      {
        ...common,
        sequence: events.length + 2,
        event: 'webdriver-command-complete',
        attemptId,
        sessionId,
        correlationId: deleteCorrelation,
        commandName: 'deleteSession',
        args: [],
        result: null,
        error: null,
      },
      {
        ...common,
        sequence: events.length + 3,
        event: 'webdriver-session-deleted',
        attemptId,
        sessionId,
      },
    );
    return { extension: 'ndjson', content: `${events.map(canonical).join('\n')}\n` };
  }
  if (requiredCase.id === 'DOC-01-SAVE-AS-MARKDOWN' && kind === 'native-dialog-observation') {
    return {
      extension: 'json',
      content: `${JSON.stringify({
        schema: 'jotluck.installed-app.native-save-dialog.v1',
        processId: 73,
        dialogTitle: 'Save Markdown copy',
        dialogAutomationId: '',
        fileNameAutomationId: '1001',
        saveButtonAutomationId: '1',
        saveButtonName: 'Save',
        targetFileName: 'document-save-copy.md',
        usedValuePattern: true,
        usedInvokePattern: true,
      })}\n`,
    };
  }
  if (requiredCase.id === 'DOC-01-SAVE-AS-MARKDOWN' && kind === 'document-save-readback') {
    const marker = 'document-save-fixture-marker';
    const sourceBytes = Buffer.from('fixture-docx-bytes');
    const markdownContent = `# ${marker}\n\n![image](document-save-copy.assets/image.png)\n`;
    const markdownBytes = Buffer.from(markdownContent, 'utf8');
    const assetBytes = Buffer.from('fixture-png-bytes');
    const source = { bytes: sourceBytes.byteLength, sha256: hash(sourceBytes) };
    return {
      extension: 'json',
      content: `${JSON.stringify({
        schema: 'jotluck.installed-app.document-save-readback.v1',
        marker,
        source: {
          fileName: 'document-save-source.docx',
          before: source,
          after: source,
          unchanged: true,
        },
        markdown: {
          fileName: 'document-save-copy.md',
          bytes: markdownBytes.byteLength,
          sha256: hash(markdownBytes),
          contentUtf8: markdownContent,
        },
        assets: {
          directoryName: 'document-save-copy.assets',
          entries: [
            {
              fileName: 'image.png',
              bytes: assetBytes.byteLength,
              sha256: hash(assetBytes),
            },
          ],
        },
        transition: {
          sessionMode: 'external-edit',
          editorContainsMarker: true,
        },
      })}\n`,
    };
  }
  if (requiredCase.id.startsWith('ASSOC-0') && kind === 'registry-snapshot') {
    const extension = associationExtension(requiredCase.id);
    return {
      extension: 'json',
      content: `${JSON.stringify(associationRegistry(extension))}\n`,
    };
  }
  if (requiredCase.id.startsWith('ASSOC-0') && kind === 'launch-trace') {
    const extension = associationExtension(requiredCase.id);
    return {
      extension: 'json',
      content: `${JSON.stringify(associationLaunch(extension))}\n`,
    };
  }
  if (requiredCase.id === 'RF-10' && kind === 'process-lifecycle') {
    return {
      extension: 'json',
      content: `${JSON.stringify({
        schema: 'jotluck.installed-app.process-lifecycle.v2',
        application: {
          installed: {
            path: 'C:\\Program Files\\JotLuck\\JotLuck.exe',
            ...candidateApplicationIdentity,
          },
          packaged: {
            path: 'C:\\candidate\\jotluck.exe',
            ...candidateApplicationIdentity,
          },
        },
        samples: Array.from({ length: 20 }, (_, index) => ({
          sample: index + 1,
          startedAt: now,
          finishedAt: now,
          before: [],
          after: [],
        })),
        hotWindowSamples: Array.from({ length: 30 }, (_, index) => ({
          sample: index + 1,
          before: 1,
          opened: 2,
          after: 1,
        })),
        finalProcesses: [],
      })}\n`,
    };
  }
  return { extension: 'txt', content: `${requiredCase.id}:${kind}\n` };
}

function associationExtension(caseId) {
  return {
    'ASSOC-01-MD': '.md',
    'ASSOC-02-MARKDOWN': '.markdown',
    'ASSOC-03-MDX': '.mdx',
    'ASSOC-04-TXT': '.txt',
    'ASSOC-05-DOCX': '.docx',
    'ASSOC-06-PDF': '.pdf',
    'ASSOC-07-XLSX': '.xlsx',
    'ASSOC-08-XLS': '.xls',
  }[caseId];
}

function associationRegistry(extension) {
  const progId = ['.docx', '.pdf', '.xlsx', '.xls'].includes(extension)
    ? 'JotLuck.DocumentImport'
    : 'JotLuck.Note';
  return {
    extension,
    openWithListExists: false,
    defaultProgId: null,
    userChoiceProgId: null,
    userChoiceLatestProgId: null,
    mruList: null,
    openWithSlots: {},
    openWithExecutables: [],
    classOpenWithProgIds: [progId],
    explorerOpenWithProgIds: [progId],
    supportedType: true,
    openCommand: '"C:\\Program Files\\JotLuck\\JotLuck.exe" "%1"',
    progIdOpenCommand: '"C:\\Program Files\\JotLuck\\JotLuck.exe" "%1"',
  };
}

function candidateApplicationFixture() {
  return {
    path: 'C:\\candidate\\jotluck.exe',
    ...candidateApplicationIdentity,
  };
}

function associationLaunch(extension) {
  const marker = `association-marker-${extension.slice(1)}`;
  const contentUtf8 = extension === '.txt' ? marker : `# ${marker}\n`;
  const content = Buffer.from(contentUtf8, 'utf8');
  const binaryTarget = ['.docx', '.pdf', '.xlsx', '.xls'].includes(extension);
  const progId = binaryTarget ? 'JotLuck.DocumentImport' : 'JotLuck.Note';
  const targetPath = `C:\\runner temp\\association evidence${extension}`;
  return {
    schema: 'jotluck.installed-app.association-launch.v2',
    launchedAt: '2026-07-25T00:00:00Z',
    target: {
      path: targetPath,
      extension,
      marker,
      markerSha256: hash(Buffer.from(marker, 'utf8')),
      before: { bytes: content.byteLength, sha256: hash(content) },
      after: binaryTarget
        ? { bytes: content.byteLength, sha256: hash(content) }
        : { bytes: content.byteLength, sha256: hash(content), contentUtf8 },
    },
    shell: { method: 'ShellExecuteExW', className: progId, processId: 42 },
    processObserved: {
      target: targetPath,
      process: {
        Id: 42,
        ProcessName: 'JotLuck',
        MainWindowTitle: `JotLuck - association evidence${extension}`,
        ExecutablePath: 'C:\\Program Files\\JotLuck\\JotLuck.exe',
        matchedText: contentUtf8,
        observationSource: 'Windows-UIAutomation',
      },
    },
    application: {
      installed: {
        path: 'C:\\Program Files\\JotLuck\\JotLuck.exe',
        ...candidateApplicationIdentity,
      },
      packaged: {
        path: 'C:\\candidate\\jotluck.exe',
        ...candidateApplicationIdentity,
      },
    },
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
function rewriteCaseArtifact(root, base, results, attachments, caseId, kind, transform) {
  const result = results.find((entry) => entry.caseId === caseId);
  const artifact = result.artifacts.find((entry) => entry.kind === kind);
  writeFile(root, artifact.path, transform(readFile(root, artifact.path).toString('utf8')));
  const changed = metadata(root, artifact.path);
  Object.assign(artifact, changed);
  Object.assign(
    attachments.find((entry) => entry.caseId === caseId && entry.path === artifact.path),
    artifactRef(changed),
  );

  const executionLog = result.artifacts.find((entry) => entry.kind === 'execution-log');
  const events = readFile(root, executionLog.path)
    .toString('utf8')
    .trim()
    .split(/\r?\n/u)
    .map((line) => JSON.parse(line))
    .map((event) =>
      event.event === 'artifact-observed' && event.artifactKind === kind
        ? { ...event, bytes: changed.bytes, sha256: changed.sha256 }
        : event,
    );
  writeFile(root, executionLog.path, `${events.map(canonical).join('\n')}\n`);
  const changedExecutionLog = metadata(root, executionLog.path);
  Object.assign(executionLog, changedExecutionLog);
  Object.assign(
    attachments.find((entry) => entry.caseId === caseId && entry.path === executionLog.path),
    artifactRef(changedExecutionLog),
  );
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
