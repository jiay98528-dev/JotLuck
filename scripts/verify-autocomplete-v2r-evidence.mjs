import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import {
  AUTOCOMPLETE_V2R_EVIDENCE_SOURCE_FILES,
  canonicalJson,
  resolveWorkspaceFile,
  sha256,
  verifyEvaluatorSourceTree,
} from './autocomplete-evidence-integrity.mjs';

export const V2R_PUBLIC_MANIFESTS = Object.freeze([
  {
    profile: 'web-local',
    manifest: 'packages/app/public/public-phrase-transformer-v1.web-local.manifest.json',
  },
  {
    profile: 'release',
    manifest: 'packages/app/public/public-phrase-transformer-v1.release.manifest.json',
  },
]);

const REQUIRED_EVIDENCE = Object.freeze([
  'model',
  'phraseBank',
  'metadata',
  'runtime',
  'selectionManifest',
  'sourceRegistry',
  'corpusGovernance',
  'generatorReport',
  'trainingInput',
  'trainingReport',
  'quantizationReport',
  'operatorConfig',
  'runtimeBuildReport',
  'bundleSizeReport',
  'coldValidationHoldout',
  'workspaceValidationHoldout',
  'coldFinalHoldout',
  'workspaceFinalHoldout',
  'evaluatorSourceTree',
  'qualityReport',
  'runtimeReport',
  'finalConsumptionReceipt',
  'finalOverlapAudit',
  'webviewSmoke',
]);

const PROJECT_OWNED_GENERATOR_VERSION = 'jotluck-project-owned-short-notes-v3.1';
const PROJECT_OWNED_GENERATOR_SEED = 'v2r-project-owned-2026-07-12-b';

const REQUIRED_ASSET_ROLES = Object.freeze(['model', 'phrase-bank', 'metadata', 'runtime']);
const CATEGORIES = Object.freeze([
  'field-observation',
  'maintenance-log',
  'meeting-note',
  'reading-note',
  'household-plan',
]);

export function hasAnyV2RPublicManifest(rootDir) {
  return V2R_PUBLIC_MANIFESTS.some(({ manifest }) =>
    existsSync(resolveOptionalWorkspacePath(rootDir, manifest)),
  );
}

export function verifyAutocompleteV2REvidence({ rootDir, expectedEvaluatorFiles }) {
  const architectureStopPath = resolveOptionalWorkspacePath(
    rootDir,
    'scripts/corpus/autocomplete-v2r-architecture-stop.json',
  );
  if (existsSync(architectureStopPath)) {
    const stop = readJson(architectureStopPath, 'V2R architecture stop');
    if (
      stop?.schema !== 'jotluck.autocomplete.v2r-architecture-stop.v1' ||
      stop.engine !== 'public-phrase-transformer-v1' ||
      stop.status !== 'architecture-blocked' ||
      stop.stopLongTraining !== true
    ) {
      throw new Error('V2R architecture-stop record is invalid.');
    }
    throw new Error('V2R fixed-phrase architecture is blocked and cannot satisfy RC evidence.');
  }
  const present = V2R_PUBLIC_MANIFESTS.filter(({ manifest }) =>
    existsSync(resolveOptionalWorkspacePath(rootDir, manifest)),
  );
  if (present.length !== V2R_PUBLIC_MANIFESTS.length) {
    throw new Error(
      'V2R public manifests are only partially installed; atomic publication is required.',
    );
  }
  const verified = V2R_PUBLIC_MANIFESTS.map((descriptor) =>
    verifyProfile(rootDir, descriptor, expectedEvaluatorFiles),
  );
  assertProfilesEquivalent(verified);
  return verified.map(({ profile, modelSha256 }) => ({
    profile,
    status: 'release-evidence-verified-v5',
    sha256: modelSha256,
  }));
}

function verifyProfile(rootDir, descriptor, expectedEvaluatorFiles) {
  const manifestPath = resolveWorkspaceFile(rootDir, descriptor.manifest);
  const manifest = readJson(manifestPath, 'v5 manifest');
  assertManifestIdentity(manifest, descriptor.profile);
  const assets = verifyAssets(rootDir, manifest);
  const evidence = verifyEvidenceBindings(rootDir, manifest);
  assertAssetEvidenceIdentity(assets, evidence);
  const evaluator = parseJson(evidence.evaluatorSourceTree.bytes, 'evaluatorSourceTree');
  const evaluatorIdentity = verifyEvaluatorSourceTree(rootDir, evaluator, expectedEvaluatorFiles);
  const holdouts = verifyHoldouts(evidence);
  verifyTrainingEvidence(manifest, evidence, assets, holdouts);
  verifyRuntimeBuildEvidence(evidence, assets);
  verifyBundleSizeEvidence(evidence, assets, manifest);
  verifyQualityEvidence(manifest, evidence, assets, holdouts, evaluatorIdentity.treeSha256);
  verifyRuntimeEvidence(manifest, evidence, assets, holdouts);
  verifyFinalReceipt(evidence, assets, holdouts);
  verifyWebviewSmoke(evidence, assets);
  return {
    profile: descriptor.profile,
    manifest,
    modelSha256: assets.model.sha256,
    equivalenceIdentity: sha256(
      canonicalJson({
        architecture: manifest.architecture,
        assets: manifest.assets,
        staticBundleDeltaBytes: manifest.staticBundleDeltaBytes,
        training: manifest.training,
        evidenceBindings: manifest.evidenceBindings,
      }),
    ),
  };
}

