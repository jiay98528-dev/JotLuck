#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validatePerformanceEvidence } from './installed-app-performance.mjs';
import { WEBDRIVER_PROTOCOL_COMMANDS } from './installed-app-webdriver-protocol.mjs';

export const RAW_SCHEMA = 'jotluck.installed-app.raw-report.v2';
export const TRANSCRIPT_SCHEMA = 'jotluck.installed-app.transcript.v2';
export const MANIFEST_SCHEMA = 'jotluck.installed-app.manifest.v2';
export const CASE_EXECUTION_SCHEMA = 'jotluck.installed-app.case-execution.v2';
export const EVIDENCE_ROOT = 'release-evidence/installed-app/v2';
const REQUIRED_CASES_PATH = 'spec/release/required-cases/installed-app-v2.json';
const REQUIRED_CASES_TREE = 'spec/release/required-cases';

const SHA256 = /^[a-f0-9]{64}$/u;
const COMMIT = /^[a-f0-9]{40}$/u;
const ISO_TIME = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/u;
const trackedFilesByRoot = new Map();
const ASSOCIATION_EXTENSIONS = Object.freeze({
  'ASSOC-01-MD': '.md',
  'ASSOC-02-MARKDOWN': '.markdown',
  'ASSOC-03-MDX': '.mdx',
  'ASSOC-04-TXT': '.txt',
});
const WEBDRIVER_CASE_COMMANDS = Object.freeze({
  'GUI-01-NOTE-LIFECYCLE': ['refresh', 'elementClear', 'elementSendKeys', 'performActions'],
  'GUI-02-FILE-DRAWER': ['findElements', 'elementClick', 'elementSendKeys'],
  'GUI-03-SEARCH-EDIT': ['getElementText', 'elementClick', 'elementSendKeys'],
  'GUI-04-LIVE-PREVIEW': ['elementClick', 'performActions', 'takeScreenshot'],
  'GUI-05-SETTINGS-PERSISTENCE': ['getElementAttribute', 'elementClick', 'refresh'],
  'GUI-06-EXPORT-CONTENT': ['elementClick'],
  'GUI-07-IMAGE-ASSET': ['executeAsyncScript', 'executeScript'],
  'RF-01': ['getTitle', 'executeScript'],
  'RF-02': ['getWindowHandles', 'switchToWindow', 'getTitle'],
  'RF-03': ['getWindowHandles'],
  'RF-04': ['elementClick', 'elementSendKeys'],
  'RF-05': ['elementClick', 'refresh', 'getElementText'],
  'RF-06': ['getWindowHandles', 'switchToWindow', 'elementSendKeys'],
  'RF-07': ['getWindowHandles', 'closeWindow'],
  'RF-08': ['executeScript'],
  'RF-10': ['getWindowHandles', 'switchToWindow', 'closeWindow'],
  'VER-01': ['elementClick', 'getElementText'],
});

export const __test = Object.freeze({
  validateWebDriverEvents,
  validateAssociationObjects,
  validateColdStartLifecycleValue,
  webdriverCaseCommands: WEBDRIVER_CASE_COMMANDS,
});

export function verifyInstalledAppEvidenceV2({
  rootDir,
  releaseId,
  installerPath,
  candidateApplicationPath,
  executionEvidencePath,
}) {
  const root = realpathSync(path.resolve(rootDir));
  assertSafeSegment(releaseId, 'release id');
  const required = readJson(root, REQUIRED_CASES_PATH);
  if (
    required.schema !== 'jotluck.installed-app.required-cases.v2' ||
    !Array.isArray(required.cases)
  ) {
    throw new Error('required installed-app case catalog is invalid');
  }
  assertExactKeys(required, ['schema', 'version', 'cases', 'performance'], 'required-case catalog');
  if (
    required.version !== 2 ||
    required.cases.length === 0 ||
    required.cases.some(
      (entry) =>
        !entry ||
        typeof entry !== 'object' ||
        Array.isArray(entry) ||
        canonicalJson(Object.keys(entry).sort()) !==
          canonicalJson(['adapter', 'id', 'requiredArtifactKinds']) ||
        !nonEmpty(entry.id) ||
        !nonEmpty(entry.adapter) ||
        !Array.isArray(entry.requiredArtifactKinds) ||
        entry.requiredArtifactKinds.length < 2 ||
        entry.requiredArtifactKinds.some((kind) => !nonEmpty(kind)) ||
        !entry.requiredArtifactKinds.includes('execution-log') ||
        new Set(entry.requiredArtifactKinds).size !== entry.requiredArtifactKinds.length,
    ) ||
    new Set(required.cases.map((entry) => entry.id)).size !== required.cases.length ||
    new Set(required.cases.map((entry) => entry.adapter)).size !== required.cases.length
  ) {
    throw new Error('required installed-app case catalog contains invalid or duplicate cases');
  }
  assertObject(required.performance, 'required performance');
  assertExactKeys(
    required.performance,
    [
      'coldStartSamples',
      'hotWindowSamples',
      'coldStartP90ReferenceMs',
      'hotWindowP90ReferenceMs',
      'requiredArtifactKind',
    ],
    'required performance',
  );
  if (
    ![
      required.performance.coldStartSamples,
      required.performance.hotWindowSamples,
      required.performance.coldStartP90ReferenceMs,
      required.performance.hotWindowP90ReferenceMs,
    ].every((value) => Number.isInteger(value) && value > 0) ||
    !nonEmpty(required.performance.requiredArtifactKind)
  ) {
    throw new Error('required performance references are invalid');
  }
  const base = `${EVIDENCE_ROOT}/${releaseId}`;
  const manifest = readJson(root, `${base}/manifest.json`);
  const raw = readJson(root, `${base}/raw-report.json`);
  const transcript = readJson(root, `${base}/transcript.json`);

  validateManifest(manifest, releaseId, base);
  verifyCandidateVersion(root, manifest.candidate);
  validateRaw(raw, required, releaseId);
  validateTranscript(transcript, raw, required, releaseId);
  if (
    raw.candidateCommit !== manifest.candidate.commit ||
    transcript.candidateCommit !== manifest.candidate.commit
  ) {
    throw new Error('manifest, raw report, and transcript candidate commits do not match');
  }
  verifyRunnerBinding(raw.runner, manifest);
  if (raw.runner.id !== transcript.transcriber.id) {
    throw new Error('raw report and transcript must be produced by the same readonly actor');
  }
  rejectSelfAttestedConclusion(raw, 'raw report');
  rejectSelfAttestedConclusion(transcript, 'transcript');
  verifyRequiredCasesTree(root, manifest);
  verifyInstallerArtifact(installerPath, manifest.installer);
  const candidateApplication = verifyApplicationArtifact(
    candidateApplicationPath,
    manifest.application,
  );
  const evidenceCommit = verifyGitLineage(root, manifest.candidate.commit, base);
  if (git(root, ['status', '--porcelain']).trim())
    throw new Error('evidence working tree must be clean');

  const records = [
    { label: 'manifest', path: `${base}/manifest.json`, expected: null },
    { label: 'raw report', path: manifest.rawReport.path, expected: manifest.rawReport },
    { label: 'transcript', path: manifest.transcript.path, expected: manifest.transcript },
    { label: 'catalog', path: manifest.catalog.path, expected: manifest.catalog },
    ...manifest.attachments.map((entry) => ({
      label: 'attachment',
      path: entry.path,
      expected: entry,
    })),
  ];
  const seen = new Set();
  for (const record of records) {
    if (seen.has(record.path)) throw new Error(`duplicate evidence path: ${record.path}`);
    seen.add(record.path);
    if (record.expected) verifyTrackedArtifact(root, record.expected, record.label);
    else fileMetadata(root, record.path);
  }
  if (
    sha256Json(raw) !== manifest.rawReport.sha256 ||
    sha256Json(transcript) !== manifest.transcript.sha256
  ) {
    throw new Error('manifest report hash is not the canonical JSON hash');
  }
  verifyExecutionAttachments(raw, manifest.attachments, root, base, required, candidateApplication);
  verifyExecutionArtifactSnapshot(root, base, manifest, executionEvidencePath);
  const warnings = verifyPerformance(
    raw.performance,
    transcript.performance,
    manifest.performance,
    required.performance,
  );

  return { releaseId, candidateCommit: manifest.candidate.commit, evidenceCommit, warnings };
}

