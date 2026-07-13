import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { assertV2SArchitectureActive } from './architecture-stop';
import { canonicalJson, resolveInside, sha256, V2S_ENGINE_ID } from './common';
import { finalizeV2SManifest, packV2SContainer, type V2SPublicModelManifest } from './container-v6';
import {
  gateModelToBytes,
  trainG0Gate,
  trainG1Gate,
  type GateSample,
  type V2SGateModel,
} from './gate';
import { getV2SMatrixEntry, resolveMatrixTokenizer, resolveV2SCandidateDirectory } from './matrix';
import { pruneMknToNestedBudgets, trainModifiedKneserNey } from './mkn';
import {
  verifyV2SSelection,
  type V2SLanguage,
  type V2SSelectionDocument,
  type V2SSelectionManifest,
} from './selection';
import {
  encodeWithTokenizer,
  tokenizerToBytes,
  trainTokenizer,
  type V2STokenizerKind,
  type V2STokenizerModel,
} from './tokenizer';

export interface TrainV2SCandidateOptions {
  workspaceRoot: string;
  selectionPath: string;
  matrixId: string;
  candidateId: string;
  gateKind: 'g0' | 'g1';
  gateSamples: readonly GateSample[];
  selectedTokenizer?: V2STokenizerKind;
  vocabularyLimit?: number;
  maxOrder?: number;
  maximumDocuments?: number;
}

export interface V2STrainingReport {
  schema: 'jotluck.autocomplete.v2s-training-report.v1';
  engine: typeof V2S_ENGINE_ID;
  candidateId: string;
  matrixId: string;
  formalResult: false;
  selectedDocumentCount: number;
  selectedBytes: number;
  selectedByLanguage: Record<V2SLanguage, number>;
  tokenizer: V2STokenizerKind;
  vocabularyByLanguage: Record<V2SLanguage, number>;
  mknRecordsByLanguage: Record<V2SLanguage, number>;
  mknRecordsByOrderByLanguage: Record<V2SLanguage, Record<string, number>>;
  ngramOrders: [2, 2 | 3 | 4 | 5];
  mknEncoding: 'typed-array-trie-v2';
  pruning: 'relative-entropy-q1e6+renormalized-backoff-v2';
  gateKind: V2SGateModel['kind'];
  quantization: 'probability-q16+gate-q16' | 'probability-q16+gate-int8';
  gateCalibrationStatus: V2SGateModel['calibration']['status'];
  gateCalibrationFailureReasons: string[];
  excludedBankMisses: number;
  containerBytes: number;
  assetBudgetBytes: number;
  note: 'candidate-only; no holdout quality claim';
}

export interface V2STrainingResult {
  directory: string;
  manifest: V2SPublicModelManifest;
  report: V2STrainingReport;
}

const HEADER_RESERVE_BYTES = 16 * 1024;