function assertManifestIdentity(manifest, profile) {
  if (
    manifest?.schema !== 'jotluck.autocomplete.public-model.v5' ||
    manifest.schemaVersion !== 5 ||
    manifest.engine !== 'public-phrase-transformer-v1' ||
    manifest.profile !== profile ||
    manifest.runtimeEligible !== true ||
    manifest.qualityGatePassed !== true ||
    manifest.releaseEligible !== true ||
    !isCanonicalIso(manifest.createdAt)
  ) {
    throw new Error(`V2R ${profile} manifest identity or release flags are invalid.`);
  }
  const architecture = manifest.architecture;
  const signature = `${architecture?.phraseBankSize}:${architecture?.hiddenSize}:${architecture?.layers}`;
  if (
    architecture?.format !== 'onnx' ||
    architecture.quantization !== 'int8' ||
    !['8192:96:2', '12288:128:2', '16384:128:3'].includes(signature) ||
    architecture.attentionHeads !== 4 ||
    architecture.maxContextUtf8Bytes !== 192 ||
    architecture.contextPatchBytes !== 4 ||
    architecture.maxCandidates !== 32 ||
    architecture.abstainClass !== true
  ) {
    throw new Error(`V2R ${profile} architecture is outside the frozen matrix.`);
  }
}

function verifyAssets(rootDir, manifest) {
  if (!Array.isArray(manifest.assets) || manifest.assets.length < 4 || manifest.assets.length > 5) {
    throw new Error('V2R manifest assets are incomplete.');
  }
  const roles = new Set();
  const output = {};
  let modelDataBytes = 0;
  let rawAssetBytes = 0;
  for (const binding of manifest.assets) {
    if (
      !binding ||
      !REQUIRED_ASSET_ROLES.concat('tokenizer').includes(binding.role) ||
      roles.has(binding.role) ||
      !Number.isSafeInteger(binding.bytes) ||
      binding.bytes <= 0 ||
      !isSha256(binding.sha256) ||
      typeof binding.path !== 'string' ||
      !binding.path.startsWith('packages/app/public/')
    ) {
      throw new Error(`V2R asset binding is invalid: ${String(binding?.role)}.`);
    }
    roles.add(binding.role);
    const filePath = resolveWorkspaceFile(rootDir, binding.path);
    const bytes = readFileSync(filePath);
    if (bytes.byteLength !== binding.bytes || sha256(bytes) !== binding.sha256) {
      throw new Error(`V2R asset content mismatch: ${binding.role}.`);
    }
    if (looksLikeHtml(bytes))
      throw new Error(`V2R asset unexpectedly contains HTML: ${binding.role}.`);
    if (binding.role === 'runtime' && !hasWasmMagic(bytes)) {
      throw new Error('V2R runtime asset is not WebAssembly.');
    }
    rawAssetBytes += bytes.byteLength;
    if (binding.role !== 'runtime') modelDataBytes += bytes.byteLength;
    output[toEvidenceRole(binding.role)] = {
      path: binding.path,
      sha256: binding.sha256,
      bytes: bytes.byteLength,
      content: bytes,
    };
  }
  for (const role of REQUIRED_ASSET_ROLES) {
    if (!roles.has(role)) throw new Error(`V2R required asset is missing: ${role}.`);
  }
  if (modelDataBytes > 6 * 1024 * 1024) throw new Error('V2R model data exceeds 6 MiB.');
  if (
    !Number.isSafeInteger(manifest.staticBundleDeltaBytes) ||
    manifest.staticBundleDeltaBytes < rawAssetBytes ||
    manifest.staticBundleDeltaBytes > 12 * 1024 * 1024
  ) {
    throw new Error('V2R static bundle delta is invalid or exceeds 12 MiB.');
  }
  verifyPhraseBank(output.phraseBank.content, manifest.architecture.phraseBankSize);
  verifyRuntimeMetadata(output.metadata.content, manifest.architecture.phraseBankSize);
  return output;
}

function verifyEvidenceBindings(rootDir, manifest) {
  const bindings = manifest.evidenceBindings;
  if (!bindings || typeof bindings !== 'object' || Array.isArray(bindings)) {
    throw new Error('V2R evidenceBindings are missing.');
  }
  const output = {};
  for (const key of REQUIRED_EVIDENCE) {
    const binding = bindings[key];
    if (!binding || typeof binding.path !== 'string' || !isSha256(binding.sha256)) {
      throw new Error(`V2R evidence binding is incomplete: ${key}.`);
    }
    const filePath = resolveWorkspaceFile(rootDir, binding.path);
    const bytes = readFileSync(filePath);
    if (sha256(bytes) !== binding.sha256) {
      throw new Error(`V2R evidence SHA mismatch: ${key}.`);
    }
    output[key] = { path: binding.path, bytes, sha256: binding.sha256 };
  }
  return output;
}

function assertAssetEvidenceIdentity(assets, evidence) {
  for (const key of ['model', 'phraseBank', 'metadata', 'runtime']) {
    if (assets[key].path !== evidence[key].path || assets[key].sha256 !== evidence[key].sha256) {
      throw new Error(`V2R ${key} evidence does not identify the released asset.`);
    }
  }
}

