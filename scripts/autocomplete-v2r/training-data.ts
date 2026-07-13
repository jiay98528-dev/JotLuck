import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { access, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { once } from 'node:events';
import { encodeUtf8ContextWindow } from './context-window';
import { collectProjectOwnedChineseCursorOffsets } from './generator-v3';
import {
  type V2RCorpusSelectionManifest,
  type V2RCorpusSplit,
  type V2RSelectedDocument,
} from './corpus-governance';
import { canonicalSha256, normalizeForComparison, sha256 } from './common';
import {
  extractPhraseVariantsAtCursor,
  isTrainablePublicPhrase,
  type V2RLanguage,
} from './phrase-extraction';
import { assertPathInsideV2RCache, resolveV2RCacheRoot, V2R_REPOSITORY_ROOT } from './workspace';

export const V2R_TRAINING_DATA_SCHEMA = 'jotluck.autocomplete.v2r-training-data.v3';
export const V2R_PHRASE_BANK_SIZES = [8192, 12288, 16384] as const;
export const V2R_MAX_ACCEPTABLE_LABELS = 32;

export type V2RPhraseBankSize = (typeof V2R_PHRASE_BANK_SIZES)[number];
export type V2RTrainingBlock = 'paragraph' | 'list' | 'quote';
export type V2RCursorBoundary = 'word' | 'space' | 'punctuation' | 'other';

export interface V2RPhraseBankEntry {
  index: number;
  id: string;
  text: string;
  language: V2RLanguage;
  trainingOccurrences: number;
  trainingDocuments?: number;
}

export interface V2RTrainingSample {
  sampleId: string;
  documentId: string;
  contextUtf8Base64: string;
  language: V2RLanguage;
  blockType: V2RTrainingBlock;
  cursorBoundary: V2RCursorBoundary;
  label: number;
  acceptableLabels: number[];
  phraseId: string | null;
  abstain: boolean;
  abstainReason: 'bank-miss' | 'document-end' | null;
}

export interface V2RTrainingDataReport {
  schema: typeof V2R_TRAINING_DATA_SCHEMA;
  schemaVersion: 3;
  phraseBankSize: V2RPhraseBankSize;
  abstainIndex: number;
  selectionSha256: string;
  phraseBankSha256: string;
  phraseBankBytes: number;
  maxPhraseDocumentRatio: number;
  maxStructuralPhraseDocumentRatio: number;
  samples: Record<
    V2RCorpusSplit,
    {
      path: string;
      sha256: string;
      bytes: number;
      total: number;
      positive: number;
      abstain: number;
      abstainReasons: {
        bankMiss: number;
        documentEnd: number;
      };
      zh: number;
      en: number;
      bankCoverage: number;
    }
  >;
  reportSha256: string;
}

export interface PhraseCheckpoint {
  cursor: number;
  text: string;
}

export interface V2RAbstainCheckpoint {
  cursor: number;
  reason: 'bank-miss' | 'document-end';
}

export interface BuildV2RTrainingDataOptions {
  workspaceRoot?: string;
  phraseBankSize: V2RPhraseBankSize;
  maxPositiveSamplesPerDocument?: number;
}

export async function buildV2RTrainingData(
  options: BuildV2RTrainingDataOptions,
): Promise<V2RTrainingDataReport> {
  const workspaceRoot = path.resolve(options.workspaceRoot ?? V2R_REPOSITORY_ROOT);
  const cacheRoot = resolveV2RCacheRoot(workspaceRoot);
  const manifest = await readSelectionManifest(path.join(cacheRoot, 'selection-manifest.json'));
  const finalTrainingRoot = path.join(cacheRoot, 'training', String(options.phraseBankSize));
  const existing = await readExistingTrainingData(
    workspaceRoot,
    finalTrainingRoot,
    options.phraseBankSize,
    manifest.selectionSha256,
  );
  if (existing) return existing;
  const maxPositiveSamples = options.maxPositiveSamplesPerDocument ?? 3;
  if (
    !Number.isSafeInteger(maxPositiveSamples) ||
    maxPositiveSamples < 1 ||
    maxPositiveSamples > 8
  ) {
    throw new Error('maxPositiveSamplesPerDocument must be between 1 and 8.');
  }

  const temporaryTrainingRoot = `${finalTrainingRoot}.${process.pid}.tmp`;
  await rm(temporaryTrainingRoot, { recursive: true, force: true });
  await mkdir(temporaryTrainingRoot, { recursive: true });
  try {
    const documentTexts = await loadSelectedDocumentTexts(workspaceRoot, manifest.documents);
    const phraseCounts = countTrainingPhrases(manifest.documents, documentTexts);
    const phraseBank = selectPhraseBank(phraseCounts, options.phraseBankSize);
    const trainDocumentCount = manifest.documents.filter(
      (document) => document.split === 'train',
    ).length;
    const phraseDocumentRatio = (entry: V2RPhraseBankEntry): number =>
      trainDocumentCount === 0 ? 0 : (entry.trainingDocuments ?? 0) / trainDocumentCount;
    const maxPhraseDocumentRatio = Math.max(...phraseBank.map(phraseDocumentRatio));
    const maxStructuralPhraseDocumentRatio = Math.max(
      0,
      ...phraseBank.filter(isStructuralPhrase).map(phraseDocumentRatio),
    );
    if (maxStructuralPhraseDocumentRatio > 0.1 + Number.EPSILON) {
      throw new Error(
        `V2R structural phrase document concentration exceeds 10% (${maxStructuralPhraseDocumentRatio}).`,
      );
    }
    const phraseIndex = new Map(phraseBank.map((entry) => [entry.text, entry]));
    const phraseBankPath = path.join(temporaryTrainingRoot, 'phrase-bank.jsonl');
    const phraseBankIdentity = await writeJsonLines(phraseBankPath, phraseBank);

    const splitReports = {} as V2RTrainingDataReport['samples'];
    for (const split of ['train', 'development', 'internalSelection'] as const) {
      const selected = manifest.documents.filter((document) => document.split === split);
      const outputPath = path.join(temporaryTrainingRoot, `samples.${split}.jsonl`);
      splitReports[split] = await writeSplitSamples(
        workspaceRoot,
        outputPath,
        path.join(finalTrainingRoot, `samples.${split}.jsonl`),
        selected,
        documentTexts,
        phraseIndex,
        options.phraseBankSize,
        maxPositiveSamples,
      );
    }

    const withoutIdentity: Omit<V2RTrainingDataReport, 'reportSha256'> = {
      schema: V2R_TRAINING_DATA_SCHEMA,
      schemaVersion: 3,
      phraseBankSize: options.phraseBankSize,
      abstainIndex: options.phraseBankSize,
      selectionSha256: manifest.selectionSha256,
      phraseBankSha256: phraseBankIdentity.sha256,
      phraseBankBytes: phraseBankIdentity.bytes,
      maxPhraseDocumentRatio,
      maxStructuralPhraseDocumentRatio,
      samples: splitReports,
    };
    const report = { ...withoutIdentity, reportSha256: canonicalSha256(withoutIdentity) };
    await writeFile(
      path.join(temporaryTrainingRoot, 'training-data-report.json'),
      `${JSON.stringify(report, null, 2)}\n`,
      { encoding: 'utf8', flag: 'wx' },
    );
    await rename(temporaryTrainingRoot, finalTrainingRoot);
    return report;
  } catch (error) {
    await rm(temporaryTrainingRoot, { recursive: true, force: true });
    throw error;
  }
}

export function selectPhraseBank(
  counts: ReadonlyMap<string, { language: V2RLanguage; count: number; documents?: number }>,
  phraseBankSize: V2RPhraseBankSize,
): V2RPhraseBankEntry[] {
  const perLanguage = phraseBankSize / 2;
  const ranked = (language: V2RLanguage) =>
    [...counts.entries()]
      .filter(([, value]) => value.language === language)
      .sort((left, right) => {
        const byCount = right[1].count - left[1].count;
        if (byCount) return byCount;
        const byBytes = Buffer.byteLength(left[0], 'utf8') - Buffer.byteLength(right[0], 'utf8');
        return byBytes || left[0].localeCompare(right[0]);
      })
      .slice(0, perLanguage);
  const zh = ranked('zh');
  const en = ranked('en');
  if (zh.length !== perLanguage || en.length !== perLanguage) {
    throw new Error(
      `Insufficient phrases for ${phraseBankSize}: zh=${zh.length}, en=${en.length}.`,
    );
  }
  const output: V2RPhraseBankEntry[] = [];
  for (let rank = 0; rank < perLanguage; rank++) {
    for (const [language, items] of [
      ['zh', zh],
      ['en', en],
    ] as const) {
      const [text, value] = items[rank]!;
      const index = output.length;
      output.push({
        index,
        id: `${language}.${index.toString().padStart(5, '0')}.${sha256(text).slice(0, 12)}`,
        text,
        language,
        trainingOccurrences: value.count,
        trainingDocuments: value.documents ?? value.count,
      });
    }
  }
  return output;
}

export function collectPhraseCheckpoints(
  text: string,
  language: V2RLanguage,
  sourceId?: string,
): PhraseCheckpoint[] {
  const cursors =
    language === 'en'
      ? collectEnglishCursors(text)
      : collectChineseCursors(text, sourceId?.startsWith('project-v3-') ?? false);
  const checkpoints: PhraseCheckpoint[] = [];
  const seen = new Set<string>();
  for (const cursor of cursors) {
    // Production suppresses general completions before two UTF-16 code units;
    // do not teach the public engine unreachable empty/one-character contexts.
    if (cursor < 2) continue;
    for (const phrase of extractPhraseVariantsAtCursor(text, cursor, language)) {
      if (!isTrainablePublicPhrase(phrase, language)) continue;
      if (language === 'zh' && /^[。！？；]/u.test(phrase)) continue;
      const key = `${cursor}\0${normalizeForComparison(phrase)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      checkpoints.push({ cursor, text: phrase });
    }
  }
  return checkpoints;
}

function isStructuralPhrase(entry: V2RPhraseBankEntry): boolean {
  if (entry.language === 'en') {
    return (entry.text.match(/[A-Za-z]+(?:['’-][A-Za-z]+)*/gu)?.length ?? 0) >= 2;
  }
  return (entry.text.match(/\p{Script=Han}/gu)?.length ?? 0) >= 3;
}

function countTrainingPhrases(
  documents: readonly V2RSelectedDocument[],
  documentTexts: ReadonlyMap<string, string>,
): Map<string, { language: V2RLanguage; count: number; documents: number }> {
  const counts = new Map<string, { language: V2RLanguage; count: number; documents: number }>();
  for (const document of documents) {
    if (document.split !== 'train') continue;
    const text = requireDocumentText(documentTexts, document.documentId);
    const documentPhrases = new Set<string>();
    for (const checkpoint of collectPhraseCheckpoints(text, document.language, document.sourceId)) {
      const existing = counts.get(checkpoint.text);
      if (existing && existing.language !== document.language) {
        throw new Error(`Phrase language collision: ${checkpoint.text}`);
      }
      counts.set(checkpoint.text, {
        language: document.language,
        count: (existing?.count ?? 0) + 1,
        documents: existing?.documents ?? 0,
      });
      documentPhrases.add(checkpoint.text);
    }
    for (const phrase of documentPhrases) {
      const existing = counts.get(phrase)!;
      counts.set(phrase, { ...existing, documents: existing.documents + 1 });
    }
  }
  return counts;
}

async function writeSplitSamples(
  workspaceRoot: string,
  outputPath: string,
  reportedOutputPath: string,
  documents: readonly V2RSelectedDocument[],
  documentTexts: ReadonlyMap<string, string>,
  phraseIndex: ReadonlyMap<string, V2RPhraseBankEntry>,
  abstainIndex: number,
  maxPositiveSamples: number,
): Promise<V2RTrainingDataReport['samples'][V2RCorpusSplit]> {
  const stream = createWriteStream(outputPath, { encoding: 'utf8' });
  const hash = createHash('sha256');
  let bytes = 0;
  let total = 0;
  let positive = 0;
  let abstain = 0;
  let zh = 0;
  let en = 0;
  let eligiblePositive = 0;
  let bankMatchedPositive = 0;
  let bankMissAbstain = 0;
  let documentEndAbstain = 0;
  for (const document of documents) {
    const text = requireDocumentText(documentTexts, document.documentId);
    const all = collectPhraseCheckpoints(text, document.language, document.sourceId);
    const checkpointGroups = groupCheckpointsByCursor(all);
    eligiblePositive += checkpointGroups.length;
    bankMatchedPositive += checkpointGroups.filter((group) =>
      group.some((checkpoint) => phraseIndex.has(checkpoint.text)),
    ).length;
    const selected = checkpointGroups
      .flatMap((group) => {
        const target = selectTrainingTarget(group, phraseIndex);
        return target ? [target] : [];
      })
      .sort((left, right) =>
        sha256(
          `${document.documentId}\0${left.checkpoint.cursor}\0${left.checkpoint.text}`,
        ).localeCompare(
          sha256(`${document.documentId}\0${right.checkpoint.cursor}\0${right.checkpoint.text}`),
        ),
      )
      .slice(0, maxPositiveSamples);
    for (const target of selected) {
      const sample = createTrainingSample(
        document,
        text,
        target.checkpoint.cursor,
        target.entry.index,
        target.acceptableLabels,
        target.entry.id,
        null,
      );
      await appendJsonLine(stream, hash, sample);
      const lineBytes = Buffer.byteLength(`${JSON.stringify(sample)}\n`, 'utf8');
      bytes += lineBytes;
      total++;
      positive++;
      if (document.language === 'zh') zh++;
      else en++;
    }
    const abstainCheckpoint = selectAbstainCheckpoint(text);
    const silenceSample = createTrainingSample(
      document,
      text,
      abstainCheckpoint.cursor,
      abstainIndex,
      [abstainIndex],
      null,
      abstainCheckpoint.reason,
    );
    await appendJsonLine(stream, hash, silenceSample);
    bytes += Buffer.byteLength(`${JSON.stringify(silenceSample)}\n`, 'utf8');
    total++;
    abstain++;
    if (abstainCheckpoint.reason === 'bank-miss') bankMissAbstain++;
    else documentEndAbstain++;
    if (document.language === 'zh') zh++;
    else en++;
  }
  stream.end();
  await once(stream, 'finish');
  return {
    path: repositoryRelative(reportedOutputPath, workspaceRoot),
    sha256: hash.digest('hex'),
    bytes,
    total,
    positive,
    abstain,
    abstainReasons: {
      bankMiss: bankMissAbstain,
      documentEnd: documentEndAbstain,
    },
    zh,
    en,
    bankCoverage: eligiblePositive === 0 ? 0 : bankMatchedPositive / eligiblePositive,
  };
}

async function loadSelectedDocumentTexts(
  workspaceRoot: string,
  documents: readonly V2RSelectedDocument[],
): Promise<Map<string, string>> {
  const output = new Map<string, string>();
  const batchSize = 128;
  for (let offset = 0; offset < documents.length; offset += batchSize) {
    const batch = documents.slice(offset, offset + batchSize);
    const texts = await Promise.all(
      batch.map((document) => readSelectedDocument(workspaceRoot, document)),
    );
    for (let index = 0; index < batch.length; index++) {
      output.set(batch[index]!.documentId, texts[index]!);
    }
  }
  return output;
}

function requireDocumentText(
  documentTexts: ReadonlyMap<string, string>,
  documentId: string,
): string {
  const text = documentTexts.get(documentId);
  if (text === undefined) throw new Error(`Selected document text is missing: ${documentId}.`);
  return text;
}

function createTrainingSample(
  document: V2RSelectedDocument,
  text: string,
  cursor: number,
  label: number,
  acceptableLabels: readonly number[],
  phraseId: string | null,
  abstainReason: V2RTrainingSample['abstainReason'],
): V2RTrainingSample {
  const normalizedLabels = [...new Set(acceptableLabels)].sort((left, right) => left - right);
  if (
    normalizedLabels.length === 0 ||
    normalizedLabels.length > V2R_MAX_ACCEPTABLE_LABELS ||
    !normalizedLabels.includes(label)
  ) {
    throw new Error('V2R training sample has invalid acceptable labels.');
  }
  const window = encodeUtf8ContextWindow(text, cursor);
  const sampleId = sha256(
    `${document.documentId}\0${cursor}\0${label}\0${normalizedLabels.join(',')}`,
  ).slice(0, 24);
  return {
    sampleId,
    documentId: document.documentId,
    contextUtf8Base64: Buffer.from(window.bytes).toString('base64'),
    language: document.language,
    blockType: classifyBlock(text, cursor),
    cursorBoundary: classifyCursorBoundary(text, cursor),
    label,
    acceptableLabels: normalizedLabels,
    phraseId,
    abstain: phraseId === null,
    abstainReason,
  };
}

export function selectTrainingTarget(
  checkpoints: readonly PhraseCheckpoint[],
  phraseIndex: ReadonlyMap<string, V2RPhraseBankEntry>,
): {
  checkpoint: PhraseCheckpoint;
  entry: V2RPhraseBankEntry;
  acceptableLabels: number[];
} | null {
  const available = checkpoints
    .map((checkpoint) => {
      const entry = phraseIndex.get(checkpoint.text);
      return entry ? { checkpoint, entry } : null;
    })
    .filter((value): value is { checkpoint: PhraseCheckpoint; entry: V2RPhraseBankEntry } =>
      Boolean(value),
    )
    .sort(
      (left, right) =>
        right.entry.trainingOccurrences - left.entry.trainingOccurrences ||
        Buffer.byteLength(left.entry.text, 'utf8') - Buffer.byteLength(right.entry.text, 'utf8') ||
        left.entry.text.localeCompare(right.entry.text),
    );
  if (available.length === 0) return null;
  const acceptableLabels = [...new Set(available.map(({ entry }) => entry.index))].sort(
    (left, right) => left - right,
  );
  if (acceptableLabels.length > V2R_MAX_ACCEPTABLE_LABELS) {
    throw new Error(`V2R cursor has more than ${V2R_MAX_ACCEPTABLE_LABELS} legal labels.`);
  }
  return { ...available[0]!, acceptableLabels };
}

/**
 * Keeps one genuine silence sample per document. A continuation that is absent
 * from the fixed bank is a representation miss, not evidence that the user
 * wants silence; labelling it abstain corrupts both rejection training and the
 * false-trigger metric. Bank misses remain visible through bankCoverage only.
 */
export function selectAbstainCheckpoint(text: string): V2RAbstainCheckpoint {
  return { cursor: text.length, reason: 'document-end' };
}

function groupCheckpointsByCursor(checkpoints: readonly PhraseCheckpoint[]): PhraseCheckpoint[][] {
  const groups = new Map<number, PhraseCheckpoint[]>();
  for (const checkpoint of checkpoints) {
    const group = groups.get(checkpoint.cursor) ?? [];
    group.push(checkpoint);
    groups.set(checkpoint.cursor, group);
  }
  return [...groups.values()].sort((left, right) => left[0]!.cursor - right[0]!.cursor);
}

function collectEnglishCursors(text: string): number[] {
  const words = [...text.matchAll(/[A-Za-z]+(?:['’-][A-Za-z]+)*/gu)];
  return words
    .slice(0, -1)
    .map((match) => (match.index ?? 0) + match[0].length)
    .filter((cursor) => !/[\r\n]/u.test(text.slice(cursor, cursor + 2)));
}

function collectChineseCursors(text: string, projectOwnedV3: boolean): number[] {
  const cursors = new Set<number>(
    projectOwnedV3 ? collectProjectOwnedChineseCursorOffsets(text) : [],
  );
  let lineOffset = 0;
  for (const line of text.split('\n')) {
    const prefix = line.match(/^\s{0,3}(?:(?:[-+*]|\d+[.)]|>)\s+)?/u)?.[0] ?? '';
    if (/\p{Script=Han}/u.test(line[prefix.length] ?? '')) {
      cursors.add(lineOffset + prefix.length);
    }
    for (const match of line.matchAll(/[，；：]/gu)) {
      const cursor = lineOffset + (match.index ?? 0);
      if (/\p{Script=Han}/u.test(text[cursor - 1] ?? '')) cursors.add(cursor);
    }
    lineOffset += line.length + 1;
  }

  // Chinese has no whitespace word boundary. Restricting training only to
  // generator-owned slots produced a phrase library that could not represent
  // ordinary mid-sentence writing. Sample code-point boundaries across every
  // document while keeping the per-document cost bounded and deterministic.
  const interior: number[] = [];
  for (let cursor = 0; cursor < text.length; ) {
    const point = String.fromCodePoint(text.codePointAt(cursor)!);
    if (/\p{Script=Han}/u.test(point) && !cursors.has(cursor)) interior.push(cursor);
    cursor += point.length;
  }
  const maximumInteriorCursors = 20;
  if (interior.length <= maximumInteriorCursors) {
    for (const cursor of interior) cursors.add(cursor);
  } else {
    const digest = sha256(text);
    const offset = Number.parseInt(digest.slice(0, 8), 16) % interior.length;
    const stride = interior.length / maximumInteriorCursors;
    for (let index = 0; index < maximumInteriorCursors; index++) {
      cursors.add(interior[Math.floor((offset + index * stride) % interior.length)]!);
    }
  }
  return [...cursors].sort((left, right) => left - right);
}

function classifyBlock(text: string, cursor: number): V2RTrainingBlock {
  const lineStart = Math.max(text.lastIndexOf('\n', Math.max(0, cursor - 1)) + 1, 0);
  const prefix = text.slice(lineStart, cursor);
  if (/^\s{0,3}>/u.test(prefix)) return 'quote';
  if (/^\s{0,3}(?:[-+*]|\d+[.)])\s/u.test(prefix)) return 'list';
  return 'paragraph';
}

function classifyCursorBoundary(text: string, cursor: number): V2RCursorBoundary {
  const previous = Array.from(text.slice(0, cursor)).at(-1) ?? '';
  if (/^[\p{L}\p{N}_]$/u.test(previous)) return 'word';
  if (/^\s$/u.test(previous)) return 'space';
  if (/^[\p{P}\p{S}]$/u.test(previous)) return 'punctuation';
  return 'other';
}

async function readSelectionManifest(filePath: string): Promise<V2RCorpusSelectionManifest> {
  const value = JSON.parse(await readFile(filePath, 'utf8')) as V2RCorpusSelectionManifest;
  const withoutIdentity = {
    ...value,
  } as Omit<V2RCorpusSelectionManifest, 'selectionSha256'> & { selectionSha256?: string };
  delete withoutIdentity.selectionSha256;
  if (
    value.schema !== 'jotluck.autocomplete.v2r-corpus-selection.v1' ||
    value.schemaVersion !== 1 ||
    value.status !== 'complete' ||
    value.selectionSha256 !== canonicalSha256(withoutIdentity)
  ) {
    throw new Error('V2R selection manifest is invalid.');
  }
  return value;
}

async function readExistingTrainingData(
  workspaceRoot: string,
  trainingRoot: string,
  phraseBankSize: V2RPhraseBankSize,
  selectionSha256: string,
): Promise<V2RTrainingDataReport | null> {
  const reportPath = path.join(trainingRoot, 'training-data-report.json');
  let reportBytes: Buffer;
  try {
    reportBytes = await readFile(reportPath);
  } catch (error) {
    if (!isMissingFile(error)) throw error;
    try {
      await access(trainingRoot);
    } catch (accessError) {
      if (isMissingFile(accessError)) return null;
      throw accessError;
    }
    throw new Error(`V2R training cache is incomplete and immutable: ${trainingRoot}.`);
  }

  let report: V2RTrainingDataReport;
  try {
    report = JSON.parse(reportBytes.toString('utf8')) as V2RTrainingDataReport;
  } catch {
    throw new Error(`V2R training cache report is corrupt: ${reportPath}.`);
  }
  const withoutIdentity = {
    ...report,
  } as Omit<V2RTrainingDataReport, 'reportSha256'> & { reportSha256?: string };
  delete withoutIdentity.reportSha256;
  if (
    report.schema !== V2R_TRAINING_DATA_SCHEMA ||
    report.schemaVersion !== 3 ||
    report.phraseBankSize !== phraseBankSize ||
    report.abstainIndex !== phraseBankSize ||
    report.selectionSha256 !== selectionSha256 ||
    !Number.isFinite(report.maxPhraseDocumentRatio) ||
    report.maxPhraseDocumentRatio < 0 ||
    report.maxPhraseDocumentRatio > 1 ||
    !Number.isFinite(report.maxStructuralPhraseDocumentRatio) ||
    report.maxStructuralPhraseDocumentRatio < 0 ||
    report.maxStructuralPhraseDocumentRatio > 0.1 + Number.EPSILON ||
    report.reportSha256 !== canonicalSha256(withoutIdentity)
  ) {
    throw new Error(`V2R training cache identity is invalid: ${reportPath}.`);
  }

  const phraseBankPath = path.join(trainingRoot, 'phrase-bank.jsonl');
  const phraseBankIdentity = await hashFile(phraseBankPath);
  if (
    phraseBankIdentity.sha256 !== report.phraseBankSha256 ||
    phraseBankIdentity.bytes !== report.phraseBankBytes
  ) {
    throw new Error(`V2R cached phrase bank changed: ${phraseBankPath}.`);
  }
  await Promise.all(
    (['train', 'development', 'internalSelection'] as const).map(async (split) => {
      const binding = report.samples?.[split];
      const samplePath = path.join(trainingRoot, `samples.${split}.jsonl`);
      const expectedPath = repositoryRelative(samplePath, workspaceRoot);
      if (
        !binding ||
        binding.path !== expectedPath ||
        !Number.isSafeInteger(binding.total) ||
        !Number.isSafeInteger(binding.positive) ||
        !Number.isSafeInteger(binding.abstain) ||
        !Number.isSafeInteger(binding.zh) ||
        !Number.isSafeInteger(binding.en) ||
        binding.abstainReasons?.bankMiss !== 0 ||
        binding.abstainReasons?.documentEnd !== binding.abstain ||
        binding.total !== binding.positive + binding.abstain ||
        binding.total !== binding.zh + binding.en ||
        !Number.isFinite(binding.bankCoverage) ||
        binding.bankCoverage < 0 ||
        binding.bankCoverage > 1
      ) {
        throw new Error(`V2R cached ${split} sample report is invalid.`);
      }
      const identity = await hashFile(samplePath);
      if (identity.sha256 !== binding.sha256 || identity.bytes !== binding.bytes) {
        throw new Error(`V2R cached ${split} samples changed.`);
      }
    }),
  );
  return report;
}

async function hashFile(filePath: string): Promise<{ sha256: string; bytes: number }> {
  const hash = createHash('sha256');
  let bytes = 0;
  for await (const chunk of createReadStream(filePath)) {
    const buffer = chunk as Buffer;
    hash.update(buffer);
    bytes += buffer.byteLength;
  }
  return { sha256: hash.digest('hex'), bytes };
}

function isMissingFile(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT';
}

async function readSelectedDocument(
  workspaceRoot: string,
  document: V2RSelectedDocument,
): Promise<string> {
  assertPathInsideV2RCache(document.relativePath, `${document.documentId}.relativePath`);
  const absolutePath = path.resolve(workspaceRoot, ...document.relativePath.split('/'));
  const text = await readFile(absolutePath, 'utf8');
  if (Buffer.byteLength(text, 'utf8') !== document.bytes || sha256(text) !== document.sha256) {
    throw new Error(`Training document identity mismatch: ${document.documentId}.`);
  }
  return text;
}

async function writeJsonLines(
  filePath: string,
  values: readonly unknown[],
): Promise<{ sha256: string; bytes: number }> {
  const stream = createWriteStream(filePath, { encoding: 'utf8' });
  const hash = createHash('sha256');
  let bytes = 0;
  for (const value of values) {
    const line = `${JSON.stringify(value)}\n`;
    hash.update(line);
    bytes += Buffer.byteLength(line, 'utf8');
    if (!stream.write(line)) await once(stream, 'drain');
  }
  stream.end();
  await once(stream, 'finish');
  return { sha256: hash.digest('hex'), bytes };
}

async function appendJsonLine(
  stream: ReturnType<typeof createWriteStream>,
  hash: ReturnType<typeof createHash>,
  value: unknown,
): Promise<void> {
  const line = `${JSON.stringify(value)}\n`;
  hash.update(line);
  if (!stream.write(line)) await once(stream, 'drain');
}

function repositoryRelative(filePath: string, workspaceRoot: string): string {
  const relative = path.relative(workspaceRoot, filePath).split(path.sep).join('/');
  return assertPathInsideV2RCache(relative, 'training output path');
}