export async function trainV2SCandidate(
  options: TrainV2SCandidateOptions,
): Promise<V2STrainingResult> {
  assertV2SArchitectureActive(options.workspaceRoot);
  const matrix = getV2SMatrixEntry(options.matrixId);
  const tokenizerKind = resolveMatrixTokenizer(matrix, options.selectedTokenizer);
  const selectionAbsolutePath = resolveInside(
    options.workspaceRoot,
    options.selectionPath,
    'V2S selection path',
  );
  const selectionRaw = await readFile(selectionAbsolutePath, 'utf8');
  const selection = JSON.parse(selectionRaw) as V2SSelectionManifest;
  await verifyV2SSelection(selection, options.workspaceRoot);
  const documents = selectTrainingPrefix(
    selection.documents,
    matrix.maximumTrainingBytes,
    options.maximumDocuments,
  );
  const texts = await readSelectedTexts(options.workspaceRoot, documents);
  assertBothLanguages(texts);

  const tokenizerByLanguage = {
    zh: trainTokenizer(texts.zh, {
      kind: tokenizerKind,
      language: 'zh',
      vocabularyLimit: options.vocabularyLimit,
    }),
    en: trainTokenizer(texts.en, {
      kind: tokenizerKind,
      language: 'en',
      vocabularyLimit: options.vocabularyLimit,
    }),
  } satisfies Record<V2SLanguage, V2STokenizerModel>;
  const maxOrder = options.maxOrder ?? 5;
  if (!Number.isSafeInteger(maxOrder) || maxOrder < 2 || maxOrder > 5) {
    throw new Error('V2S training maxOrder must be between 2 and 5.');
  }
  const manifestMaxOrder = maxOrder as 2 | 3 | 4 | 5;
  const gate =
    options.gateKind === 'g0' ? trainG0Gate(options.gateSamples) : trainG1Gate(options.gateSamples);
  const quantization =
    gate.kind === 'g0-rules'
      ? ('probability-q16+gate-q16' as const)
      : ('probability-q16+gate-int8' as const);
  const tokenizerBytes = {
    zh: tokenizerToBytes(tokenizerByLanguage.zh),
    en: tokenizerToBytes(tokenizerByLanguage.en),
  };
  const gateBytes = gateModelToBytes(gate);
  const metadataBytes = new TextEncoder().encode(
    canonicalJson({
      schema: 'jotluck.autocomplete.v2s-runtime-metadata.v1',
      engine: V2S_ENGINE_ID,
      candidateId: options.candidateId,
      maxOrder,
      providerId: V2S_ENGINE_ID,
      source: 'public-v2s',
      sourceLayer: 'l3',
    }),
  );
  const staticBytes =
    tokenizerBytes.zh.byteLength +
    tokenizerBytes.en.byteLength +
    gateBytes.byteLength +
    metadataBytes.byteLength +
    HEADER_RESERVE_BYTES;
  const availableForModels = matrix.assetBudgetBytes - staticBytes;
  if (availableForModels < 64 * 1024) {
    throw new Error('V2S tokenizers and gate leave too little room for language models.');
  }
  const zhBudget = Math.floor(availableForModels / 2);
  const enBudget = availableForModels - zhBudget;
  // Train and prune one language at a time. Keeping both unpruned 2–5 order
  // count graphs alive made the bounded 24 MiB tier exceed Node's practical
  // heap despite the final asset being below 6 MiB.
  const prunedZh = trainAndPruneLanguageModel(tokenizerByLanguage.zh, texts.zh, maxOrder, zhBudget);
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  const prunedEn = trainAndPruneLanguageModel(tokenizerByLanguage.en, texts.en, maxOrder, enBudget);
  const pruned = {
    zh: prunedZh,
    en: prunedEn,
  };
  const container = packV2SContainer(
    [
      { id: 'tokenizer.zh', bytes: tokenizerBytes.zh },
      { id: 'tokenizer.en', bytes: tokenizerBytes.en },
      { id: 'lm.zh', bytes: pruned.zh.encoded },
      { id: 'lm.en', bytes: pruned.en.encoded },
      { id: 'gate', bytes: gateBytes },
      { id: 'metadata', bytes: metadataBytes },
    ],
    matrix.assetBudgetBytes,
  );

  const finalDirectory = resolveV2SCandidateDirectory(options.workspaceRoot, options.candidateId);
  const parentDirectory = path.dirname(finalDirectory);
  const temporaryDirectory = `${finalDirectory}.tmp-${process.pid}`;
  await mkdir(parentDirectory, { recursive: true });
  await rm(temporaryDirectory, { recursive: true, force: true });
  await mkdir(temporaryDirectory, { recursive: false });
  try {
    const relativeDirectory = path
      .relative(options.workspaceRoot, finalDirectory)
      .replaceAll(path.sep, '/');
    const assetRelativePath = `${relativeDirectory}/public-v2s.bin`;
    const manifest = finalizeV2SManifest({
      schema: 'jotluck.autocomplete.public-model.v6',
      schemaVersion: 6,
      engine: V2S_ENGINE_ID,
      profile: 'candidate',
      candidateId: options.candidateId,
      architecture: {
        languages: ['zh', 'en'],
        tokenizers: { zh: tokenizerKind, en: tokenizerKind },
        vocabularyLimitPerLanguage: options.vocabularyLimit ?? 4096,
        ngramOrders: [2, manifestMaxOrder],
        quantization,
        gateKind: gate.kind,
        assetBudgetBytes: matrix.assetBudgetBytes,
      },
      asset: {
        path: assetRelativePath,
        bytes: container.bytes.byteLength,
        sha256: sha256(container.bytes),
        containerHeaderSha256: container.headerSha256,
      },
      training: {
        selectionPath: options.selectionPath.replaceAll('\\', '/'),
        selectionSha256: selection.selectionSha256,
        inputTreeSha256: selection.inputTreeSha256,
        selectedDocumentCount: documents.length,
        selectedBytes: documents.reduce((sum, document) => sum + document.bytes, 0),
      },
      evidenceBindings: {
        selection: {
          path: options.selectionPath.replaceAll('\\', '/'),
          sha256: sha256(selectionRaw),
        },
      },
      runtimeEligible: false,
      qualityGatePassed: false,
      releaseEligible: false,
      formalResult: false,
    });
    const report: V2STrainingReport = {
      schema: 'jotluck.autocomplete.v2s-training-report.v1',
      engine: V2S_ENGINE_ID,
      candidateId: options.candidateId,
      matrixId: options.matrixId,
      formalResult: false,
      selectedDocumentCount: documents.length,
      selectedBytes: documents.reduce((sum, document) => sum + document.bytes, 0),
      selectedByLanguage: {
        zh: documents.filter((document) => document.language === 'zh').length,
        en: documents.filter((document) => document.language === 'en').length,
      },
      tokenizer: tokenizerKind,
      vocabularyByLanguage: {
        zh: tokenizerByLanguage.zh.vocabulary.length,
        en: tokenizerByLanguage.en.vocabulary.length,
      },
      mknRecordsByLanguage: {
        zh: pruned.zh.model.predictions.length,
        en: pruned.en.model.predictions.length,
      },
      mknRecordsByOrderByLanguage: {
        zh: countPredictionsByOrder(pruned.zh.model.predictions, maxOrder),
        en: countPredictionsByOrder(pruned.en.model.predictions, maxOrder),
      },
      ngramOrders: [2, manifestMaxOrder],
      mknEncoding: 'typed-array-trie-v2',
      pruning: 'relative-entropy-q1e6+renormalized-backoff-v2',
      gateKind: gate.kind,
      quantization,
      gateCalibrationStatus: gate.calibration.status,
      gateCalibrationFailureReasons: gate.calibration.failureReasons,
      excludedBankMisses: gate.excludedBankMisses,
      containerBytes: container.bytes.byteLength,
      assetBudgetBytes: matrix.assetBudgetBytes,
      note: 'candidate-only; no holdout quality claim',
    };
    await Promise.all([
      writeFile(path.join(temporaryDirectory, 'public-v2s.bin'), container.bytes),
      writeFile(
        path.join(temporaryDirectory, 'manifest.json'),
        `${canonicalJson(manifest)}\n`,
        'utf8',
      ),
      writeFile(
        path.join(temporaryDirectory, 'training-report.json'),
        `${canonicalJson(report)}\n`,
        'utf8',
      ),
    ]);
    await rename(temporaryDirectory, finalDirectory);
    return { directory: finalDirectory, manifest, report };
  } catch (error) {
    await rm(temporaryDirectory, { recursive: true, force: true });
    throw error;
  }
}