function verifyTrainingEvidence(manifest, evidence, assets, holdouts) {
  const selection = parseJson(evidence.selectionManifest.bytes, 'selectionManifest');
  const sourceRegistry = parseJson(evidence.sourceRegistry.bytes, 'sourceRegistry');
  const governance = parseJson(evidence.corpusGovernance.bytes, 'corpusGovernance');
  const generator = parseJson(evidence.generatorReport.bytes, 'generatorReport');
  const trainingInput = parseJson(evidence.trainingInput.bytes, 'trainingInput');
  const training = parseJson(evidence.trainingReport.bytes, 'trainingReport');
  const quantization = parseJson(evidence.quantizationReport.bytes, 'quantizationReport');
  const finalOverlap = parseJson(evidence.finalOverlapAudit.bytes, 'finalOverlapAudit');
  assertProjectOwnedGeneratorIdentity(sourceRegistry, generator);
  if (!Array.isArray(selection.documents)) {
    throw new Error('V2R corpus selection has no document identities.');
  }
  const inputTreeSha256 = sha256(
    canonicalJson(
      selection.documents
        .map((document) => ({ id: document.documentId, sha256: document.sha256 }))
        .sort((left, right) => left.id.localeCompare(right.id, 'en')),
    ),
  );
  const validationClassifications = new Set(['cold-validation-v3', 'workspace-validation-v3']);
  const finalClassifications = new Set(['cold-final-v3', 'workspace-final-v3']);
  const finalOverlapIdentity = { ...finalOverlap };
  delete finalOverlapIdentity.reportSha256;
  if (
    selection.schema !== 'jotluck.autocomplete.v2r-corpus-selection.v1' ||
    selection.schemaVersion !== 1 ||
    selection.status !== 'complete' ||
    selection.selectionSha256 !== manifest.training.selectionManifestSha256 ||
    sha256(canonicalJson(selection.sources)) !== sha256(canonicalJson(sourceRegistry)) ||
    governance.selectionSha256 !== selection.selectionSha256 ||
    governance.exactDuplicates !== 0 ||
    governance.nearDuplicates / Math.max(1, selection.documents.length) > 0.03 ||
    governance.holdoutExactOverlaps !== 0 ||
    governance.holdoutNearOverlaps !== 0 ||
    governance.forbiddenTextMatches !== 0 ||
    governance.unapprovedLicenseSources !== 0 ||
    governance.isolatedNovelZhReferences !== 0 ||
    governance.projectOwnedRatio < 0.6 ||
    governance.maxTemplateRatio > 0.005 ||
    governance.maxFiveGramRatio > 0.01 ||
    !Number.isFinite(governance.maxDocumentTrigramRatio) ||
    governance.maxDocumentTrigramRatio > 0.08 ||
    generator.schema !== 'jotluck.autocomplete.v2r-generator-report.v1' ||
    generator.schemaVersion !== 1 ||
    generator.selectionSha256 !== selection.selectionSha256 ||
    generator.inputTreeSha256 !== inputTreeSha256 ||
    generator.inputTreeSha256 !== manifest.training.inputTreeSha256 ||
    generator.generatorVersion !== manifest.training.generatorVersion ||
    generator.sourceTreeSha256 !== sha256(canonicalJson(sourceRegistry)) ||
    generator.governanceSha256 !== sha256(canonicalJson(governance)) ||
    generator.releaseEvidence !== true ||
    generator.holdoutScope !== 'validation-only-before-candidate-freeze-v1' ||
    generator.holdoutTreeSha256 !==
      holdoutEvidenceTreeSha256(holdouts, validationClassifications) ||
    generator.holdoutDocumentsAudited !== governance.holdoutDocumentsAudited ||
    governance.holdoutDocumentsAudited !==
      countHoldoutDocuments(holdouts, validationClassifications) ||
    governance.holdoutInputTreeSha256 !==
      holdoutInputTreeSha256(holdouts, validationClassifications) ||
    finalOverlap.schema !== 'jotluck.autocomplete.v2r-final-overlap-audit.v1' ||
    finalOverlap.schemaVersion !== 1 ||
    finalOverlap.auditorVersion !== 'corpus-governance-v2r-v1' ||
    finalOverlap.selectionSha256 !== selection.selectionSha256 ||
    finalOverlap.inputTreeSha256 !== inputTreeSha256 ||
    finalOverlap.finalHoldoutTreeSha256 !==
      holdoutEvidenceTreeSha256(holdouts, finalClassifications) ||
    finalOverlap.finalHoldoutInputTreeSha256 !==
      holdoutInputTreeSha256(holdouts, finalClassifications) ||
    finalOverlap.finalHoldoutDocumentsAudited !==
      countHoldoutDocuments(holdouts, finalClassifications) ||
    finalOverlap.holdoutExactOverlaps !== 0 ||
    finalOverlap.holdoutNearOverlaps !== 0 ||
    finalOverlap.passed !== true ||
    finalOverlap.reportSha256 !== sha256(canonicalJson(finalOverlapIdentity))
  ) {
    throw new Error('V2R corpus selection or governance evidence is invalid.');
  }
  const trainingInputIdentity = { ...trainingInput };
  delete trainingInputIdentity.reportSha256;
  if (
    trainingInput.schema !== 'jotluck.autocomplete.v2r-training-data.v3' ||
    trainingInput.schemaVersion !== 3 ||
    trainingInput.selectionSha256 !== selection.selectionSha256 ||
    trainingInput.phraseBankSha256 !== assets.phraseBank.sha256 ||
    trainingInput.phraseBankBytes !== assets.phraseBank.bytes ||
    !Number.isFinite(trainingInput.maxPhraseDocumentRatio) ||
    trainingInput.maxPhraseDocumentRatio < 0 ||
    trainingInput.maxPhraseDocumentRatio > 1 ||
    !Number.isFinite(trainingInput.maxStructuralPhraseDocumentRatio) ||
    trainingInput.maxStructuralPhraseDocumentRatio < 0 ||
    trainingInput.maxStructuralPhraseDocumentRatio > 0.1 ||
    trainingInput.reportSha256 !== sha256(canonicalJson(trainingInputIdentity))
  ) {
    throw new Error('V2R training-data evidence is invalid.');
  }
  for (const split of ['train', 'development', 'internalSelection']) {
    const sample = trainingInput.samples?.[split];
    if (
      sample?.abstainReasons?.bankMiss !== 0 ||
      sample?.abstainReasons?.documentEnd !== sample?.abstain
    ) {
      throw new Error(`V2R ${split} contains non-silence abstain labels.`);
    }
  }
  const trainingIdentity = { ...training };
  delete trainingIdentity.trainerCanonicalSha256;
  if (
    training.schema !== 'jotluck.autocomplete.v2r-training-report.v1' ||
    training.candidateEligible !== true ||
    training.releaseEligible !== false ||
    training.assets?.int8?.sha256 !== assets.model.sha256 ||
    training.assets?.phraseBank?.sha256 !== assets.phraseBank.sha256 ||
    training.assets?.metadata?.sha256 !== assets.metadata.sha256 ||
    training.assets?.operatorConfig?.sha256 !== evidence.operatorConfig.sha256 ||
    training.architecture?.contextUtf8Bytes !== 192 ||
    training.architecture?.contextPatchBytes !== 4 ||
    training.labelSemantics?.abstainClassWeight !== 1 ||
    training.labelSemantics?.abstainReasonPolicy !== 'document-end-only-v1' ||
    training.labelSemantics?.bankMissIsCoverageOnly !== true ||
    training.trainingDataReportSha256 !== trainingInput.reportSha256 ||
    training.quantizationReport?.sha256 !== evidence.quantizationReport.sha256 ||
    training.candidateCapabilityPassed !== true ||
    training.thresholdCalibrationPassed !== true ||
    training.internalQualityGatePassed !== true ||
    training.quantizationPassed !== true ||
    training.trainerCanonicalSha256 !== sha256(canonicalJson(trainingIdentity))
  ) {
    throw new Error('V2R bounded training report is not an eligible frozen candidate.');
  }
  if (
    quantization.modelSha256 !== assets.model.sha256 ||
    quantization.phraseBankSha256 !== assets.phraseBank.sha256 ||
    quantization.top1Agreement < 0.98 ||
    quantization.oracleAt32Agreement < 0.99 ||
    quantization.passed !== true
  ) {
    throw new Error('V2R quantization evidence is invalid.');
  }
}

