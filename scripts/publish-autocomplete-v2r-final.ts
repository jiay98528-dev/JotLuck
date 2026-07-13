/**
 * Fail-closed V2R publisher. It is intentionally unable to train, evaluate,
 * or relax a gate: it can only bind an already frozen candidate and complete
 * evidence set, then install both profiles in one rollback-capable transaction.
 */
import { randomBytes } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
// Independent ESM verifiers deliberately have no declaration output.
// @ts-expect-error See scripts/autocomplete-evidence-integrity.mjs.
import { AUTOCOMPLETE_V2R_EVIDENCE_SOURCE_FILES } from './autocomplete-evidence-integrity.mjs';
// @ts-expect-error See scripts/verify-autocomplete-v2r-evidence.mjs.
import { verifyAutocompleteV2REvidence } from './verify-autocomplete-v2r-evidence.mjs';
import {
  canonicalSha256,
  PROJECT_OWNED_GENERATOR_V3,
  PROJECT_OWNED_GENERATOR_V3_SEED,
  sha256,
  validatePublicModelManifestV5,
  validateV2RHoldoutV3,
  V2R_REPOSITORY_ROOT,
  type PublicModelManifestV5,
  type V2RHoldoutV3,
} from './autocomplete-v2r/index';

type HoldoutName = 'coldValidation' | 'workspaceValidation' | 'coldFinal' | 'workspaceFinal';
const PUBLIC_ASSETS = {
  model: 'packages/app/public/public-phrase-transformer-v1.int8.onnx',
  phraseBank: 'packages/app/public/public-phrase-transformer-v1.phrases.jsonl',
  metadata: 'packages/app/public/public-phrase-transformer-v1.metadata.json',
  runtime: 'packages/app/public/ort-wasm-simd-threaded.v2r.wasm',
} as const;

const PUBLIC_MANIFESTS = {
  'web-local': 'packages/app/public/public-phrase-transformer-v1.web-local.manifest.json',
  release: 'packages/app/public/public-phrase-transformer-v1.release.manifest.json',
} as const;

export interface PublishAutocompleteV2RFinalOptions {
  rootDir?: string;
  candidateDir: string;
  evidenceBundleDir: string;
  evaluatorTreePath: string;
  webviewSmokePath: string;
  holdoutPaths: Record<HoldoutName, string>;
}

export interface PublishAutocompleteV2RFinalResult {
  candidateId: string;
  modelSha256: string;
  evidenceDirectory: string;
  manifests: typeof PUBLIC_MANIFESTS;
}