function validateManifest(value, releaseId, base) {
  assertObject(value, 'manifest');
  assertExactKeys(
    value,
    [
      'schema',
      'releaseId',
      'candidate',
      'ci',
      'installer',
      'application',
      'catalog',
      'rawReport',
      'transcript',
      'attachments',
      'requiredCasesTree',
      'performance',
    ],
    'manifest',
  );
  if (value.schema !== MANIFEST_SCHEMA || value.releaseId !== releaseId)
    throw new Error('manifest schema or release id is invalid');
  assertObject(value.candidate, 'candidate binding');
  assertExactKeys(value.candidate, ['commit', 'version'], 'candidate binding');
  assertCommit(value.candidate?.commit, 'candidate commit');
  if (typeof value.candidate.version !== 'string' || !value.candidate.version)
    throw new Error('manifest candidate version is invalid');
  assertObject(value.ci, 'CI binding');
  assertExactKeys(
    value.ci,
    [
      'provider',
      'repository',
      'runId',
      'runAttempt',
      'candidateArtifact',
      'evidenceArtifact',
      'materialization',
    ],
    'CI binding',
  );
  if (
    value.ci.provider !== 'github-actions' ||
    !/^[^/]+\/[^/]+$/u.test(String(value.ci.repository)) ||
    !/^[1-9]\d*$/u.test(String(value.ci.runId)) ||
    !Number.isInteger(value.ci.runAttempt) ||
    value.ci.runAttempt <= 0
  )
    throw new Error('CI run/artifact binding is incomplete');
  assertGitHubArtifactBinding(value.ci.candidateArtifact, 'candidate artifact binding');
  assertGitHubArtifactBinding(value.ci.evidenceArtifact, 'evidence artifact binding');
  assertObject(value.ci.materialization, 'materialization binding');
  assertExactKeys(value.ci.materialization, ['job', 'step'], 'materialization binding');
  if (
    value.ci.materialization.job !== 'Installed-app Evidence Materialization' ||
    value.ci.materialization.step !== 'Materialize managed evidence bundle'
  ) {
    throw new Error('materialization job/step binding is invalid');
  }
  if (
    value.ci.candidateArtifact.name !== 'jotluck-windows-candidate' ||
    value.ci.evidenceArtifact.name !== `jotluck-installed-app-evidence-v2-${releaseId}` ||
    value.ci.candidateArtifact.id === value.ci.evidenceArtifact.id
  ) {
    throw new Error('CI artifact identity is invalid');
  }
  assertInstaller(value.installer);
  assertApplication(value.application);
  assertArtifact(value.catalog, 'catalog');
  assertArtifact(value.rawReport, 'raw report');
  assertArtifact(value.transcript, 'transcript');
  if (value.rawReport.path !== `${EVIDENCE_ROOT}/${releaseId}/raw-report.json`)
    throw new Error('raw report path is not fixed');
  if (value.transcript.path !== `${EVIDENCE_ROOT}/${releaseId}/transcript.json`)
    throw new Error('transcript path is not fixed');
  if (value.catalog.path !== REQUIRED_CASES_PATH)
    throw new Error('catalog path is not the fixed required-case catalog');
  if (!Array.isArray(value.attachments) || value.attachments.length === 0)
    throw new Error('manifest attachments are missing');
  value.attachments.forEach((entry) => {
    assertAttachment(entry);
    assertPathWithinBase(entry.path, base, 'attachment');
  });
  assertObject(value.requiredCasesTree, 'required-case tree binding');
  assertExactKeys(value.requiredCasesTree, ['commit', 'gitTreeSha'], 'required-case tree binding');
  assertCommit(value.requiredCasesTree.commit, 'required-case tree commit');
  if (!/^[a-f0-9]{40,64}$/u.test(String(value.requiredCasesTree.gitTreeSha)))
    throw new Error('required-case Git tree SHA is invalid');
  assertObject(value.performance, 'manifest performance');
}

function verifyCandidateVersion(root, candidate) {
  let packageJson;
  try {
    packageJson = JSON.parse(git(root, ['show', `${candidate.commit}:package.json`]));
  } catch {
    throw new Error('candidate package version cannot be read');
  }
  if (packageJson.version !== candidate.version)
    throw new Error('manifest candidate version does not match candidate package.json');
}

function verifyInstallerArtifact(installerPath, expected) {
  verifyCandidateFile(installerPath, expected, {
    label: 'candidate installer',
    matchesFileName: (actual, declared) => actual === declared,
  });
}

function verifyApplicationArtifact(applicationPath, expected) {
  return verifyCandidateFile(applicationPath, expected, {
    label: 'candidate application',
    matchesFileName: (actual, declared) =>
      actual.toLowerCase() === declared.toLowerCase() && declared === 'jotluck.exe',
  });
}

function verifyCandidateFile(filePath, expected, { label, matchesFileName }) {
  if (!nonEmpty(filePath)) throw new Error(`${label} path is required`);
  if (!path.isAbsolute(filePath)) throw new Error(`${label} path must be absolute`);
  const requested = path.resolve(filePath);
  let requestedInfo;
  try {
    requestedInfo = lstatSync(requested);
  } catch {
    throw new Error(`${label} path does not exist`);
  }
  if (requestedInfo.isSymbolicLink() || !requestedInfo.isFile() || requestedInfo.size <= 0) {
    throw new Error(`${label} must be a non-empty regular file`);
  }
  const absolute = realpathSync(requested);
  if (normalizeWindowsPath(absolute) !== normalizeWindowsPath(requested)) {
    throw new Error(`${label} path must not traverse a symbolic link or reparse point`);
  }
  if (!matchesFileName(path.basename(absolute), expected.fileName)) {
    throw new Error(`${label} file name does not match manifest`);
  }
  const bytes = readFileSync(absolute);
  const actual = { path: absolute, bytes: bytes.byteLength, sha256: sha256(bytes) };
  if (actual.bytes !== expected.bytes || actual.sha256 !== expected.sha256) {
    throw new Error(`${label} hash or byte count does not match manifest`);
  }
  return actual;
}

function verifyRequiredCasesTree(root, manifest) {
  if (manifest.requiredCasesTree.commit !== manifest.candidate.commit)
    throw new Error('required-case tree is not bound to the candidate commit');
  const actual = git(root, [
    'rev-parse',
    `${manifest.candidate.commit}:${REQUIRED_CASES_TREE}`,
  ]).trim();
  if (actual !== manifest.requiredCasesTree.gitTreeSha)
    throw new Error('required-case Git tree SHA does not match the candidate commit');
  const candidateCatalog = JSON.parse(
    git(root, ['show', `${manifest.candidate.commit}:${REQUIRED_CASES_PATH}`]),
  );
  const worktreeCatalog = JSON.parse(readFileSync(path.join(root, REQUIRED_CASES_PATH), 'utf8'));
  if (canonicalJson(candidateCatalog) !== canonicalJson(worktreeCatalog))
    throw new Error('required-case catalog differs from the candidate commit');
}

function validateRaw(value, required, releaseId) {
  assertObject(value, 'raw report');
  assertExactKeys(
    value,
    [
      'schema',
      'releaseId',
      'candidateCommit',
      'runner',
      'startedAt',
      'finishedAt',
      'executions',
      'performance',
    ],
    'raw report',
  );
  if (value.schema !== RAW_SCHEMA || value.releaseId !== releaseId)
    throw new Error('raw report schema or release id is invalid');
  assertCommit(value.candidateCommit, 'raw candidate commit');
  assertObject(value.runner, 'raw runner');
  assertExactKeys(
    value.runner,
    ['id', 'role', 'provider', 'repository', 'runId', 'runAttempt', 'headSha'],
    'raw runner',
  );
  if (
    value.runner.role !== 'independent-readonly' ||
    value.runner.provider !== 'github-actions' ||
    !nonEmpty(value.runner.id) ||
    !/^[^/]+\/[^/]+$/u.test(String(value.runner.repository)) ||
    !/^[1-9]\d*$/u.test(String(value.runner.runId)) ||
    !Number.isInteger(value.runner.runAttempt) ||
    value.runner.runAttempt <= 0 ||
    !COMMIT.test(String(value.runner.headSha))
  )
    throw new Error('raw runner is not independent readonly');
  if (!ISO_TIME.test(String(value.startedAt)) || !ISO_TIME.test(String(value.finishedAt)))
    throw new Error('raw report timestamps are invalid');
  if (Date.parse(value.startedAt) > Date.parse(value.finishedAt))
    throw new Error('raw report timestamps are reversed');
  validateExecutions(value.executions, required.cases, 'raw report');
  assertObject(value.performance, 'raw performance');
}

