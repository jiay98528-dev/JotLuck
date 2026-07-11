#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AUTOCOMPLETE_EVIDENCE_SOURCE_FILES,
  canonicalJson,
  resolveWorkspaceFile,
  sha256,
  verifyEvaluatorSourceTree,
  verifyFrozenV1Snapshot,
} from './autocomplete-evidence-integrity.mjs';

const MODULE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC_MODELS = [
  {
    asset: 'packages/app/public/baseline-ngram.web-local.compact.txt',
    manifest: 'packages/app/public/baseline-ngram.web-local.compact.manifest.json',
  },
  {
    asset: 'packages/app/public/baseline-ngram.v1.compact.txt',
    manifest: 'packages/app/public/baseline-ngram.v1.compact.manifest.json',
  },
];
const COMPLETE_BINDING_KEYS = [
  'model',
  'trainingInput',
  'validation',
  'final',
  'finalReport',
  'evaluatorTree',
  'frozenV1',
  'qualityReport',
  'runtimeReport',
  'comparison',
  'learningCurve',
  'webviewSmoke',
  'finalRuntimeReport',
  'finalConsumptionReceipt',
];
const SYNTHETIC_SOURCE_IDS = [
  'synthetic-natural-zh',
  'synthetic-project-zh',
  'synthetic-technical-en',
  'synthetic-technical-zh',
  'synthetic-workflow-en',
];
const LEARNING_CURVE_TIERS = [
  ['0.1mib', 104_858],
  ['0.5mib', 524_288],
  ['1mib', 1_048_576],
  ['3mib', 3_145_728],
  ['8mib', 8_388_608],
  ['16mib', 16_777_216],
  ['24mib-cap', 25_165_824],
];
const QUALITY_EVALUATOR_VERSION = 'offline-completion-evaluator-v2';
const RUNTIME_EVALUATOR_VERSION = 'production-router-runtime-v2';

export function verifyAutocompleteEvidence(options = {}) {
  const rootDir = path.resolve(options.rootDir ?? MODULE_ROOT);
  const mode = options.mode ?? 'ci';
  if (mode !== 'ci' && mode !== 'rc') throw new Error(`Unsupported evidence mode: ${mode}.`);
  const models = options.models ?? PUBLIC_MODELS;
  const expectedEvaluatorFiles = options.evaluatorFiles ?? AUTOCOMPLETE_EVIDENCE_SOURCE_FILES;
  const results = models.map((model) => verifyModel(rootDir, model, mode, expectedEvaluatorFiles));
  return { mode, models: results };
}

function verifyModel(rootDir, model, mode, expectedEvaluatorFiles) {
  const assetPath = resolveWorkspaceFile(rootDir, model.asset);
  const manifestPath = resolveWorkspaceFile(rootDir, model.manifest);
  const asset = readFileSync(assetPath);
  const manifest = readJson(manifestPath);
  const actualSha256 = sha256(asset);
  const lineCount = asset
    .toString('utf8')
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(
      (line) =>
        line && line !== '# jotluck-baseline-v4' && line !== '[character]' && line !== '[word]',
    ).length;
  if (
    manifest.verifiedOnly !== true ||
    manifest.modelBytes !== asset.byteLength ||
    manifest.sha256 !== actualSha256 ||
    !Number.isSafeInteger(manifest.entryCount) ||
    manifest.entryCount <= 0 ||
    manifest.entryCount !== lineCount ||
    asset.byteLength > 6 * 1024 * 1024
  ) {
    throw new Error(`Autocomplete model integrity failed: ${model.asset}.`);
  }

  const isV4 =
    manifest.schemaVersion === 2 &&
    manifest.serialization === 'sectioned-jsonl-hex-v4' &&
    manifest.order === 'section-profile-context-hex';
  if (!isV4) {
    if (
      manifest.runtimeEligible !== false ||
      manifest.qualityGatePassed !== false ||
      manifest.releaseEligible !== false
    ) {
      throw new Error(`Legacy autocomplete model is not fail-closed: ${model.manifest}.`);
    }
    if (mode === 'rc') {
      throw new Error(`RC requires a verified v4 autocomplete model: ${model.manifest}.`);
    }
    return { profile: manifest.profile, status: 'fail-closed-legacy', sha256: actualSha256 };
  }

  if (
    manifest.ngramN !== 4 ||
    manifest.minNgramN !== 2 ||
    manifest.countScale !== 1000 ||
    !Array.isArray(manifest.wordNgramOrders) ||
    manifest.wordNgramOrders.join(',') !== '1,2'
  ) {
    throw new Error(`Autocomplete v4 schema contract failed: ${model.manifest}.`);
  }
  if (manifest.releaseEligible === true && manifest.qualityGatePassed !== true) {
    throw new Error(`Release-eligible autocomplete model lacks a passed quality gate.`);
  }
  if (mode === 'ci' && manifest.releaseEligible !== true) {
    if (manifest.runtimeEligible !== false) {
      throw new Error(`Checked-in ineligible autocomplete asset must remain runtime-disabled.`);
    }
    return { profile: manifest.profile, status: 'fail-closed-v4', sha256: actualSha256 };
  }
  if (
    manifest.runtimeEligible !== true ||
    manifest.qualityGatePassed !== true ||
    manifest.releaseEligible !== true
  ) {
    throw new Error(`RC autocomplete model has not passed every release flag.`);
  }
  verifyCompleteEvidence(rootDir, manifest, model, actualSha256, expectedEvaluatorFiles);
  return { profile: manifest.profile, status: 'release-evidence-verified', sha256: actualSha256 };
}