export function publishAutocompleteV2RFinal(
  options: PublishAutocompleteV2RFinalOptions,
): PublishAutocompleteV2RFinalResult {
  if (process.env.VITEST !== 'true') {
    throw new Error(
      'Public V2R publication is archived; only publish-autocomplete-v2s-final may write the canonical public model.',
    );
  }
  const rootDir = fs.realpathSync(path.resolve(options.rootDir ?? V2R_REPOSITORY_ROOT));
  assertArchitectureNotBlocked(rootDir);
  const candidateDir = resolveDirectory(rootDir, options.candidateDir, 'candidateDir');
  const evidenceBundleDir = resolveDirectory(
    rootDir,
    options.evidenceBundleDir,
    'evidenceBundleDir',
  );
  const candidateId = path.basename(candidateDir);
  if (!/^[A-Za-z0-9._-]{3,160}$/u.test(candidateId)) {
    throw new Error('V2R candidate directory name is not a stable candidate id.');
  }

  const cacheRoot = resolveDirectory(
    rootDir,
    'scripts/corpus/_web-cache/autocomplete-v2r',
    'cacheRoot',
  );
  if (!isWithin(candidateDir, path.join(cacheRoot, 'candidates'))) {
    throw new Error('V2R candidate escaped the approved candidate cache.');
  }

  const training = readJson(path.join(candidateDir, 'training-report.json'));
  assertEligibleTrainingReport(training, candidateId);
  const architecture = training.architecture as Record<string, number>;
  const phraseBankSize = architecture.phraseBankSize as 8192 | 12288 | 16384;
  const trainingDataDir = path.join(cacheRoot, 'training', String(phraseBankSize));

  const sourceFiles = {
    model: path.join(candidateDir, 'model.int8.onnx'),
    phraseBank: path.join(trainingDataDir, 'phrase-bank.jsonl'),
    metadata: path.join(candidateDir, 'runtime-metadata.json'),
    runtime: path.join(candidateDir, 'ort-wasm-simd-threaded.reduced.wasm'),
    selectionManifest: path.join(cacheRoot, 'selection-manifest.json'),
    sourceRegistry: path.join(cacheRoot, 'source-registry.json'),
    corpusGovernance: path.join(cacheRoot, 'governance-report.json'),
    generatorReport: path.join(cacheRoot, 'generator-report.json'),
    trainingInput: path.join(trainingDataDir, 'training-data-report.json'),
    trainingReport: path.join(candidateDir, 'training-report.json'),
    quantizationReport: path.join(candidateDir, 'quantization-report.json'),
    operatorConfig: path.join(candidateDir, 'required-operators.config'),
    runtimeBuildReport: path.join(candidateDir, 'runtime-build-report.json'),
    bundleSizeReport: path.join(candidateDir, 'bundle-size-report.json'),
    evaluatorSourceTree: resolveFile(rootDir, options.evaluatorTreePath, 'evaluatorTreePath'),
    qualityReport: path.join(evidenceBundleDir, 'quality-report.json'),
    runtimeReport: path.join(evidenceBundleDir, 'runtime-report.json'),
    finalConsumptionReceipt: path.join(evidenceBundleDir, 'final-consumption-receipt.json'),
    finalOverlapAudit: path.join(evidenceBundleDir, 'final-overlap-audit.json'),
    webviewSmoke: resolveFile(rootDir, options.webviewSmokePath, 'webviewSmokePath'),
  } as const;
  const holdoutFiles = mapHoldouts(options.holdoutPaths, (value, name) =>
    resolveFile(rootDir, value, `${name}Holdout`),
  );
  const allSourceBytes = Object.fromEntries(
    Object.entries(sourceFiles).map(([name, filePath]) => [name, readBytes(filePath, name)]),
  ) as Record<keyof typeof sourceFiles, Buffer>;
  const holdoutBytes = mapHoldouts(holdoutFiles, (filePath, name) =>
    readBytes(filePath, `${name} holdout`),
  );

  const identity = {
    modelSha256: sha256(allSourceBytes.model),
    phraseBankSha256: sha256(allSourceBytes.phraseBank),
    metadataSha256: sha256(allSourceBytes.metadata),
    runtimeSha256: sha256(allSourceBytes.runtime),
  };
  assertCandidateAssetBindings(training, identity);
  const staticBundleDeltaBytes = validateBundleSizeReport(
    parseJson(allSourceBytes.bundleSizeReport, 'bundle-size report'),
    identity,
    allSourceBytes.model.byteLength +
      allSourceBytes.phraseBank.byteLength +
      allSourceBytes.metadata.byteLength +
      allSourceBytes.runtime.byteLength,
  );
  assertAggregateEvidence(
    allSourceBytes,
    holdoutBytes,
    identity,
    candidateId,
    options.holdoutPaths,
    staticBundleDeltaBytes,
  );

  const selection = parseJson(allSourceBytes.selectionManifest, 'selection manifest');
  const generator = parseJson(allSourceBytes.generatorReport, 'generator report');
  assertCorpusAndTrainingBindings(
    selection,
    generator,
    allSourceBytes,
    training,
    identity,
    holdoutBytes,
  );
  const evidenceRelativeRoot = `scripts/corpus/autocomplete-v2r-release/${candidateId}`;
  const evidenceTargets = {
    selectionManifest: `${evidenceRelativeRoot}/selection-manifest.json.gz`,
    sourceRegistry: `${evidenceRelativeRoot}/source-registry.json`,
    corpusGovernance: `${evidenceRelativeRoot}/corpus-governance.json`,
    generatorReport: `${evidenceRelativeRoot}/generator-report.json`,
    trainingInput: `${evidenceRelativeRoot}/training-data-report.json`,
    trainingReport: `${evidenceRelativeRoot}/training-report.json`,
    quantizationReport: `${evidenceRelativeRoot}/quantization-report.json`,
    operatorConfig: `${evidenceRelativeRoot}/required-operators.config`,
    runtimeBuildReport: `${evidenceRelativeRoot}/runtime-build-report.json`,
    bundleSizeReport: `${evidenceRelativeRoot}/bundle-size-report.json`,
    coldValidationHoldout: `${evidenceRelativeRoot}/cold-validation-v3.json`,
    workspaceValidationHoldout: `${evidenceRelativeRoot}/workspace-validation-v3.json`,
    coldFinalHoldout: `${evidenceRelativeRoot}/cold-final-v3.json`,
    workspaceFinalHoldout: `${evidenceRelativeRoot}/workspace-final-v3.json`,
    evaluatorSourceTree: `${evidenceRelativeRoot}/evaluator-source-tree.json`,
    qualityReport: `${evidenceRelativeRoot}/quality-report.json`,
    runtimeReport: `${evidenceRelativeRoot}/runtime-report.json`,
    finalConsumptionReceipt: `${evidenceRelativeRoot}/final-consumption-receipt.json`,
    finalOverlapAudit: `${evidenceRelativeRoot}/final-overlap-audit.json`,
    webviewSmoke: `${evidenceRelativeRoot}/tauri-webview-smoke.json`,
  } as const;
  const evidenceContents: Record<keyof typeof evidenceTargets, Buffer> = {
    selectionManifest: gzipSync(allSourceBytes.selectionManifest, { level: 9 }),
    sourceRegistry: allSourceBytes.sourceRegistry,
    corpusGovernance: allSourceBytes.corpusGovernance,
    generatorReport: allSourceBytes.generatorReport,
    trainingInput: allSourceBytes.trainingInput,
    trainingReport: allSourceBytes.trainingReport,
    quantizationReport: allSourceBytes.quantizationReport,
    operatorConfig: allSourceBytes.operatorConfig,
    runtimeBuildReport: allSourceBytes.runtimeBuildReport,
    bundleSizeReport: allSourceBytes.bundleSizeReport,
    coldValidationHoldout: holdoutBytes.coldValidation,
    workspaceValidationHoldout: holdoutBytes.workspaceValidation,
    coldFinalHoldout: holdoutBytes.coldFinal,
    workspaceFinalHoldout: holdoutBytes.workspaceFinal,
    evaluatorSourceTree: allSourceBytes.evaluatorSourceTree,
    qualityReport: allSourceBytes.qualityReport,
    runtimeReport: allSourceBytes.runtimeReport,
    finalConsumptionReceipt: allSourceBytes.finalConsumptionReceipt,
    finalOverlapAudit: allSourceBytes.finalOverlapAudit,
    webviewSmoke: allSourceBytes.webviewSmoke,
  };

  const evidenceBindings = {} as PublicModelManifestV5['evidenceBindings'];
  for (const key of Object.keys(evidenceTargets) as Array<keyof typeof evidenceTargets>) {
    evidenceBindings[key] = binding(evidenceTargets[key], evidenceContents[key]);
  }
  evidenceBindings.model = binding(PUBLIC_ASSETS.model, allSourceBytes.model);
  evidenceBindings.phraseBank = binding(PUBLIC_ASSETS.phraseBank, allSourceBytes.phraseBank);
  evidenceBindings.metadata = binding(PUBLIC_ASSETS.metadata, allSourceBytes.metadata);
  evidenceBindings.runtime = binding(PUBLIC_ASSETS.runtime, allSourceBytes.runtime);

  const receipt = parseJson(allSourceBytes.finalConsumptionReceipt, 'final receipt');
  const manifestBase = {
    schema: 'jotluck.autocomplete.public-model.v5' as const,
    schemaVersion: 5 as const,
    engine: 'public-phrase-transformer-v1' as const,
    createdAt: String(receipt.consumedAt),
    architecture: {
      format: 'onnx' as const,
      quantization: 'int8' as const,
      phraseBankSize,
      hiddenSize: architecture.hiddenSize as 96 | 128,
      layers: architecture.layers as 2 | 3,
      attentionHeads: 4 as const,
      maxContextUtf8Bytes: 192 as const,
      contextPatchBytes: 4 as const,
      maxCandidates: 32 as const,
      abstainClass: true as const,
    },
    assets: [
      asset('model', PUBLIC_ASSETS.model, allSourceBytes.model),
      asset('phrase-bank', PUBLIC_ASSETS.phraseBank, allSourceBytes.phraseBank),
      asset('metadata', PUBLIC_ASSETS.metadata, allSourceBytes.metadata),
      asset('runtime', PUBLIC_ASSETS.runtime, allSourceBytes.runtime),
    ],
    staticBundleDeltaBytes,
    training: {
      selectionManifestPath: evidenceTargets.selectionManifest,
      selectionManifestSha256: String(selection.selectionSha256),
      inputTreeSha256: String(generator.inputTreeSha256),
      generatorVersion: String(generator.generatorVersion),
      seeds: [Number(training.seed)],
      trainBytes: Number((selection.selectedBytes as Record<string, unknown>).train),
      developmentBytes: Number((selection.selectedBytes as Record<string, unknown>).development),
      internalSelectionBytes: Number(
        (selection.selectedBytes as Record<string, unknown>).internalSelection,
      ),
    },
    evidenceBindings,
    runtimeEligible: true,
    qualityGatePassed: true,
    releaseEligible: true,
  };
  const manifests = (Object.keys(PUBLIC_MANIFESTS) as Array<keyof typeof PUBLIC_MANIFESTS>).map(
    (profile) => {
      const value = validatePublicModelManifestV5({ ...manifestBase, profile });
      return {
        profile,
        path: PUBLIC_MANIFESTS[profile],
        bytes: Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8'),
      };
    },
  );

  const writes: Array<{ target: string; content: Buffer }> = [
    ...Object.entries(PUBLIC_ASSETS).map(([name, relativePath]) => ({
      target: resolveOutput(rootDir, relativePath),
      content: allSourceBytes[name as keyof typeof PUBLIC_ASSETS],
    })),
    ...(Object.keys(evidenceTargets) as Array<keyof typeof evidenceTargets>).map((key) => ({
      target: resolveOutput(rootDir, evidenceTargets[key]),
      content: evidenceContents[key],
    })),
    ...manifests.map((manifest) => ({
      target: resolveOutput(rootDir, manifest.path),
      content: manifest.bytes,
    })),
  ];
  validateUniqueTargets(writes);
  const transaction = replaceFilesWithRollback(writes);
  try {
    verifyAutocompleteV2REvidence({
      rootDir,
      expectedEvaluatorFiles: AUTOCOMPLETE_V2R_EVIDENCE_SOURCE_FILES,
    });
    transaction.commit();
  } catch (error) {
    transaction.rollback();
    throw error;
  }

  return {
    candidateId,
    modelSha256: identity.modelSha256,
    evidenceDirectory: evidenceRelativeRoot,
    manifests: PUBLIC_MANIFESTS,
  };
}

