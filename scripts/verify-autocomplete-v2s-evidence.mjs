#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  AUTOCOMPLETE_V2S_EVIDENCE_SOURCE_FILES,
  canonicalJson,
  verifyEvaluatorSourceTree,
} from './autocomplete-evidence-integrity.mjs';

export const V2S_PUBLIC_DIRECTORY = 'packages/app/public/autocomplete';
export const V2S_CANONICAL_MANIFEST = `${V2S_PUBLIC_DIRECTORY}/autocomplete-public.manifest.json`;
export const V2S_ENGINE = 'public-v2s-mkn-v1';
export const V2S_MANIFEST_SCHEMA = 'jotluck.autocomplete.public-model.v6';

const MAX_ASSET_BYTES = 6 * 1024 * 1024;
const LEGACY_PUBLIC_FILES = Object.freeze([
  'baseline-ngram.web-local.compact.manifest.json',
  'baseline-ngram.web-local.compact.txt',
]);
const V2R_PUBLIC_FILES = Object.freeze([
  'ort-wasm-simd-threaded.v2r.wasm',
  'public-phrase-transformer-v1.int8.onnx',
  'public-phrase-transformer-v1.metadata.json',
  'public-phrase-transformer-v1.phrases.jsonl',
  'public-phrase-transformer-v1.release.manifest.json',
  'public-phrase-transformer-v1.web-local.manifest.json',
]);
const EVIDENCE_KEYS = Object.freeze([
  'selection',
  'governance',
  'coldValidation',
  'workspaceValidation',
  'coldFinal',
  'workspaceFinal',
  'finalConsumption',
  'runtime',
  'evaluator',
  'webview',
]);
const PROJECT_SOURCE_PREFIX =
  'scripts/corpus/_web-cache/autocomplete-v2r/generated-project-owned-v3.1';
const PROJECT_GENERATOR_VERSION = 'jotluck-project-owned-short-notes-v3.1';
const PROJECT_GENERATOR_SEED = 'v2r-project-owned-2026-07-12-b';
const TATOEBA_SOURCE_ID = 'tatoeba-cc0-en-2026-07-12';
const TATOEBA_CONTENT_ROOT =
  'scripts/corpus/_web-cache/autocomplete-v2r/generated-external/tatoeba/en';
const V2S_OBSERVATION_REPLAY_SCHEMA = 'jotluck.autocomplete.v2s-observation-replay-receipt.v1';
const V2S_RUNTIME_REPLAY_SCHEMA = 'jotluck.autocomplete.v2s-runtime-replay-binding.v1';
const V2S_ARCHITECTURE_STOP = 'scripts/corpus/autocomplete-v2s-architecture-stop.json';

export function inspectAutocompletePublicState(rootDir) {
  const realRoot = realpathSync(path.resolve(rootDir));
  const publicDir = path.join(realRoot, 'packages/app/public');
  const canonicalDir = path.join(realRoot, V2S_PUBLIC_DIRECTORY);
  const publicNames = existsSync(publicDir) ? readdirSync(publicDir) : [];
  const legacyFiles = publicNames
    .filter((name) => /^baseline-ngram\..*\.compact\.(?:txt|manifest\.json)$/u.test(name))
    .sort();
  const v2rFiles = publicNames.filter(
    (name) => V2R_PUBLIC_FILES.includes(name) || /^public-phrase-transformer-v1\./u.test(name),
  );
  const canonicalEntries = existsSync(canonicalDir)
    ? readdirSync(canonicalDir, { withFileTypes: true }).map((entry) => ({
        name: entry.name,
        isFile: entry.isFile(),
      }))
    : [];
  const manifestName = path.posix.basename(V2S_CANONICAL_MANIFEST);
  const hasManifest = canonicalEntries.some((entry) => entry.name === manifestName && entry.isFile);

  if (v2rFiles.length > 0) {
    return invalidState('stopped-v2r-public-residue', { legacyFiles, v2rFiles, canonicalEntries });
  }

  if (hasManifest) {
    if (legacyFiles.length > 0) {
      return invalidState('legacy-and-v2s-coexist', { legacyFiles, v2rFiles, canonicalEntries });
    }
    let manifest;
    try {
      manifest = readJson(path.join(canonicalDir, manifestName), 'V2S public manifest');
    } catch (error) {
      return invalidState(`invalid-v2s-manifest: ${errorMessage(error)}`, {
        legacyFiles,
        v2rFiles,
        canonicalEntries,
      });
    }
    const assetFile = manifest?.asset?.file;
    const expectedEntries = [manifestName, assetFile].filter(
      (value) => typeof value === 'string' && value.length > 0,
    );
    const actualEntries = canonicalEntries.map((entry) => entry.name).sort();
    if (
      expectedEntries.length !== 2 ||
      canonicalEntries.some((entry) => !entry.isFile) ||
      !sameStrings(actualEntries, expectedEntries)
    ) {
      return invalidState('v2s-orphan-or-duplicate-public-asset', {
        legacyFiles,
        v2rFiles,
        canonicalEntries,
      });
    }
    return {
      kind: 'v2s',
      reason: null,
      legacyFiles,
      v2rFiles,
      canonicalEntries,
      manifest,
    };
  }

  if (canonicalEntries.length > 0) {
    return invalidState('v2s-orphan-without-canonical-manifest', {
      legacyFiles,
      v2rFiles,
      canonicalEntries,
    });
  }

  if (legacyFiles.length > 0) {
    if (!sameStrings(legacyFiles, LEGACY_PUBLIC_FILES)) {
      return invalidState('multiple-or-noncanonical-legacy-models', {
        legacyFiles,
        v2rFiles,
        canonicalEntries,
      });
    }
    return {
      kind: 'legacy-failclosed',
      reason: null,
      legacyFiles,
      v2rFiles,
      canonicalEntries,
      manifest: null,
    };
  }

  return {
    kind: 'missing',
    reason: 'no-public-autocomplete-model',
    legacyFiles,
    v2rFiles,
    canonicalEntries,
    manifest: null,
  };
}

export function prepareAutocompleteV2SPublication({
  rootDir,
  candidatePath,
  expectedEvaluatorFiles = AUTOCOMPLETE_V2S_EVIDENCE_SOURCE_FILES,
}) {
  const realRoot = realpathSync(path.resolve(rootDir));
  const fixtureProtocol = resolveFixtureProtocol(expectedEvaluatorFiles);
  const state = inspectAutocompletePublicState(realRoot);
  const architectureStop = inspectV2SArchitectureStop(realRoot);
  if (architectureStop) {
    throw new Error(
      `Cannot publish stopped V2S architecture ${architectureStop.architectureId} (${architectureStop.reasonCode}).`,
    );
  }
  if (state.kind === 'invalid') {
    throw new Error(`Cannot publish V2S from an ambiguous public state: ${state.reason}.`);
  }

  const candidateFile = loadWorkspaceFile(realRoot, candidatePath, 'candidate descriptor');
  assertOutsidePublic(realRoot, candidateFile.absolutePath, 'Candidate descriptor');
  const candidate = parseJson(candidateFile.bytes, 'candidate descriptor');
  if (
    candidate?.schemaVersion !== 1 ||
    candidate.classification !== 'autocomplete-v2s-release-candidate' ||
    candidate.engine !== V2S_ENGINE ||
    typeof candidate.assetPath !== 'string' ||
    !candidate.training ||
    !isSha256(candidate.training.selectionSha256) ||
    !isSha256(candidate.training.inputTreeSha256) ||
    !candidate.evidence ||
    typeof candidate.evidence !== 'object'
  ) {
    throw new Error('V2S candidate descriptor identity is invalid.');
  }
  if (
    EVIDENCE_KEYS.some(
      (key) => typeof candidate.evidence[key] !== 'string' || !candidate.evidence[key],
    )
  ) {
    throw new Error('V2S candidate descriptor has an incomplete evidence set.');
  }

  const assetFile = loadWorkspaceFile(realRoot, candidate.assetPath, 'candidate asset');
  assertOutsidePublic(realRoot, assetFile.absolutePath, 'Candidate asset');
  if (!candidate.assetPath.endsWith('.bin')) {
    throw new Error('V2S candidate asset must use the .bin format.');
  }
  const facts = buildReleaseFacts({
    rootDir: realRoot,
    assetBytes: assetFile.bytes,
    assetPath: normalizeRelativePath(candidate.assetPath),
    evidencePaths: candidate.evidence,
    expectedEvaluatorFiles,
    fixtureProtocol,
  });
  if (
    candidate.training.selectionSha256 !== facts.training.selectionSha256 ||
    candidate.training.inputTreeSha256 !== facts.training.inputTreeSha256
  ) {
    throw new Error('V2S candidate training identity does not match the verified selection.');
  }
  const manifest = buildManifest(facts);
  if (state.kind === 'v2s' && state.manifest?.releaseId === facts.releaseId) {
    throw new Error('V2S final pair was already consumed and published.');
  }
  const assetFileName = manifest.asset.file;
  const assetTarget = `${V2S_PUBLIC_DIRECTORY}/${assetFileName}`;

  return {
    assetBytes: assetFile.bytes,
    assetTarget,
    manifest,
    manifestText: `${JSON.stringify(manifest, null, 2)}\n`,
    manifestTarget: V2S_CANONICAL_MANIFEST,
    releaseId: facts.releaseId,
    stalePublicPaths: collectReplaceablePublicPaths(realRoot, state),
  };
}

export function verifyAutocompleteV2SEvidence({
  rootDir,
  mode = 'rc',
  expectedEvaluatorFiles = AUTOCOMPLETE_V2S_EVIDENCE_SOURCE_FILES,
}) {
  const realRoot = realpathSync(path.resolve(rootDir));
  const fixtureProtocol = resolveFixtureProtocol(expectedEvaluatorFiles);
  const state = inspectAutocompletePublicState(realRoot);
  const architectureStop = inspectV2SArchitectureStop(realRoot);
  if (!['ci', 'rc'].includes(mode)) throw new Error(`Unsupported V2S verification mode: ${mode}.`);
  if (state.kind === 'invalid') {
    throw new Error(`Ambiguous autocomplete public state: ${state.reason}.`);
  }
  if (architectureStop) {
    if (state.kind === 'v2s') {
      throw new Error('A stopped V2S architecture cannot coexist with a canonical public model.');
    }
    if (mode === 'ci') {
      return {
        status: 'architecture-stopped-fail-closed',
        architectureId: architectureStop.architectureId,
        reasonCode: architectureStop.reasonCode,
        publicState: state.kind,
        releaseEligible: false,
      };
    }
    throw new Error(
      `V2S architecture ${architectureStop.architectureId} is stopped (${architectureStop.reasonCode}).`,
    );
  }
  if (state.kind !== 'v2s' && mode === 'ci') {
    return {
      status: 'disabled-fail-closed',
      publicState: state.kind,
      releaseEligible: false,
    };
  }
  if (state.kind !== 'v2s') {
    throw new Error(
      `Canonical V2S public state is required; observed ${state.kind}${state.reason ? ` (${state.reason})` : ''}.`,
    );
  }
  const manifest = state.manifest;
  assertManifestShape(manifest);
  const assetRelativePath = `${V2S_PUBLIC_DIRECTORY}/${manifest.asset.file}`;
  const asset = loadWorkspaceFile(realRoot, assetRelativePath, 'V2S public asset');
  const evidencePaths = Object.fromEntries(
    EVIDENCE_KEYS.map((key) => [key, manifest.evidenceBindings[key]?.path]),
  );
  const facts = buildReleaseFacts({
    rootDir: realRoot,
    assetBytes: asset.bytes,
    assetPath: assetRelativePath,
    evidencePaths,
    expectedEvaluatorFiles,
    fixtureProtocol,
  });
  const expectedManifest = buildManifest(facts);
  if (canonicalJson(manifest) !== canonicalJson(expectedManifest)) {
    throw new Error(
      'V2S public manifest does not match independently recomputed release evidence.',
    );
  }
  return {
    status: 'release-evidence-verified-v2s',
    releaseId: facts.releaseId,
    assetSha256: facts.asset.sha256,
    assetBytes: facts.asset.bytes,
    metrics: facts.metrics,
  };
}