function validateTranscript(value, raw, required, releaseId) {
  assertObject(value, 'transcript');
  assertExactKeys(
    value,
    [
      'schema',
      'releaseId',
      'candidateCommit',
      'rawReportSha256',
      'transcriber',
      'executions',
      'performance',
    ],
    'transcript',
  );
  if (value.schema !== TRANSCRIPT_SCHEMA || value.releaseId !== releaseId)
    throw new Error('transcript schema or release id is invalid');
  if (value.candidateCommit !== raw.candidateCommit || value.rawReportSha256 !== sha256Json(raw))
    throw new Error('transcript is not bound to raw report');
  assertObject(value.transcriber, 'transcriber');
  assertExactKeys(value.transcriber, ['id', 'role'], 'transcriber');
  if (value.transcriber.role !== 'independent-readonly' || !nonEmpty(value.transcriber.id))
    throw new Error('transcriber is not independent readonly');
  validateExecutions(value.executions, required.cases, 'transcript');
  for (const execution of raw.executions) {
    const copy = value.executions.find((item) => item.caseId === execution.caseId);
    if (
      !copy ||
      copy.adapter !== execution.adapter ||
      canonicalJson(copy.counters) !== canonicalJson(execution.counters) ||
      copy.outputSha256 !== execution.output.sha256
    ) {
      throw new Error(`transcript does not conserve raw execution: ${execution.caseId}`);
    }
  }
}

function validateExecutions(executions, requiredCases, label) {
  if (!Array.isArray(executions) || executions.length !== requiredCases.length)
    throw new Error(`${label} execution count does not match fixed cases`);
  const actual = executions.map((item) => item?.caseId).sort();
  const expected = requiredCases.map((entry) => entry.id).sort();
  if (canonicalJson(actual) !== canonicalJson(expected))
    throw new Error(`${label} case conservation failed`);
  for (const execution of executions) {
    assertObject(execution, `${label} execution`);
    const requiredCase = requiredCases.find((entry) => entry.id === execution.caseId);
    if (!requiredCase || execution.adapter !== requiredCase.adapter) {
      throw new Error(`${label} adapter does not match fixed catalog: ${execution.caseId}`);
    }
    assertExactKeys(
      execution,
      label === 'raw report'
        ? ['caseId', 'adapter', 'startedAt', 'finishedAt', 'exitCode', 'counters', 'output']
        : ['caseId', 'adapter', 'counters', 'outputSha256'],
      `${label} execution`,
    );
    assertObject(execution.counters, `${label} counters`);
    assertExactKeys(
      execution.counters,
      ['executed', 'passed', 'failed', 'skipped'],
      `${label} counters`,
    );
    const { executed, passed, failed, skipped } = execution.counters;
    if (
      ![executed, passed, failed, skipped].every((value) => Number.isInteger(value) && value >= 0)
    )
      throw new Error(`${label} counters are invalid`);
    if (executed === 0 || passed === 0 || failed !== 0 || skipped !== 0 || executed !== passed)
      throw new Error(`${label} has skipped, failed, or zero execution: ${execution.caseId}`);
    if (label === 'raw report') {
      if (execution.exitCode !== 0)
        throw new Error(`${label} execution failed: ${execution.caseId}`);
      assertArtifact(execution.output, `${execution.caseId} output`);
      if (
        !ISO_TIME.test(String(execution.startedAt)) ||
        !ISO_TIME.test(String(execution.finishedAt))
      )
        throw new Error(`${label} execution metadata is incomplete: ${execution.caseId}`);
    } else if (!SHA256.test(String(execution.outputSha256))) {
      throw new Error(`transcript output hash is invalid: ${execution.caseId}`);
    }
  }
}

function verifyExecutionAttachments(raw, attachments, root, base, required, candidateApplication) {
  const declared = new Map(attachments.map((entry) => [entry.path, entry]));
  const referenced = new Set();
  const observationContext = {
    driver: null,
    nativeDriver: null,
    applicationPaths: new Set(),
    installedApplication: null,
  };
  for (const execution of raw.executions) {
    const requiredCase = required.cases.find((entry) => entry.id === execution.caseId);
    if (!requiredCase) throw new Error(`case is not in the fixed catalog: ${execution.caseId}`);
    const attached = declared.get(execution.output.path);
    if (
      !attached ||
      attached.kind !== 'case-result' ||
      attached.caseId !== execution.caseId ||
      !sameArtifact(attached, execution.output)
    )
      throw new Error(`execution output is not manifest-bound: ${execution.caseId}`);
    assertPathWithinBase(execution.output.path, base, 'case result');
    const actual = fileMetadata(root, execution.output.path);
    if (actual.sha256 !== execution.output.sha256 || actual.bytes !== execution.output.bytes)
      throw new Error(`execution output changed: ${execution.caseId}`);
    referenced.add(execution.output.path);

    const caseResult = readJson(root, execution.output.path);
    validateCaseResult(
      caseResult,
      execution,
      raw.runner,
      requiredCase,
      required.performance,
      candidateApplication,
      observationContext,
      root,
    );
    rejectSelfAttestedConclusion(caseResult, `case result ${execution.caseId}`);
    for (const artifact of caseResult.artifacts) {
      const bound = declared.get(artifact.path);
      if (
        !bound ||
        bound.kind !== 'case-artifact' ||
        bound.caseId !== execution.caseId ||
        !sameArtifact(bound, artifact)
      ) {
        throw new Error(`case artifact is not manifest-bound: ${execution.caseId}`);
      }
      assertPathWithinBase(artifact.path, base, 'case artifact');
      verifyTrackedArtifact(root, artifact, `case artifact ${execution.caseId}`);
      referenced.add(artifact.path);
    }
  }
  if (!observationContext.installedApplication) {
    throw new Error('installed application identity was not observed by ASSOC/RF-10');
  }
  const installedPath = normalizeWindowsPath(observationContext.installedApplication.path);
  if (
    observationContext.applicationPaths.size === 0 ||
    [...observationContext.applicationPaths].some(
      (applicationPath) => applicationPath !== installedPath,
    )
  ) {
    throw new Error('WebDriver sessions are not bound to the observed installed application');
  }
  if (referenced.size !== attachments.length) {
    throw new Error('manifest contains an orphan or duplicate case attachment');
  }
}