function assertArchitectureNotBlocked(rootDir: string): void {
  const stopPath = path.join(rootDir, 'scripts/corpus/autocomplete-v2r-architecture-stop.json');
  if (!fs.existsSync(stopPath)) return;
  const value = readJson(stopPath);
  if (
    value.schema !== 'jotluck.autocomplete.v2r-architecture-stop.v1' ||
    value.engine !== 'public-phrase-transformer-v1' ||
    value.status !== 'architecture-blocked' ||
    value.stopLongTraining !== true
  ) {
    throw new Error('V2R architecture-stop record is invalid.');
  }
  throw new Error('V2R fixed-phrase architecture is blocked and cannot be published.');
}

function assertEligibleTrainingReport(
  training: Record<string, unknown>,
  candidateId: string,
): void {
  const identity = { ...training };
  delete identity.trainerCanonicalSha256;
  const architecture = training.architecture as Record<string, unknown> | undefined;
  const labelSemantics = training.labelSemantics as Record<string, unknown> | undefined;
  if (
    training.schema !== 'jotluck.autocomplete.v2r-training-report.v1' ||
    training.schemaVersion !== 1 ||
    training.engine !== 'public-phrase-transformer-v1' ||
    training.candidateEligible !== true ||
    training.candidateCapabilityPassed !== true ||
    training.thresholdCalibrationPassed !== true ||
    training.internalQualityGatePassed !== true ||
    training.quantizationPassed !== true ||
    training.releaseEligible !== false ||
    architecture?.contextUtf8Bytes !== 192 ||
    architecture.contextPatchBytes !== 4 ||
    labelSemantics?.abstainClassWeight !== 1 ||
    labelSemantics?.abstainReasonPolicy !== 'document-end-only-v1' ||
    labelSemantics?.bankMissIsCoverageOnly !== true ||
    !training.assets ||
    !Number.isSafeInteger(training.seed) ||
    training.trainerCanonicalSha256 !== canonicalSha256(identity)
  ) {
    throw new Error(`V2R candidate ${candidateId} is not eligible for final publication.`);
  }
}