function verifyCompleteEvidence(
  rootDir,
  manifest,
  model,
  actualModelSha256,
  expectedEvaluatorFiles,
) {
  const bindings = manifest.evidenceBindings;
  if (!bindings || bindings.schemaVersion !== 2) {
    throw new Error(`Autocomplete manifest lacks evidenceBindings schema v2: ${model.manifest}.`);
  }
  const resolved = {};
  for (const key of COMPLETE_BINDING_KEYS) {
    const binding = bindings[key];
    if (
      !binding ||
      typeof binding.path !== 'string' ||
      typeof binding.sha256 !== 'string' ||
      !/^[0-9a-f]{64}$/u.test(binding.sha256)
    ) {
      throw new Error(`Autocomplete evidence binding is incomplete: ${key}.`);
    }
    const filePath = resolveWorkspaceFile(rootDir, binding.path);
    const bytes = readFileSync(filePath);
    if (sha256(bytes) !== binding.sha256) {
      throw new Error(`Autocomplete evidence SHA mismatch: ${key}.`);
    }
    resolved[key] = { path: filePath, bytes };
  }
  if (path.resolve(resolved.model.path) !== resolveWorkspaceFile(rootDir, model.asset)) {
    throw new Error('Model evidence binding does not identify the released asset.');
  }
  if (bindings.model.sha256 !== actualModelSha256 || manifest.sha256 !== actualModelSha256) {
    throw new Error('Released model SHA is inconsistent with its evidence binding.');
  }

  const selection = parseJsonBytes(resolved.trainingInput.bytes, 'trainingInput');
  const validation = parseJsonBytes(resolved.validation.bytes, 'validation');
  const finalHoldout = parseJsonBytes(resolved.final.bytes, 'final');
  const finalEvidence = parseJsonBytes(resolved.finalReport.bytes, 'finalReport');
  const evaluator = parseJsonBytes(resolved.evaluatorTree.bytes, 'evaluatorTree');
  const frozenV1 = parseJsonBytes(resolved.frozenV1.bytes, 'frozenV1');
  const quality = parseJsonBytes(resolved.qualityReport.bytes, 'qualityReport');
  const runtime = parseJsonBytes(resolved.runtimeReport.bytes, 'runtimeReport');
  const comparison = parseJsonBytes(resolved.comparison.bytes, 'comparison');
  const curve = parseJsonBytes(resolved.learningCurve.bytes, 'learningCurve');
  const webview = parseJsonBytes(resolved.webviewSmoke.bytes, 'webviewSmoke');
  const finalRuntime = parseJsonBytes(resolved.finalRuntimeReport.bytes, 'finalRuntimeReport');
  const finalReceipt = parseJsonBytes(
    resolved.finalConsumptionReceipt.bytes,
    'finalConsumptionReceipt',
  );
  const validationCanonicalSha = sha256(canonicalJson(validation));
  const finalCanonicalSha = sha256(canonicalJson(finalHoldout));
  const validationOpportunityCount = countValidationOpportunities(validation);

  const evaluatorIdentity = verifyEvaluatorSourceTree(rootDir, evaluator, expectedEvaluatorFiles);
  const frozenIdentity = verifyFrozenV1Snapshot(rootDir, bindings.frozenV1.path, frozenV1);

  if (
    selection.schemaVersion !== 1 ||
    !Array.isArray(selection.documents) ||
    !Array.isArray(selection.fragments)
  ) {
    throw new Error('Training selection manifest is invalid.');
  }
  if (
    validationCanonicalSha !== manifest.holdoutSha256 ||
    quality.validationSha256 !== validationCanonicalSha ||
    comparison.holdoutSha256 !== validationCanonicalSha
  ) {
    throw new Error('Validation holdout identities are inconsistent.');
  }
  if (
    quality.modelSha256 !== actualModelSha256 ||
    quality.trainingInputHash !== manifest.trainingInputHash ||
    quality.evaluatorTreeSha256 !== evaluatorIdentity.treeSha256 ||
    quality.frozenV1TreeSha256 !== frozenIdentity.treeSha256
  ) {
    throw new Error('Quality evidence does not bind the released model and evaluator identities.');
  }
  const selectedTier = assertLearningCurveEvidence({
    curve,
    manifest,
    modelSha256: actualModelSha256,
    modelBytes: readFileSync(resolved.model.path).byteLength,
    validationCanonicalSha,
    validation,
    selection,
    quality,
    comparison,
    evaluatorTreeSha256: evaluatorIdentity.treeSha256,
    frozenV1TreeSha256: frozenIdentity.treeSha256,
    runtimeBytes: resolved.runtimeReport.bytes,
  });
  const runtimeTier = runtime.tiers?.[selectedTier.id];
  if (
    runtime.schemaVersion !== 2 ||
    runtime.classification !== 'production-router-runtime-evidence' ||
    runtime.validationSha256 !== validationCanonicalSha ||
    runtime.evaluatorVersion !== RUNTIME_EVALUATOR_VERSION ||
    !runtimeTier ||
    runtimeTier.productionRouterObserved !== true ||
    runtimeTier.modelSha256 !== actualModelSha256 ||
    runtimeTier.requestCount !== validationOpportunityCount ||
    !Number.isSafeInteger(runtimeTier.visibleSampleCount) ||
    runtimeTier.visibleSampleCount <= 0 ||
    runtimeTier.visibleSampleCount > runtimeTier.requestCount ||
    !isFiniteNonNegative(runtimeTier.allRequestP90Ms) ||
    !isFiniteNonNegative(runtimeTier.visiblePredictionP90Ms) ||
    runtimeTier.allRequestP90Ms > 140 ||
    runtimeTier.visiblePredictionP90Ms > 140 ||
    runtimeTier.mixedCandidateRate !== 0 ||
    !isUnitRate(runtimeTier.fallbackRate) ||
    !isUnitRate(runtimeTier.timeoutRate) ||
    runtimeTier.requestCount !== selectedTier.runtimeRequestCount ||
    runtimeTier.visibleSampleCount !== selectedTier.runtimeVisibleSampleCount ||
    runtimeTier.allRequestP90Ms !== selectedTier.allRequestP90Ms ||
    runtimeTier.visiblePredictionP90Ms !== selectedTier.visiblePredictionP90Ms ||
    runtimeTier.mixedCandidateRate !== selectedTier.mixedCandidateRate ||
    runtimeTier.fallbackRate !== selectedTier.fallbackRate ||
    runtimeTier.timeoutRate !== selectedTier.timeoutRate ||
    !isFiniteNonNegative(runtimeTier.parseMaxChunkMs) ||
    runtimeTier.parseMaxChunkMs > 50 ||
    runtimeTier.parseMaxChunkMs !== selectedTier.parseMaxChunkMs ||
    !Number.isSafeInteger(runtimeTier.parseLongTasksOver50Ms) ||
    runtimeTier.parseLongTasksOver50Ms !== 0 ||
    runtimeTier.parseLongTasksOver50Ms !== selectedTier.parseLongTasksOver50Ms
  ) {
    throw new Error('Production router runtime evidence is missing or failed.');
  }
  assertWorkspaceFinalHoldout(finalHoldout, finalCanonicalSha);
  if (
    finalCanonicalSha !== finalEvidence.finalHoldoutSha256 ||
    finalCanonicalSha !== finalEvidence.finalAudit?.datasetSha256 ||
    finalEvidence.schemaVersion !== 1 ||
    finalEvidence.classification !== 'workspace-final-v2-evidence' ||
    finalEvidence.releaseEligible !== true ||
    finalEvidence.modelSha256 !== actualModelSha256 ||
    finalEvidence.validationCurveSha256 !== manifest.learningCurveSha256 ||
    finalEvidence.finalHoldoutConsumed !== true ||
    !/^[a-f0-9]{64}$/u.test(finalEvidence.finalHoldoutSha256 ?? '') ||
    finalEvidence.finalAudit?.datasetSha256 !== finalEvidence.finalHoldoutSha256 ||
    finalEvidence.finalAudit?.targetDocuments !== 50 ||
    finalEvidence.finalAudit?.checkpoints !== 200 ||
    finalEvidence.finalAudit?.languageCheckpoints?.zh !== 100 ||
    finalEvidence.finalAudit?.languageCheckpoints?.en !== 100 ||
    finalEvidence.finalAudit?.silenceCheckpoints !== 50 ||
    finalEvidence.finalAudit?.exactContinuationDuplicates !== 0 ||
    finalEvidence.finalAudit?.nearContinuationDuplicates / 150 > 0.03 ||
    finalEvidence.finalAudit?.supportContinuationOverlaps !== 0 ||
    finalEvidence.finalAudit?.maxCategoryRatio > 0.4 ||
    finalEvidence.finalAudit?.maxTemplateRatio > 0.1 ||
    finalEvidence.finalAudit?.maxStructuralTemplateRatio > 0.1 ||
    finalEvidence.finalAudit?.maxFrequentNgramRatio > 0.3 ||
    finalEvidence.finalAudit?.sharedLongNgramPairs !== 0 ||
    finalEvidence.runtimeEvidenceSha256 !== sha256(resolved.finalRuntimeReport.bytes) ||
    finalEvidence.consumptionReceiptSha256 !== sha256(resolved.finalConsumptionReceipt.bytes) ||
    canonicalJson(finalEvidence.runtime) !== canonicalJson(finalRuntime) ||
    !isValidFinalRuntimeEvidence(
      finalRuntime,
      actualModelSha256,
      finalEvidence.finalHoldoutSha256,
    ) ||
    finalEvidence.v21Eligible !==
      (finalRuntime.oracleAt8Rate - finalRuntime.top1Rate >= 0.08 &&
        ['zh', 'en'].every((language) => {
          const metrics = finalRuntime.language?.[language];
          return (
            metrics?.top1Rate + 0.02 >= metrics?.v1Top1Rate &&
            metrics?.usableRate + 0.02 >= metrics?.v1UsableRate
          );
        }))
  ) {
    throw new Error('Workspace final evidence is missing, unconsumed, or model-mismatched.');
  }
  if (
    finalReceipt.schemaVersion !== 1 ||
    finalReceipt.classification !== 'workspace-final-v2-consumption-receipt' ||
    finalReceipt.finalHoldoutSha256 !== finalEvidence.finalHoldoutSha256 ||
    finalReceipt.modelSha256 !== actualModelSha256 ||
    finalReceipt.validationCurveSha256 !== manifest.learningCurveSha256 ||
    !Number.isFinite(Date.parse(finalReceipt.claimedAt))
  ) {
    throw new Error('Workspace final consumption receipt is missing or inconsistent.');
  }
  if (
    comparison.frozenV1TreeSha256 !== frozenIdentity.treeSha256 ||
    canonicalJson(comparison) !== canonicalJson(selectedTier.v1Comparison) ||
    canonicalJson(comparison) !== canonicalJson(quality.comparison) ||
    comparison.v2.top1Rate < comparison.v1.top1Rate ||
    comparison.v2.usableRate < comparison.v1.usableRate ||
    comparison.v2.mixedCandidates > comparison.v1.mixedCandidates
  ) {
    throw new Error('V1/V2 comparison is missing or contains a safety/quality regression.');
  }
  if (
    webview.classification !== 'tauri-webview-offline-smoke' ||
    webview.status !== 'pass' ||
    webview.modelSha256 !== actualModelSha256 ||
    !Number.isFinite(Date.parse(webview.completedAt)) ||
    Date.parse(webview.completedAt) < Date.parse(finalReceipt.claimedAt)
  ) {
    throw new Error('A real Tauri WebView offline smoke is required for RC.');
  }
}