export function inspectV2SArchitectureStop(rootDir) {
  const absolutePath = path.join(rootDir, ...V2S_ARCHITECTURE_STOP.split('/'));
  if (!existsSync(absolutePath)) return null;
  const value = readJson(absolutePath, 'V2S architecture stop');
  const recordSha256 = value?.recordSha256;
  if (!isValidV2SArchitectureStop(value) || !isSha256(recordSha256)) {
    throw new Error('V2S architecture-stop record is invalid.');
  }
  const { recordSha256: _recordSha256, ...unsigned } = value;
  if (sha256(canonicalJson(unsigned)) !== recordSha256) {
    throw new Error('V2S architecture-stop record SHA-256 is invalid.');
  }
  return value;
}

function isValidV2SArchitectureStop(value) {
  const gates = value?.gates;
  const oracle = value?.oracle;
  const frontier = value?.bestFixedMatrixFrontier;
  const bindings = value?.evidenceBindings;
  const lifecycle = value?.lifecycle;
  return (
    value?.schema === 'jotluck.autocomplete.v2s-architecture-stop.v1' &&
    value.schemaVersion === 1 &&
    value.engine === V2S_ENGINE &&
    value.architectureId === V2S_ENGINE &&
    value.status === 'architecture-blocked' &&
    value.formalResult === false &&
    value.releaseEvidence === false &&
    value.stopLongTraining === true &&
    ['development-oracle-ceiling', 'asset-budget', 'runtime-budget'].includes(value.reasonCode) &&
    Number.isFinite(Date.parse(value.recordedAt)) &&
    /^[0-9a-f]{40}$/u.test(value.sourceCommit) &&
    value.workingTreeClean === false &&
    gates?.oracleAt8AbsoluteMinimum === 0.4 &&
    gates.oracleAt32AbsoluteMinimum === 0.45 &&
    gates.perLanguageOracleAt8AbsoluteMinimum === 0.32 &&
    isValidArchitectureOracleSummary(oracle) &&
    value.frontierDerivation === 'per-language-max-over-fixed-matrix' &&
    isValidArchitectureOracleSummary(frontier) &&
    frontier.opportunities === oracle.opportunities &&
    frontier.at8.hits >= oracle.at8.hits &&
    frontier.at32.hits >= oracle.at32.hits &&
    !(
      value.reasonCode === 'development-oracle-ceiling' &&
      passesArchitectureOracleGates(frontier, gates)
    ) &&
    typeof value.candidateId === 'string' &&
    value.candidateId.length > 0 &&
    value.methodCorrection === 'bpe-en+unigram-zh' &&
    bindings !== null &&
    typeof bindings === 'object' &&
    Object.keys(bindings).length >= 4 &&
    Object.values(bindings).every(
      (binding) =>
        binding !== null &&
        typeof binding === 'object' &&
        typeof binding.path === 'string' &&
        binding.path.length > 0 &&
        isSha256(binding.sha256),
    ) &&
    lifecycle?.gateTrainingStarted === false &&
    lifecycle.finalHoldoutsRead === false &&
    lifecycle.publicWritten === false &&
    lifecycle.v21Unlocked === false
  );
}

function isValidArchitectureOracleSummary(value) {
  if (
    value?.denominator !== 'all-development-opportunities' ||
    !Number.isSafeInteger(value.opportunities) ||
    value.opportunities < 1 ||
    !Number.isSafeInteger(value.completeOpportunities) ||
    !Number.isSafeInteger(value.silenceOpportunities) ||
    value.completeOpportunities + value.silenceOpportunities !== value.opportunities
  ) {
    return false;
  }
  return [value.at8, value.at32].every((level) => {
    if (
      !Number.isSafeInteger(level?.hits) ||
      level.hits < 0 ||
      level.hits > value.completeOpportunities ||
      level.absoluteRate !== level.hits / value.opportunities
    ) {
      return false;
    }
    const zh = level.byLanguage?.zh;
    const en = level.byLanguage?.en;
    if (!zh || !en) return false;
    return (
      zh.opportunities + en.opportunities === value.opportunities &&
      zh.hits + en.hits === level.hits &&
      [zh, en].every(
        (item) =>
          Number.isSafeInteger(item.opportunities) &&
          item.opportunities > 0 &&
          Number.isSafeInteger(item.hits) &&
          item.hits >= 0 &&
          item.hits <= item.opportunities &&
          item.absoluteRate === item.hits / item.opportunities,
      )
    );
  });
}

function passesArchitectureOracleGates(oracle, gates) {
  return (
    oracle.at8.absoluteRate >= gates.oracleAt8AbsoluteMinimum &&
    oracle.at32.absoluteRate >= gates.oracleAt32AbsoluteMinimum &&
    oracle.at8.byLanguage.zh.absoluteRate >= gates.perLanguageOracleAt8AbsoluteMinimum &&
    oracle.at8.byLanguage.en.absoluteRate >= gates.perLanguageOracleAt8AbsoluteMinimum
  );
}

function buildReleaseFacts({
  rootDir,
  assetBytes,
  assetPath,
  evidencePaths,
  expectedEvaluatorFiles,
  fixtureProtocol,
}) {
  if (
    !Buffer.isBuffer(assetBytes) ||
    assetBytes.byteLength === 0 ||
    assetBytes.byteLength > MAX_ASSET_BYTES
  ) {
    throw new Error('V2S public asset is empty or exceeds the 6 MiB hard limit.');
  }
  const container = verifyV2SContainer(assetBytes);
  const asset = {
    sha256: sha256(assetBytes),
    bytes: assetBytes.byteLength,
    containerHeaderSha256: container.headerSha256,
  };
  const evidence = {};
  for (const key of EVIDENCE_KEYS) {
    const relativePath = evidencePaths[key];
    const file = loadWorkspaceFile(rootDir, relativePath, `${key} evidence`);
    assertOutsidePublic(rootDir, file.absolutePath, `${key} evidence`);
    evidence[key] = {
      path: normalizeRelativePath(relativePath),
      sha256: sha256(file.bytes),
      value: parseJson(file.bytes, `${key} evidence`),
    };
  }

  const selection = verifySelection(rootDir, evidence.selection.value, fixtureProtocol);
  verifyGovernance({
    rootDir,
    value: evidence.governance.value,
    selection,
    holdoutEvidence: [
      evidence.coldValidation.value,
      evidence.workspaceValidation.value,
      evidence.coldFinal.value,
      evidence.workspaceFinal.value,
    ],
    fixtureProtocol,
  });
  const evaluatorIdentity = verifyEvaluatorSourceTree(
    rootDir,
    evidence.evaluator.value,
    expectedEvaluatorFiles,
  );
  const coldValidationMetrics = verifyHoldoutEvidence(
    rootDir,
    evidence.coldValidation.value,
    'cold-validation-v2s-v1',
    asset.sha256,
    assetBytes,
    assetPath,
    selection.treeSha256,
    evaluatorIdentity.treeSha256,
    fixtureProtocol,
  );
  const workspaceValidationMetrics = verifyHoldoutEvidence(
    rootDir,
    evidence.workspaceValidation.value,
    'workspace-validation-v2s-v1',
    asset.sha256,
    assetBytes,
    assetPath,
    selection.treeSha256,
    evaluatorIdentity.treeSha256,
    fixtureProtocol,
  );
  const coldFinalMetrics = verifyHoldoutEvidence(
    rootDir,
    evidence.coldFinal.value,
    'cold-final-v2s-v1',
    asset.sha256,
    assetBytes,
    assetPath,
    selection.treeSha256,
    evaluatorIdentity.treeSha256,
    fixtureProtocol,
  );
  const workspaceFinalMetrics = verifyHoldoutEvidence(
    rootDir,
    evidence.workspaceFinal.value,
    'workspace-final-v2s-v1',
    asset.sha256,
    assetBytes,
    assetPath,
    selection.treeSha256,
    evaluatorIdentity.treeSha256,
    fixtureProtocol,
  );
  const finalConsumption = verifyFinalConsumption({
    value: evidence.finalConsumption.value,
    modelSha256: asset.sha256,
    coldFinalHoldoutSha256: coldFinalMetrics.holdoutSha256,
    workspaceFinalHoldoutSha256: workspaceFinalMetrics.holdoutSha256,
    coldFinalEvidenceSha256: evidence.coldFinal.sha256,
    workspaceFinalEvidenceSha256: evidence.workspaceFinal.sha256,
  });
  const holdoutReplayTreeSha256 = sha256(
    canonicalJson({
      coldValidation: coldValidationMetrics.replayTreeSha256,
      workspaceValidation: workspaceValidationMetrics.replayTreeSha256,
      coldFinal: coldFinalMetrics.replayTreeSha256,
      workspaceFinal: workspaceFinalMetrics.replayTreeSha256,
    }),
  );
  const runtimeMetrics = verifyRuntimeEvidence({
    value: evidence.runtime.value,
    modelSha256: asset.sha256,
    evaluatorTreeSha256: evaluatorIdentity.treeSha256,
    holdoutReplayTreeSha256,
    fixtureProtocol,
  });
  verifyWebviewEvidence(evidence.webview.value, asset.sha256, finalConsumption.consumedAt);
  if (
    new Set([
      coldValidationMetrics.holdoutSha256,
      workspaceValidationMetrics.holdoutSha256,
      coldFinalMetrics.holdoutSha256,
      workspaceFinalMetrics.holdoutSha256,
    ]).size !== 4
  ) {
    throw new Error('V2S cold/workspace validation/final must bind four distinct frozen holdouts.');
  }

  const metrics = {
    validation: {
      cold: coldValidationMetrics,
      workspace: workspaceValidationMetrics,
    },
    final: {
      cold: coldFinalMetrics,
      workspace: workspaceFinalMetrics,
      consumption: finalConsumption,
    },
    runtime: runtimeMetrics,
  };
  const bindings = Object.fromEntries(
    EVIDENCE_KEYS.map((key) => [key, { path: evidence[key].path, sha256: evidence[key].sha256 }]),
  );
  const releaseCore = {
    schemaVersion: 6,
    engine: V2S_ENGINE,
    asset,
    evidenceBindings: bindings,
    training: {
      selectionSha256: selection.selectionSha256,
      inputTreeSha256: selection.treeSha256,
    },
    metrics,
  };
  return {
    asset,
    bindings,
    training: releaseCore.training,
    metrics,
    publishedAt: evidence.webview.value.completedAt,
    releaseId: sha256(canonicalJson(releaseCore)),
  };
}