function assertCorpusAndTrainingBindings(
  selection: Record<string, unknown>,
  generator: Record<string, unknown>,
  sources: Record<string, Buffer>,
  training: Record<string, unknown>,
  modelIdentity: Record<string, string>,
  holdoutBytes: Record<HoldoutName, Buffer>,
): void {
  const sourceRegistry = parseJson(sources.sourceRegistry!, 'source registry');
  const governance = parseJson(sources.corpusGovernance!, 'corpus governance');
  const trainingInput = parseJson(sources.trainingInput!, 'training-data report');
  if (!Array.isArray(selection.documents)) {
    throw new Error('V2R corpus selection has no document identities.');
  }
  const inputTreeSha256 = canonicalSha256(
    selection.documents
      .map((value) => {
        const document = value as Record<string, unknown>;
        return { id: document.documentId, sha256: document.sha256 };
      })
      .sort((left, right) => String(left.id).localeCompare(String(right.id), 'en')),
  );
  const trainingInputIdentity = { ...trainingInput };
  delete trainingInputIdentity.reportSha256;
  const quantizationReport =
    training.quantizationReport !== null &&
    typeof training.quantizationReport === 'object' &&
    !Array.isArray(training.quantizationReport)
      ? (training.quantizationReport as Record<string, unknown>)
      : null;
  const validationHoldoutEvidence = buildHoldoutCorpusEvidence({
    coldValidation: holdoutBytes.coldValidation,
    workspaceValidation: holdoutBytes.workspaceValidation,
  });
  const finalHoldoutEvidence = buildHoldoutCorpusEvidence({
    coldFinal: holdoutBytes.coldFinal,
    workspaceFinal: holdoutBytes.workspaceFinal,
  });
  const finalOverlap = parseJson(sources.finalOverlapAudit!, 'final overlap audit');
  const finalOverlapIdentity = { ...finalOverlap };
  delete finalOverlapIdentity.reportSha256;
  assertProjectOwnedGeneratorIdentity(sourceRegistry, generator);
  if (
    selection.schema !== 'jotluck.autocomplete.v2r-corpus-selection.v1' ||
    selection.status !== 'complete' ||
    generator.schema !== 'jotluck.autocomplete.v2r-generator-report.v1' ||
    generator.selectionSha256 !== selection.selectionSha256 ||
    generator.inputTreeSha256 !== inputTreeSha256 ||
    canonicalSha256(selection.sources) !== canonicalSha256(sourceRegistry) ||
    generator.sourceTreeSha256 !== canonicalSha256(sourceRegistry) ||
    generator.governanceSha256 !== canonicalSha256(governance) ||
    generator.releaseEvidence !== true ||
    generator.holdoutScope !== 'validation-only-before-candidate-freeze-v1' ||
    generator.holdoutTreeSha256 !== validationHoldoutEvidence.treeSha256 ||
    generator.holdoutDocumentsAudited !== validationHoldoutEvidence.documents.length ||
    governance.holdoutDocumentsAudited !== validationHoldoutEvidence.documents.length ||
    governance.holdoutInputTreeSha256 !== validationHoldoutEvidence.inputTreeSha256 ||
    finalOverlap.schema !== 'jotluck.autocomplete.v2r-final-overlap-audit.v1' ||
    finalOverlap.selectionSha256 !== selection.selectionSha256 ||
    finalOverlap.inputTreeSha256 !== inputTreeSha256 ||
    finalOverlap.finalHoldoutTreeSha256 !== finalHoldoutEvidence.treeSha256 ||
    finalOverlap.finalHoldoutInputTreeSha256 !== finalHoldoutEvidence.inputTreeSha256 ||
    finalOverlap.finalHoldoutDocumentsAudited !== finalHoldoutEvidence.documents.length ||
    finalOverlap.holdoutExactOverlaps !== 0 ||
    finalOverlap.holdoutNearOverlaps !== 0 ||
    finalOverlap.passed !== true ||
    finalOverlap.reportSha256 !== canonicalSha256(finalOverlapIdentity) ||
    governance.forbiddenTextMatches !== 0 ||
    governance.unapprovedLicenseSources !== 0 ||
    governance.isolatedNovelZhReferences !== 0 ||
    typeof governance.maxDocumentTrigramRatio !== 'number' ||
    !Number.isFinite(governance.maxDocumentTrigramRatio) ||
    governance.maxDocumentTrigramRatio > 0.08 ||
    trainingInput.schema !== 'jotluck.autocomplete.v2r-training-data.v3' ||
    trainingInput.schemaVersion !== 3 ||
    trainingInput.selectionSha256 !== selection.selectionSha256 ||
    trainingInput.phraseBankSha256 !== modelIdentity.phraseBankSha256 ||
    trainingInput.phraseBankBytes !== sources.phraseBank!.byteLength ||
    typeof trainingInput.maxPhraseDocumentRatio !== 'number' ||
    !Number.isFinite(trainingInput.maxPhraseDocumentRatio) ||
    trainingInput.maxPhraseDocumentRatio < 0 ||
    trainingInput.maxPhraseDocumentRatio > 1 ||
    typeof trainingInput.maxStructuralPhraseDocumentRatio !== 'number' ||
    !Number.isFinite(trainingInput.maxStructuralPhraseDocumentRatio) ||
    trainingInput.maxStructuralPhraseDocumentRatio < 0 ||
    trainingInput.maxStructuralPhraseDocumentRatio > 0.1 ||
    trainingInput.reportSha256 !== canonicalSha256(trainingInputIdentity) ||
    training.trainingDataReportSha256 !== trainingInput.reportSha256 ||
    (training.labelSemantics as Record<string, unknown> | undefined)?.abstainClassWeight !== 1 ||
    (training.labelSemantics as Record<string, unknown> | undefined)?.abstainReasonPolicy !==
      'document-end-only-v1' ||
    (training.labelSemantics as Record<string, unknown> | undefined)?.bankMissIsCoverageOnly !==
      true ||
    quantizationReport?.sha256 !== sha256(sources.quantizationReport!)
  ) {
    throw new Error('V2R corpus, generator, training-data, and candidate bindings disagree.');
  }
  for (const split of ['train', 'development', 'internalSelection']) {
    const samples = trainingInput.samples as Record<string, Record<string, unknown>> | undefined;
    const sample = samples?.[split];
    const reasons = sample?.abstainReasons as Record<string, unknown> | undefined;
    if (reasons?.bankMiss !== 0 || reasons?.documentEnd !== sample?.abstain) {
      throw new Error(`V2R ${split} contains non-silence abstain labels.`);
    }
  }
}