function validateCaseResult(
  value,
  execution,
  runner,
  requiredCase,
  performanceRule,
  candidateApplication,
  observationContext,
  root,
) {
  assertObject(value, `case result ${execution.caseId}`);
  assertExactKeys(
    value,
    [
      'schema',
      'caseId',
      'adapter',
      'producer',
      'startedAt',
      'finishedAt',
      'exitCode',
      'counters',
      'artifacts',
    ],
    `case result ${execution.caseId}`,
  );
  if (value.schema !== CASE_EXECUTION_SCHEMA || value.caseId !== execution.caseId)
    throw new Error(`case result identity is invalid: ${execution.caseId}`);
  if (
    value.adapter !== execution.adapter ||
    canonicalJson(value.producer) !== canonicalJson(runner) ||
    value.startedAt !== execution.startedAt ||
    value.finishedAt !== execution.finishedAt ||
    value.exitCode !== execution.exitCode ||
    canonicalJson(value.counters) !== canonicalJson(execution.counters)
  ) {
    throw new Error(`raw report does not match parsed case result: ${execution.caseId}`);
  }
  assertObject(value.counters, `case result counters ${execution.caseId}`);
  assertExactKeys(
    value.counters,
    ['executed', 'passed', 'failed', 'skipped'],
    `case result counters ${execution.caseId}`,
  );
  if (!Array.isArray(value.artifacts) || value.artifacts.length === 0)
    throw new Error(`case result artifacts are invalid: ${execution.caseId}`);
  const kinds = new Set();
  const paths = new Set();
  value.artifacts.forEach((artifact) => {
    assertCaseArtifact(artifact, `case artifact ${execution.caseId}`);
    if (kinds.has(artifact.kind) || paths.has(artifact.path)) {
      throw new Error(`case result contains duplicate artifact evidence: ${execution.caseId}`);
    }
    kinds.add(artifact.kind);
    paths.add(artifact.path);
  });
  for (const kind of requiredCase.requiredArtifactKinds) {
    if (!kinds.has(kind)) {
      throw new Error(`case result is missing required artifact ${kind}: ${execution.caseId}`);
    }
  }
  if (kinds.size !== requiredCase.requiredArtifactKinds.length) {
    throw new Error(`case result contains an undeclared artifact kind: ${execution.caseId}`);
  }
  validateExecutionLog(
    value.artifacts.find((artifact) => artifact.kind === 'execution-log'),
    value,
    execution,
    runner,
    root,
  );
  if (kinds.has('adapter-action-log')) {
    validateAdapterActionLog(
      value.artifacts.find((artifact) => artifact.kind === 'adapter-action-log'),
      execution,
      root,
    );
  }
  let webdriverObservation = null;
  if (kinds.has('webdriver-trace')) {
    webdriverObservation = validateWebDriverTrace(
      value.artifacts.find((artifact) => artifact.kind === 'webdriver-trace'),
      execution,
      root,
    );
    bindDriverObservation(observationContext, webdriverObservation, execution.caseId);
  }
  if (/^ASSOC-0[1-4]-/u.test(execution.caseId)) {
    const installedApplication = validateAssociationEvidence(
      value.artifacts,
      execution,
      candidateApplication,
      root,
    );
    bindInstalledApplication(observationContext, installedApplication, execution.caseId);
  }
  if (execution.caseId === 'RF-10') {
    const installedApplication = validateColdStartLifecycle(
      value.artifacts,
      execution,
      performanceRule.coldStartSamples,
      performanceRule.hotWindowSamples,
      candidateApplication,
      webdriverObservation,
      root,
    );
    bindInstalledApplication(observationContext, installedApplication, execution.caseId);
  }
}

function readNdjsonArtifact(artifact, execution, root, label) {
  if (!artifact || !artifact.path.endsWith(`/${execution.caseId}/${artifact.kind}.ndjson`)) {
    throw new Error(`${label} path is not fixed: ${execution.caseId}`);
  }
  const lines = readFileSync(path.join(root, ...artifact.path.split('/')), 'utf8')
    .split(/\r?\n/u)
    .filter(Boolean);
  if (lines.length === 0) throw new Error(`${label} is empty: ${execution.caseId}`);
  try {
    return lines.map((line) => JSON.parse(line));
  } catch {
    throw new Error(`${label} is not NDJSON: ${execution.caseId}`);
  }
}

function validateAdapterActionLog(artifact, execution, root) {
  const events = readNdjsonArtifact(artifact, execution, root, 'adapter action log');
  events.forEach((event, index) => {
    assertObject(event, `adapter action event ${execution.caseId}`);
    if (
      event.schema !== 'jotluck.installed-app.adapter-action-event.v1' ||
      event.sequence !== index + 1 ||
      event.caseId !== execution.caseId ||
      event.adapter !== execution.adapter ||
      !ISO_TIME.test(String(event.timestamp)) ||
      !nonEmpty(event.action) ||
      !event.details ||
      typeof event.details !== 'object' ||
      Array.isArray(event.details)
    ) {
      throw new Error(`adapter action event is invalid: ${execution.caseId}`);
    }
  });
}

function validateWebDriverTrace(artifact, execution, root) {
  const events = readNdjsonArtifact(artifact, execution, root, 'WebDriver trace');
  return validateWebDriverEvents(events, execution);
}