function buildManifest(facts) {
  return {
    schema: V2S_MANIFEST_SCHEMA,
    schemaVersion: 6,
    engine: V2S_ENGINE,
    releaseId: facts.releaseId,
    publishedAt: facts.publishedAt,
    runtimeEligible: true,
    qualityGatePassed: true,
    releaseEligible: true,
    asset: {
      file: `${V2S_ENGINE}.${facts.asset.sha256}.bin`,
      sha256: facts.asset.sha256,
      bytes: facts.asset.bytes,
      containerHeaderSha256: facts.asset.containerHeaderSha256,
    },
    evidenceBindings: facts.bindings,
    training: facts.training,
    metrics: facts.metrics,
  };
}

function assertManifestShape(manifest) {
  if (
    manifest?.schema !== V2S_MANIFEST_SCHEMA ||
    manifest.schemaVersion !== 6 ||
    manifest.engine !== V2S_ENGINE ||
    manifest.runtimeEligible !== true ||
    manifest.qualityGatePassed !== true ||
    manifest.releaseEligible !== true ||
    !isSha256(manifest.releaseId) ||
    !Number.isFinite(Date.parse(manifest.publishedAt)) ||
    !manifest.asset ||
    !manifest.training ||
    !isSha256(manifest.training.selectionSha256) ||
    !isSha256(manifest.training.inputTreeSha256) ||
    !manifest.evidenceBindings
  ) {
    throw new Error('V2S public manifest identity is invalid.');
  }
  if (
    manifest.asset.file !== `${V2S_ENGINE}.${manifest.asset.sha256}.bin` ||
    !isSha256(manifest.asset.sha256) ||
    !isSha256(manifest.asset.containerHeaderSha256) ||
    !Number.isSafeInteger(manifest.asset.bytes) ||
    manifest.asset.bytes <= 0 ||
    manifest.asset.bytes > MAX_ASSET_BYTES
  ) {
    throw new Error('V2S public asset binding is not content-addressed or is invalid.');
  }
  for (const key of EVIDENCE_KEYS) {
    const binding = manifest.evidenceBindings[key];
    if (!binding || typeof binding.path !== 'string' || !isSha256(binding.sha256)) {
      throw new Error(`V2S public manifest is missing ${key} evidence.`);
    }
  }
}

function verifySelection(rootDir, value, fixtureProtocol = false) {
  if (
    value?.schema !== 'jotluck.autocomplete.v2s-corpus-selection.v1' ||
    value.schemaVersion !== 1 ||
    !value.sourceSelection ||
    typeof value.sourceSelection.path !== 'string' ||
    !isSha256(value.sourceSelection.sha256) ||
    value.sourceSelection.schema !== 'jotluck.autocomplete.v2r-corpus-selection.v1' ||
    !value.generator ||
    value.generator.version !== 'jotluck-project-owned-short-notes-v3.1' ||
    value.generator.seed !== 'v2r-project-owned-2026-07-12-b' ||
    !Array.isArray(value.documents) ||
    value.documents.length === 0
  ) {
    throw new Error('V2S selection evidence is invalid.');
  }
  const upstream = loadWorkspaceFile(rootDir, value.sourceSelection.path, 'V2S upstream selection');
  assertOutsidePublic(rootDir, upstream.absolutePath, 'V2S upstream selection');
  if (sha256(upstream.bytes) !== value.sourceSelection.sha256) {
    throw new Error('V2S upstream selection SHA-256 is invalid.');
  }
  const upstreamValue = parseJson(upstream.bytes, 'V2S upstream selection');
  if (
    upstreamValue?.schema !== value.sourceSelection.schema ||
    !Array.isArray(upstreamValue.sources)
  ) {
    throw new Error('V2S upstream selection schema is invalid.');
  }
  if (!Array.isArray(upstreamValue.documents) || upstreamValue.documents.length === 0) {
    const legacyFixtureRegistry =
      fixtureProtocol &&
      upstreamValue.sources.every(
        (source) => source && typeof source.id === 'string' && source.kind === undefined,
      );
    if (!legacyFixtureRegistry) {
      throw new Error('V2S upstream selection has no document registry to trace selected inputs.');
    }
    return verifyLegacyFixtureSelection(rootDir, value);
  }
  const approvedSources = verifyUpstreamSources(rootDir, upstreamValue.sources);
  const upstreamDocuments = new Map();
  for (const [index, document] of upstreamValue.documents.entries()) {
    const normalized = normalizeUpstreamDocument(document, index);
    if (upstreamDocuments.has(normalized.documentId)) {
      throw new Error(`V2S upstream selection has duplicate document ${normalized.documentId}.`);
    }
    upstreamDocuments.set(normalized.documentId, normalized);
  }
  const ids = new Set();
  const paths = new Set();
  const verifiedDocuments = [];
  for (const document of value.documents) {
    if (
      !document ||
      typeof document.documentId !== 'string' ||
      !document.documentId ||
      ids.has(document.documentId) ||
      typeof document.sourceId !== 'string' ||
      !['zh', 'en'].includes(document.language) ||
      typeof document.category !== 'string' ||
      typeof document.relativePath !== 'string' ||
      !['train', 'development', 'internal-selection'].includes(document.split) ||
      !isSha256(document.sha256) ||
      !Number.isSafeInteger(document.bytes) ||
      document.bytes <= 0 ||
      document.bytes > 512 * 1024
    ) {
      throw new Error('V2S selection contains an invalid or duplicate document.');
    }
    const relativePath = assertBoundedRelativePath(
      document.relativePath,
      `V2S selected document ${document.documentId}`,
      1_024,
    );
    if (paths.has(relativePath)) {
      throw new Error(`V2S selection contains duplicate path ${relativePath}.`);
    }
    const approvedSource = approvedSources.get(document.sourceId);
    if (!approvedSource) {
      throw new Error(
        `V2S selected document ${document.documentId} references an unknown or unapproved source.`,
      );
    }
    if (
      document.language !== approvedSource.language ||
      document.category !== approvedSource.category ||
      !isPathInsideRoot(relativePath, approvedSource.contentRoot)
    ) {
      throw new Error(
        `V2S selected document ${document.documentId} disagrees with its approved source metadata or contentRoot.`,
      );
    }
    const upstreamDocument = upstreamDocuments.get(document.documentId);
    if (!upstreamDocument) {
      throw new Error(
        `V2S selected document ${document.documentId} is missing from the upstream document registry.`,
      );
    }
    const selectedIdentity = {
      documentId: document.documentId,
      sourceId: document.sourceId,
      language: document.language,
      category: document.category,
      relativePath,
      split: document.split,
      bytes: document.bytes,
      sha256: document.sha256,
    };
    if (canonicalJson(upstreamDocument) !== canonicalJson(selectedIdentity)) {
      throw new Error(
        `V2S selected document ${document.documentId} differs from its upstream document entry.`,
      );
    }
    const selectedFile = loadWorkspaceFile(
      rootDir,
      relativePath,
      `V2S selected document ${document.documentId}`,
    );
    assertOutsidePublic(
      rootDir,
      selectedFile.absolutePath,
      `V2S selected document ${document.documentId}`,
    );
    if (
      selectedFile.bytes.byteLength !== document.bytes ||
      sha256(selectedFile.bytes) !== document.sha256
    ) {
      throw new Error(`V2S selected document ${document.documentId} changed after selection.`);
    }
    let text;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(selectedFile.bytes);
    } catch (error) {
      throw new Error(
        `V2S selected document ${document.documentId} is not valid UTF-8: ${errorMessage(error)}.`,
      );
    }
    ids.add(document.documentId);
    paths.add(relativePath);
    verifiedDocuments.push({ ...selectedIdentity, text });
  }
  const treeSha256 = sha256(
    canonicalJson(
      value.documents
        .map((document) => ({ documentId: document.documentId, sha256: document.sha256 }))
        .sort((left, right) => left.documentId.localeCompare(right.documentId, 'en')),
    ),
  );
  const selectedBytes = value.documents.reduce((sum, document) => sum + document.bytes, 0);
  const unsigned = { ...value };
  delete unsigned.selectionSha256;
  const selectionSha256 = sha256(canonicalJson(unsigned));
  if (
    value.inputTreeSha256 !== treeSha256 ||
    value.selectionSha256 !== selectionSha256 ||
    value.documentCount !== value.documents.length ||
    value.selectedBytes !== selectedBytes ||
    selectedBytes > 30 * 1024 * 1024
  ) {
    throw new Error('V2S selection input tree was not computed from its document members.');
  }
  return {
    treeSha256,
    selectionSha256,
    documents: verifiedDocuments,
    sources: approvedSources,
    strict: true,
  };
}

function verifyLegacyFixtureSelection(rootDir, value) {
  const ids = new Set();
  for (const document of value.documents) {
    if (!document || typeof document.documentId !== 'string' || ids.has(document.documentId)) {
      throw new Error('V2S fixture selection contains an invalid or duplicate document.');
    }
    const selectedFile = loadWorkspaceFile(
      rootDir,
      document.relativePath,
      `V2S fixture selected document ${document.documentId}`,
    );
    if (
      selectedFile.bytes.byteLength !== document.bytes ||
      sha256(selectedFile.bytes) !== document.sha256
    ) {
      throw new Error(`V2S fixture selected document ${document.documentId} changed.`);
    }
    ids.add(document.documentId);
  }
  const treeSha256 = sha256(
    canonicalJson(
      value.documents
        .map((document) => ({ documentId: document.documentId, sha256: document.sha256 }))
        .sort((left, right) => left.documentId.localeCompare(right.documentId, 'en')),
    ),
  );
  const unsigned = { ...value };
  delete unsigned.selectionSha256;
  const selectionSha256 = sha256(canonicalJson(unsigned));
  if (
    value.inputTreeSha256 !== treeSha256 ||
    value.selectionSha256 !== selectionSha256 ||
    value.documentCount !== value.documents.length ||
    value.selectedBytes !== value.documents.reduce((sum, document) => sum + document.bytes, 0)
  ) {
    throw new Error('V2S fixture selection identity is invalid.');
  }
  return { treeSha256, selectionSha256, documents: [], sources: new Map(), strict: false };
}