function assertProjectOwnedGeneratorIdentity(
  sourceRegistry: unknown,
  generator: Record<string, unknown>,
): void {
  if (!Array.isArray(sourceRegistry) || sourceRegistry.length === 0) {
    throw new Error('V2R source registry must be a non-empty array.');
  }
  let projectOwnedSources = 0;
  for (const [index, value] of sourceRegistry.entries()) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error(`V2R source registry entry ${index} is invalid.`);
    }
    const source = value as Record<string, unknown>;
    if (source.kind === 'project-owned') {
      projectOwnedSources++;
      if (
        source.licenseSpdx !== 'MIT' ||
        source.generatorVersion !== PROJECT_OWNED_GENERATOR_V3 ||
        source.generatorSeed !== PROJECT_OWNED_GENERATOR_V3_SEED
      ) {
        throw new Error(`V2R project-owned source ${index} has invalid generator provenance.`);
      }
    } else if (source.licenseSpdx !== 'CC0-1.0') {
      throw new Error(`V2R external source ${index} is not CC0-1.0.`);
    }
  }
  if (
    projectOwnedSources === 0 ||
    generator.generatorVersion !== PROJECT_OWNED_GENERATOR_V3 ||
    generator.generatorSeed !== PROJECT_OWNED_GENERATOR_V3_SEED
  ) {
    throw new Error('V2R generator report does not match the frozen project-owned sources.');
  }
}

