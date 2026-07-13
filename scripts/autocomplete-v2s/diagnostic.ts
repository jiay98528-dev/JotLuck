import { mkdir, readFile, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { performance } from 'node:perf_hooks';
import {
  parsePublicV2sModel,
  type PublicV2sRuntimeModel,
} from '../../packages/app/src/services/completion/public-v2s-binary';
import type { PublicEngineGenerateRequest } from '../../packages/app/src/services/completion/public-engine-types';
import { takeLastUtf8Bytes } from '../../packages/app/src/services/completion/engine-router';
import { canonicalJson, resolveInside, sha256, V2S_ENGINE_ID } from './common';
import type { GateSample } from './gate';
import {
  verifyV2SSelection,
  type V2SLanguage,
  type V2SSelectionDocument,
  type V2SSelectionManifest,
} from './selection';

const CATEGORIES = [
  'field-observation',
  'maintenance-log',
  'meeting-note',
  'reading-note',
  'household-plan',
] as const;

export interface V2SDiagnosticReport {
  schema: 'jotluck.autocomplete.v2s-development-diagnostic.v1';
  releaseEvidence: false;
  engine: typeof V2S_ENGINE_ID;
  modelSha256: string;
  selectionSha256: string;
  observations: number;
  complete: number;
  silence: number;
  oracleAt8: number;
  oracleAt8AbsoluteRate: number;
  oracleAt32: number;
  oracleAt32AbsoluteRate: number;
  gatedTriggers: number;
  gatedUsable: number;
  gatedAbsoluteUsableRate: number;
  silenceFalseTriggers: number;
  mixedCandidates: number;
  byLanguage: Record<
    V2SLanguage,
    { opportunities: number; oracleAt8: number; oracleAt32: number; gatedUsable: number }
  >;
  parseMs: number;
  generationP90Ms: number;
  gateSamples: { show: number; silence: number; bankMiss: number };
}

interface DiagnosticCheckpoint {
  id: string;
  group: string;
  language: V2SLanguage;
  text: string;
  cursorOffset: number;
  expectedBehavior: 'complete' | 'silence';
  calibrationRole: GateSample['calibrationRole'];
}

export async function runV2SDevelopmentDiagnostic(options: {
  workspaceRoot: string;
  selectionPath: string;
  candidateAssetPath: string;
  reportPath?: string;
  gateSamplesPath?: string;
}): Promise<{ report: V2SDiagnosticReport; gateSamples: GateSample[] }> {
  const selectionFile = resolveInside(
    options.workspaceRoot,
    options.selectionPath,
    'V2S diagnostic selection',
  );
  const selection = JSON.parse(await readFile(selectionFile, 'utf8')) as V2SSelectionManifest;
  await verifyV2SSelection(selection, options.workspaceRoot);
  const assetPath = resolveInside(
    options.workspaceRoot,
    options.candidateAssetPath,
    'V2S diagnostic candidate asset',
  );
  const asset = await readFile(assetPath);
  const parseStartedAt = performance.now();
  const model = await parsePublicV2sModel(asset);
  const parseMs = performance.now() - parseStartedAt;
  const checkpoints = await buildDiagnosticCheckpoints(options.workspaceRoot, selection.documents);
  const evaluation = evaluateCheckpoints(model, checkpoints);
  evaluation.gateSamples.push(...collectHardNegativeGateSamples(model));
  const report: V2SDiagnosticReport = {
    schema: 'jotluck.autocomplete.v2s-development-diagnostic.v1',
    releaseEvidence: false,
    engine: V2S_ENGINE_ID,
    modelSha256: sha256(asset),
    selectionSha256: selection.selectionSha256,
    observations: checkpoints.length,
    complete: checkpoints.filter((item) => item.expectedBehavior === 'complete').length,
    silence: checkpoints.filter((item) => item.expectedBehavior === 'silence').length,
    oracleAt8: evaluation.oracleAt8,
    oracleAt8AbsoluteRate: evaluation.oracleAt8 / checkpoints.length,
    oracleAt32: evaluation.oracleAt32,
    oracleAt32AbsoluteRate: evaluation.oracleAt32 / checkpoints.length,
    gatedTriggers: evaluation.gatedTriggers,
    gatedUsable: evaluation.gatedUsable,
    gatedAbsoluteUsableRate: evaluation.gatedUsable / checkpoints.length,
    silenceFalseTriggers: evaluation.silenceFalseTriggers,
    mixedCandidates: evaluation.mixedCandidates,
    byLanguage: evaluation.byLanguage,
    parseMs,
    generationP90Ms: percentile(evaluation.latencies, 0.9),
    gateSamples: {
      show: evaluation.gateSamples.filter((item) => item.label === 'show').length,
      silence: evaluation.gateSamples.filter((item) => item.label === 'silence').length,
      bankMiss: evaluation.gateSamples.filter((item) => item.label === 'bank-miss').length,
    },
  };
  await Promise.all([
    options.reportPath
      ? writeJsonInside(options.workspaceRoot, options.reportPath, report)
      : Promise.resolve(),
    options.gateSamplesPath
      ? writeJsonInside(options.workspaceRoot, options.gateSamplesPath, evaluation.gateSamples)
      : Promise.resolve(),
  ]);
  return { report, gateSamples: evaluation.gateSamples };
}

function collectHardNegativeGateSamples(model: PublicV2sRuntimeModel): GateSample[] {
  const cases: Array<{ id: string; language: V2SLanguage; text: string }> = [
    { id: 'history-chatbot', language: 'zh', text: '聊天机器人' },
    { id: 'history-spec-document', language: 'zh', text: '规格文档' },
    { id: 'zh-low-information-1', language: 'zh', text: '今天的' },
    { id: 'zh-low-information-2', language: 'zh', text: '我们正在' },
    { id: 'zh-sentence-end', language: 'zh', text: '检查已经完成。' },
    { id: 'en-half-word-document', language: 'en', text: 'The project docum' },
    { id: 'en-half-word-review', language: 'en', text: 'Please revi' },
    { id: 'en-low-information-1', language: 'en', text: 'This is' },
    { id: 'en-low-information-2', language: 'en', text: 'The' },
    { id: 'en-sentence-end', language: 'en', text: 'The review is complete.' },
  ];
  const output: GateSample[] = [];
  for (const item of cases) {
    const checkpoint: DiagnosticCheckpoint = {
      id: `hard-negative:${item.id}`,
      group: `hard-negative:${item.id}`,
      language: item.language,
      text: item.text,
      cursorOffset: item.text.length,
      expectedBehavior: 'silence',
      calibrationRole: 'calibration',
    };
    const observation = model.observeForGateTraining(createRequest(checkpoint));
    if (observation.gateFeatures) {
      output.push({
        features: observation.gateFeatures,
        label: 'silence',
        group: checkpoint.group,
        language: checkpoint.language,
        expectedBehavior: checkpoint.expectedBehavior,
        calibrationRole: checkpoint.calibrationRole,
      });
    }
  }
  return output;
}

async function buildDiagnosticCheckpoints(
  workspaceRoot: string,
  documents: readonly V2SSelectionDocument[],
): Promise<DiagnosticCheckpoint[]> {
  const output: DiagnosticCheckpoint[] = [];
  for (const language of ['zh', 'en'] as const) {
    for (const category of CATEGORIES) {
      const group = documents
        .filter(
          (document) =>
            document.split === 'development' &&
            document.language === language &&
            document.category === category,
        )
        .sort(
          (left, right) =>
            sha256(left.documentId).localeCompare(sha256(right.documentId), 'en') ||
            left.documentId.localeCompare(right.documentId, 'en'),
        );
      let complete = 0;
      let silence = 0;
      for (const document of group) {
        if (complete >= 15 && silence >= 5) break;
        const text = await readVerifiedDocument(workspaceRoot, document);
        if (complete < 15) {
          const cursorOffset = findCompletionCursor(text, language);
          if (cursorOffset !== null) {
            output.push({
              id: `${document.documentId}:complete`,
              group: document.documentId,
              language,
              text,
              cursorOffset,
              expectedBehavior: 'complete',
              calibrationRole: complete % 5 === 0 ? 'calibration' : 'fit',
            });
            complete += 1;
            continue;
          }
        }
        if (silence < 5) {
          const cursorOffset = text.trimEnd().length;
          if (cursorOffset > 0) {
            output.push({
              id: `${document.documentId}:silence`,
              group: document.documentId,
              language,
              text,
              cursorOffset,
              expectedBehavior: 'silence',
              calibrationRole: silence % 5 === 0 ? 'calibration' : 'fit',
            });
            silence += 1;
          }
        }
      }
      if (complete !== 15 || silence !== 5) {
        throw new Error(`V2S diagnostic lacks ${language}/${category} development checkpoints.`);
      }
    }
  }
  return output;
}

function evaluateCheckpoints(
  model: PublicV2sRuntimeModel,
  checkpoints: readonly DiagnosticCheckpoint[],
) {
  let oracleAt8 = 0;
  let oracleAt32 = 0;
  let gatedTriggers = 0;
  let gatedUsable = 0;
  let silenceFalseTriggers = 0;
  let mixedCandidates = 0;
  const latencies: number[] = [];
  const gateSamples: GateSample[] = [];
  const byLanguage = {
    zh: { opportunities: 0, oracleAt8: 0, oracleAt32: 0, gatedUsable: 0 },
    en: { opportunities: 0, oracleAt8: 0, oracleAt32: 0, gatedUsable: 0 },
  };
  for (const checkpoint of checkpoints) {
    const request = createRequest(checkpoint);
    const observation = model.observeForGateTraining(request);
    const startedAt = performance.now();
    const gated = model.generate(request);
    latencies.push(performance.now() - startedAt);
    const oracle8 = observation.candidates
      .slice(0, 8)
      .some((candidate) => isUsable(candidate.text, checkpoint));
    const oracle32 = observation.candidates.some((candidate) =>
      isUsable(candidate.text, checkpoint),
    );
    const gatedTop1 = gated[0]?.text;
    const usableTop1 = gatedTop1 !== undefined && isUsable(gatedTop1, checkpoint);
    oracleAt8 += oracle8 ? 1 : 0;
    oracleAt32 += oracle32 ? 1 : 0;
    gatedTriggers += gatedTop1 === undefined ? 0 : 1;
    gatedUsable += usableTop1 ? 1 : 0;
    silenceFalseTriggers +=
      checkpoint.expectedBehavior === 'silence' && gatedTop1 !== undefined ? 1 : 0;
    mixedCandidates += observation.candidates.filter((candidate) =>
      isMixed(candidate.text, checkpoint.language),
    ).length;
    const languageMetrics = byLanguage[checkpoint.language];
    languageMetrics.opportunities += 1;
    languageMetrics.oracleAt8 += oracle8 ? 1 : 0;
    languageMetrics.oracleAt32 += oracle32 ? 1 : 0;
    languageMetrics.gatedUsable += usableTop1 ? 1 : 0;
    if (observation.gateFeatures) {
      gateSamples.push({
        features: observation.gateFeatures,
        label:
          checkpoint.expectedBehavior === 'silence'
            ? 'silence'
            : isUsable(observation.candidates[0]?.text ?? '', checkpoint)
              ? 'show'
              : 'bank-miss',
        group: checkpoint.group,
        language: checkpoint.language,
        expectedBehavior: checkpoint.expectedBehavior,
        calibrationRole: checkpoint.calibrationRole,
      });
    }
  }
  return {
    oracleAt8,
    oracleAt32,
    gatedTriggers,
    gatedUsable,
    silenceFalseTriggers,
    mixedCandidates,
    latencies,
    gateSamples,
    byLanguage,
  };
}

function createRequest(checkpoint: DiagnosticCheckpoint): PublicEngineGenerateRequest {
  const context = checkpoint.text.slice(0, checkpoint.cursorOffset);
  const contextTail = takeLastUtf8Bytes(context, 256);
  return {
    engineEpoch: 1,
    workspaceScope: 'v2s-development-diagnostic',
    documentVersion: checkpoint.id,
    cursorPos: checkpoint.cursorOffset,
    contextTail,
    contextTailUtf8Bytes: new TextEncoder().encode(contextTail).byteLength,
    languageHint: checkpoint.language,
    blockType: 'paragraph',
    cursorBoundary: detectBoundary(checkpoint.text, checkpoint.cursorOffset),
    maxCandidates: 32,
    deadlineAt: Date.now() + 60_000,
  };
}

function findCompletionCursor(text: string, language: V2SLanguage): number | null {
  const candidates: number[] = [];
  if (language === 'en') {
    for (const match of text.matchAll(/[A-Za-z][A-Za-z'’-]*(?=\s+[A-Za-z])/gu)) {
      const cursor = (match.index ?? 0) + match[0].length;
      if ((text.slice(cursor).match(/[A-Za-z]/gu)?.length ?? 0) >= 5) candidates.push(cursor);
    }
  } else {
    for (let cursor = 1; cursor < text.length; cursor += 1) {
      const previous = text.slice(0, cursor).at(-1) ?? '';
      if (!/\p{Script=Han}/u.test(previous)) continue;
      if ((text.slice(cursor).match(/\p{Script=Han}/gu)?.length ?? 0) >= 3) candidates.push(cursor);
    }
  }
  if (candidates.length === 0) return null;
  const target = text.length * 0.55;
  return candidates.sort((left, right) => Math.abs(left - target) - Math.abs(right - target))[0]!;
}

function isUsable(candidate: string, checkpoint: DiagnosticCheckpoint): boolean {
  if (checkpoint.expectedBehavior !== 'complete' || isMixed(candidate, checkpoint.language)) {
    return false;
  }
  const normalizedCandidate = normalize(candidate);
  const actual = normalize(checkpoint.text.slice(checkpoint.cursorOffset));
  if (!actual.startsWith(normalizedCandidate)) return false;
  if (checkpoint.language === 'zh') {
    return (normalizedCandidate.match(/\p{Script=Han}/gu)?.length ?? 0) >= 3;
  }
  if ((normalizedCandidate.match(/[A-Za-z]/gu)?.length ?? 0) < 5) return false;
  const last = normalizedCandidate.at(-1) ?? '';
  const next = actual[normalizedCandidate.length] ?? '';
  return !(/[A-Za-z'’-]/u.test(last) && /[A-Za-z'’-]/u.test(next));
}

function normalize(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/\r\n?/gu, '\n')
    .replace(/[ \t]+/gu, ' ')
    .toLocaleLowerCase('en-US');
}

function isMixed(value: string, language: V2SLanguage): boolean {
  return language === 'zh' ? /[A-Za-z]/u.test(value) : /\p{Script=Han}/u.test(value);
}

function detectBoundary(
  text: string,
  cursorOffset: number,
): PublicEngineGenerateRequest['cursorBoundary'] {
  const previous = Array.from(text.slice(0, cursorOffset)).at(-1) ?? '';
  if (/^[\p{L}\p{N}_]$/u.test(previous)) return 'word';
  if (/^\s$/u.test(previous)) return 'space';
  if (/^[\p{P}\p{S}]$/u.test(previous)) return 'punctuation';
  return 'other';
}

async function readVerifiedDocument(
  workspaceRoot: string,
  document: V2SSelectionDocument,
): Promise<string> {
  const bytes = await readFile(
    resolveInside(workspaceRoot, document.relativePath, 'V2S diagnostic document'),
  );
  if (bytes.byteLength !== document.bytes || sha256(bytes) !== document.sha256) {
    throw new Error(`V2S diagnostic document changed: ${document.documentId}.`);
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

async function writeJsonInside(workspaceRoot: string, relativePath: string, value: unknown) {
  const target = resolveInside(workspaceRoot, relativePath, 'V2S diagnostic output');
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${canonicalJson(value)}\n`, 'utf8');
}

function percentile(values: readonly number[], quantile: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * quantile) - 1)] ?? 0;
}