function verifyGovernance({ rootDir, value, selection, holdoutEvidence, fixtureProtocol }) {
  const metrics = value?.metrics;
  if (!selection.strict && fixtureProtocol) {
    if (
      value?.schemaVersion !== 1 ||
      value.classification !== 'autocomplete-v2s-governance' ||
      value.passed !== true ||
      value.inputTreeSha256 !== selection.treeSha256 ||
      value.selectionSha256 !== selection.selectionSha256 ||
      !metrics ||
      metrics.unknownLicenseSources !== 0 ||
      metrics.privacyFindings !== 0 ||
      metrics.holdoutOverlapCount !== 0 ||
      !isRate(metrics.exactDuplicateRate) ||
      metrics.exactDuplicateRate > 0.01 ||
      !isRate(metrics.nearDuplicateRate) ||
      metrics.nearDuplicateRate > 0.03
    ) {
      throw new Error('V2S fixture governance evidence failed its release gates.');
    }
    return;
  }
  if (
    value?.schemaVersion !== 1 ||
    value.classification !== 'autocomplete-v2s-governance' ||
    value.inputTreeSha256 !== selection.treeSha256 ||
    value.selectionSha256 !== selection.selectionSha256 ||
    !metrics ||
    !Array.isArray(value.rawEntries) ||
    !Array.isArray(value.nearDuplicatePairs)
  ) {
    throw new Error('V2S governance raw evidence identity is invalid.');
  }
  const documentsById = new Map(
    selection.documents.map((document) => [document.documentId, document]),
  );
  if (value.rawEntries.length !== documentsById.size) {
    throw new Error('V2S governance raw entries do not cover every selected document.');
  }
  const seenEntries = new Set();
  const normalizedHashes = new Map();
  let privacyFindings = 0;
  let declaredHoldoutOverlaps = 0;
  for (const entry of value.rawEntries) {
    if (
      !entry ||
      typeof entry.documentId !== 'string' ||
      seenEntries.has(entry.documentId) ||
      typeof entry.sourceId !== 'string' ||
      !isSha256(entry.sha256) ||
      !isSha256(entry.normalizedSha256) ||
      !Array.isArray(entry.privacyFindings) ||
      !entry.privacyFindings.every(
        (finding) => typeof finding === 'string' && finding.length > 0,
      ) ||
      !Array.isArray(entry.holdoutOverlaps) ||
      !entry.holdoutOverlaps.every((overlap) => typeof overlap === 'string' && overlap.length > 0)
    ) {
      throw new Error('V2S governance contains an invalid or duplicate raw entry.');
    }
    const document = documentsById.get(entry.documentId);
    if (!document || entry.sourceId !== document.sourceId || entry.sha256 !== document.sha256) {
      throw new Error(`V2S governance raw entry ${entry.documentId} is detached from selection.`);
    }
    const normalizedSha256 = sha256(normalizeGovernanceText(document.text));
    if (entry.normalizedSha256 !== normalizedSha256) {
      throw new Error(`V2S governance normalized hash mismatch for ${entry.documentId}.`);
    }
    const detectedPrivacyFindings = detectPrivacyFindings(document.text);
    if (
      canonicalJson([...entry.privacyFindings].sort()) !== canonicalJson(detectedPrivacyFindings)
    ) {
      throw new Error(`V2S governance privacy findings are incomplete for ${entry.documentId}.`);
    }
    privacyFindings += detectedPrivacyFindings.length;
    declaredHoldoutOverlaps += new Set(entry.holdoutOverlaps).size;
    normalizedHashes.set(entry.documentId, normalizedSha256);
    seenEntries.add(entry.documentId);
  }
  const exactDuplicateDocuments = normalizedHashes.size - new Set(normalizedHashes.values()).size;
  const exactDuplicateRate = ratio(exactDuplicateDocuments, normalizedHashes.size);
  const nearDuplicatePairs = verifyNearDuplicatePairs(value.nearDuplicatePairs, documentsById);
  const nearDuplicateRate = ratio(nearDuplicatePairs, normalizedHashes.size);
  const actualHoldoutOverlaps = findExactHoldoutOverlaps(
    rootDir,
    selection.documents,
    holdoutEvidence,
  );
  const recomputed = {
    unknownLicenseSources: 0,
    privacyFindings,
    holdoutOverlapCount: actualHoldoutOverlaps.length,
    exactDuplicateRate,
    nearDuplicateRate,
  };
  if (declaredHoldoutOverlaps !== actualHoldoutOverlaps.length) {
    throw new Error('V2S governance raw holdout-overlap entries are incomplete.');
  }
  for (const [key, expected] of Object.entries(recomputed)) {
    if (metrics[key] !== expected) {
      throw new Error(`V2S governance metric ${key} was not recomputed from raw entries.`);
    }
  }
  if (
    value.passed !== true ||
    recomputed.unknownLicenseSources !== 0 ||
    recomputed.privacyFindings !== 0 ||
    recomputed.holdoutOverlapCount !== 0 ||
    recomputed.exactDuplicateRate > 0.01 ||
    recomputed.nearDuplicateRate > 0.03
  ) {
    throw new Error('V2S governance evidence failed independently recomputed release gates.');
  }
}

function verifyUpstreamSources(rootDir, sources) {
  const approved = new Map();
  for (const [index, source] of sources.entries()) {
    const label = `V2S upstream source[${index}]`;
    if (!source || typeof source.id !== 'string' || !source.id || approved.has(source.id)) {
      throw new Error(`${label} has an invalid or duplicate source id.`);
    }
    const normalized = approveUpstreamSource(source, label);
    assertBoundedRelativePath(normalized.contentRoot, `${label} contentRoot`, 512);
    const licensePath = assertBoundedRelativePath(
      normalized.licenseEvidencePath,
      `${label} license evidence`,
      512,
    );
    const license = loadWorkspaceFile(rootDir, licensePath, `${label} license evidence`);
    assertOutsidePublic(rootDir, license.absolutePath, `${label} license evidence`);
    approved.set(normalized.id, normalized);
  }
  return approved;
}

function approveUpstreamSource(source, label) {
  if (source.id === TATOEBA_SOURCE_ID) {
    if (
      source.kind !== 'tatoeba-cc0' ||
      source.language !== 'en' ||
      source.category !== 'reading-note' ||
      source.contentRoot !== TATOEBA_CONTENT_ROOT ||
      source.licenseSpdx !== 'CC0-1.0' ||
      source.licenseEvidencePath !== 'scripts/corpus/licenses/tatoeba-cc0.md' ||
      source.cleanerVersion !== 'jotluck-tatoeba-cc0-cleaner-v1'
    ) {
      throw new Error(`${label} does not match the approved Tatoeba CC0 source.`);
    }
    return {
      id: source.id,
      language: 'en',
      category: 'reading-note',
      contentRoot: TATOEBA_CONTENT_ROOT,
      licenseSpdx: 'CC0-1.0',
      licenseEvidencePath: 'scripts/corpus/licenses/tatoeba-cc0.md',
    };
  }
  const match =
    /^project-v3-(zh|en)-(field-observation|maintenance-log|meeting-note|reading-note|household-plan)$/u.exec(
      source.id,
    );
  if (!match) throw new Error(`${label} is an unknown V2S source.`);
  const language = match[1];
  const category = match[2];
  const contentRoot = `${PROJECT_SOURCE_PREFIX}/${language}/${category}`;
  if (
    source.kind !== 'project-owned' ||
    source.language !== language ||
    source.category !== category ||
    source.contentRoot !== contentRoot ||
    source.licenseSpdx !== 'MIT' ||
    source.licenseEvidencePath !== 'LICENSE' ||
    source.cleanerVersion !== PROJECT_GENERATOR_VERSION ||
    source.generatorVersion !== PROJECT_GENERATOR_VERSION ||
    source.generatorSeed !== PROJECT_GENERATOR_SEED
  ) {
    throw new Error(`${label} does not match the approved deterministic project source.`);
  }
  return {
    id: source.id,
    language,
    category,
    contentRoot,
    licenseSpdx: 'MIT',
    licenseEvidencePath: 'LICENSE',
  };
}

function normalizeUpstreamDocument(document, index) {
  const label = `V2S upstream document[${index}]`;
  if (
    !document ||
    typeof document.documentId !== 'string' ||
    !document.documentId ||
    typeof document.sourceId !== 'string' ||
    !['zh', 'en'].includes(document.language) ||
    typeof document.category !== 'string' ||
    typeof document.relativePath !== 'string' ||
    !Number.isSafeInteger(document.bytes) ||
    document.bytes <= 0 ||
    document.bytes > 512 * 1024 ||
    !isSha256(document.sha256)
  ) {
    throw new Error(`${label} has invalid fields.`);
  }
  return {
    documentId: document.documentId,
    sourceId: document.sourceId,
    language: document.language,
    category: document.category,
    relativePath: assertBoundedRelativePath(document.relativePath, label, 1_024),
    split: normalizeSelectionSplit(document.split, label),
    bytes: document.bytes,
    sha256: document.sha256,
  };
}

function normalizeSelectionSplit(value, label) {
  if (['train', 'development', 'internal-selection'].includes(value)) return value;
  if (value === 'internalSelection') return 'internal-selection';
  throw new Error(`${label} has an unsupported split.`);
}

function assertBoundedRelativePath(value, label, maximumLength) {
  const normalized = normalizeRelativePath(value);
  if (
    value !== normalized ||
    normalized.length > maximumLength ||
    normalized.includes('\0') ||
    normalized.split('/').some((segment) => !segment || segment === '.')
  ) {
    throw new Error(`${label} is not a canonical bounded workspace-relative path.`);
  }
  return normalized;
}

function isPathInsideRoot(relativePath, contentRoot) {
  return relativePath === contentRoot || relativePath.startsWith(`${contentRoot}/`);
}

function normalizeGovernanceText(value) {
  return value
    .normalize('NFKC')
    .replace(/\r\n?/gu, '\n')
    .replace(/[ \t]+/gu, ' ')
    .trim()
    .toLocaleLowerCase('en-US');
}

function detectPrivacyFindings(value) {
  const findings = [];
  if (/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu.test(value)) findings.push('email');
  if (/(?:\+?\d[\d ()-]{7,}\d)/u.test(value)) findings.push('phone');
  if (/\b(?:api[_ -]?key|access[_ -]?token|password)\s*[:=]/iu.test(value)) {
    findings.push('credential-like-text');
  }
  return findings.sort();
}

function verifyNearDuplicatePairs(pairs, documentsById) {
  const seen = new Set();
  for (const pair of pairs) {
    if (
      !pair ||
      typeof pair.leftDocumentId !== 'string' ||
      typeof pair.rightDocumentId !== 'string' ||
      pair.leftDocumentId === pair.rightDocumentId ||
      !Number.isFinite(pair.similarity) ||
      pair.similarity < 0.9 ||
      pair.similarity > 1
    ) {
      throw new Error('V2S governance contains an invalid near-duplicate pair.');
    }
    const ordered = [pair.leftDocumentId, pair.rightDocumentId].sort((left, right) =>
      left.localeCompare(right, 'en'),
    );
    const key = `${ordered[0]}\0${ordered[1]}`;
    if (seen.has(key) || !documentsById.has(ordered[0]) || !documentsById.has(ordered[1])) {
      throw new Error('V2S governance near-duplicate pair is duplicate or detached.');
    }
    const actualSimilarity = trigramJaccard(
      documentsById.get(ordered[0]).text,
      documentsById.get(ordered[1]).text,
    );
    if (Math.abs(actualSimilarity - pair.similarity) > 1e-12 || actualSimilarity < 0.9) {
      throw new Error('V2S governance near-duplicate similarity is not reproducible.');
    }
    seen.add(key);
  }
  return seen.size;
}

function trigramJaccard(left, right) {
  const leftGrams = characterNgrams(normalizeGovernanceText(left), 3);
  const rightGrams = characterNgrams(normalizeGovernanceText(right), 3);
  const union = new Set([...leftGrams, ...rightGrams]);
  if (union.size === 0) return left === right ? 1 : 0;
  let intersection = 0;
  for (const gram of leftGrams) if (rightGrams.has(gram)) intersection += 1;
  return intersection / union.size;
}

function characterNgrams(value, size) {
  const points = Array.from(value);
  if (points.length < size) return new Set([value]);
  const grams = new Set();
  for (let index = 0; index <= points.length - size; index += 1) {
    grams.add(points.slice(index, index + size).join(''));
  }
  return grams;
}