function buildHoldoutCorpusEvidence(holdoutBytes: Partial<Record<HoldoutName, Buffer>>): {
  treeSha256: string;
  inputTreeSha256: string;
  documents: Array<{ id: string; sha256: string }>;
} {
  const identities: Array<{
    classification: V2RHoldoutV3['classification'];
    datasetSha256: string;
  }> = [];
  const documents: Array<{ id: string; sha256: string }> = [];
  for (const name of Object.keys(holdoutBytes) as HoldoutName[]) {
    const bytes = holdoutBytes[name];
    if (!bytes) throw new Error(`V2R holdout bytes are missing: ${name}.`);
    const holdout = parseJson(bytes, `${name} holdout`) as unknown as V2RHoldoutV3;
    const audit = validateV2RHoldoutV3(holdout);
    identities.push({
      classification: holdout.classification,
      datasetSha256: audit.datasetSha256,
    });
    for (const target of holdout.targets) {
      documents.push({
        id: `holdout:${holdout.classification}:target:${target.id}`,
        sha256: sha256(target.text),
      });
    }
    for (const support of holdout.supportDocuments) {
      documents.push({
        id: `holdout:${holdout.classification}:support:${support.id}`,
        sha256: sha256(support.text),
      });
    }
  }
  identities.sort((left, right) => left.classification.localeCompare(right.classification));
  documents.sort((left, right) => left.id.localeCompare(right.id));
  return {
    treeSha256: canonicalSha256(identities),
    inputTreeSha256: canonicalSha256(documents),
    documents,
  };
}

function assertCandidateAssetBindings(
  training: Record<string, unknown>,
  identity: Record<string, string>,
): void {
  const assets = training.assets as Record<string, { sha256?: string }>;
  if (
    assets.int8?.sha256 !== identity.modelSha256 ||
    assets.phraseBank?.sha256 !== identity.phraseBankSha256 ||
    assets.metadata?.sha256 !== identity.metadataSha256
  ) {
    throw new Error('V2R candidate assets changed after training.');
  }
}

function validateBundleSizeReport(
  report: Record<string, unknown>,
  identity: Record<string, string>,
  candidateAssetBytes: number,
): number {
  const withoutIdentity = { ...report };
  delete withoutIdentity.reportSha256;
  const measured = report.conservativeStaticDeltaUpperBoundBytes;
  if (
    report.schema !== 'jotluck.autocomplete.v2r-bundle-size.v1' ||
    report.schemaVersion !== 1 ||
    report.measurementMethod !== 'candidate-assets-plus-entire-app-js-upper-bound' ||
    report.modelSha256 !== identity.modelSha256 ||
    report.phraseBankSha256 !== identity.phraseBankSha256 ||
    report.metadataSha256 !== identity.metadataSha256 ||
    report.runtimeSha256 !== identity.runtimeSha256 ||
    report.candidateAssetBytes !== candidateAssetBytes ||
    !Number.isSafeInteger(report.entireAppJavaScriptBytes) ||
    (report.entireAppJavaScriptBytes as number) <= 0 ||
    !Number.isSafeInteger(measured) ||
    (measured as number) < candidateAssetBytes ||
    (measured as number) > 12 * 1024 * 1024 ||
    report.staticDeltaLimitBytes !== 12 * 1024 * 1024 ||
    report.candidateRuntimeCopies !== 1 ||
    report.candidateModelCopies !== 1 ||
    report.candidatePhraseBankCopies !== 1 ||
    report.candidateMetadataCopies !== 1 ||
    report.stockWasmAssets !== 0 ||
    report.passed !== true ||
    report.reportSha256 !== canonicalSha256(withoutIdentity)
  ) {
    throw new Error('V2R bundle-size report does not prove the published candidate bundle.');
  }
  return measured as number;
}