function validateWebDriverEvents(events, execution) {
  const attempts = new Map();
  const sessionIds = new Set();
  let expectedDriver = null;
  let expectedNativeDriver = null;
  events.forEach((event, index) => {
    assertObject(event, `WebDriver event ${execution.caseId}`);
    if (
      event.schema !== 'jotluck.installed-app.webdriver-event.v3' ||
      event.sequence !== index + 1 ||
      event.caseId !== execution.caseId ||
      event.adapter !== execution.adapter ||
      !ISO_TIME.test(String(event.timestamp)) ||
      !nonEmpty(event.event)
    ) {
      throw new Error(`WebDriver event identity is invalid: ${execution.caseId}`);
    }
    if (event.event === 'tauri-driver-ready') {
      assertWebDriverEventKeys(
        event,
        ['attemptId', 'processId', 'driver', 'nativeDriver'],
        execution.caseId,
      );
      if (
        !nonEmpty(event.attemptId) ||
        attempts.has(event.attemptId) ||
        !Number.isInteger(event.processId) ||
        event.processId <= 0 ||
        !isExecutableIdentity(event.driver) ||
        !isExecutableIdentity(event.nativeDriver) ||
        path.win32.basename(event.driver.path).toLowerCase() !== 'tauri-driver.exe' ||
        path.win32.basename(event.nativeDriver.path).toLowerCase() !== 'msedgedriver.exe'
      ) {
        throw new Error(`tauri-driver identity is invalid: ${execution.caseId}`);
      }
      assertExactKeys(event.driver, ['path', 'bytes', 'sha256'], 'tauri-driver file identity');
      assertExactKeys(
        event.nativeDriver,
        ['path', 'bytes', 'sha256'],
        'native WebDriver file identity',
      );
      if (
        (expectedDriver && canonicalJson(expectedDriver) !== canonicalJson(event.driver)) ||
        (expectedNativeDriver &&
          canonicalJson(expectedNativeDriver) !== canonicalJson(event.nativeDriver))
      ) {
        throw new Error(`WebDriver executable identity changed within a case: ${execution.caseId}`);
      }
      expectedDriver ??= event.driver;
      expectedNativeDriver ??= event.nativeDriver;
      attempts.set(event.attemptId, {
        sessionId: null,
        starts: new Map(),
        completed: new Set(),
        commands: [],
        deleteStarted: false,
        deleteCompleted: false,
        deleted: false,
      });
    } else if (event.event === 'webdriver-session-handshake-complete') {
      assertWebDriverEventKeys(
        event,
        ['attemptId', 'sessionId', 'capabilities', 'requested'],
        execution.caseId,
      );
      const attempt = attempts.get(event.attemptId);
      assertObject(event.requested, `WebDriver handshake request ${execution.caseId}`);
      assertExactKeys(
        event.requested,
        ['application', 'args'],
        `WebDriver handshake request ${execution.caseId}`,
      );
      if (
        !attempt ||
        attempt.sessionId ||
        !nonEmpty(event.sessionId) ||
        sessionIds.has(event.sessionId) ||
        !event.capabilities ||
        typeof event.capabilities !== 'object' ||
        Array.isArray(event.capabilities) ||
        Object.keys(event.capabilities).length === 0 ||
        !nonEmpty(event.requested.application) ||
        !path.win32.isAbsolute(event.requested.application) ||
        path.win32.basename(event.requested.application).toLowerCase() !== 'jotluck.exe' ||
        !Array.isArray(event.requested.args) ||
        event.requested.args.length === 0 ||
        event.requested.args.some(
          (entry) => typeof entry !== 'string' || !path.win32.isAbsolute(entry),
        )
      ) {
        throw new Error(`WebDriver session handshake is invalid: ${execution.caseId}`);
      }
      attempt.sessionId = event.sessionId;
      attempt.requestedApplication = normalizeWindowsPath(event.requested.application);
      sessionIds.add(event.sessionId);
    } else if (event.event === 'webdriver-command-start') {
      assertWebDriverEventKeys(
        event,
        ['attemptId', 'sessionId', 'correlationId', 'commandName', 'args'],
        execution.caseId,
      );
      const attempt = attempts.get(event.attemptId);
      if (
        !attempt ||
        !attempt.sessionId ||
        attempt.deleted ||
        attempt.deleteStarted ||
        event.sessionId !== attempt.sessionId ||
        !nonEmpty(event.correlationId) ||
        !nonEmpty(event.commandName) ||
        !WEBDRIVER_PROTOCOL_COMMANDS.has(event.commandName) ||
        !Array.isArray(event.args)
      ) {
        throw new Error(`WebDriver command start is invalid: ${execution.caseId}`);
      }
      if (attempt.starts.has(event.correlationId)) {
        throw new Error(`WebDriver command correlation is duplicated: ${execution.caseId}`);
      }
      if (event.commandName === 'deleteSession' && attempt.completed.size !== attempt.starts.size) {
        throw new Error(
          `WebDriver deletion started with commands still pending: ${execution.caseId}`,
        );
      }
      attempt.starts.set(event.correlationId, {
        commandName: event.commandName,
        args: canonicalJson(event.args),
      });
      if (event.commandName === 'deleteSession') attempt.deleteStarted = true;
    } else if (event.event === 'webdriver-command-complete') {
      assertWebDriverEventKeys(
        event,
        ['attemptId', 'sessionId', 'correlationId', 'commandName', 'args', 'result', 'error'],
        execution.caseId,
      );
      const attempt = attempts.get(event.attemptId);
      const started = attempt?.starts.get(event.correlationId);
      if (
        !attempt ||
        !attempt.sessionId ||
        attempt.deleted ||
        event.sessionId !== attempt.sessionId ||
        !nonEmpty(event.correlationId) ||
        started?.commandName !== event.commandName ||
        started.args !== canonicalJson(event.args) ||
        event.error !== null ||
        attempt.completed.has(event.correlationId)
      ) {
        throw new Error(
          `WebDriver command completion is invalid: ${execution.caseId}/${event.commandName}/${event.correlationId}`,
        );
      }
      attempt.completed.add(event.correlationId);
      attempt.commands.push(event.commandName);
      if (event.commandName === 'newSession') {
        throw new Error(
          `WebDriver newSession hook is not an observable handshake: ${execution.caseId}`,
        );
      }
      if (event.commandName === 'deleteSession') attempt.deleteCompleted = true;
    } else if (event.event === 'webdriver-session-deleted') {
      assertWebDriverEventKeys(event, ['attemptId', 'sessionId'], execution.caseId);
      const attempt = attempts.get(event.attemptId);
      if (
        !attempt ||
        attempt.sessionId !== event.sessionId ||
        attempt.deleted ||
        !attempt.deleteStarted ||
        !attempt.deleteCompleted ||
        attempt.completed.size !== attempt.starts.size
      ) {
        throw new Error(`WebDriver session deletion is unbound: ${execution.caseId}`);
      }
      attempt.deleted = true;
    } else if (event.event === 'webdriver-session-delete-failed') {
      throw new Error(`WebDriver session cleanup failed: ${execution.caseId}`);
    } else if (event.event === 'tauri-driver-output') {
      assertWebDriverEventKeys(event, ['attemptId', 'stream', 'value'], execution.caseId);
      if (
        !attempts.has(event.attemptId) ||
        attempts.get(event.attemptId).deleted ||
        !['stdout', 'stderr'].includes(event.stream) ||
        !isTraceText(event.value)
      ) {
        throw new Error(`tauri-driver output observation is invalid: ${execution.caseId}`);
      }
    } else {
      throw new Error(`unknown WebDriver observation event: ${execution.caseId}`);
    }
  });
  if (attempts.size === 0 || [...attempts.values()].some((attempt) => !attempt.deleted)) {
    throw new Error(`WebDriver observation lifecycle is incomplete: ${execution.caseId}`);
  }
  const requiredCommands = WEBDRIVER_CASE_COMMANDS[execution.caseId];
  if (!requiredCommands) {
    throw new Error(`WebDriver case command contract is missing: ${execution.caseId}`);
  }
  const completeCaseAttempt = [...attempts.values()].find((attempt) =>
    requiredCommands.every((command) => attempt.commands.includes(command)),
  );
  if (!completeCaseAttempt) {
    throw new Error(`WebDriver case commands are not closed in one session: ${execution.caseId}`);
  }
  return {
    driver: expectedDriver,
    nativeDriver: expectedNativeDriver,
    applicationPaths: [
      ...new Set([...attempts.values()].map((entry) => entry.requestedApplication)),
    ],
  };
}

function assertWebDriverEventKeys(event, details, caseId) {
  assertExactKeys(
    event,
    ['schema', 'sequence', 'timestamp', 'caseId', 'adapter', 'event', ...details],
    `WebDriver ${event.event} event ${caseId}`,
  );
}

function bindDriverObservation(context, observation, caseId) {
  for (const key of ['driver', 'nativeDriver']) {
    if (context[key] && canonicalJson(context[key]) !== canonicalJson(observation[key])) {
      throw new Error(`WebDriver ${key} identity changed across cases: ${caseId}`);
    }
    context[key] ??= observation[key];
  }
  for (const applicationPath of observation.applicationPaths) {
    context.applicationPaths.add(applicationPath);
  }
}

function bindInstalledApplication(context, identity, caseId) {
  if (
    context.installedApplication &&
    canonicalJson(context.installedApplication) !== canonicalJson(identity)
  ) {
    throw new Error(`installed application identity changed across cases: ${caseId}`);
  }
  context.installedApplication ??= identity;
}

function validateAssociationEvidence(artifacts, execution, candidateApplication, root) {
  const registryArtifact = artifacts.find((entry) => entry.kind === 'registry-snapshot');
  const launchArtifact = artifacts.find((entry) => entry.kind === 'launch-trace');
  if (!registryArtifact || !launchArtifact) {
    throw new Error(`association evidence is incomplete: ${execution.caseId}`);
  }
  const registry = readJson(root, registryArtifact.path);
  const launch = readJson(root, launchArtifact.path);
  return validateAssociationObjects(registry, launch, execution, candidateApplication);
}