function assertProjectOwnedGeneratorIdentity(sourceRegistry, generator) {
  if (!Array.isArray(sourceRegistry) || sourceRegistry.length === 0) {
    throw new Error('V2R source registry must be a non-empty array.');
  }
  let projectOwnedSources = 0;
  for (const [index, source] of sourceRegistry.entries()) {
    if (!source || typeof source !== 'object' || Array.isArray(source)) {
      throw new Error(`V2R source registry entry ${index} is invalid.`);
    }
    if (source.kind === 'project-owned') {
      projectOwnedSources++;
      if (
        source.licenseSpdx !== 'MIT' ||
        source.generatorVersion !== PROJECT_OWNED_GENERATOR_VERSION ||
        source.generatorSeed !== PROJECT_OWNED_GENERATOR_SEED
      ) {
        throw new Error(`V2R project-owned source ${index} has invalid generator provenance.`);
      }
    } else if (source.licenseSpdx !== 'CC0-1.0') {
      throw new Error(`V2R external source ${index} is not CC0-1.0.`);
    }
  }
  if (
    projectOwnedSources === 0 ||
    generator.generatorVersion !== PROJECT_OWNED_GENERATOR_VERSION ||
    generator.generatorSeed !== PROJECT_OWNED_GENERATOR_SEED
  ) {
    throw new Error('V2R generator report does not match the frozen project-owned sources.');
  }
}

function holdoutEvidenceTreeSha256(holdouts, classifications = undefined) {
  return sha256(
    canonicalJson(
      Object.values(holdouts)
        .filter(({ value }) => !classifications || classifications.has(value.classification))
        .map(({ value, canonicalSha256 }) => ({
          classification: value.classification,
          datasetSha256: canonicalSha256,
        }))
        .sort((left, right) => left.classification.localeCompare(right.classification)),
    ),
  );
}

function holdoutInputTreeSha256(holdouts, classifications = undefined) {
  return sha256(
    canonicalJson(
      Object.values(holdouts)
        .filter(({ value }) => !classifications || classifications.has(value.classification))
        .flatMap(({ value }) => [
          ...value.targets.map((target) => ({
            id: `holdout:${value.classification}:target:${target.id}`,
            sha256: sha256(target.text),
          })),
          ...value.supportDocuments.map((support) => ({
            id: `holdout:${value.classification}:support:${support.id}`,
            sha256: sha256(support.text),
          })),
        ])
        .sort((left, right) => left.id.localeCompare(right.id)),
    ),
  );
}

function countHoldoutDocuments(holdouts, classifications = undefined) {
  return Object.values(holdouts)
    .filter(({ value }) => !classifications || classifications.has(value.classification))
    .reduce((total, { value }) => total + value.targets.length + value.supportDocuments.length, 0);
}