function assertAggregateEvidence(
  sources: Record<string, Buffer>,
  holdoutBytes: Record<HoldoutName, Buffer>,
  identity: Record<string, string>,
  candidateId: string,
  holdoutPaths: Record<HoldoutName, string>,
  staticBundleDeltaBytes: number,
): void {
  const quality = parseJson(sources.qualityReport!, 'quality report');
  const runtime = parseJson(sources.runtimeReport!, 'runtime report');
  const receipt = parseJson(sources.finalConsumptionReceipt!, 'final receipt');
  const finalOverlap = parseJson(sources.finalOverlapAudit!, 'final overlap audit');
  const smoke = parseJson(sources.webviewSmoke!, 'WebView smoke');
  for (const [name, value] of Object.entries(identity)) {
    if (quality[name] !== value || receipt[name] !== value) {
      throw new Error(`V2R aggregate evidence candidate mismatch: ${name}.`);
    }
  }
  if (
    quality.candidateId !== candidateId ||
    quality.releaseEligible !== true ||
    runtime.modelSha256 !== identity.modelSha256 ||
    runtime.runtimeSha256 !== identity.runtimeSha256 ||
    runtime.workerOnly !== true ||
    runtime.mainThreadModelLongTasksOver50Ms !== 0 ||
    runtime.measuredStaticDeltaBytes !== staticBundleDeltaBytes ||
    receipt.status !== 'passed' ||
    receipt.consumedOnce !== true ||
    quality.finalOverlapAuditSha256 !== finalOverlap.reportSha256 ||
    receipt.finalOverlapAuditSha256 !== finalOverlap.reportSha256 ||
    finalOverlap.passed !== true ||
    smoke.modelSha256 !== identity.modelSha256 ||
    smoke.tauriWebviewExecuted !== true
  ) {
    throw new Error('V2R aggregate quality/runtime/final/WebView evidence is not releasable.');
  }
  for (const name of Object.keys(holdoutBytes) as HoldoutName[]) {
    const holdout = parseJson(holdoutBytes[name], `${name} holdout`) as unknown as V2RHoldoutV3;
    const audit = validateV2RHoldoutV3(holdout);
    const qualityHoldout = (quality.holdouts as Record<string, { holdoutSha256?: string }>)[name];
    if (qualityHoldout?.holdoutSha256 !== audit.datasetSha256) {
      throw new Error(`V2R aggregate evidence does not bind ${holdoutPaths[name]}.`);
    }
  }
}

function asset(
  role: 'model' | 'phrase-bank' | 'metadata' | 'runtime',
  filePath: string,
  bytes: Buffer,
) {
  return { role, path: filePath, bytes: bytes.byteLength, sha256: sha256(bytes) };
}

function binding(filePath: string, bytes: Buffer): { path: string; sha256: string } {
  return { path: filePath, sha256: sha256(bytes) };
}

function readBytes(filePath: string, label: string): Buffer {
  const resolved = fs.realpathSync(filePath);
  const value = fs.readFileSync(resolved);
  if (value.byteLength === 0) throw new Error(`V2R ${label} is empty.`);
  return value;
}

function readJson(filePath: string): Record<string, unknown> {
  return parseJson(readBytes(filePath, filePath), filePath);
}

function parseJson(bytes: Uint8Array, label: string): Record<string, unknown> {
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as Record<
      string,
      unknown
    >;
  } catch (error) {
    throw new Error(`V2R ${label} is not valid UTF-8 JSON: ${String(error)}.`);
  }
}

function resolveDirectory(rootDir: string, relativePath: string, label: string): string {
  const resolved = resolveFile(rootDir, relativePath, label);
  if (!fs.statSync(resolved).isDirectory()) throw new Error(`${label} is not a directory.`);
  return resolved;
}