function validateAssociationObjects(registry, launch, execution, candidateApplication) {
  const expectedExtension = ASSOCIATION_EXTENSIONS[execution.caseId];
  const commandMatch = String(registry.openCommand).match(/^"([^"\r\n]+)"\s+"%1"$/u);
  const installed = launch.application?.installed;
  const packaged = launch.application?.packaged;
  const target = launch.target;
  const processObserved = launch.processObserved;
  const process = processObserved?.process;
  assertObject(registry, `association registry ${execution.caseId}`);
  assertExactKeys(
    registry,
    [
      'extension',
      'openWithListExists',
      'defaultProgId',
      'userChoiceProgId',
      'mruList',
      'openWithSlots',
      'openWithExecutables',
      'classOpenWithProgIds',
      'explorerOpenWithProgIds',
      'supportedType',
      'openCommand',
      'progIdOpenCommand',
    ],
    `association registry ${execution.caseId}`,
  );
  if (
    !expectedExtension ||
    registry.extension !== expectedExtension ||
    !Array.isArray(registry.classOpenWithProgIds) ||
    !registry.classOpenWithProgIds.includes('JotLuck.Note') ||
    !Array.isArray(registry.explorerOpenWithProgIds) ||
    !registry.explorerOpenWithProgIds.includes('JotLuck.Note') ||
    registry.supportedType !== true ||
    !/^"[^"\r\n]*[\\/]JotLuck\.exe"\s+"%1"$/iu.test(String(registry.openCommand)) ||
    registry.progIdOpenCommand !== registry.openCommand ||
    !commandMatch ||
    normalizeWindowsPath(commandMatch[1]) !== normalizeWindowsPath(installed?.path)
  ) {
    throw new Error(`association registry command is not exact: ${execution.caseId}`);
  }
  assertObject(launch, `association launch ${execution.caseId}`);
  assertExactKeys(
    launch,
    ['schema', 'launchedAt', 'target', 'shell', 'processObserved', 'application'],
    `association launch ${execution.caseId}`,
  );
  assertObject(target, `association target ${execution.caseId}`);
  assertExactKeys(
    target,
    ['path', 'extension', 'marker', 'markerSha256', 'before', 'after'],
    `association target ${execution.caseId}`,
  );
  assertObject(target.before, `association target before ${execution.caseId}`);
  assertExactKeys(
    target.before,
    ['bytes', 'sha256'],
    `association target before ${execution.caseId}`,
  );
  assertObject(target.after, `association target after ${execution.caseId}`);
  assertExactKeys(
    target.after,
    ['bytes', 'sha256', 'contentUtf8'],
    `association target after ${execution.caseId}`,
  );
  assertObject(launch.shell, `association Shell result ${execution.caseId}`);
  assertExactKeys(
    launch.shell,
    ['method', 'className', 'processId'],
    `association Shell result ${execution.caseId}`,
  );
  assertObject(processObserved, `association UIA observation ${execution.caseId}`);
  assertExactKeys(
    processObserved,
    ['target', 'process'],
    `association UIA observation ${execution.caseId}`,
  );
  assertObject(process, `association UIA process ${execution.caseId}`);
  assertExactKeys(
    process,
    ['Id', 'ProcessName', 'MainWindowTitle', 'ExecutablePath', 'matchedText', 'observationSource'],
    `association UIA process ${execution.caseId}`,
  );
  assertObject(launch.application, `association application ${execution.caseId}`);
  assertExactKeys(
    launch.application,
    ['installed', 'packaged'],
    `association application ${execution.caseId}`,
  );
  if (isExecutableIdentity(installed)) {
    assertExactKeys(installed, ['path', 'bytes', 'sha256'], 'installed application identity');
  }
  if (isExecutableIdentity(packaged)) {
    assertExactKeys(packaged, ['path', 'bytes', 'sha256'], 'packaged application identity');
  }
  const afterBytes = Buffer.from(String(target?.after?.contentUtf8 ?? ''), 'utf8');
  const targetStem = path.win32.parse(String(target?.path ?? '')).name.toLowerCase();
  if (
    launch.schema !== 'jotluck.installed-app.association-launch.v2' ||
    !ISO_TIME.test(String(launch.launchedAt)) ||
    target?.extension !== expectedExtension ||
    path.win32.extname(String(target?.path)).toLowerCase() !== expectedExtension ||
    !path.win32.basename(String(target?.path)).includes(' ') ||
    !nonEmpty(target?.marker) ||
    target.markerSha256 !== sha256(Buffer.from(target.marker, 'utf8')) ||
    !Number.isInteger(target.before?.bytes) ||
    target.before.bytes <= 0 ||
    !SHA256.test(String(target.before?.sha256)) ||
    target.after?.bytes !== afterBytes.byteLength ||
    target.after?.sha256 !== sha256(afterBytes) ||
    target.before.bytes !== target.after.bytes ||
    target.before.sha256 !== target.after.sha256 ||
    !String(target.after?.contentUtf8).includes(target.marker) ||
    launch.shell?.method !== 'ShellExecuteExW' ||
    launch.shell?.className !== 'JotLuck.Note' ||
    !Number.isInteger(launch.shell?.processId) ||
    launch.shell.processId <= 0 ||
    processObserved?.target !== target.path ||
    process?.Id !== launch.shell.processId ||
    process?.observationSource !== 'Windows-UIAutomation' ||
    !nonEmpty(process?.matchedText) ||
    !process.matchedText.includes(target.marker) ||
    !nonEmpty(process?.MainWindowTitle) ||
    !process.MainWindowTitle.toLowerCase().includes(targetStem) ||
    !isExecutableIdentity(installed) ||
    !isExecutableIdentity(packaged) ||
    normalizeWindowsPath(process?.ExecutablePath) !== normalizeWindowsPath(installed?.path) ||
    installed.sha256 !== packaged.sha256 ||
    installed.bytes !== packaged.bytes ||
    !candidateApplication ||
    packaged.sha256 !== candidateApplication.sha256 ||
    packaged.bytes !== candidateApplication.bytes ||
    path.win32.basename(String(packaged.path)).toLowerCase() !==
      path.win32.basename(String(candidateApplication.path)).toLowerCase()
  ) {
    throw new Error(`association Shell observation is invalid: ${execution.caseId}`);
  }
  return installed;
}

function validateColdStartLifecycle(
  artifacts,
  execution,
  expectedSamples,
  expectedHotSamples,
  candidateApplication,
  webdriverObservation,
  root,
) {
  const artifact = artifacts.find((entry) => entry.kind === 'process-lifecycle');
  if (!artifact) throw new Error('RF-10 process lifecycle evidence is missing');
  const lifecycle = readJson(root, artifact.path);
  return validateColdStartLifecycleValue(
    lifecycle,
    expectedSamples,
    expectedHotSamples,
    candidateApplication,
    webdriverObservation,
  );
}

function validateColdStartLifecycleValue(
  lifecycle,
  expectedSamples = 20,
  expectedHotSamples = 30,
  candidateApplication,
  webdriverObservation,
) {
  assertObject(lifecycle, 'RF-10 process lifecycle');
  assertExactKeys(
    lifecycle,
    ['schema', 'application', 'samples', 'hotWindowSamples', 'finalProcesses'],
    'RF-10 process lifecycle',
  );
  assertObject(lifecycle.application, 'RF-10 application identity');
  assertExactKeys(lifecycle.application, ['installed', 'packaged'], 'RF-10 application identity');
  const installed = lifecycle.application.installed;
  const packaged = lifecycle.application.packaged;
  if (isExecutableIdentity(installed)) {
    assertExactKeys(installed, ['path', 'bytes', 'sha256'], 'RF-10 installed application');
  }
  if (isExecutableIdentity(packaged)) {
    assertExactKeys(packaged, ['path', 'bytes', 'sha256'], 'RF-10 packaged application');
  }
  if (
    lifecycle.schema !== 'jotluck.installed-app.process-lifecycle.v2' ||
    !isExecutableIdentity(installed) ||
    !isExecutableIdentity(packaged) ||
    path.win32.basename(installed.path).toLowerCase() !== 'jotluck.exe' ||
    path.win32.basename(packaged.path).toLowerCase() !== 'jotluck.exe' ||
    installed.bytes !== packaged.bytes ||
    installed.sha256 !== packaged.sha256 ||
    (candidateApplication &&
      (packaged.bytes !== candidateApplication.bytes ||
        packaged.sha256 !== candidateApplication.sha256 ||
        path.win32.basename(packaged.path).toLowerCase() !==
          path.win32.basename(candidateApplication.path).toLowerCase())) ||
    (webdriverObservation &&
      (!Array.isArray(webdriverObservation.applicationPaths) ||
        webdriverObservation.applicationPaths.length === 0 ||
        webdriverObservation.applicationPaths.some(
          (applicationPath) => applicationPath !== normalizeWindowsPath(installed.path),
        ))) ||
    !Array.isArray(lifecycle.samples) ||
    lifecycle.samples.length !== expectedSamples ||
    !Array.isArray(lifecycle.hotWindowSamples) ||
    lifecycle.hotWindowSamples.length !== expectedHotSamples ||
    !Array.isArray(lifecycle.finalProcesses) ||
    lifecycle.finalProcesses.length !== 0
  ) {
    throw new Error('RF-10 cold-start process lifecycle is invalid');
  }
  lifecycle.samples.forEach((sample, index) => {
    assertObject(sample, `RF-10 cold-start sample ${index + 1}`);
    assertExactKeys(
      sample,
      ['sample', 'startedAt', 'finishedAt', 'before', 'after'],
      `RF-10 cold-start sample ${index + 1}`,
    );
    if (
      sample.sample !== index + 1 ||
      !ISO_TIME.test(String(sample.startedAt)) ||
      !ISO_TIME.test(String(sample.finishedAt)) ||
      Date.parse(sample.finishedAt) < Date.parse(sample.startedAt) ||
      !Array.isArray(sample.before) ||
      sample.before.length !== 0 ||
      !Array.isArray(sample.after) ||
      sample.after.length !== 0
    ) {
      throw new Error(`RF-10 cold-start sample lacks a zero-process boundary: ${index + 1}`);
    }
  });
  lifecycle.hotWindowSamples.forEach((sample, index) => {
    assertObject(sample, `RF-10 hot-window sample ${index + 1}`);
    assertExactKeys(
      sample,
      ['sample', 'before', 'opened', 'after'],
      `RF-10 hot-window sample ${index + 1}`,
    );
    if (
      sample.sample !== index + 1 ||
      !Number.isInteger(sample.before) ||
      sample.before < 1 ||
      sample.opened !== sample.before + 1 ||
      sample.after !== sample.before
    ) {
      throw new Error(`RF-10 hot-window sample lacks a restored boundary: ${index + 1}`);
    }
  });
  return installed;
}