function verifyRuntimeBuildEvidence(evidence, assets) {
  const operatorConfigText = decodeUtf8(evidence.operatorConfig.bytes, 'operatorConfig');
  const runtimeBuild = parseJson(evidence.runtimeBuildReport.bytes, 'runtimeBuildReport');
  const runtimeBuildIdentity = { ...runtimeBuild };
  delete runtimeBuildIdentity.reportSha256;
  const operatorLines = operatorConfigText
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
  if (
    operatorLines.length < 1 ||
    operatorLines.some((line) => !/^[A-Za-z0-9_.-]+;\d+;[A-Za-z0-9_,]+$/u.test(line)) ||
    runtimeBuild?.schema !== 'jotluck.autocomplete.v2r-runtime-build.v1' ||
    runtimeBuild.schemaVersion !== 1 ||
    runtimeBuild.ortVersion !== '1.27.0' ||
    runtimeBuild.ortSourceCommit !== '8f0278c77bf44b0cc83c098c6c722b92a36ac4b5' ||
    runtimeBuild.modelFormat !== 'onnx' ||
    runtimeBuild.reducedOperatorBuild !== true ||
    runtimeBuild.minimalBuild !== false ||
    runtimeBuild.parallelBuild !== true ||
    runtimeBuild.toolchain?.python !== '3.12.10' ||
    runtimeBuild.toolchain?.cmake !== '3.31.6' ||
    runtimeBuild.toolchain?.emscripten !== '4.0.23' ||
    typeof runtimeBuild.toolchain?.ninja !== 'string' ||
    !runtimeBuild.toolchain.ninja.startsWith('1.13.0') ||
    runtimeBuild.operatorConfigSha256 !== evidence.operatorConfig.sha256 ||
    runtimeBuild.modelSha256 !== assets.model.sha256 ||
    runtimeBuild.runtimeSha256 !== assets.runtime.sha256 ||
    runtimeBuild.runtimeBytes !== assets.runtime.bytes ||
    runtimeBuild.runtimeBytes > 12 * 1024 * 1024 ||
    runtimeBuild.passed !== true ||
    runtimeBuild.reportSha256 !== sha256(canonicalJson(runtimeBuildIdentity)) ||
    runtimeBuild.nodeModuleScope?.mode !== 'isolated-commonjs-package' ||
    runtimeBuild.nodeModuleScope?.sha256 !==
      '7d38de102f9d211b8a221ab5943610473c4b23aeee36e9a9cf0e22848e04b9d4' ||
    !Array.isArray(runtimeBuild.buildFlags) ||
    !runtimeBuild.buildFlags.includes('--include_ops_by_config') ||
    !runtimeBuild.buildFlags.includes('--build_wasm') ||
    !runtimeBuild.buildFlags.includes('--compile_no_warning_as_error') ||
    !runtimeBuild.buildFlags.includes('--disable_contrib_ops') ||
    !runtimeBuild.buildFlags.includes('--disable_generation_ops')
  ) {
    throw new Error('V2R reduced-operator runtime build evidence is invalid.');
  }
}

function verifyBundleSizeEvidence(evidence, assets, manifest) {
  const report = parseJson(evidence.bundleSizeReport.bytes, 'bundleSizeReport');
  const identity = { ...report };
  delete identity.reportSha256;
  if (
    report?.schema !== 'jotluck.autocomplete.v2r-bundle-size.v1' ||
    report.schemaVersion !== 1 ||
    report.measurementMethod !== 'candidate-assets-plus-entire-app-js-upper-bound' ||
    report.modelSha256 !== assets.model.sha256 ||
    report.phraseBankSha256 !== assets.phraseBank.sha256 ||
    report.metadataSha256 !== assets.metadata.sha256 ||
    report.runtimeSha256 !== assets.runtime.sha256 ||
    report.candidateAssetBytes !==
      assets.model.bytes + assets.phraseBank.bytes + assets.metadata.bytes + assets.runtime.bytes ||
    report.conservativeStaticDeltaUpperBoundBytes !== manifest.staticBundleDeltaBytes ||
    report.conservativeStaticDeltaUpperBoundBytes > 12 * 1024 * 1024 ||
    !Number.isSafeInteger(report.entireAppJavaScriptBytes) ||
    report.entireAppJavaScriptBytes <= 0 ||
    report.stockWasmAssets !== 0 ||
    report.candidateRuntimeCopies !== 1 ||
    report.candidateModelCopies !== 1 ||
    report.candidatePhraseBankCopies !== 1 ||
    report.candidateMetadataCopies !== 1 ||
    report.passed !== true ||
    report.reportSha256 !== sha256(canonicalJson(identity))
  ) {
    throw new Error('V2R production bundle-size evidence is invalid.');
  }
}

function verifyHoldouts(evidence) {
  const descriptors = {
    coldValidation: ['coldValidationHoldout', 'cold-validation-v3'],
    workspaceValidation: ['workspaceValidationHoldout', 'workspace-validation-v3'],
    coldFinal: ['coldFinalHoldout', 'cold-final-v3'],
    workspaceFinal: ['workspaceFinalHoldout', 'workspace-final-v3'],
  };
  const output = {};
  for (const [name, [bindingKey, classification]] of Object.entries(descriptors)) {
    const holdout = parseJson(evidence[bindingKey].bytes, bindingKey);
    verifyHoldoutShape(holdout, classification);
    output[name] = {
      value: holdout,
      canonicalSha256: sha256(canonicalJson(holdout)),
      bindingSha256: evidence[bindingKey].sha256,
    };
  }
  const ids = Object.values(output).map(({ value }) => value.datasetId);
  if (new Set(ids).size !== ids.length)
    throw new Error('V2R holdout dataset ids must be distinct.');
  return output;
}