function findExactHoldoutOverlaps(rootDir, documents, holdoutEvidence) {
  const trainingByText = new Map();
  for (const document of documents) {
    const normalized = normalizeGovernanceText(document.text);
    trainingByText.set(normalized, [
      ...(trainingByText.get(normalized) ?? []),
      document.documentId,
    ]);
  }
  const overlaps = [];
  for (const evidence of holdoutEvidence) {
    if (typeof evidence?.holdoutPath !== 'string' || !isSha256(evidence.holdoutSha256)) {
      throw new Error('V2S governance cannot bind an invalid holdout reference.');
    }
    const file = loadWorkspaceFile(rootDir, evidence.holdoutPath, 'V2S governance holdout');
    if (sha256(file.bytes) !== evidence.holdoutSha256) {
      throw new Error('V2S governance holdout SHA-256 is invalid.');
    }
    const holdout = parseJson(file.bytes, 'V2S governance holdout');
    const entries = [
      ...(Array.isArray(holdout.targets) ? holdout.targets : []),
      ...(Array.isArray(holdout.supportDocuments) ? holdout.supportDocuments : []),
    ];
    for (const entry of entries) {
      if (typeof entry?.text !== 'string') continue;
      const trainingIds = trainingByText.get(normalizeGovernanceText(entry.text)) ?? [];
      for (const documentId of trainingIds) {
        overlaps.push(
          `${documentId}:${evidence.holdoutSha256}:${String(entry.id ?? entry.path ?? '')}`,
        );
      }
    }
  }
  return overlaps.sort();
}

function verifyHoldoutEvidence(
  rootDir,
  value,
  classification,
  modelSha256,
  assetBytes,
  assetPath,
  selectionTreeSha256,
  evaluatorTreeSha256,
  fixtureProtocol,
) {
  if (
    value?.schema !== 'jotluck.autocomplete.v2s-observation-evidence.v1' ||
    value.schemaVersion !== 1 ||
    value.classification !== classification ||
    value.modelSha256 !== modelSha256 ||
    value.inputTreeSha256 !== selectionTreeSha256 ||
    typeof value.holdoutPath !== 'string' ||
    !isSha256(value.holdoutSha256) ||
    value.evaluatorTreeSha256 !== evaluatorTreeSha256 ||
    !Array.isArray(value.observations) ||
    value.observations.length !== 200
  ) {
    throw new Error(`V2S ${classification} holdout identity is invalid.`);
  }
  const holdoutCheckpoints = verifyFrozenHoldout(rootDir, value, classification);
  const ids = new Set();
  const categories = [
    'field-observation',
    'maintenance-log',
    'meeting-note',
    'reading-note',
    'household-plan',
  ];
  const normalizedObservations = [];
  for (const observation of value.observations) {
    if (
      !observation ||
      typeof observation.checkpointId !== 'string' ||
      !observation.checkpointId ||
      ids.has(observation.checkpointId) ||
      !['zh', 'en'].includes(observation.language) ||
      !categories.includes(observation.category) ||
      !['complete', 'silence'].includes(observation.kind) ||
      observation.expectedBehavior !== observation.kind ||
      !Array.isArray(observation.acceptableSuffixes) ||
      !observation.acceptableSuffixes.every(
        (suffix) => typeof suffix === 'string' && suffix.length > 0,
      ) ||
      !Object.hasOwn(observation, 'b0Top1') ||
      !(observation.b0Top1 === null || isObservedCandidate(observation.b0Top1)) ||
      !Object.hasOwn(observation, 'publicCandidates') ||
      !Array.isArray(observation.publicCandidates) ||
      observation.publicCandidates.length > 32 ||
      !observation.publicCandidates.every(
        (candidate) =>
          isObservedCandidate(candidate) &&
          candidate.providerId === V2S_ENGINE &&
          candidate.sourceLayer === 'l3',
      ) ||
      (!fixtureProtocol &&
        (!Object.hasOwn(observation, 'gatedPublicCandidates') ||
          !Array.isArray(observation.gatedPublicCandidates) ||
          observation.gatedPublicCandidates.length > 32 ||
          !observation.gatedPublicCandidates.every(
            (candidate) =>
              isObservedCandidate(candidate) &&
              candidate.providerId === V2S_ENGINE &&
              candidate.sourceLayer === 'l3',
          ))) ||
      !Object.hasOwn(observation, 'combinedTop1') ||
      !(observation.combinedTop1 === null || isObservedCandidate(observation.combinedTop1)) ||
      !Object.hasOwn(observation, 'allRequestLatencyMs') ||
      !isLatency(observation.allRequestLatencyMs) ||
      (observation.combinedTop1 !== null &&
        (!Object.hasOwn(observation, 'visibleLatencyMs') ||
          !isLatency(observation.visibleLatencyMs))) ||
      !Object.hasOwn(observation, 'fallback') ||
      ![true, false].includes(observation.fallback) ||
      !Object.hasOwn(observation, 'timeout') ||
      ![true, false].includes(observation.timeout) ||
      !Object.hasOwn(observation, 'rejectionReasons') ||
      !Array.isArray(observation.rejectionReasons) ||
      !observation.rejectionReasons.every(
        (reason) => typeof reason === 'string' && reason.length > 0,
      ) ||
      (observation.kind === 'silence' && observation.acceptableSuffixes.length > 0) ||
      (observation.kind === 'complete' && observation.acceptableSuffixes.length === 0)
    ) {
      throw new Error(`V2S ${classification} holdout contains an invalid observation.`);
    }
    const frozen = holdoutCheckpoints.get(observation.checkpointId);
    if (
      !frozen ||
      frozen.language !== observation.language ||
      frozen.category !== observation.category ||
      frozen.expectedBehavior !== observation.expectedBehavior ||
      canonicalJson(frozen.acceptableSuffixes) !== canonicalJson(observation.acceptableSuffixes)
    ) {
      throw new Error(
        `V2S ${classification} observation ${observation.checkpointId} differs from its frozen holdout.`,
      );
    }
    ids.add(observation.checkpointId);
    normalizedObservations.push(observation);
  }

  const replayTreeSha256 = fixtureProtocol
    ? sha256(
        canonicalJson({
          fixtureProtocol: true,
          classification,
          modelSha256,
          holdoutSha256: value.holdoutSha256,
          evaluatorTreeSha256,
        }),
      )
    : sha256(
        canonicalJson({
          publicModelReplay: verifyV2SObservationReplay({
            rootDir,
            assetBytes,
            modelSha256,
            holdoutSha256: value.holdoutSha256,
            evaluatorTreeSha256,
            classification,
            checkpoints: [...holdoutCheckpoints.entries()].map(([checkpointId, checkpoint]) => ({
              checkpointId,
              ...checkpoint,
            })),
            observations: normalizedObservations,
          }),
          fullStackReplay: verifyV2SFullStackReplay({
            rootDir,
            assetPath,
            modelSha256,
            holdoutPath: value.holdoutPath,
            holdoutSha256: value.holdoutSha256,
            evaluatorTreeSha256,
            observations: normalizedObservations,
          }),
        }),
      );

  const complete = normalizedObservations.filter((item) => item.kind === 'complete').length;
  const silence = normalizedObservations.length - complete;
  const b0 = calculateTop1Metrics(normalizedObservations, (item) => item.b0Top1);
  const combined = calculateTop1Metrics(normalizedObservations, (item) => item.combinedTop1);
  const publicOracle = calculateOracleMetrics(normalizedObservations);
  const combinedByLanguage = Object.fromEntries(
    ['zh', 'en'].map((language) => [
      language,
      calculateTop1Metrics(
        normalizedObservations.filter((item) => item.language === language),
        (item) => item.combinedTop1,
      ),
    ]),
  );
  const publicOracleByLanguage = Object.fromEntries(
    ['zh', 'en'].map((language) => [
      language,
      calculateOracleMetrics(normalizedObservations.filter((item) => item.language === language)),
    ]),
  );
  const combinedByCategory = Object.fromEntries(
    categories.map((category) => [
      category,
      calculateTop1Metrics(
        normalizedObservations.filter((item) => item.category === category),
        (item) => item.combinedTop1,
      ),
    ]),
  );
  const combinedNewUsable = normalizedObservations.filter(
    (item) =>
      isObservationUsable(item.combinedTop1, item) && !isObservationUsable(item.b0Top1, item),
  ).length;
  const combinedLostUsable = normalizedObservations.filter(
    (item) =>
      isObservationUsable(item.b0Top1, item) && !isObservationUsable(item.combinedTop1, item),
  ).length;
  const mixedPublicCandidates = normalizedObservations.reduce(
    (count, item) =>
      count +
      item.publicCandidates.filter((candidate) => isMixedCandidate(candidate.text, item.language))
        .length,
    0,
  );
  const mixedVisibleCandidates = normalizedObservations.filter(
    (item) => item.combinedTop1 && isMixedCandidate(item.combinedTop1.text, item.language),
  ).length;
  const allRequestP90Ms = percentile(
    normalizedObservations.map((item) => item.allRequestLatencyMs),
    0.9,
  );
  const visibleLatencies = normalizedObservations.flatMap((item) =>
    item.combinedTop1 !== null ? [item.visibleLatencyMs] : [],
  );
  if (visibleLatencies.length === 0) {
    throw new Error(`V2S ${classification} holdout has no visible latency evidence.`);
  }
  const visiblePredictionP90Ms = percentile(visibleLatencies, 0.9);
  const fallbackCount = normalizedObservations.filter((item) => item.fallback).length;
  const timeoutCount = normalizedObservations.filter((item) => item.timeout).length;
  const rejectionReasons = {};
  for (const observation of normalizedObservations) {
    for (const reason of observation.rejectionReasons) {
      rejectionReasons[reason] = (rejectionReasons[reason] ?? 0) + 1;
    }
  }
  const metrics = {
    opportunities: normalizedObservations.length,
    holdoutSha256: value.holdoutSha256,
    evaluatorTreeSha256,
    replayTreeSha256,
    complete,
    silence,
    b0,
    combined,
    publicOracle,
    combinedByLanguage,
    combinedByCategory,
    publicOracleByLanguage,
    combinedNewUsable,
    combinedLostUsable,
    mixedPublicCandidates,
    mixedVisibleCandidates,
    allRequestP90Ms,
    visiblePredictionP90Ms,
    fallbackCount,
    fallbackRate: fallbackCount / normalizedObservations.length,
    timeoutCount,
    timeoutRate: timeoutCount / normalizedObservations.length,
    rejectionReasons,
    // Compatibility aliases for existing release reporting. They are derived
    // from the raw combined observation, never copied from an evidence report.
    triggered: combined.triggers,
    usable: combined.usable,
    falseTriggers: combined.silenceFalseTriggers,
    mixed: mixedPublicCandidates + mixedVisibleCandidates,
    triggerRate: combined.triggerRate,
    absoluteUsableRate: combined.absoluteUsableRate,
    falseTriggerRate: combined.silenceFalseRate,
    mixedRate: (mixedPublicCandidates + mixedVisibleCandidates) / normalizedObservations.length,
  };

  const reasons = [];
  if (complete !== 150 || silence !== 50) {
    reasons.push('The holdout must contain exactly 150 complete and 50 silence checkpoints.');
  }
  for (const language of ['zh', 'en']) {
    const languageCombined = combinedByLanguage[language];
    const languageOracle = publicOracleByLanguage[language];
    if (
      languageCombined.opportunities !== 100 ||
      languageCombined.completeOpportunities !== 75 ||
      languageCombined.silenceOpportunities !== 25
    ) {
      reasons.push(
        `${language} must contain exactly 100/75/25 total/complete/silence checkpoints.`,
      );
    }
    if (languageCombined.absoluteUsableRate < 0.3) {
      reasons.push(`${language} absolute usable rate is below 30%.`);
    }
    if (languageOracle.oracleAt8AbsoluteRate < 0.32) {
      reasons.push(`${language} Public Oracle@8 absolute rate is below 32%.`);
    }
  }
  for (const category of categories) {
    const categoryCombined = combinedByCategory[category];
    if (
      categoryCombined.opportunities !== 40 ||
      categoryCombined.completeOpportunities !== 30 ||
      categoryCombined.silenceOpportunities !== 10
    ) {
      reasons.push(`${category} must contain exactly 40/30/10 total/complete/silence checkpoints.`);
    }
    if (categoryCombined.absoluteUsableRate < 0.25) {
      reasons.push(`${category} absolute usable rate is below 25%.`);
    }
  }
  if (combined.triggerRate < 0.35 || combined.triggerRate > 0.42) {
    reasons.push('Combined trigger rate is outside 35%-42%.');
  }
  if (combined.absoluteUsableRate < 0.35) {
    reasons.push('Combined absolute usable rate is below 35%.');
  }
  if (combined.silenceFalseTriggers > 1) {
    reasons.push('Combined silence false triggers exceed 1/50.');
  }
  if (publicOracle.oracleAt8AbsoluteRate < 0.4) {
    reasons.push('Public Oracle@8 absolute rate is below 40%.');
  }
  if (publicOracle.oracleAt32AbsoluteRate < 0.45) {
    reasons.push('Public Oracle@32 absolute rate is below 45%.');
  }
  if (classification.startsWith('cold-') && publicOracle.newCoverageOnB0MissesAbsoluteRate < 0.08) {
    reasons.push('Public Oracle adds less than 8pp coverage on B0 misses.');
  }
  if (combined.usable < b0.usable || combinedLostUsable > combinedNewUsable) {
    reasons.push('Public V2S regresses the paired Public-off B0 result.');
  }
  if (mixedPublicCandidates > 0 || mixedVisibleCandidates > 0) {
    reasons.push('Mixed-language candidates must be zero in the full public pool and ghost.');
  }
  if (allRequestP90Ms > 140 || visiblePredictionP90Ms > 140) {
    reasons.push('All-request or visible prediction p90 exceeds 140ms.');
  }
  if (classification.includes('validation')) {
    if (combined.triggerRate < 0.37 || combined.triggerRate > 0.4) {
      reasons.push('Validation trigger rate is outside the 37%-40% target margin.');
    }
    if (combined.absoluteUsableRate < 0.37) {
      reasons.push('Validation absolute usable rate is below the 37% target margin.');
    }
    if (combined.silenceFalseTriggers > 0) {
      reasons.push('Validation target margin requires zero silence false triggers.');
    }
    if (allRequestP90Ms > 120 || visiblePredictionP90Ms > 120) {
      reasons.push('Validation target margin requires both p90 values at or below 120ms.');
    }
  }
  if (reasons.length > 0) {
    throw new Error(`V2S ${classification} holdout failed gates: ${reasons.join(' ')}`);
  }
  return metrics;
}