function normalizeWindowsPath(value) {
  return String(value ?? '')
    .replaceAll('/', '\\')
    .replace(/^\\\\\?\\/u, '')
    .toLowerCase();
}

function isExecutableIdentity(value) {
  return (
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    nonEmpty(value.path) &&
    Number.isInteger(value.bytes) &&
    value.bytes > 0 &&
    SHA256.test(String(value.sha256))
  );
}

function isTraceText(value) {
  if (typeof value === 'string') return true;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  assertExactKeys(value, ['bytes', 'sha256'], 'sanitized WebDriver text');
  return Number.isInteger(value.bytes) && value.bytes > 0 && SHA256.test(String(value.sha256));
}

function validateExecutionLog(artifact, caseResult, execution, runner, root) {
  if (!artifact || !artifact.path.endsWith(`/${execution.caseId}/execution-log.ndjson`)) {
    throw new Error(`case execution log path is not fixed: ${execution.caseId}`);
  }
  const lines = readFileSync(path.join(root, ...artifact.path.split('/')), 'utf8')
    .split(/\r?\n/u)
    .filter(Boolean);
  const observedArtifacts = caseResult.artifacts.filter((entry) => entry.kind !== 'execution-log');
  if (lines.length !== observedArtifacts.length + 2) {
    throw new Error(`case execution log event conservation failed: ${execution.caseId}`);
  }
  let events;
  try {
    events = lines.map((line) => JSON.parse(line));
  } catch {
    throw new Error(`case execution log is not NDJSON: ${execution.caseId}`);
  }
  events.forEach((event, index) => {
    assertObject(event, `execution log event ${execution.caseId}`);
    if (
      event.schema !== 'jotluck.installed-app.execution-event.v2' ||
      event.sequence !== index + 1 ||
      event.caseId !== execution.caseId ||
      event.adapter !== execution.adapter ||
      !ISO_TIME.test(String(event.timestamp))
    ) {
      throw new Error(`case execution log identity is invalid: ${execution.caseId}`);
    }
  });
  const start = events[0];
  assertExactKeys(
    start,
    ['schema', 'sequence', 'timestamp', 'caseId', 'adapter', 'event', 'producer'],
    `execution log start ${execution.caseId}`,
  );
  if (
    start.event !== 'adapter-start' ||
    start.timestamp !== execution.startedAt ||
    canonicalJson(start.producer) !== canonicalJson(runner)
  ) {
    throw new Error(`case execution log start is invalid: ${execution.caseId}`);
  }
  const observed = events.slice(1, -1);
  for (const [index, expected] of observedArtifacts.entries()) {
    const event = observed[index];
    assertExactKeys(
      event,
      [
        'schema',
        'sequence',
        'timestamp',
        'caseId',
        'adapter',
        'event',
        'artifactKind',
        'path',
        'bytes',
        'sha256',
      ],
      `execution log observation ${execution.caseId}`,
    );
    if (
      event.event !== 'artifact-observed' ||
      event.artifactKind !== expected.kind ||
      event.path !== expected.path ||
      event.bytes !== expected.bytes ||
      event.sha256 !== expected.sha256
    ) {
      throw new Error(`case execution log observation is invalid: ${execution.caseId}`);
    }
  }
  const finish = events.at(-1);
  assertExactKeys(
    finish,
    ['schema', 'sequence', 'timestamp', 'caseId', 'adapter', 'event', 'exitCode', 'counters'],
    `execution log finish ${execution.caseId}`,
  );
  if (
    finish.event !== 'adapter-finish' ||
    finish.timestamp !== execution.finishedAt ||
    finish.exitCode !== execution.exitCode ||
    canonicalJson(finish.counters) !== canonicalJson(execution.counters)
  ) {
    throw new Error(`case execution log finish is invalid: ${execution.caseId}`);
  }
}

function verifyRunnerBinding(runner, manifest) {
  if (
    runner.provider !== manifest.ci.provider ||
    runner.repository.toLowerCase() !== manifest.ci.repository.toLowerCase() ||
    runner.runId !== manifest.ci.runId ||
    runner.runAttempt !== manifest.ci.runAttempt ||
    runner.headSha !== manifest.candidate.commit
  ) {
    throw new Error('raw runner is not bound to the manifest candidate workflow run');
  }
}

function verifyExecutionArtifactSnapshot(root, base, manifest, executionEvidencePath) {
  if (!nonEmpty(executionEvidencePath)) {
    throw new Error('downloaded trusted execution evidence path is required');
  }
  const snapshotRoot = realpathSync(path.resolve(executionEvidencePath));
  const info = lstatSync(snapshotRoot);
  if (info.isSymbolicLink() || !info.isDirectory()) {
    throw new Error('downloaded trusted execution evidence must be a regular directory');
  }
  const expected = [manifest.rawReport, ...manifest.attachments]
    .map((entry) => {
      if (!entry.path.startsWith(`${base}/`)) {
        throw new Error(`execution artifact path is outside the release directory: ${entry.path}`);
      }
      return {
        path: entry.path.slice(base.length + 1),
        bytes: entry.bytes,
        sha256: entry.sha256,
      };
    })
    .sort((left, right) => left.path.localeCompare(right.path));
  const actual = collectSnapshotFiles(snapshotRoot).sort((left, right) =>
    left.path.localeCompare(right.path),
  );
  if (canonicalJson(actual) !== canonicalJson(expected)) {
    throw new Error(
      'downloaded trusted execution evidence does not exactly match managed evidence',
    );
  }
  for (const record of expected) {
    const managed = fileMetadata(root, `${base}/${record.path}`);
    if (managed.bytes !== record.bytes || managed.sha256 !== record.sha256) {
      throw new Error(`managed execution evidence changed: ${record.path}`);
    }
  }
}

function collectSnapshotFiles(root, relative = '') {
  const directory = path.join(root, relative);
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const childRelative = relative ? `${relative}/${entry.name}` : entry.name;
    const child = path.join(root, ...childRelative.split('/'));
    const info = lstatSync(child);
    if (info.isSymbolicLink()) throw new Error(`symbolic link is forbidden: ${childRelative}`);
    if (info.isDirectory()) files.push(...collectSnapshotFiles(root, childRelative));
    else if (info.isFile()) {
      const bytes = readFileSync(child);
      if (bytes.byteLength === 0) throw new Error(`execution artifact is empty: ${childRelative}`);
      files.push({ path: childRelative, bytes: bytes.byteLength, sha256: sha256(bytes) });
    } else throw new Error(`execution artifact contains a non-file entry: ${childRelative}`);
  }
  return files;
}

function verifyPerformance(raw, transcript, manifest, rule) {
  for (const performance of [raw, transcript, manifest]) {
    validatePerformanceEvidence(performance, rule);
  }
  if (
    canonicalJson(raw) !== canonicalJson(transcript) ||
    canonicalJson(raw) !== canonicalJson(manifest)
  )
    throw new Error('performance values are not conserved across evidence');
  return raw.advisories;
}

function verifyGitLineage(root, candidateCommit, base) {
  const evidenceCommit = git(root, ['rev-parse', 'HEAD']).trim();
  assertCommit(candidateCommit, 'candidate commit');
  assertCommit(evidenceCommit, 'evidence commit');
  if (candidateCommit === evidenceCommit)
    throw new Error('candidate and evidence commits must differ');
  git(root, ['rev-parse', '--verify', `${candidateCommit}^{commit}`]);
  if (git(root, ['merge-base', '--is-ancestor', candidateCommit, evidenceCommit], true) !== 0)
    throw new Error('candidate commit is not an ancestor of evidence commit');
  const changed = git(root, ['diff', '--name-status', `${candidateCommit}..${evidenceCommit}`])
    .trim()
    .split(/\r?\n/u)
    .filter(Boolean);
  if (changed.length === 0) throw new Error('evidence commit has no evidence files');
  for (const line of changed) {
    const [status, changedPath] = line.split('\t');
    if (status !== 'A' || !changedPath?.startsWith(`${base}/`))
      throw new Error('evidence commit may only add files inside its release directory');
  }
  return evidenceCommit;
}