function verifyHoldoutShape(holdout, classification) {
  if (
    holdout?.schema !== 'jotluck.autocomplete.multi-reference-holdout.v3' ||
    holdout.schemaVersion !== 3 ||
    holdout.classification !== classification ||
    holdout.releaseEvidence !== true ||
    !isCanonicalIso(holdout.frozenAt) ||
    !Array.isArray(holdout.targets) ||
    holdout.targets.length !== 50 ||
    !Array.isArray(holdout.supportDocuments)
  ) {
    throw new Error(`V2R holdout ${classification} identity is invalid.`);
  }
  const workspace = classification.startsWith('workspace-');
  if (
    (workspace && holdout.supportDocuments.length < 2) ||
    (!workspace && holdout.supportDocuments.length !== 0)
  ) {
    throw new Error(`V2R holdout ${classification} support-document contract is invalid.`);
  }
  let total = 0;
  let complete = 0;
  let silence = 0;
  const languages = { zh: 0, en: 0 };
  const categories = Object.fromEntries(CATEGORIES.map((category) => [category, 0]));
  const checkpointIds = new Set();
  const continuations = new Set();
  for (const target of holdout.targets) {
    if (
      (target.language !== 'zh' && target.language !== 'en') ||
      !CATEGORIES.includes(target.category) ||
      typeof target.text !== 'string' ||
      !Array.isArray(target.checkpoints) ||
      target.checkpoints.length !== 4
    ) {
      throw new Error(`V2R holdout ${classification} target is invalid.`);
    }
    if (
      workspace &&
      (!Array.isArray(target.workspaceSupportDocumentIds) ||
        new Set(target.workspaceSupportDocumentIds).size < 2)
    ) {
      throw new Error(`V2R workspace target ${target.id} lacks independent support.`);
    }
    for (const checkpoint of target.checkpoints) {
      if (
        !checkpoint.id ||
        checkpointIds.has(checkpoint.id) ||
        !Number.isSafeInteger(checkpoint.cursorOffset) ||
        checkpoint.cursorOffset < 0 ||
        checkpoint.cursorOffset > target.text.length ||
        !Array.isArray(checkpoint.acceptableSuffixes)
      ) {
        throw new Error(`V2R holdout ${classification} checkpoint is invalid.`);
      }
      checkpointIds.add(checkpoint.id);
      total++;
      languages[target.language]++;
      categories[target.category]++;
      if (checkpoint.expectedBehavior === 'complete') {
        complete++;
        if (checkpoint.acceptableSuffixes.length < 3 || checkpoint.acceptableSuffixes.length > 5) {
          throw new Error(`V2R complete checkpoint ${checkpoint.id} must have 3-5 references.`);
        }
        for (const suffix of checkpoint.acceptableSuffixes) {
          const normalized = normalizeText(suffix);
          if (!isUsableReference(suffix, target.language) || continuations.has(normalized)) {
            throw new Error(`V2R holdout continuation is invalid or duplicated: ${checkpoint.id}.`);
          }
          continuations.add(normalized);
        }
      } else if (checkpoint.expectedBehavior === 'silence') {
        silence++;
        if (checkpoint.acceptableSuffixes.length !== 0) {
          throw new Error(`V2R silence checkpoint ${checkpoint.id} must not have references.`);
        }
      } else throw new Error(`V2R checkpoint behavior is invalid: ${checkpoint.id}.`);
    }
  }
  if (
    total !== 200 ||
    complete !== 150 ||
    silence !== 50 ||
    languages.zh !== 100 ||
    languages.en !== 100 ||
    CATEGORIES.some((category) => categories[category] !== 40)
  ) {
    throw new Error(`V2R holdout ${classification} composition is invalid.`);
  }
}

function verifyQualityEvidence(manifest, evidence, assets, holdouts, evaluatorTreeSha256) {
  const quality = parseJson(evidence.qualityReport.bytes, 'qualityReport');
  const finalOverlap = parseJson(evidence.finalOverlapAudit.bytes, 'finalOverlapAudit');
  if (
    quality?.schema !== 'jotluck.autocomplete.v2r-quality-report.v1' ||
    quality.schemaVersion !== 1 ||
    quality.engine !== manifest.engine ||
    quality.modelSha256 !== assets.model.sha256 ||
    quality.phraseBankSha256 !== assets.phraseBank.sha256 ||
    quality.metadataSha256 !== assets.metadata.sha256 ||
    quality.evaluatorTreeSha256 !== evaluatorTreeSha256 ||
    quality.candidateFrozenBeforeFinal !== true ||
    quality.finalOverlapAuditSha256 !== finalOverlap.reportSha256 ||
    quality.releaseEligible !== true
  ) {
    throw new Error('V2R quality report identity is invalid.');
  }
  for (const name of ['coldValidation', 'workspaceValidation', 'coldFinal', 'workspaceFinal']) {
    const result = quality.holdouts?.[name];
    if (result?.holdoutSha256 !== holdouts[name].canonicalSha256) {
      throw new Error(`V2R quality report holdout binding is invalid: ${name}.`);
    }
    assertReleaseMetrics(result.metrics, name);
  }
}