function calculateTop1Metrics(observations, selectCandidate) {
  const triggered = observations.filter((item) => selectCandidate(item) !== null);
  const usable = triggered.filter((item) => isObservationUsable(selectCandidate(item), item));
  const silence = observations.filter((item) => item.expectedBehavior === 'silence');
  const silenceFalse = silence.filter((item) => selectCandidate(item) !== null);
  return {
    opportunities: observations.length,
    completeOpportunities: observations.length - silence.length,
    silenceOpportunities: silence.length,
    triggers: triggered.length,
    triggerRate: ratio(triggered.length, observations.length),
    usable: usable.length,
    absoluteUsableRate: ratio(usable.length, observations.length),
    conditionalPrecision: ratio(usable.length, triggered.length),
    silenceFalseTriggers: silenceFalse.length,
    silenceFalseRate: ratio(silenceFalse.length, silence.length),
    unusableTriggers: triggered.length - usable.length,
    unusableTriggerRate: ratio(triggered.length - usable.length, observations.length),
  };
}

function calculateOracleMetrics(observations) {
  const oracleAt8Hits = observations.filter((item) =>
    item.publicCandidates.slice(0, 8).some((candidate) => isObservationUsable(candidate, item)),
  ).length;
  const oracleAt32Hits = observations.filter((item) =>
    item.publicCandidates.some((candidate) => isObservationUsable(candidate, item)),
  ).length;
  const newCoverageOnB0Misses = observations.filter(
    (item) =>
      !isObservationUsable(item.b0Top1, item) &&
      item.publicCandidates.slice(0, 8).some((candidate) => isObservationUsable(candidate, item)),
  ).length;
  return {
    oracleAt8Hits,
    oracleAt8AbsoluteRate: ratio(oracleAt8Hits, observations.length),
    oracleAt32Hits,
    oracleAt32AbsoluteRate: ratio(oracleAt32Hits, observations.length),
    newCoverageOnB0Misses,
    newCoverageOnB0MissesAbsoluteRate: ratio(newCoverageOnB0Misses, observations.length),
  };
}

function isObservationUsable(candidate, observation) {
  return Boolean(
    candidate &&
    isCandidateUsable(
      candidate.text,
      observation.expectedBehavior,
      observation.acceptableSuffixes,
      observation.language,
    ),
  );
}

function verifyFrozenHoldout(rootDir, evidence, classification) {
  const file = loadWorkspaceFile(rootDir, evidence.holdoutPath, `${classification} frozen holdout`);
  assertOutsidePublic(rootDir, file.absolutePath, `${classification} frozen holdout`);
  if (sha256(file.bytes) !== evidence.holdoutSha256) {
    throw new Error(`V2S ${classification} frozen holdout SHA-256 is invalid.`);
  }
  const holdout = parseJson(file.bytes, `${classification} frozen holdout`);
  if (
    holdout?.schema !== 'jotluck.autocomplete.v2s-holdout.v1' ||
    holdout.schemaVersion !== 1 ||
    holdout.classification !== classification ||
    holdout.releaseEvidence !== true ||
    !Array.isArray(holdout.targets) ||
    holdout.targets.length !== 50
  ) {
    throw new Error(`V2S ${classification} frozen holdout identity is invalid.`);
  }
  const checkpoints = new Map();
  for (const target of holdout.targets) {
    if (
      !target ||
      typeof target.id !== 'string' ||
      !target.id ||
      typeof target.text !== 'string' ||
      !['zh', 'en'].includes(target.language) ||
      ![
        'field-observation',
        'maintenance-log',
        'meeting-note',
        'reading-note',
        'household-plan',
      ].includes(target.category) ||
      !Array.isArray(target.checkpoints) ||
      target.checkpoints.length !== 4
    ) {
      throw new Error(`V2S ${classification} frozen holdout target is invalid.`);
    }
    for (const checkpoint of target.checkpoints) {
      if (
        !checkpoint ||
        typeof checkpoint.id !== 'string' ||
        !checkpoint.id ||
        checkpoints.has(checkpoint.id) ||
        !Number.isSafeInteger(checkpoint.cursorOffset) ||
        checkpoint.cursorOffset < 0 ||
        checkpoint.cursorOffset > target.text.length ||
        splitsSurrogatePair(target.text, checkpoint.cursorOffset) ||
        !['complete', 'silence'].includes(checkpoint.expectedBehavior) ||
        !Array.isArray(checkpoint.acceptableSuffixes)
      ) {
        throw new Error(`V2S ${classification} frozen checkpoint is invalid.`);
      }
      checkpoints.set(checkpoint.id, {
        language: target.language,
        category: target.category,
        expectedBehavior: checkpoint.expectedBehavior,
        acceptableSuffixes: checkpoint.acceptableSuffixes,
        text: target.text,
        cursorOffset: checkpoint.cursorOffset,
      });
    }
  }
  if (checkpoints.size !== 200) {
    throw new Error(`V2S ${classification} frozen holdout requires 200 checkpoints.`);
  }
  return checkpoints;
}

export function createV2SObservationReplay({
  rootDir,
  assetBytes,
  modelSha256,
  holdoutSha256,
  evaluatorTreeSha256,
  classification,
  checkpoints,
}) {
  if (
    !Buffer.isBuffer(assetBytes) ||
    sha256(assetBytes) !== modelSha256 ||
    !isSha256(holdoutSha256) ||
    !isSha256(evaluatorTreeSha256) ||
    typeof classification !== 'string' ||
    !classification ||
    !Array.isArray(checkpoints) ||
    checkpoints.length === 0
  ) {
    throw new Error('V2S model replay input identity is invalid.');
  }
  const requests = checkpoints.map((checkpoint) => ({
    checkpointId: checkpoint.checkpointId,
    request: buildReplayRequest(classification, checkpoint),
  }));
  const parserFile = loadWorkspaceFile(
    rootDir,
    'packages/app/src/services/completion/public-v2s-binary.ts',
    'V2S replay runtime',
  );
  const runnerSource = String.raw`
const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
const { parsePublicV2sModel } = await import(input.parserUrl);
const model = await parsePublicV2sModel(Buffer.from(input.assetBase64, 'base64'));
const project = (candidate) => ({
  candidateId: candidate.candidateId,
  text: candidate.text,
  confidence: candidate.confidence,
  modelScore: candidate.modelScore,
  gateScore: candidate.gateScore,
  language: candidate.language,
});
const results = input.requests.map(({ checkpointId, request }) => ({
  checkpointId,
  ungatedCandidates: model.generateUngatedForEvaluation(request).map(project),
  gatedCandidates: model.generate(request).map(project),
}));
process.stdout.write(JSON.stringify(results));
`;
  let replayed;
  try {
    replayed = JSON.parse(
      execFileSync(
        process.execPath,
        ['--import', 'tsx', '--input-type=module', '--eval', runnerSource],
        {
          cwd: rootDir,
          input: JSON.stringify({
            parserUrl: pathToFileURL(parserFile.absolutePath).href,
            assetBase64: assetBytes.toString('base64'),
            requests,
          }),
          encoding: 'utf8',
          maxBuffer: 128 * 1024 * 1024,
          timeout: 120_000,
          windowsHide: true,
        },
      ),
    );
  } catch (error) {
    throw new Error(`V2S bound model replay failed closed: ${errorMessage(error)}.`);
  }
  if (!Array.isArray(replayed) || replayed.length !== requests.length) {
    throw new Error('V2S bound model replay returned an invalid result set.');
  }
  return replayed.map((result, index) => {
    const expected = requests[index];
    if (
      !result ||
      result.checkpointId !== expected.checkpointId ||
      !Array.isArray(result.ungatedCandidates) ||
      !Array.isArray(result.gatedCandidates) ||
      result.ungatedCandidates.length > 32 ||
      result.gatedCandidates.length > 32 ||
      !result.ungatedCandidates.every(isRawReplayCandidate) ||
      !result.gatedCandidates.every(isRawReplayCandidate)
    ) {
      throw new Error(`V2S bound model replay result ${expected.checkpointId} is invalid.`);
    }
    const receipt = {
      schema: V2S_OBSERVATION_REPLAY_SCHEMA,
      modelSha256,
      holdoutSha256,
      evaluatorTreeSha256,
      requestSha256: sha256(canonicalJson(expected.request)),
      ungatedCandidatesSha256: sha256(canonicalJson(result.ungatedCandidates)),
      gatedCandidatesSha256: sha256(canonicalJson(result.gatedCandidates)),
    };
    return {
      checkpointId: expected.checkpointId,
      publicCandidates: result.ungatedCandidates.map((candidate) => ({
        text: candidate.text,
        providerId: V2S_ENGINE,
        sourceLayer: 'l3',
      })),
      gatedPublicCandidates: result.gatedCandidates.map((candidate) => ({
        text: candidate.text,
        providerId: V2S_ENGINE,
        sourceLayer: 'l3',
      })),
      receipt,
    };
  });
}