function resolveFile(rootDir: string, relativePath: string, label: string): string {
  if (
    !relativePath ||
    path.isAbsolute(relativePath) ||
    relativePath.split(/[\\/]/u).includes('..')
  ) {
    throw new Error(`${label} must be a repository-relative path.`);
  }
  const resolved = path.resolve(rootDir, relativePath);
  if (!isWithin(resolved, rootDir)) throw new Error(`${label} escaped the repository.`);
  return resolved;
}

function resolveOutput(rootDir: string, relativePath: string): string {
  if (
    !relativePath ||
    path.isAbsolute(relativePath) ||
    relativePath.split(/[\\/]/u).includes('..')
  ) {
    throw new Error('V2R output path is unsafe.');
  }
  const output = path.resolve(rootDir, relativePath);
  if (!isWithin(output, rootDir)) throw new Error('V2R output escaped the repository.');
  return output;
}

function isWithin(candidate: string, root: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function mapHoldouts<T, R>(
  values: Record<HoldoutName, T>,
  mapper: (value: T, name: HoldoutName) => R,
): Record<HoldoutName, R> {
  return Object.fromEntries(
    (Object.keys(values) as HoldoutName[]).map((name) => [name, mapper(values[name], name)]),
  ) as Record<HoldoutName, R>;
}

function validateUniqueTargets(writes: readonly { target: string }[]): void {
  if (new Set(writes.map((item) => item.target)).size !== writes.length) {
    throw new Error('V2R publisher generated duplicate output targets.');
  }
}

function replaceFilesWithRollback(writes: Array<{ target: string; content: Buffer }>): {
  commit(): void;
  rollback(): void;
} {
  const token = `${process.pid}-${randomBytes(6).toString('hex')}`;
  const records: Array<{
    target: string;
    temporary: string;
    backup: string;
    hadTarget: boolean;
    backupCreated: boolean;
    installed: boolean;
  }> = [];
  try {
    for (const { target, content } of writes) {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      const temporary = `${target}.tmp-${token}`;
      const backup = `${target}.bak-${token}`;
      const record = {
        target,
        temporary,
        backup,
        hadTarget: fs.existsSync(target),
        backupCreated: false,
        installed: false,
      };
      records.push(record);
      fs.writeFileSync(temporary, content, { flag: 'wx' });
      const descriptor = fs.openSync(temporary, 'r+');
      try {
        fs.fsyncSync(descriptor);
      } finally {
        fs.closeSync(descriptor);
      }
    }
  } catch (error) {
    for (const record of records) {
      if (fs.existsSync(record.temporary)) fs.unlinkSync(record.temporary);
    }
    throw error;
  }
  let completed = false;
  try {
    for (const record of records) {
      if (record.hadTarget) {
        fs.renameSync(record.target, record.backup);
        record.backupCreated = true;
      }
      fs.renameSync(record.temporary, record.target);
      record.installed = true;
    }
  } catch (error) {
    rollback();
    throw error;
  }
  return { commit, rollback };

  function commit(): void {
    if (completed) return;
    for (const record of records) {
      if (fs.existsSync(record.backup)) fs.unlinkSync(record.backup);
    }
    completed = true;
  }

  function rollback(): void {
    if (completed) return;
    for (const record of [...records].reverse()) {
      if (record.installed && fs.existsSync(record.target)) {
        fs.unlinkSync(record.target);
      }
      if (record.backupCreated && fs.existsSync(record.backup)) {
        fs.renameSync(record.backup, record.target);
      }
      if (fs.existsSync(record.temporary)) fs.unlinkSync(record.temporary);
    }
    completed = true;
  }
}

function parseArguments(argv: readonly string[]): PublishAutocompleteV2RFinalOptions {
  const values = new Map<string, string>();
  for (const argument of argv) {
    const match = /^--([a-z-]+)=(.+)$/u.exec(argument);
    if (!match) throw new Error(`Unknown V2R publish argument: ${argument}`);
    values.set(match[1]!, match[2]!);
  }
  const required = (name: string): string => {
    const value = values.get(name);
    if (!value) throw new Error(`--${name} is required.`);
    return value;
  };
  return {
    rootDir: values.get('root-dir'),
    candidateDir: required('candidate-dir'),
    evidenceBundleDir: required('evidence-bundle-dir'),
    evaluatorTreePath: required('evaluator-tree'),
    webviewSmokePath: required('webview-smoke'),
    holdoutPaths: {
      coldValidation: required('cold-validation-holdout'),
      workspaceValidation: required('workspace-validation-holdout'),
      coldFinal: required('cold-final-holdout'),
      workspaceFinal: required('workspace-final-holdout'),
    },
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    console.log(
      JSON.stringify(publishAutocompleteV2RFinal(parseArguments(process.argv.slice(2))), null, 2),
    );
  } catch (error) {
    console.error(error instanceof Error ? error.stack : String(error));
    process.exitCode = 1;
  }
}
