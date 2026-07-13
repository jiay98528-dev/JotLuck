import { describe, expect, it } from 'vitest';
import type { PublicEngineGenerateRequest } from '../public-engine-types';
import { PUBLIC_V2S_GATE_FEATURE_SCHEMA, parsePublicV2sModel } from '../public-v2s-binary';

const SPECIAL_TOKENS = ['<unk>', '<bos>', '<eos>', '<abstain>'];

interface V2STokenizerModel {
  schema: 'jotluck.autocomplete.v2s-tokenizer.v1';
  kind: 'bpe';
  language: 'zh' | 'en';
  vocabulary: string[];
  merges: Array<[string, string]>;
  scores: number[];
  maxPieceCodePoints: number;
}

interface MknPredictionRecord {
  order: number;
  context: number[];
  token: number;
  probabilityQ16: number;
  count: number;
}

interface MknModel {
  vocabularySize: number;
  maxOrder: number;
  unigramQ16: number[];
  predictions: MknPredictionRecord[];
  backoffs: Array<{ order: number; context: number[]; weightQ16: number }>;
}

interface G0GateModel {
  schema: 'jotluck.autocomplete.v2s-gate.v1';
  kind: 'g0-rules';
  featureSchema: string;
  featureCount: 10;
  trainingExamples: number;
  excludedBankMisses: number;
  weightScale: number;
  ruleWeightsQ16: number[];
  biasScale: number;
  biasQ16: number;
  showThresholdQ16: number;
}

function tokenizer(
  language: 'zh' | 'en',
  pieces: string[],
  merges: Array<[string, string]>,
): V2STokenizerModel {
  const vocabulary = [...SPECIAL_TOKENS, ...new Set(pieces)];
  return {
    schema: 'jotluck.autocomplete.v2s-tokenizer.v1',
    kind: 'bpe',
    language,
    vocabulary,
    merges,
    scores: vocabulary.map(() => 0),
    maxPieceCodePoints: 16,
  };
}

function mergeWord(word: string, leadingSpace = false): Array<[string, string]> {
  const points = [...word];
  if (leadingSpace) points[0] = `▁${points[0]}`;
  const merges: Array<[string, string]> = [];
  let left = points[0]!;
  for (let index = 1; index < points.length; index += 1) {
    const right = points[index]!;
    merges.push([left, right]);
    left += right;
  }
  return merges;
}

function createMkn(vocabularySize: number, predictions: MknPredictionRecord[]): MknModel {
  const unigramQ16 = new Array<number>(vocabularySize).fill(512);
  unigramQ16[2] = 2_048;
  for (const prediction of predictions) unigramQ16[prediction.token] = 4_096;
  const predictionsByContext = new Map<string, MknPredictionRecord[]>();
  for (const prediction of predictions) {
    const key = `${prediction.order}:${prediction.context.join(',')}`;
    predictionsByContext.set(key, [...(predictionsByContext.get(key) ?? []), prediction]);
  }
  return {
    vocabularySize,
    maxOrder: 3,
    unigramQ16,
    predictions,
    backoffs: [...predictionsByContext.values()].map((items) => ({
      order: items[0]!.order,
      context: items[0]!.context,
      weightQ16: Math.max(0, 65_535 - items.reduce((sum, item) => sum + item.probabilityQ16, 0)),
    })),
  };
}