function assertReleaseMetrics(metrics, name) {
  const overall = metrics?.overall;
  if (
    overall?.opportunities !== 200 ||
    overall.completeOpportunities !== 150 ||
    overall.silenceOpportunities !== 50 ||
    !Number.isSafeInteger(overall.triggers) ||
    overall.triggers < 120 ||
    overall.triggers > 130 ||
    overall.triggerRate !== overall.triggers / 200 ||
    !Number.isSafeInteger(overall.usable) ||
    overall.usable < 120 ||
    overall.usableRate !== overall.usable / 200 ||
    !Number.isSafeInteger(overall.falseTriggers) ||
    overall.falseTriggers > 1 ||
    overall.falseTriggerRate > 0.03 ||
    overall.oracleAt32Rate < 0.7 ||
    metrics.mixedVisibleCandidates !== 0 ||
    metrics.mixedRankedCandidates !== 0 ||
    metrics.releaseGate?.passed !== true
  ) {
    throw new Error(`V2R ${name} overall quality metrics do not pass.`);
  }
  for (const language of ['zh', 'en']) {
    const slice = metrics.byLanguage?.[language];
    if (slice?.opportunities !== 100 || slice.usableRate < 0.55 || slice.oracleAt32Rate < 0.65) {
      throw new Error(`V2R ${name} ${language} metrics do not pass.`);
    }
  }
  for (const category of CATEGORIES) {
    const slice = metrics.byCategory?.[category];
    if (slice?.opportunities !== 40 || slice.usableRate < 0.5) {
      throw new Error(`V2R ${name} ${category} metrics do not pass.`);
    }
  }
}

function verifyRuntimeEvidence(manifest, evidence, assets, holdouts) {
  const runtime = parseJson(evidence.runtimeReport.bytes, 'runtimeReport');
  if (
    runtime?.schema !== 'jotluck.autocomplete.v2r-runtime-report.v1' ||
    runtime.schemaVersion !== 1 ||
    runtime.modelSha256 !== assets.model.sha256 ||
    runtime.runtimeSha256 !== assets.runtime.sha256 ||
    runtime.workerOnly !== true ||
    runtime.mainThreadModelLongTasksOver50Ms !== 0 ||
    runtime.measuredStaticDeltaBytes !== manifest.staticBundleDeltaBytes ||
    runtime.measuredStaticDeltaBytes > 12 * 1024 * 1024
  ) {
    throw new Error('V2R runtime report identity or static budget is invalid.');
  }
  for (const name of ['coldFinal', 'workspaceFinal']) {
    const result = runtime.holdouts?.[name];
    if (
      result?.holdoutSha256 !== holdouts[name].canonicalSha256 ||
      result.requestCount !== 200 ||
      result.visibleRequestCount < 120 ||
      result.visibleRequestCount > 130 ||
      !isFiniteWithin(result.allRequestP90Ms, 0, 140) ||
      !isFiniteWithin(result.visibleGhostP90Ms, 0, 140) ||
      !isUnitRate(result.timeoutRate) ||
      !isUnitRate(result.fallbackRate) ||
      result.backendKind !== 'worker' ||
      result.backendStatus !== 'ready'
    ) {
      throw new Error(`V2R ${name} runtime evidence does not pass.`);
    }
  }
}

function verifyFinalReceipt(evidence, assets, holdouts) {
  const receipt = parseJson(evidence.finalConsumptionReceipt.bytes, 'finalConsumptionReceipt');
  const finalOverlap = parseJson(evidence.finalOverlapAudit.bytes, 'finalOverlapAudit');
  if (
    receipt?.schema !== 'jotluck.autocomplete.v2r-final-consumption.v1' ||
    receipt.schemaVersion !== 1 ||
    receipt.status !== 'passed' ||
    receipt.consumedOnce !== true ||
    !isCanonicalIso(receipt.consumedAt) ||
    receipt.modelSha256 !== assets.model.sha256 ||
    receipt.phraseBankSha256 !== assets.phraseBank.sha256 ||
    receipt.coldFinalSha256 !== holdouts.coldFinal.canonicalSha256 ||
    receipt.workspaceFinalSha256 !== holdouts.workspaceFinal.canonicalSha256 ||
    receipt.finalOverlapAuditSha256 !== finalOverlap.reportSha256
  ) {
    throw new Error('V2R final-consumption receipt is invalid.');
  }
}

function verifyWebviewSmoke(evidence, assets) {
  const smoke = parseJson(evidence.webviewSmoke.bytes, 'webviewSmoke');
  if (
    smoke?.schema !== 'jotluck.autocomplete.v2r-webview-smoke.v1' ||
    smoke.schemaVersion !== 1 ||
    smoke.modelSha256 !== assets.model.sha256 ||
    smoke.tauriWebviewExecuted !== true ||
    smoke.offlineReloadPassed !== true ||
    smoke.workerInferencePassed !== true ||
    smoke.webBuildSubstitute !== false
  ) {
    throw new Error('V2R real Tauri WebView smoke evidence is missing or invalid.');
  }
}

function assertProfilesEquivalent(verified) {
  if (verified[0].equivalenceIdentity !== verified[1].equivalenceIdentity) {
    throw new Error('V2R web-local and release manifests do not bind the same model evidence.');
  }
}