function fileMetadata(root, relativePath) {
  assertSafeEvidencePath(relativePath);
  const absolute = path.resolve(root, relativePath);
  if (!absolute.startsWith(`${root}${path.sep}`))
    throw new Error(`evidence path escapes root: ${relativePath}`);
  const parts = relativePath.split('/');
  let cursor = root;
  for (const part of parts) {
    cursor = path.join(cursor, part);
    if (lstatSync(cursor).isSymbolicLink())
      throw new Error(`symbolic link is forbidden: ${relativePath}`);
  }
  if (!statSync(absolute).isFile()) throw new Error(`evidence path is not a file: ${relativePath}`);
  if (!trackedFiles(root).has(relativePath))
    throw new Error(`evidence file is untracked: ${relativePath}`);
  const bytes = readFileSync(absolute);
  return { bytes: bytes.byteLength, sha256: sha256(bytes) };
}
function trackedFiles(root) {
  let cached = trackedFilesByRoot.get(root);
  if (!cached) {
    cached = new Set(
      git(root, ['ls-files', '-z'])
        .split('\0')
        .filter(Boolean)
        .map((entry) => entry.replaceAll('\\', '/')),
    );
    trackedFilesByRoot.set(root, cached);
  }
  return cached;
}

export function verifyTrackedArtifact(root, expected, label = 'artifact') {
  if ('caseId' in expected) assertAttachment(expected);
  else if ('kind' in expected) assertCaseArtifact(expected, label);
  else assertArtifact(expected, label);
  const metadata = fileMetadata(root, expected.path);
  if (metadata.bytes !== expected.bytes || metadata.sha256 !== expected.sha256)
    throw new Error(`${label} hash or byte count does not match: ${expected.path}`);
  return metadata;
}

function assertArtifact(value, label) {
  assertObject(value, label);
  assertExactKeys(value, ['path', 'bytes', 'sha256'], label);
  assertSafeEvidencePath(value.path);
  if (!Number.isInteger(value.bytes) || value.bytes <= 0 || !SHA256.test(String(value.sha256)))
    throw new Error(`${label} metadata is invalid`);
}
function assertCaseArtifact(value, label) {
  assertObject(value, label);
  assertExactKeys(value, ['kind', 'path', 'bytes', 'sha256'], label);
  if (!nonEmpty(value.kind)) throw new Error(`${label} kind is invalid`);
  assertArtifact({ path: value.path, bytes: value.bytes, sha256: value.sha256 }, label);
}
function assertGitHubArtifactBinding(value, label) {
  assertObject(value, label);
  assertExactKeys(value, ['id', 'name', 'digest', 'sizeInBytes'], label);
  if (
    !/^[1-9]\d*$/u.test(String(value.id)) ||
    !nonEmpty(value.name) ||
    !/^sha256:[a-f0-9]{64}$/u.test(String(value.digest)) ||
    !Number.isInteger(value.sizeInBytes) ||
    value.sizeInBytes <= 0
  ) {
    throw new Error(`${label} is invalid`);
  }
}
function assertInstaller(value) {
  assertObject(value, 'installer');
  assertExactKeys(value, ['fileName', 'bytes', 'sha256'], 'installer');
  if (
    !nonEmpty(value.fileName) ||
    value.fileName !== path.basename(value.fileName) ||
    !Number.isInteger(value.bytes) ||
    value.bytes <= 0 ||
    !SHA256.test(String(value.sha256))
  ) {
    throw new Error('installer metadata is invalid');
  }
}
function assertApplication(value) {
  assertInstaller(value);
  if (value.fileName !== 'jotluck.exe') {
    throw new Error('candidate application metadata is invalid');
  }
}
function assertAttachment(value) {
  assertObject(value, 'attachment');
  assertExactKeys(value, ['path', 'bytes', 'sha256', 'caseId', 'kind'], 'attachment');
  assertSafeEvidencePath(value.path);
  if (
    !Number.isInteger(value.bytes) ||
    value.bytes <= 0 ||
    !SHA256.test(String(value.sha256)) ||
    !nonEmpty(value.caseId) ||
    !['case-result', 'case-artifact'].includes(value.kind)
  ) {
    throw new Error('attachment metadata is invalid');
  }
}

function assertPathWithinBase(value, base, label) {
  if (!value.startsWith(`${base}/`)) throw new Error(`${label} must remain inside ${base}`);
}

function sameArtifact(left, right) {
  return left.path === right.path && left.bytes === right.bytes && left.sha256 === right.sha256;
}

function assertSafeEvidencePath(value) {
  if (
    !nonEmpty(value) ||
    path.isAbsolute(value) ||
    value.includes('\\') ||
    value.split('/').some((part) => !part || part === '.' || part === '..')
  )
    throw new Error(`unsafe evidence path: ${value}`);
}
function assertSafeSegment(value, label) {
  if (!nonEmpty(value) || /[\\/]/u.test(value) || value === '.' || value === '..')
    throw new Error(`unsafe ${label}`);
}
function assertCommit(value, label) {
  if (!COMMIT.test(String(value))) throw new Error(`${label} is invalid`);
}
function assertObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${label} must be an object`);
}
function assertExactKeys(value, expected, label) {
  const actual = Object.keys(value).sort();
  const required = [...expected].sort();
  if (canonicalJson(actual) !== canonicalJson(required))
    throw new Error(`${label} fields do not match the strict schema`);
}
function nonEmpty(value) {
  return typeof value === 'string' && value.length > 0;
}
function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}
function sha256Json(value) {
  return sha256(canonicalJson(value));
}
function canonicalJson(value) {
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
function readJson(root, relative) {
  const meta = fileMetadata(root, relative);
  try {
    return JSON.parse(readFileSync(path.join(root, relative), 'utf8'));
  } catch {
    throw new Error(`invalid JSON: ${relative} (${meta.sha256})`);
  }
}
function git(root, args, statusOnly = false) {
  try {
    const output = execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      stdio: statusOnly ? 'ignore' : undefined,
    });
    return statusOnly ? 0 : output;
  } catch (error) {
    if (statusOnly) return error.status ?? 1;
    throw new Error(`git ${args.join(' ')} failed`);
  }
}
function rejectSelfAttestedConclusion(value, label) {
  const forbidden = new Set(['pass', 'passed', 'status', 'result', 'conclusion']);
  const visit = (candidate, key = '') => {
    if (
      forbidden.has(key) &&
      (candidate === true ||
        ['PASS', 'pass', 'SKIP', 'skip', 'SKIPPED', 'skipped'].includes(candidate))
    )
      throw new Error(`${label} contains self-attested ${key}`);
    if (Array.isArray(candidate)) candidate.forEach((item) => visit(item));
    else if (candidate && typeof candidate === 'object')
      Object.entries(candidate).forEach(([childKey, child]) => visit(child, childKey));
  };
  visit(value);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [
    releaseId,
    installerPath = process.env.JOTLUCK_INSTALLER_PATH,
    candidateApplicationPath = process.env.JOTLUCK_CANDIDATE_APPLICATION_PATH,
    executionEvidencePath = process.env.JOTLUCK_EXECUTION_EVIDENCE_PATH,
  ] = process.argv.slice(2);
  if (!releaseId || !installerPath || !candidateApplicationPath || !executionEvidencePath) {
    console.error(
      'usage: node scripts/release/verify-installed-app-evidence-v2.mjs <release-id> <installer-path> <candidate-application-path> <execution-evidence-path>',
    );
    process.exit(2);
  }
  try {
    console.log(
      JSON.stringify(
        verifyInstalledAppEvidenceV2({
          rootDir: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'),
          releaseId,
          installerPath,
          candidateApplicationPath,
          executionEvidencePath,
        }),
      ),
    );
  } catch (error) {
    console.error(`[installed-app-evidence-v2] FAIL: ${error.message}`);
    process.exit(11);
  }
}