function countPredictionsByOrder(
  predictions: readonly { order: number }[],
  maxOrder: number,
): Record<string, number> {
  const output: Record<string, number> = {};
  for (let order = 2; order <= maxOrder; order += 1) output[String(order)] = 0;
  for (const prediction of predictions) {
    output[String(prediction.order)] = (output[String(prediction.order)] ?? 0) + 1;
  }
  return output;
}

function selectTrainingPrefix(
  documents: readonly V2SSelectionDocument[],
  maximumBytes: number,
  maximumDocuments?: number,
): V2SSelectionDocument[] {
  const ordered = documents
    .filter((document) => document.split === 'train')
    .map((document) => ({ document, orderKey: sha256(document.documentId) }))
    .sort(
      (left, right) =>
        left.orderKey.localeCompare(right.orderKey, 'en') ||
        left.document.documentId.localeCompare(right.document.documentId, 'en'),
    );
  const output: V2SSelectionDocument[] = [];
  let bytes = 0;
  for (const { document } of ordered) {
    if (maximumDocuments !== undefined && output.length >= maximumDocuments) break;
    if (bytes + document.bytes > maximumBytes) break;
    output.push(document);
    bytes += document.bytes;
  }
  if (output.length === 0) throw new Error('V2S matrix selected no train documents.');
  return output;
}

async function readSelectedTexts(
  workspaceRoot: string,
  documents: readonly V2SSelectionDocument[],
): Promise<Record<V2SLanguage, string[]>> {
  const output: Record<V2SLanguage, string[]> = { zh: [], en: [] };
  for (const document of documents) {
    const absolutePath = resolveInside(
      workspaceRoot,
      document.relativePath,
      'training document path',
    );
    const bytes = await readFile(absolutePath);
    if (bytes.byteLength !== document.bytes || sha256(bytes) !== document.sha256) {
      throw new Error(
        `Training document changed after selection verification: ${document.documentId}.`,
      );
    }
    output[document.language].push(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  }
  return output;
}

function assertBothLanguages(texts: Record<V2SLanguage, string[]>): void {
  if (texts.zh.length === 0 || texts.en.length === 0) {
    throw new Error('V2S public training requires both Chinese and English documents.');
  }
}

function trainLanguageModel(
  tokenizer: V2STokenizerModel,
  texts: readonly string[],
  maxOrder: number,
) {
  const sequences = texts.map((text) => [1, ...encodeWithTokenizer(tokenizer, text), 2]);
  return trainModifiedKneserNey({
    sequences,
    vocabularySize: tokenizer.vocabulary.length,
    maxOrder,
  });
}

function trainAndPruneLanguageModel(
  tokenizer: V2STokenizerModel,
  texts: readonly string[],
  maxOrder: number,
  budgetBytes: number,
) {
  const fullModel = trainLanguageModel(tokenizer, texts, maxOrder);
  return pruneMknToNestedBudgets(fullModel, [budgetBytes])[0]!;
}