function parseJsonBytes(bytes, label) {
  try {
    return JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    throw new Error(`${label} evidence is invalid JSON: ${String(error)}.`);
  }
}

function readJson(filePath) {
  return parseJsonBytes(readFileSync(filePath), filePath);
}

function assertLearningCurveEvidence(input) {
  const {
    curve,
    manifest,
    modelSha256,
    modelBytes,
    validationCanonicalSha,
    validation,
    selection,
    quality,
    comparison,
    evaluatorTreeSha256,
    frozenV1TreeSha256,
    runtimeBytes,
  } = input;
  assertFormalValidationHoldout(validation);
  const { learningCurveSha256: claimedCurveSha, ...curveCore } = curve ?? {};
  if (
    curve?.schemaVersion !== 2 ||
    curve.version !== 'autocomplete-learning-curve-v2' ||
    curve.stage !== 'validation' ||
    curve.generatorVersion !== 'jotluck-synthetic-short-notes-v1' ||
    curve.generatorSeed !== 'project-owned-seed-2026-07-11' ||
    curve.validationPath !== 'scripts/corpus/formal-holdout.json' ||
    curve.validationSha256 !== validationCanonicalSha ||
    curve.evaluatorVersion !== QUALITY_EVALUATOR_VERSION ||
    curve.evaluatorTreeSha256 !== evaluatorTreeSha256 ||
    curve.frozenV1TreeSha256 !== frozenV1TreeSha256 ||
    curve.runtimeEvidenceStatus !== 'accepted' ||
    curve.runtimeEvidenceSha256 !== sha256(runtimeBytes) ||
    curve.releaseEligible !== false ||
    curve.finalHoldoutConsumed !== false ||
    curve.selectionReason !== 'minimum-eligible-tier' ||
    !sameStrings(curve.sourceIds, SYNTHETIC_SOURCE_IDS) ||
    !isSha256(claimedCurveSha) ||
    sha256(canonicalJson(curveCore)) !== claimedCurveSha ||
    manifest.learningCurveSha256 !== claimedCurveSha ||
    manifest.evaluatorVersion !== QUALITY_EVALUATOR_VERSION ||
    manifest.evaluatorSha256 !== evaluatorTreeSha256 ||
    !Array.isArray(curve.tiers) ||
    curve.tiers.length !== LEARNING_CURVE_TIERS.length
  ) {
    throw new Error('Learning curve does not contain valid, self-bound validation evidence.');
  }

  const seen = new Set();
  for (let index = 0; index < LEARNING_CURVE_TIERS.length; index++) {
    const [expectedId, expectedBytes] = LEARNING_CURVE_TIERS[index];
    const tier = curve.tiers[index];
    if (
      !tier ||
      tier.id !== expectedId ||
      tier.requestedBytes !== expectedBytes ||
      seen.has(tier.id) ||
      !Number.isSafeInteger(tier.realizedBytes) ||
      tier.realizedBytes <= 0 ||
      tier.realizedBytes > tier.requestedBytes ||
      (index > 0 && tier.realizedBytes < curve.tiers[index - 1].realizedBytes) ||
      !isSha256(tier.selectionManifestHash) ||
      !isSha256(tier.modelSha256) ||
      !isSha256(tier.trainingInputHash) ||
      !sameStrings(tier.sourceIds, SYNTHETIC_SOURCE_IDS)
    ) {
      throw new Error(`Learning curve tier ${String(expectedId)} is malformed.`);
    }
    seen.add(tier.id);
  }
  const firstEligible = curve.tiers.find((tier) => tier.eligible === true);
  if (!firstEligible || curve.selectedTier !== firstEligible.id) {
    throw new Error('Learning curve did not select the minimum eligible tier.');
  }
  if (
    firstEligible.modelSha256 !== modelSha256 ||
    firstEligible.modelBytes !== modelBytes ||
    firstEligible.trainingInputHash !== manifest.trainingInputHash ||
    firstEligible.selectionManifestHash !== sha256(canonicalJson(selection)) ||
    firstEligible.selectionDocumentCount !== selection.documents.length ||
    firstEligible.selectionFragmentCount !== selection.fragments.length ||
    firstEligible.safetyGatePassed !== true ||
    firstEligible.hardLimitPassed !== true ||
    firstEligible.softTargetPassed !== true ||
    firstEligible.modelQualityPassed !== true ||
    firstEligible.deterministicRuntimeSafetyPassed !== true ||
    firstEligible.runtimeMeasurementRequired !== true ||
    firstEligible.runtimeEvidencePassed !== true ||
    !Array.isArray(firstEligible.ineligibilityReasons) ||
    firstEligible.ineligibilityReasons.length !== 0 ||
    firstEligible.triggerRate < 0.35 ||
    firstEligible.triggerRate > 0.42 ||
    firstEligible.usableRate < 0.35 ||
    firstEligible.falseTriggerRate > 0.03 ||
    firstEligible.mixedCandidateRate !== 0 ||
    firstEligible.v1Comparison?.delta?.top1Rate < 0 ||
    firstEligible.v1Comparison?.delta?.usableRate < 0 ||
    firstEligible.v1Comparison?.v2?.mixedCandidates >
      firstEligible.v1Comparison?.v1?.mixedCandidates
  ) {
    throw new Error('Selected learning-curve tier no longer satisfies release gates.');
  }
  const evaluation = quality?.evaluation;
  if (
    quality?.schemaVersion !== 2 ||
    quality.classification !== 'deterministic-model-quality-evidence' ||
    quality.stage !== 'validation' ||
    quality.releaseEligible !== false ||
    quality.evaluatorVersion !== QUALITY_EVALUATOR_VERSION ||
    evaluation?.schemaVersion !== 2 ||
    evaluation.evaluatorVersion !== QUALITY_EVALUATOR_VERSION ||
    evaluation.model?.sha256 !== modelSha256 ||
    evaluation.model?.bytes !== modelBytes ||
    evaluation.holdout?.sha256 !== validationCanonicalSha ||
    evaluation.holdout?.opportunities !== countValidationOpportunities(validation) ||
    evaluation.l3Raw?.contextHitRate !== firstEligible.contextHitRate ||
    evaluation.l3Raw?.top1Rate !== firstEligible.top1Rate ||
    evaluation.l3Raw?.oracleAt8Rate !== firstEligible.oracleAt8Rate ||
    evaluation.fullStack?.triggerRate !== firstEligible.triggerRate ||
    evaluation.fullStack?.usableRate !== firstEligible.usableRate ||
    evaluation.fullStack?.falseTriggerRate !== firstEligible.falseTriggerRate ||
    evaluation.fullStack?.mixedCandidates !== comparison.v2.mixedCandidates ||
    evaluation.verdicts?.runtimeSafety?.status !== 'pass' ||
    evaluation.verdicts?.modelQuality?.status !== 'pass' ||
    canonicalJson(quality.comparison) !== canonicalJson(comparison) ||
    canonicalJson(firstEligible.v1Comparison) !== canonicalJson(comparison)
  ) {
    throw new Error('Deterministic quality evidence does not reproduce the selected tier.');
  }
  return firstEligible;
}