export function verifyV2SObservationReplay(options) {
  const replayed = createV2SObservationReplay(options);
  const observations = options.observations;
  if (!Array.isArray(observations) || observations.length !== replayed.length) {
    throw new Error('V2S observation replay does not cover every frozen checkpoint.');
  }
  const observationsById = new Map(
    observations.map((observation) => [observation.checkpointId, observation]),
  );
  const receipts = [];
  for (const actual of replayed) {
    const observation = observationsById.get(actual.checkpointId);
    if (!observation) {
      throw new Error(`V2S replay is missing observation ${actual.checkpointId}.`);
    }
    const observedPublicCandidates = observation.publicCandidates.map((candidate) => ({
      text: candidate.text,
      providerId: candidate.providerId,
      sourceLayer: candidate.sourceLayer,
    }));
    if (canonicalJson(observedPublicCandidates) !== canonicalJson(actual.publicCandidates)) {
      throw new Error(
        `V2S observation ${actual.checkpointId} is inconsistent with actual bound-model output.`,
      );
    }
    if (canonicalJson(observation.replayReceipt) !== canonicalJson(actual.receipt)) {
      throw new Error(
        `V2S observation ${actual.checkpointId} lacks its bound model/holdout/evaluator replay receipt.`,
      );
    }
    receipts.push({ checkpointId: actual.checkpointId, receipt: actual.receipt });
  }
  return sha256(canonicalJson(receipts));
}

function verifyV2SFullStackReplay({
  rootDir,
  assetPath,
  modelSha256,
  holdoutPath,
  holdoutSha256,
  evaluatorTreeSha256,
  observations,
}) {
  const runner = loadWorkspaceFile(
    rootDir,
    'scripts/autocomplete-v2s/replay-evidence.ts',
    'V2S full-stack replay runner',
  );
  let replay;
  try {
    replay = JSON.parse(
      execFileSync(
        process.execPath,
        [
          '--import',
          'tsx',
          runner.absolutePath,
          '--root',
          rootDir,
          '--model',
          assetPath,
          '--holdout',
          holdoutPath,
          '--model-sha256',
          modelSha256,
          '--evaluator-tree-sha256',
          evaluatorTreeSha256,
        ],
        {
          cwd: rootDir,
          encoding: 'utf8',
          maxBuffer: 128 * 1024 * 1024,
          timeout: 180_000,
          windowsHide: true,
        },
      ),
    );
  } catch (error) {
    throw new Error(`V2S full-stack replay failed closed: ${errorMessage(error)}.`);
  }
  const unsigned = { ...replay };
  delete unsigned.replaySha256;
  if (
    replay?.schema !== 'jotluck.autocomplete.v2s-deterministic-replay.v1' ||
    replay.schemaVersion !== 1 ||
    replay.modelSha256 !== modelSha256 ||
    replay.holdoutSha256 !== holdoutSha256 ||
    replay.evaluatorTreeSha256 !== evaluatorTreeSha256 ||
    replay.replaySha256 !== sha256(canonicalJson(unsigned)) ||
    !Array.isArray(replay.observations) ||
    replay.observations.length !== observations.length
  ) {
    throw new Error('V2S full-stack replay identity is invalid.');
  }
  const replayById = new Map(replay.observations.map((item) => [item.checkpointId, item]));
  if (replayById.size !== replay.observations.length) {
    throw new Error('V2S full-stack replay contains duplicate checkpoints.');
  }
  const compared = [];
  for (const observation of observations) {
    const actual = replayById.get(observation.checkpointId);
    if (!actual) {
      throw new Error(`V2S full-stack replay is missing ${observation.checkpointId}.`);
    }
    const expectedResult = {
      b0Top1: projectReplayCandidate(observation.b0Top1),
      publicCandidates: observation.publicCandidates.map(projectReplayCandidate),
      gatedPublicCandidates: observation.gatedPublicCandidates.map(projectReplayCandidate),
      combinedTop1: projectReplayCandidate(observation.combinedTop1),
      fallback: observation.fallback,
      timeout: observation.timeout,
      rejectionReasons: [...observation.rejectionReasons].sort(),
    };
    const actualResult = {
      b0Top1: projectReplayCandidate(actual.b0Top1),
      publicCandidates: actual.publicCandidates.map(projectReplayCandidate),
      gatedPublicCandidates: actual.gatedPublicCandidates.map(projectReplayCandidate),
      combinedTop1: projectReplayCandidate(actual.combinedTop1),
      fallback: actual.fallback,
      timeout: actual.timeout,
      rejectionReasons: [...actual.rejectionReasons].sort(),
    };
    if (canonicalJson(expectedResult) !== canonicalJson(actualResult)) {
      throw new Error(
        `V2S observation ${observation.checkpointId} differs from the production-stack replay.`,
      );
    }
    compared.push({ checkpointId: observation.checkpointId, result: actualResult });
  }
  return sha256(
    canonicalJson({
      replaySha256: replay.replaySha256,
      compared,
    }),
  );
}

function projectReplayCandidate(candidate) {
  if (candidate === null) return null;
  return {
    text: candidate.text,
    providerId: candidate.providerId,
    sourceLayer: candidate.sourceLayer,
  };
}

function buildReplayRequest(classification, checkpoint) {
  if (
    !checkpoint ||
    typeof checkpoint.checkpointId !== 'string' ||
    typeof checkpoint.text !== 'string' ||
    !Number.isSafeInteger(checkpoint.cursorOffset) ||
    checkpoint.cursorOffset < 0 ||
    checkpoint.cursorOffset > checkpoint.text.length ||
    !['zh', 'en'].includes(checkpoint.language)
  ) {
    throw new Error('V2S frozen checkpoint cannot be converted into a replay request.');
  }
  const context = checkpoint.text.slice(0, checkpoint.cursorOffset);
  const contextTail = takeLastUtf8BytesForReplay(context, 256);
  return {
    engineEpoch: 1,
    workspaceScope: classification,
    documentVersion: checkpoint.checkpointId,
    cursorPos: checkpoint.cursorOffset,
    contextTail,
    contextTailUtf8Bytes: Buffer.byteLength(contextTail, 'utf8'),
    languageHint: checkpoint.language,
    blockType: 'paragraph',
    cursorBoundary: detectReplayBoundary(checkpoint.text, checkpoint.cursorOffset),
    maxCandidates: 32,
    deadlineAt: 8_640_000_000_000_000,
  };
}

function takeLastUtf8BytesForReplay(value, maximumBytes) {
  const points = Array.from(value);
  let used = 0;
  let start = points.length;
  while (start > 0) {
    const bytes = Buffer.byteLength(points[start - 1], 'utf8');
    if (used + bytes > maximumBytes) break;
    used += bytes;
    start -= 1;
  }
  return points.slice(start).join('');
}

function detectReplayBoundary(text, cursorOffset) {
  const previous = Array.from(text.slice(0, cursorOffset)).at(-1) ?? '';
  if (/^[\p{L}\p{N}_]$/u.test(previous)) return 'word';
  if (/^\s$/u.test(previous)) return 'space';
  if (/^[\p{P}\p{S}]$/u.test(previous)) return 'punctuation';
  return 'other';
}

function isRawReplayCandidate(candidate) {
  return (
    candidate &&
    typeof candidate.candidateId === 'string' &&
    typeof candidate.text === 'string' &&
    candidate.text.length > 0 &&
    !/[\r\n]/u.test(candidate.text) &&
    isRate(candidate.confidence) &&
    isRate(candidate.modelScore) &&
    isRate(candidate.gateScore) &&
    ['zh', 'en'].includes(candidate.language)
  );
}

function verifyRuntimeEvidence({
  value,
  modelSha256,
  evaluatorTreeSha256,
  holdoutReplayTreeSha256,
  fixtureProtocol,
}) {
  const replayBinding = value?.replayBinding;
  if (
    value?.schemaVersion !== 1 ||
    value.classification !== 'autocomplete-v2s-runtime-evidence' ||
    value.modelSha256 !== modelSha256 ||
    value.productionRouterObserved !== true ||
    value.workerObserved !== true ||
    value.mainThreadSynchronousInference !== false ||
    !Array.isArray(value.requests) ||
    value.requests.length !== 200
  ) {
    throw new Error('V2S runtime evidence identity is invalid.');
  }
  if (
    !fixtureProtocol &&
    (replayBinding?.schema !== V2S_RUNTIME_REPLAY_SCHEMA ||
      replayBinding.modelSha256 !== modelSha256 ||
      replayBinding.evaluatorTreeSha256 !== evaluatorTreeSha256 ||
      replayBinding.holdoutReplayTreeSha256 !== holdoutReplayTreeSha256 ||
      !isSha256(replayBinding.requestTreeSha256) ||
      !isSha256(replayBinding.runtimeStateSha256))
  ) {
    throw new Error('V2S runtime evidence lacks a bound evaluator/model/holdout replay identity.');
  }
  const ids = new Set();
  const requestReceipts = [];
  const allLatencies = [];
  const visibleLatencies = [];
  let fallbackCount = 0;
  let timeoutCount = 0;
  let warmingCount = 0;
  for (const request of value.requests) {
    if (
      !request ||
      typeof request.id !== 'string' ||
      !request.id ||
      ids.has(request.id) ||
      !isLatency(request.latencyMs) ||
      ![true, false].includes(request.fallback) ||
      ![true, false].includes(request.timedOut) ||
      ![true, false].includes(request.warming) ||
      !(
        request.visibleLatencyMs === null ||
        request.visibleLatencyMs === undefined ||
        isLatency(request.visibleLatencyMs)
      )
    ) {
      throw new Error('V2S runtime evidence contains an invalid request.');
    }
    if (!fixtureProtocol) {
      const unsignedRequest = { ...request };
      delete unsignedRequest.observationReceiptSha256;
      const expectedReceiptSha256 = sha256(
        canonicalJson({
          modelSha256,
          evaluatorTreeSha256,
          holdoutReplayTreeSha256,
          request: unsignedRequest,
        }),
      );
      if (request.observationReceiptSha256 !== expectedReceiptSha256) {
        throw new Error(`V2S runtime request ${request.id} has no valid replay-bound receipt.`);
      }
      requestReceipts.push({ id: request.id, sha256: expectedReceiptSha256 });
    }
    ids.add(request.id);
    allLatencies.push(request.latencyMs);
    if (request.visibleLatencyMs !== null && request.visibleLatencyMs !== undefined) {
      visibleLatencies.push(request.visibleLatencyMs);
    }
    fallbackCount += request.fallback ? 1 : 0;
    timeoutCount += request.timedOut ? 1 : 0;
    warmingCount += request.warming ? 1 : 0;
  }
  if (!fixtureProtocol) {
    const requestTreeSha256 = sha256(canonicalJson(requestReceipts));
    const runtimeStateSha256 = sha256(
      canonicalJson({
        modelSha256,
        evaluatorTreeSha256,
        holdoutReplayTreeSha256,
        productionRouterObserved: value.productionRouterObserved,
        workerObserved: value.workerObserved,
        mainThreadSynchronousInference: value.mainThreadSynchronousInference,
        requestTreeSha256,
      }),
    );
    if (
      replayBinding.requestTreeSha256 !== requestTreeSha256 ||
      replayBinding.runtimeStateSha256 !== runtimeStateSha256
    ) {
      throw new Error('V2S runtime replay binding was not recomputed from raw request receipts.');
    }
  }
  if (visibleLatencies.length === 0) {
    throw new Error('V2S runtime evidence has no visible prediction samples.');
  }
  const metrics = {
    requests: value.requests.length,
    visibleRequests: visibleLatencies.length,
    allRequestP90Ms: percentile(allLatencies, 0.9),
    visiblePredictionP90Ms: percentile(visibleLatencies, 0.9),
    fallbackCount,
    timeoutCount,
    warmingCount,
  };
  if (metrics.allRequestP90Ms > 140 || metrics.visiblePredictionP90Ms > 140) {
    throw new Error('V2S runtime evidence failed the 140ms p90 release gate.');
  }
  return metrics;
}