function verifyPhraseBank(bytes, expectedSize) {
  const text = decodeUtf8(bytes, 'phrase bank');
  const lines = text.split(/\r?\n/u).filter((line) => line.trim());
  if (lines.length !== expectedSize) throw new Error('V2R phrase-bank size is invalid.');
  const ids = new Set();
  const texts = new Set();
  for (const line of lines) {
    const value = JSON.parse(line);
    const normalized = value?.text?.normalize?.('NFKC');
    if (
      typeof value?.id !== 'string' ||
      typeof value?.text !== 'string' ||
      (value.language !== 'zh' && value.language !== 'en') ||
      ids.has(value.id) ||
      texts.has(normalized) ||
      !isUsableReference(value.text, value.language)
    ) {
      throw new Error('V2R phrase-bank entry is invalid or duplicated.');
    }
    ids.add(value.id);
    texts.add(normalized);
  }
}

function verifyRuntimeMetadata(bytes, phraseBankSize) {
  const value = parseJson(bytes, 'runtime metadata');
  if (
    value?.schema !== 'jotluck.autocomplete.public-runtime-metadata.v1' ||
    value.schemaVersion !== 1 ||
    value.runtime?.package !== 'onnxruntime-web' ||
    value.runtime.version !== '1.27.0' ||
    value.runtime.executionProvider !== 'wasm' ||
    value.abstainIndex !== phraseBankSize ||
    value.byteTokenizer?.sequenceLength !== 192 ||
    value.byteTokenizer?.patchBytes !== 4 ||
    value.byteTokenizer?.paddingId !== 0 ||
    value.byteTokenizer?.byteOffset !== 1 ||
    value.byteTokenizer?.alignment !== 'right' ||
    !isUnitRate(value.thresholds?.zh) ||
    !isUnitRate(value.thresholds?.en)
  ) {
    throw new Error('V2R runtime metadata is invalid.');
  }
}

function toEvidenceRole(role) {
  return role === 'phrase-bank' ? 'phraseBank' : role;
}

function resolveOptionalWorkspacePath(rootDir, relativePath) {
  if (
    typeof relativePath !== 'string' ||
    relativePath.includes('..') ||
    path.isAbsolute(relativePath)
  ) {
    throw new Error('Optional V2R manifest path is unsafe.');
  }
  const resolvedRoot = path.resolve(rootDir);
  const resolvedPath = path.resolve(resolvedRoot, relativePath);
  const relative = path.relative(resolvedRoot, resolvedPath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Optional V2R manifest path escaped the workspace.');
  }
  return resolvedPath;
}

function readJson(filePath, label) {
  return parseJson(readFileSync(filePath), label);
}

function parseJson(bytes, label) {
  try {
    const decoded = bytes[0] === 0x1f && bytes[1] === 0x8b ? gunzipSync(bytes) : bytes;
    return JSON.parse(decodeUtf8(decoded, label));
  } catch (error) {
    throw new Error(`V2R ${label} is not valid JSON: ${String(error)}.`);
  }
}

function decodeUtf8(bytes, label) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Error(`V2R ${label} is not valid UTF-8.`);
  }
}

function normalizeText(value) {
  return String(value).normalize('NFKC').replace(/\s+/gu, ' ').trim().toLocaleLowerCase('en-US');
}

function isUsableReference(value, language) {
  if (typeof value !== 'string' || /[\r\n]/u.test(value)) return false;
  const hasHan = /\p{Script=Han}/u.test(value);
  const hasLatin = /[A-Za-z]/u.test(value);
  if (hasHan && hasLatin) return false;
  if (language === 'zh') return !hasLatin && (value.match(/\p{Script=Han}/gu)?.length ?? 0) >= 3;
  return language === 'en' && !hasHan && (value.match(/[A-Za-z]/gu)?.length ?? 0) >= 5;
}

function isCanonicalIso(value) {
  return (
    typeof value === 'string' &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}

function isSha256(value) {
  return typeof value === 'string' && /^[0-9a-f]{64}$/u.test(value);
}

function isUnitRate(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

function isFiniteWithin(value, minimum, maximum) {
  return (
    typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum
  );
}

function looksLikeHtml(bytes) {
  return /^\s*(?:<!doctype\s+html|<html|<head|<body)\b/iu.test(
    bytes.subarray(0, 512).toString('utf8'),
  );
}

function hasWasmMagic(bytes) {
  return (
    bytes.byteLength >= 8 &&
    bytes[0] === 0 &&
    bytes[1] === 0x61 &&
    bytes[2] === 0x73 &&
    bytes[3] === 0x6d
  );
}

function parseCliArguments(argv) {
  let mode = 'ci';
  let rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  for (const argument of argv) {
    if (argument === '--mode=ci' || argument === '--mode=rc') {
      mode = argument.slice('--mode='.length);
    } else if (argument.startsWith('--root-dir=')) {
      rootDir = path.resolve(argument.slice('--root-dir='.length));
    } else {
      throw new Error(`Unknown V2R evidence argument: ${argument}`);
    }
  }
  return { mode, rootDir };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { mode, rootDir } = parseCliArguments(process.argv.slice(2));
    const present = hasAnyV2RPublicManifest(rootDir);
    if (!present && mode === 'rc') {
      throw new Error('V2R RC verification requires both atomically published v5 manifests.');
    }
    const result = present
      ? verifyAutocompleteV2REvidence({
          rootDir,
          expectedEvaluatorFiles: AUTOCOMPLETE_V2R_EVIDENCE_SOURCE_FILES,
        })
      : [
          {
            profile: 'v2r',
            status: 'absent-fail-closed-accepted-in-ci',
          },
        ];
    console.log(JSON.stringify({ mode, result }, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.stack : String(error));
    process.exitCode = 1;
  }
}