function assertFormalValidationHoldout(validation) {
  if (validation?.schemaVersion !== 2 || !Array.isArray(validation.cases)) {
    throw new Error('Formal validation holdout is invalid.');
  }
  let opportunities = 0;
  let silence = 0;
  const languages = { zh: 0, en: 0 };
  for (const item of validation.cases) {
    if (
      !item ||
      (item.language !== 'zh' && item.language !== 'en') ||
      !Array.isArray(item.checkpoints)
    ) {
      throw new Error('Formal validation holdout contains an invalid case.');
    }
    for (const checkpoint of item.checkpoints) {
      if (
        checkpoint?.expectedBehavior !== 'complete' &&
        checkpoint?.expectedBehavior !== 'silence'
      ) {
        throw new Error('Formal validation holdout contains an invalid checkpoint.');
      }
      opportunities++;
      languages[item.language]++;
      if (checkpoint.expectedBehavior === 'silence') silence++;
    }
  }
  if (
    opportunities !== 200 ||
    languages.zh < 80 ||
    languages.en < 80 ||
    silence / opportunities < 0.2
  ) {
    throw new Error('Formal validation holdout composition is not release-grade.');
  }
}

function assertWorkspaceFinalHoldout(finalHoldout, canonicalSha256) {
  if (
    finalHoldout?.schemaVersion !== 2 ||
    finalHoldout.classification !== 'workspace-conditioned-final-v2' ||
    finalHoldout.releaseEvidence !== true ||
    !Array.isArray(finalHoldout.supportDocuments) ||
    !Array.isArray(finalHoldout.targets) ||
    finalHoldout.targets.length !== 50 ||
    !isSha256(canonicalSha256)
  ) {
    throw new Error('Workspace final holdout identity is invalid.');
  }
  const supportById = new Map();
  for (const support of finalHoldout.supportDocuments) {
    if (!support?.id || supportById.has(support.id) || typeof support.text !== 'string') {
      throw new Error('Workspace final holdout has an invalid support document.');
    }
    supportById.set(support.id, support);
  }
  let checkpoints = 0;
  let silence = 0;
  const languages = { zh: 0, en: 0 };
  const targetIds = new Set();
  for (const target of finalHoldout.targets) {
    if (
      !target?.id ||
      targetIds.has(target.id) ||
      (target.language !== 'zh' && target.language !== 'en') ||
      !Array.isArray(target.supportDocumentIds) ||
      target.supportDocumentIds.length < 2 ||
      !Array.isArray(target.checkpoints)
    ) {
      throw new Error('Workspace final holdout has an invalid target document.');
    }
    targetIds.add(target.id);
    for (const supportId of target.supportDocumentIds) {
      const support = supportById.get(supportId);
      if (!support || support.id === target.id || support.path === target.path) {
        throw new Error('Workspace final target/support separation is invalid.');
      }
    }
    for (const checkpoint of target.checkpoints) {
      if (
        checkpoint?.expectedBehavior !== 'complete' &&
        checkpoint?.expectedBehavior !== 'silence'
      ) {
        throw new Error('Workspace final holdout has an invalid checkpoint.');
      }
      checkpoints++;
      languages[target.language]++;
      if (checkpoint.expectedBehavior === 'silence') silence++;
    }
  }
  if (checkpoints !== 200 || languages.zh !== 100 || languages.en !== 100 || silence !== 50) {
    throw new Error('Workspace final holdout composition is not frozen at 50/200/100/100/50.');
  }
}