function verifyFinalConsumption({
  value,
  modelSha256,
  coldFinalHoldoutSha256,
  workspaceFinalHoldoutSha256,
  coldFinalEvidenceSha256,
  workspaceFinalEvidenceSha256,
}) {
  const pair = {
    modelSha256,
    coldFinal: {
      holdoutSha256: coldFinalHoldoutSha256,
      evidenceSha256: coldFinalEvidenceSha256,
    },
    workspaceFinal: {
      holdoutSha256: workspaceFinalHoldoutSha256,
      evidenceSha256: workspaceFinalEvidenceSha256,
    },
  };
  const expectedPairSha256 = sha256(canonicalJson(pair));
  if (
    value?.schema !== 'jotluck.autocomplete.v2s-final-consumption.v1' ||
    value.schemaVersion !== 1 ||
    value.status !== 'consumed' ||
    value.modelSha256 !== modelSha256 ||
    value.finalPairSha256 !== expectedPairSha256 ||
    canonicalJson(value.coldFinal) !== canonicalJson(pair.coldFinal) ||
    canonicalJson(value.workspaceFinal) !== canonicalJson(pair.workspaceFinal) ||
    !isCanonicalIsoTimestamp(value.claimedAt) ||
    !isCanonicalIsoTimestamp(value.consumedAt) ||
    Date.parse(value.claimedAt) > Date.parse(value.consumedAt)
  ) {
    throw new Error(
      'V2S final consumption receipt is missing, replayed or does not bind the final pair.',
    );
  }
  return {
    status: value.status,
    finalPairSha256: expectedPairSha256,
    claimedAt: value.claimedAt,
    consumedAt: value.consumedAt,
  };
}

function verifyV2SContainer(bytes) {
  const magic = Buffer.from([0x4a, 0x4c, 0x56, 0x32, 0x53, 0x36, 0x00, 0x00]);
  if (
    bytes.byteLength < magic.byteLength + 4 ||
    !bytes.subarray(0, magic.byteLength).equals(magic)
  ) {
    throw new Error('V2S container magic is invalid or truncated.');
  }
  const headerBytesLength = bytes.readUInt32LE(magic.byteLength);
  const headerOffset = magic.byteLength + 4;
  const payloadOffset = headerOffset + headerBytesLength;
  if (headerBytesLength < 2 || headerBytesLength > 256 * 1024 || payloadOffset > bytes.byteLength) {
    throw new Error('V2S container header is truncated.');
  }
  const headerBytes = bytes.subarray(headerOffset, payloadOffset);
  const header = parseJson(headerBytes, 'V2S container header');
  if (
    header?.schema !== 'jotluck.autocomplete.public-container.v6' ||
    header.schemaVersion !== 6 ||
    header.engine !== V2S_ENGINE ||
    !Array.isArray(header.sections) ||
    header.sections.length !== 6 ||
    !Number.isSafeInteger(header.payloadBytes) ||
    header.payloadBytes < 0 ||
    payloadOffset + header.payloadBytes !== bytes.byteLength
  ) {
    throw new Error('V2S container header identity is invalid.');
  }
  const ids = new Set();
  const requiredSections = ['tokenizer.zh', 'tokenizer.en', 'lm.zh', 'lm.en', 'gate', 'metadata'];
  let expectedOffset = 0;
  for (const [index, section] of header.sections.entries()) {
    if (
      !section ||
      typeof section.id !== 'string' ||
      section.id !== requiredSections[index] ||
      ids.has(section.id) ||
      section.relativeOffset !== expectedOffset ||
      !Number.isSafeInteger(section.bytes) ||
      section.bytes < 0 ||
      !isSha256(section.sha256)
    ) {
      throw new Error('V2S container section table is invalid.');
    }
    const start = payloadOffset + section.relativeOffset;
    const end = start + section.bytes;
    if (end > bytes.byteLength || sha256(bytes.subarray(start, end)) !== section.sha256) {
      throw new Error(`V2S container section ${section.id} failed integrity verification.`);
    }
    ids.add(section.id);
    expectedOffset += section.bytes;
  }
  if (expectedOffset !== header.payloadBytes) {
    throw new Error('V2S container section bytes do not match the payload length.');
  }
  return { headerSha256: sha256(headerBytes) };
}

function isObservedCandidate(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof value.text === 'string' &&
    value.text.length > 0 &&
    !/[\r\n]/u.test(value.text) &&
    typeof value.providerId === 'string' &&
    typeof value.sourceLayer === 'string'
  );
}

function isCandidateUsable(candidate, expectedBehavior, acceptableSuffixes, language) {
  if (expectedBehavior !== 'complete' || !isMeaningfulCompletion(candidate, language)) return false;
  if (isMixedCandidate(candidate, language) || /[\r\n]/u.test(candidate)) return false;
  const normalized = normalizeContinuation(candidate);
  if (!normalized || /[ \t]$/u.test(normalized)) return false;
  return acceptableSuffixes.some((reference) => {
    const candidateText = comparable(normalized, language);
    const referenceText = comparable(normalizeContinuation(reference), language);
    if (!referenceText.startsWith(candidateText)) return false;
    if (language === 'en') {
      const last = candidateText.at(-1) ?? '';
      const next = referenceText[candidateText.length] ?? '';
      if (/[A-Za-z'’-]/u.test(last) && /[A-Za-z'’-]/u.test(next)) return false;
    }
    return true;
  });
}

function isMixedCandidate(candidate, language) {
  return language === 'zh' ? /[A-Za-z]/u.test(candidate) : /[\u3400-\u9fff]/u.test(candidate);
}

function isMeaningfulCompletion(value, language) {
  const normalized = normalizeContinuation(value);
  if (language === 'zh') return (normalized.match(/[\u3400-\u9fff]/gu) ?? []).length >= 3;
  const words = normalized.match(/[A-Za-z][A-Za-z'’-]*/gu) ?? [];
  return words.length >= 1 && words.join('').replace(/[^A-Za-z]/gu, '').length >= 5;
}

function normalizeContinuation(value) {
  return value
    .normalize('NFKC')
    .replace(/\r\n?/gu, '\n')
    .replace(/[ \t]+/gu, ' ')
    .replace(/[ \t]+$/gu, '');
}

function comparable(value, language) {
  return language === 'en' ? value.toLocaleLowerCase('en-US') : value;
}

function verifyWebviewEvidence(value, modelSha256, finalConsumedAt) {
  if (
    value?.schemaVersion !== 1 ||
    value.classification !== 'tauri-webview-offline-smoke' ||
    value.status !== 'pass' ||
    value.modelSha256 !== modelSha256 ||
    value.offlineReload !== true ||
    value.workerInferenceObserved !== true ||
    !isCanonicalIsoTimestamp(value.completedAt) ||
    Date.parse(value.completedAt) < Date.parse(finalConsumedAt)
  ) {
    throw new Error('V2S requires a model-bound real Tauri WebView offline smoke.');
  }
}

function collectReplaceablePublicPaths(rootDir, state) {
  if (state.kind === 'legacy-failclosed') {
    return LEGACY_PUBLIC_FILES.map((name) => `packages/app/public/${name}`);
  }
  if (state.kind !== 'v2s') return [];
  return state.canonicalEntries.map((entry) => `${V2S_PUBLIC_DIRECTORY}/${entry.name}`);
}

function invalidState(reason, details) {
  return { kind: 'invalid', reason, ...details, manifest: null };
}

function loadWorkspaceFile(rootDir, relativePath, label) {
  const normalized = normalizeRelativePath(relativePath);
  const resolved = path.resolve(rootDir, normalized);
  if (!isWithin(resolved, rootDir)) {
    throw new Error(`${label} escapes the workspace: ${String(relativePath)}.`);
  }
  if (!existsSync(resolved) || !statSync(resolved).isFile()) {
    throw new Error(`${label} does not exist: ${String(relativePath)}.`);
  }
  const real = realpathSync(resolved);
  if (!isWithin(real, rootDir)) {
    throw new Error(`${label} symlink escapes the workspace: ${String(relativePath)}.`);
  }
  return { absolutePath: real, bytes: readFileSync(real) };
}

function normalizeRelativePath(value) {
  if (typeof value !== 'string' || !value || path.isAbsolute(value)) {
    throw new Error(`Evidence path must be workspace-relative: ${String(value)}.`);
  }
  const normalized = value.replaceAll('\\', '/').replace(/^\.\//u, '');
  if (normalized.split('/').some((segment) => segment === '..')) {
    throw new Error(`Evidence path escapes the workspace: ${value}.`);
  }
  return normalized;
}

function resolveFixtureProtocol(expectedEvaluatorFiles) {
  if (sameStrings(expectedEvaluatorFiles, AUTOCOMPLETE_V2S_EVIDENCE_SOURCE_FILES)) return false;
  if (!process.env.VITEST || process.env.NODE_ENV !== 'test') {
    throw new Error('Evaluator source overrides are test-only and cannot weaken production RC.');
  }
  return true;
}

function assertOutsidePublic(rootDir, absolutePath, label) {
  const publicDir = path.join(rootDir, 'packages/app/public');
  if (isWithin(absolutePath, publicDir)) {
    throw new Error(`${label} must stay outside packages/app/public.`);
  }
}

function readJson(filePath, label) {
  return parseJson(readFileSync(filePath), label);
}

function parseJson(bytes, label) {
  try {
    return JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    throw new Error(`${label} is invalid JSON: ${errorMessage(error)}.`);
  }
}

function percentile(values, percentileValue) {
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.ceil(percentileValue * sorted.length) - 1);
  return sorted[index];
}

function ratio(numerator, denominator) {
  return denominator === 0 ? 0 : numerator / denominator;
}

function isCanonicalIsoTimestamp(value) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) return false;
  return new Date(value).toISOString() === value;
}

function sameStrings(left, right) {
  return (
    left.length === right.length &&
    [...left]
      .sort((a, b) => a.localeCompare(b, 'en'))
      .every((item, index) => item === [...right].sort((a, b) => a.localeCompare(b, 'en'))[index])
  );
}

function isWithin(candidate, root) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function isSha256(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
}

function isRate(value) {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}

function isLatency(value) {
  return Number.isFinite(value) && value >= 0 && value <= 60_000;
}

function splitsSurrogatePair(value, offset) {
  if (offset <= 0 || offset >= value.length) return false;
  const previous = value.charCodeAt(offset - 1);
  const next = value.charCodeAt(offset);
  return previous >= 0xd800 && previous <= 0xdbff && next >= 0xdc00 && next <= 0xdfff;
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function readArg(argv, name) {
  const inline = argv.find((item) => item.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    const scriptRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const result = verifyAutocompleteV2SEvidence({
      rootDir: readArg(process.argv.slice(2), '--root') ?? scriptRoot,
      mode: readArg(process.argv.slice(2), '--mode') ?? 'ci',
    });
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(errorMessage(error));
    process.exitCode = 1;
  }
}