async function fixture(
  options: { gateFeatureSchema?: string; showThresholdQ16?: number } = {},
): Promise<Uint8Array> {
  const en = tokenizer(
    'en',
    [
      'P',
      ...'roject',
      '▁p',
      ...'lan',
      '▁r',
      ...'eviewed',
      '▁a',
      ...'pproved',
      'Project',
      '▁plan',
      '▁reviewed',
      '▁approved',
    ],
    [
      ...mergeWord('Project'),
      ...mergeWord('plan', true),
      ...mergeWord('reviewed', true),
      ...mergeWord('approved', true),
    ],
  );
  const zh = tokenizer(
    'zh',
    ['▁项', '项', ...'目计划需要确认可以延期', '▁项目计划', '项目计划', '需要确认', '可以延期'],
    [
      ...mergeWord('项目计划', true),
      ...mergeWord('项目计划'),
      ...mergeWord('需要确认'),
      ...mergeWord('可以延期'),
    ],
  );
  const enId = new Map(en.vocabulary.map((piece, index) => [piece, index]));
  const zhId = new Map(zh.vocabulary.map((piece, index) => [piece, index]));
  const enMkn = createMkn(en.vocabulary.length, [
    prediction([enId.get('Project')!, enId.get('▁plan')!], enId.get('▁reviewed')!, 38_000, 9),
    prediction([enId.get('Project')!, enId.get('▁plan')!], enId.get('▁approved')!, 24_000, 5),
    prediction([enId.get('▁reviewed')!], 2, 65_000, 9),
    prediction([enId.get('▁approved')!], 2, 65_000, 5),
  ]);
  const zhMkn = createMkn(zh.vocabulary.length, [
    prediction([zhId.get('▁项目计划')!], zhId.get('需要确认')!, 38_000, 9),
    prediction([zhId.get('▁项目计划')!], zhId.get('可以延期')!, 24_000, 5),
    prediction([zhId.get('项目计划')!], zhId.get('需要确认')!, 38_000, 9),
    prediction([zhId.get('项目计划')!], zhId.get('可以延期')!, 24_000, 5),
  ]);
  const gate: G0GateModel = {
    schema: 'jotluck.autocomplete.v2s-gate.v1',
    kind: 'g0-rules',
    featureSchema: options.gateFeatureSchema ?? PUBLIC_V2S_GATE_FEATURE_SCHEMA,
    featureCount: 10,
    trainingExamples: 20,
    excludedBankMisses: 5,
    weightScale: 1 / 32_767,
    ruleWeightsQ16: [32_767, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    biasScale: 1,
    biasQ16: 0,
    showThresholdQ16: options.showThresholdQ16 ?? 1,
  };
  const metadata = new TextEncoder().encode(
    JSON.stringify({
      schema: 'jotluck.autocomplete.v2s-runtime-metadata.v1',
      engine: 'public-v2s-mkn-v1',
      candidateId: 'fixture-v2s',
      maxOrder: 3,
      providerId: 'public-v2s-mkn-v1',
      source: 'public-v2s',
      sourceLayer: 'l3',
    }),
  );
  return packContainer([
    { id: 'tokenizer.zh', bytes: jsonBytes(zh) },
    { id: 'tokenizer.en', bytes: jsonBytes(en) },
    { id: 'lm.zh', bytes: encodeMkn(zhMkn) },
    { id: 'lm.en', bytes: encodeMkn(enMkn) },
    { id: 'gate', bytes: jsonBytes(gate) },
    { id: 'metadata', bytes: metadata },
  ]);
}

function prediction(
  context: number[],
  token: number,
  probabilityQ16: number,
  count: number,
): MknPredictionRecord {
  return { order: context.length + 1, context, token, probabilityQ16, count };
}

function encodeMkn(model: MknModel): Uint8Array {
  interface Node {
    token: number;
    children: Map<number, Node>;
    predictions: MknPredictionRecord[];
    backoffQ16: number;
    firstChild: number;
    firstPrediction: number;
  }
  const createNode = (token: number): Node => ({
    token,
    children: new Map(),
    predictions: [],
    backoffQ16: 65_535,
    firstChild: 0,
    firstPrediction: 0,
  });
  const root = createNode(0xffffffff);
  const ensureContext = (context: readonly number[]) => {
    let node = root;
    for (const token of context) {
      const child = node.children.get(token) ?? createNode(token);
      node.children.set(token, child);
      node = child;
    }
    return node;
  };
  for (const backoff of model.backoffs) {
    ensureContext(backoff.context).backoffQ16 = backoff.weightQ16;
  }
  for (const item of model.predictions) ensureContext(item.context).predictions.push(item);
  const nodes = [root];
  const assignChildren = (node: Node) => {
    const children = [...node.children.values()].sort((left, right) => left.token - right.token);
    node.firstChild = children.length === 0 ? 0 : nodes.length;
    nodes.push(...children);
    for (const child of children) assignChildren(child);
  };
  assignChildren(root);
  const predictions: MknPredictionRecord[] = [];
  for (const node of nodes) {
    node.predictions.sort((left, right) => left.token - right.token);
    node.firstPrediction = node.predictions.length === 0 ? 0 : predictions.length;
    predictions.push(...node.predictions);
  }
  let offset = 24;
  const take = (elements: number, bytes: number) => {
    const start = offset;
    offset += elements * bytes;
    return start;
  };
  const align4 = () => {
    offset = Math.ceil(offset / 4) * 4;
  };
  const unigram = take(model.vocabularySize, 2);
  align4();
  const nodeToken = take(nodes.length, 4);
  const nodeFirstChild = take(nodes.length, 4);
  const nodeChildCount = take(nodes.length, 2);
  align4();
  const nodeFirstPrediction = take(nodes.length, 4);
  const nodePredictionCount = take(nodes.length, 2);
  const nodeBackoffQ16 = take(nodes.length, 2);
  const predictionToken = take(predictions.length, 4);
  const predictionProbabilityQ16 = take(predictions.length, 2);
  align4();
  const predictionCount = take(predictions.length, 4);
  const output = new Uint8Array(offset);
  const view = new DataView(output.buffer);
  output.set(new TextEncoder().encode('JLMKN2\0\0'));
  view.setUint8(8, model.maxOrder);
  view.setUint32(12, model.vocabularySize, true);
  view.setUint32(16, nodes.length, true);
  view.setUint32(20, predictions.length, true);
  model.unigramQ16.forEach((value, index) => view.setUint16(unigram + index * 2, value, true));
  nodes.forEach((node, index) => {
    view.setUint32(nodeToken + index * 4, node.token, true);
    view.setUint32(nodeFirstChild + index * 4, node.firstChild, true);
    view.setUint16(nodeChildCount + index * 2, node.children.size, true);
    view.setUint32(nodeFirstPrediction + index * 4, node.firstPrediction, true);
    view.setUint16(nodePredictionCount + index * 2, node.predictions.length, true);
    view.setUint16(nodeBackoffQ16 + index * 2, node.backoffQ16, true);
  });
  predictions.forEach((item, index) => {
    view.setUint32(predictionToken + index * 4, item.token, true);
    view.setUint16(predictionProbabilityQ16 + index * 2, item.probabilityQ16, true);
    view.setUint32(predictionCount + index * 4, item.count, true);
  });
  return output;
}

async function packContainer(
  sections: Array<{ id: string; bytes: Uint8Array }>,
): Promise<Uint8Array> {
  let relativeOffset = 0;
  const descriptors = [];
  for (const section of sections) {
    descriptors.push({
      id: section.id,
      relativeOffset,
      bytes: section.bytes.byteLength,
      sha256: await sha256(section.bytes),
    });
    relativeOffset += section.bytes.byteLength;
  }
  const headerBytes = jsonBytes({
    schema: 'jotluck.autocomplete.public-container.v6',
    schemaVersion: 6,
    engine: 'public-v2s-mkn-v1',
    sections: descriptors,
    payloadBytes: relativeOffset,
  });
  const output = new Uint8Array(8 + 4 + headerBytes.byteLength + relativeOffset);
  output.set(new TextEncoder().encode('JLV2S6\0\0'));
  new DataView(output.buffer).setUint32(8, headerBytes.byteLength, true);
  output.set(headerBytes, 12);
  let offset = 12 + headerBytes.byteLength;
  for (const section of sections) {
    output.set(section.bytes, offset);
    offset += section.bytes.byteLength;
  }
  return output;
}

function jsonBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value));
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const input = Uint8Array.from(bytes);
  const digest = await crypto.subtle.digest('SHA-256', input.buffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function request(
  contextTail: string,
  languageHint: 'zh' | 'en' | 'mixed' = 'en',
): PublicEngineGenerateRequest {
  return {
    engineEpoch: 1,
    workspaceScope: 'workspace-a',
    documentVersion: 'doc-v1',
    cursorPos: contextTail.length,
    contextTail,
    contextTailUtf8Bytes: new TextEncoder().encode(contextTail).byteLength,
    languageHint,
    blockType: 'paragraph',
    cursorBoundary: 'word',
    maxCandidates: 8,
    deadlineAt: Date.now() + 1_000,
  };
}

describe('Public V2S v6 container runtime', () => {
  it('parses the exact training container and generates bounded bilingual candidates', async () => {
    const bytes = await fixture();
    const model = await parsePublicV2sModel(bytes);

    expect(model.metadata).toMatchObject({
      schemaVersion: 6,
      engine: 'public-v2s-mkn-v1',
      maxOrder: 3,
      gateFeatureSchema: PUBLIC_V2S_GATE_FEATURE_SCHEMA,
      byteLength: bytes.byteLength,
    });
    expect(
      model
        .generate(request('Project plan'))
        .slice(0, 2)
        .map((candidate) => candidate.text),
    ).toEqual([' reviewed', ' approved']);
    expect(
      model
        .generate(request('Header\r\nProject plan'))
        .slice(0, 2)
        .map((candidate) => candidate.text),
    ).toEqual([' reviewed', ' approved']);
    expect(
      model
        .generate(request('当前项目计划', 'zh'))
        .slice(0, 2)
        .map((candidate) => candidate.text),
    ).toEqual(['需要确认', '可以延期']);
    expect(model.generate(request('😀项目计划', 'zh'))[0]).toMatchObject({
      text: '需要确认',
      language: 'zh',
    });
  });

  it('hard-abstains mixed language and unsupported Markdown blocks', async () => {
    const model = await parsePublicV2sModel(await fixture());
    expect(model.generate(request('Project plan', 'mixed'))).toEqual([]);
    expect(model.generate({ ...request('Project plan'), blockType: 'code' })).toEqual([]);
  });

  it('keeps ungated Oracle observation out of the production Worker contract', async () => {
    const model = await parsePublicV2sModel(await fixture({ showThresholdQ16: 65_535 }));
    const input = request('Project plan');
    expect(model.generate(input)).toEqual([]);
    expect(model.generateUngatedForEvaluation(input)[0]).toMatchObject({ text: ' reviewed' });
    expect(model.observeForGateTraining(input).gateFeatures).toHaveLength(10);
  });

  it('rejects HTML, truncation, trailing bytes, section damage and gate schema drift', async () => {
    const valid = await fixture();
    await expect(
      parsePublicV2sModel(new TextEncoder().encode('<!doctype html>')),
    ).rejects.toThrow();
    await expect(parsePublicV2sModel(valid.slice(0, -1))).rejects.toThrow();

    const trailing = new Uint8Array(valid.byteLength + 1);
    trailing.set(valid);
    await expect(parsePublicV2sModel(trailing)).rejects.toThrow();

    const corrupted = valid.slice();
    corrupted[corrupted.length - 1] = corrupted[corrupted.length - 1]! ^ 1;
    await expect(parsePublicV2sModel(corrupted)).rejects.toThrow(/SHA-256/u);
    await expect(
      parsePublicV2sModel(await fixture({ gateFeatureSchema: 'drifted' })),
    ).rejects.toThrow(/feature contract/u);
  });
});