function sameStrings(left, right) {
  if (!Array.isArray(left) || left.length !== right.length) return false;
  const sorted = [...left].sort((a, b) => String(a).localeCompare(String(b), 'en'));
  const expected = [...right].sort((a, b) => a.localeCompare(b, 'en'));
  return sorted.every((item, index) => item === expected[index]);
}

function isSha256(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
}

function countValidationOpportunities(validation) {
  if (!Array.isArray(validation?.cases)) return -1;
  return validation.cases.reduce(
    (total, item) => total + (Array.isArray(item?.checkpoints) ? item.checkpoints.length : 0),
    0,
  );
}

function isFiniteNonNegative(value) {
  return Number.isFinite(value) && value >= 0;
}

function isUnitRate(value) {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}

function isValidFinalRuntimeEvidence(evidence, modelSha256, finalHoldoutSha256) {
  if (
    evidence?.schemaVersion !== 1 ||
    evidence.classification !== 'workspace-final-v2-runtime-evidence' ||
    evidence.stage !== 'final' ||
    evidence.productionRouterObserved !== true ||
    evidence.modelSha256 !== modelSha256 ||
    evidence.finalHoldoutSha256 !== finalHoldoutSha256 ||
    evidence.opportunities !== 200 ||
    evidence.requestCount !== 200 ||
    !Number.isSafeInteger(evidence.visibleSampleCount) ||
    evidence.visibleSampleCount <= 0 ||
    evidence.visibleSampleCount > evidence.requestCount ||
    evidence.triggerRate < 0.35 ||
    evidence.triggerRate > 0.42 ||
    evidence.usableRate < 0.35 ||
    evidence.falseTriggerRate > 0.03 ||
    evidence.mixedCandidateRate !== 0 ||
    !isFiniteNonNegative(evidence.allRequestP90Ms) ||
    !isFiniteNonNegative(evidence.visiblePredictionP90Ms) ||
    evidence.allRequestP90Ms > 140 ||
    evidence.visiblePredictionP90Ms > 140
  ) {
    return false;
  }
  return ['zh', 'en'].every((language) => {
    const metrics = evidence.language?.[language];
    return (
      metrics &&
      [metrics.top1Rate, metrics.usableRate, metrics.v1Top1Rate, metrics.v1UsableRate].every(
        isUnitRate,
      ) &&
      metrics.top1Rate + 0.02 >= metrics.v1Top1Rate &&
      metrics.usableRate + 0.02 >= metrics.v1UsableRate
    );
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const modeArg = process.argv.find((item) => item.startsWith('--mode='));
    const mode = modeArg?.slice('--mode='.length) ?? 'ci';
    const result = verifyAutocompleteEvidence({ mode });
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 10;
  }
}
