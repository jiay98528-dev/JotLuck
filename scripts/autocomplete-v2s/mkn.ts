import { compareStrings } from './common';

export interface MknDiscounts {
  d1: number;
  d2: number;
  d3Plus: number;
}

export interface MknPredictionRecord {
  order: number;
  context: number[];
  token: number;
  count: number;
  probabilityQ16: number;
}

export interface MknBackoffRecord {
  order: number;
  context: number[];
  weightQ16: number;
}

export interface MknModel {
  schema: 'jotluck.autocomplete.v2s-mkn.v1';
  vocabularySize: number;
  maxOrder: number;
  discounts: Record<string, MknDiscounts>;
  unigramQ16: number[];
  predictions: MknPredictionRecord[];
  backoffs: MknBackoffRecord[];
}

export interface PrunedMknVariant {
  budgetBytes: number;
  encoded: Uint8Array;
  model: MknModel;
}

interface RankedPrediction {
  prediction: MknPredictionRecord;
  informationGainQ: number;
  informationGainPerByteQ: number;
}

interface MutableTrieNode {
  token: number;
  children: Map<number, MutableTrieNode>;
  predictions: MknPredictionRecord[];
  backoffQ16: number;
  index: number;
  firstChild: number;
  firstPrediction: number;
}

interface MknBinaryLayout {
  unigram: number;
  nodeToken: number;
  nodeFirstChild: number;
  nodeChildCount: number;
  nodeFirstPrediction: number;
  nodePredictionCount: number;
  nodeBackoffQ16: number;
  predictionToken: number;
  predictionProbabilityQ16: number;
  predictionCount: number;
  byteLength: number;
}

const Q16_MAX = 65_535;
const MKN_MAGIC = new TextEncoder().encode('JLMKN2\0\0');
const TRIE_NODE_ESTIMATED_BYTES = 18;
const TRIE_PREDICTION_BYTES = 10;

export function trainModifiedKneserNey(options: {
  sequences: readonly (readonly number[])[];
  vocabularySize: number;
  maxOrder?: number;
}): MknModel {
  const maxOrder = options.maxOrder ?? 5;
  if (!Number.isSafeInteger(maxOrder) || maxOrder < 2 || maxOrder > 5) {
    throw new Error('Modified Kneser-Ney order must be between 2 and 5.');
  }
  if (!Number.isSafeInteger(options.vocabularySize) || options.vocabularySize < 1) {
    throw new Error('MKN vocabulary size must be positive.');
  }
  const countsByOrder = new Map<number, Map<string, number>>();
  for (let order = 1; order <= maxOrder; order += 1) countsByOrder.set(order, new Map());
  for (const sequence of options.sequences) {
    const bounded = sequence.filter(
      (token) => Number.isSafeInteger(token) && token >= 0 && token < options.vocabularySize,
    );
    for (let order = 1; order <= maxOrder; order += 1) {
      const counts = countsByOrder.get(order)!;
      for (let start = 0; start + order <= bounded.length; start += 1) {
        const key = bounded.slice(start, start + order).join(',');
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
  }

  const effectiveCountsByOrder = new Map<number, Map<string, number>>();
  effectiveCountsByOrder.set(maxOrder, countsByOrder.get(maxOrder)!);
  for (let order = maxOrder - 1; order >= 2; order -= 1) {
    effectiveCountsByOrder.set(
      order,
      calculateContinuationCounts(countsByOrder.get(order + 1)!, order),
    );
  }

  const discounts: Record<string, MknDiscounts> = {};
  for (let order = 2; order <= maxOrder; order += 1) {
    discounts[String(order)] = estimateDiscounts(effectiveCountsByOrder.get(order)!);
  }
  const unigramQ16 = calculateContinuationUnigrams(
    countsByOrder.get(1)!,
    countsByOrder.get(2)!,
    options.vocabularySize,
  ).map(quantizeProbability);

  const predictions: MknPredictionRecord[] = [];
  const backoffs: MknBackoffRecord[] = [];
  for (let order = 2; order <= maxOrder; order += 1) {
    const discount = discounts[String(order)]!;
    const contexts = groupByContext(effectiveCountsByOrder.get(order)!);
    for (const [contextKey, continuations] of [...contexts.entries()].sort(([left], [right]) =>
      compareStrings(left, right),
    )) {
      const context = parseKey(contextKey);
      const total = [...continuations.values()].reduce((sum, count) => sum + count, 0);
      let discountedMass = 0;
      for (const [token, count] of [...continuations.entries()].sort(
        (left, right) => left[0] - right[0],
      )) {
        const usedDiscount = discountForCount(discount, count);
        discountedMass += usedDiscount;
        const probabilityQ16 = quantizeProbability(Math.max(0, count - usedDiscount) / total);
        if (probabilityQ16 > 0) {
          predictions.push({ order, context, token, count, probabilityQ16 });
        }
      }
      backoffs.push({
        order,
        context,
        weightQ16: quantizeProbability(Math.min(1, discountedMass / total)),
      });
    }
  }

  return {
    schema: 'jotluck.autocomplete.v2s-mkn.v1',
    vocabularySize: options.vocabularySize,
    maxOrder,
    discounts,
    unigramQ16,
    predictions,
    backoffs,
  };
}

export function pruneMknToNestedBudgets(
  model: MknModel,
  budgets: readonly number[],
): PrunedMknVariant[] {
  const uniqueBudgets = [...new Set(budgets)].sort((left, right) => left - right);
  if (uniqueBudgets.some((budget) => !Number.isSafeInteger(budget) || budget < 1)) {
    throw new Error('MKN budgets must be positive safe integers.');
  }
  const mandatory: MknModel = { ...model, predictions: [], backoffs: [] };
  if (encodeMknModel(mandatory).byteLength > (uniqueBudgets[0] ?? 0)) {
    throw new Error('Smallest MKN budget cannot fit the mandatory unigram table.');
  }
  const candidates = rankPredictionsByRelativeEntropy(model);
  const backoffByContext = new Map(
    model.backoffs.map((backoff) => [contextIdentity(backoff.order, backoff.context), backoff]),
  );
  const selectedPredictions: MknPredictionRecord[] = [];
  const selectedBackoffs = new Map<string, MknBackoffRecord>();
  const selectedContextNodes = new Set<string>(['']);
  const variants: PrunedMknVariant[] = [];

  for (const budgetBytes of uniqueBudgets) {
    for (const candidate of candidates) {
      if (candidate.selected) continue;
      const prediction = candidate.ranked.prediction;
      const identity = contextIdentity(prediction.order, prediction.context);
      const missingPrefixes = contextPrefixes(prediction.context).filter(
        (prefix) => !selectedContextNodes.has(prefix),
      );
      const proposedBytes = calculateMknLayout(
        model.vocabularySize,
        selectedContextNodes.size + missingPrefixes.length,
        selectedPredictions.length + 1,
      ).byteLength;
      if (proposedBytes > budgetBytes) continue;
      selectedPredictions.push(prediction);
      const backoff = backoffByContext.get(identity) ?? {
        order: prediction.order,
        context: prediction.context,
        weightQ16: Q16_MAX,
      };
      selectedBackoffs.set(identity, backoff);
      for (const prefix of missingPrefixes) selectedContextNodes.add(prefix);
      candidate.selected = true;
    }
    const variantModel: MknModel = {
      ...model,
      predictions: [...selectedPredictions].sort(comparePredictionStorage),
      backoffs: renormalizeSelectedBackoffs(selectedPredictions, selectedBackoffs),
    };
    const encoded = encodeMknModel(variantModel);
    if (encoded.byteLength > budgetBytes) {
      throw new Error('MKN exact encoding exceeded its pruning budget.');
    }
    variants.push({ budgetBytes, encoded, model: variantModel });
  }
  return variants;
}

export function encodeMknModel(model: MknModel): Uint8Array {
  const trie = buildMknTrie(model);
  const layout = calculateMknLayout(
    model.vocabularySize,
    trie.nodes.length,
    trie.predictions.length,
  );
  const output = new Uint8Array(layout.byteLength);
  const view = new DataView(output.buffer);
  output.set(MKN_MAGIC, 0);
  view.setUint8(8, model.maxOrder);
  view.setUint32(12, model.vocabularySize, true);
  view.setUint32(16, trie.nodes.length, true);
  view.setUint32(20, trie.predictions.length, true);
  model.unigramQ16.forEach((probability, token) =>
    view.setUint16(layout.unigram + token * 2, probability, true),
  );
  trie.nodes.forEach((node, index) => {
    view.setUint32(layout.nodeToken + index * 4, node.token, true);
    view.setUint32(layout.nodeFirstChild + index * 4, node.firstChild, true);
    view.setUint16(layout.nodeChildCount + index * 2, node.children.size, true);
    view.setUint32(layout.nodeFirstPrediction + index * 4, node.firstPrediction, true);
    view.setUint16(layout.nodePredictionCount + index * 2, node.predictions.length, true);
    view.setUint16(layout.nodeBackoffQ16 + index * 2, node.backoffQ16, true);
  });
  trie.predictions.forEach((prediction, index) => {
    view.setUint32(layout.predictionToken + index * 4, prediction.token, true);
    view.setUint16(layout.predictionProbabilityQ16 + index * 2, prediction.probabilityQ16, true);
    view.setUint32(layout.predictionCount + index * 4, prediction.count, true);
  });
  return output;
}

export function encodedMknByteLength(model: MknModel): number {
  const trie = buildMknTrie(model);
  return calculateMknLayout(model.vocabularySize, trie.nodes.length, trie.predictions.length)
    .byteLength;
}

function estimateDiscounts(counts: Map<string, number>): MknDiscounts {
  let n1 = 0;
  let n2 = 0;
  let n3 = 0;
  let n4 = 0;
  for (const count of counts.values()) {
    if (count === 1) n1 += 1;
    else if (count === 2) n2 += 1;
    else if (count === 3) n3 += 1;
    else if (count === 4) n4 += 1;
  }
  if (n1 === 0 || n2 === 0) return { d1: 0.75, d2: 1, d3Plus: 1.25 };
  const y = n1 / (n1 + 2 * n2);
  const d1 = clampDiscount(1 - (2 * y * n2) / n1, 0.1, 0.99);
  const d2 = n3 > 0 ? clampDiscount(2 - (3 * y * n3) / n2, 0.1, 1.99) : 1;
  const d3Plus = n3 > 0 && n4 > 0 ? clampDiscount(3 - (4 * y * n4) / n3, 0.1, 2.99) : 1.25;
  return { d1, d2, d3Plus };
}

function calculateContinuationUnigrams(
  unigrams: Map<string, number>,
  bigrams: Map<string, number>,
  vocabularySize: number,
): number[] {
  const leftContexts = new Map<number, Set<number>>();
  for (const key of bigrams.keys()) {
    const [left, token] = parseKey(key);
    const set = leftContexts.get(token!);
    if (set) set.add(left!);
    else leftContexts.set(token!, new Set([left!]));
  }
  const continuationTotal = [...leftContexts.values()].reduce((sum, set) => sum + set.size, 0);
  const frequencyTotal = [...unigrams.values()].reduce((sum, count) => sum + count, 0);
  const output = new Array<number>(vocabularySize).fill(0);
  for (let token = 0; token < vocabularySize; token += 1) {
    output[token] =
      continuationTotal > 0
        ? (leftContexts.get(token)?.size ?? 0) / continuationTotal
        : (unigrams.get(String(token)) ?? 0) / Math.max(1, frequencyTotal);
  }
  return output;
}

function calculateContinuationCounts(
  higherOrderCounts: Map<string, number>,
  targetOrder: number,
): Map<string, number> {
  const leftContexts = new Map<string, Set<number>>();
  for (const key of higherOrderCounts.keys()) {
    const tokens = parseKey(key);
    if (tokens.length !== targetOrder + 1) continue;
    const left = tokens.shift()!;
    const suffix = tokens.join(',');
    const values = leftContexts.get(suffix) ?? new Set<number>();
    values.add(left);
    leftContexts.set(suffix, values);
  }
  return new Map([...leftContexts.entries()].map(([key, values]) => [key, values.size]));
}

function groupByContext(counts: Map<string, number>): Map<string, Map<number, number>> {
  const contexts = new Map<string, Map<number, number>>();
  for (const [key, count] of counts) {
    const tokens = parseKey(key);
    const token = tokens.pop()!;
    const contextKey = tokens.join(',');
    const continuations = contexts.get(contextKey) ?? new Map<number, number>();
    continuations.set(token, count);
    contexts.set(contextKey, continuations);
  }
  return contexts;
}

function quantizeProbability(value: number): number {
  if (!Number.isFinite(value)) throw new Error('Cannot quantize a non-finite probability.');
  return Math.max(0, Math.min(Q16_MAX, Math.round(value * Q16_MAX)));
}

function discountForCount(discounts: MknDiscounts, count: number): number {
  return count === 1 ? discounts.d1 : count === 2 ? discounts.d2 : discounts.d3Plus;
}

function clampDiscount(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function parseKey(key: string): number[] {
  return key.length === 0 ? [] : key.split(',').map(Number);
}

function contextIdentity(order: number, context: readonly number[]): string {
  return `${order}:${context.join(',')}`;
}

function contextPrefixes(context: readonly number[]): string[] {
  const output: string[] = [];
  for (let length = 1; length <= context.length; length += 1) {
    output.push(context.slice(0, length).join(','));
  }
  return output;
}

function rankPredictionsByRelativeEntropy(
  model: MknModel,
): Array<{ ranked: RankedPrediction; selected: boolean }> {
  const predictionsByContext = new Map<string, Map<number, MknPredictionRecord>>();
  const usesByContextPrefix = new Map<string, number>();
  for (const prediction of model.predictions) {
    const identity = contextIdentity(prediction.order, prediction.context);
    const continuations = predictionsByContext.get(identity) ?? new Map();
    continuations.set(prediction.token, prediction);
    predictionsByContext.set(identity, continuations);
    for (const prefix of contextPrefixes(prediction.context)) {
      usesByContextPrefix.set(prefix, (usesByContextPrefix.get(prefix) ?? 0) + 1);
    }
  }
  const backoffByContext = new Map(
    model.backoffs.map((backoff) => [contextIdentity(backoff.order, backoff.context), backoff]),
  );
  return model.predictions
    .map((prediction) => {
      const identity = contextIdentity(prediction.order, prediction.context);
      const backoff = backoffByContext.get(identity);
      const lowerProbabilityQ16 = scoreLowerOrderQ16(
        model,
        prediction,
        predictionsByContext,
        backoffByContext,
      );
      const backedOffProbabilityQ16 = multiplyQ16(
        backoff?.weightQ16 ?? Q16_MAX,
        lowerProbabilityQ16,
      );
      const fullProbabilityQ16 = Math.min(
        Q16_MAX,
        prediction.probabilityQ16 + backedOffProbabilityQ16,
      );
      // The Q16 floor makes unseen lower-order events finite without allowing a
      // zero-probability record to dominate the model. Quantising the relative
      // entropy before sorting keeps pruning deterministic across runs.
      const informationGain =
        prediction.count *
        Math.log2(Math.max(1, fullProbabilityQ16) / Math.max(1, backedOffProbabilityQ16));
      const informationGainQ = Math.max(0, Math.round(informationGain * 1_000_000));
      const amortizedTrieBytes = contextPrefixes(prediction.context).reduce(
        (sum, prefix) =>
          sum + TRIE_NODE_ESTIMATED_BYTES / Math.max(1, usesByContextPrefix.get(prefix) ?? 1),
        0,
      );
      const estimatedBytes = TRIE_PREDICTION_BYTES + amortizedTrieBytes;
      const informationGainPerByteQ = Math.max(
        0,
        Math.round((informationGain / Math.max(1, estimatedBytes)) * 1_000_000),
      );
      return {
        ranked: { prediction, informationGainQ, informationGainPerByteQ },
        selected: false,
      };
    })
    .sort((left, right) => compareRankedPrediction(left.ranked, right.ranked));
}

function renormalizeSelectedBackoffs(
  predictions: readonly MknPredictionRecord[],
  selectedBackoffs: ReadonlyMap<string, MknBackoffRecord>,
): MknBackoffRecord[] {
  const localMassByContext = new Map<string, number>();
  for (const prediction of predictions) {
    const identity = contextIdentity(prediction.order, prediction.context);
    localMassByContext.set(
      identity,
      (localMassByContext.get(identity) ?? 0) + prediction.probabilityQ16,
    );
  }
  return [...selectedBackoffs.entries()]
    .map(([identity, backoff]) => ({
      ...backoff,
      weightQ16: Math.max(0, Q16_MAX - Math.min(Q16_MAX, localMassByContext.get(identity) ?? 0)),
    }))
    .sort(compareBackoffStorage);
}

function buildMknTrie(model: MknModel): {
  nodes: MutableTrieNode[];
  predictions: MknPredictionRecord[];
} {
  if (
    model.maxOrder < 2 ||
    model.maxOrder > 5 ||
    model.vocabularySize < 1 ||
    model.unigramQ16.length !== model.vocabularySize ||
    model.unigramQ16.some((value) => !Number.isInteger(value) || value < 0 || value > Q16_MAX)
  ) {
    throw new Error('MKN model identity is invalid for trie encoding.');
  }
  const createNode = (token: number): MutableTrieNode => ({
    token,
    children: new Map(),
    predictions: [],
    backoffQ16: Q16_MAX,
    index: -1,
    firstChild: 0,
    firstPrediction: 0,
  });
  const root = createNode(0xffffffff);
  root.index = 0;
  const ensureContext = (context: readonly number[]) => {
    let node = root;
    for (const token of context) {
      if (!Number.isSafeInteger(token) || token < 0 || token >= model.vocabularySize) {
        throw new Error('MKN trie context token is out of range.');
      }
      const child = node.children.get(token) ?? createNode(token);
      node.children.set(token, child);
      node = child;
    }
    return node;
  };
  for (const backoff of model.backoffs) {
    if (
      backoff.order < 2 ||
      backoff.order > model.maxOrder ||
      backoff.context.length !== backoff.order - 1 ||
      !Number.isInteger(backoff.weightQ16) ||
      backoff.weightQ16 < 0 ||
      backoff.weightQ16 > Q16_MAX
    ) {
      throw new Error('MKN trie backoff payload is invalid.');
    }
    ensureContext(backoff.context).backoffQ16 = backoff.weightQ16;
  }
  for (const prediction of model.predictions) {
    if (
      prediction.order < 2 ||
      prediction.order > model.maxOrder ||
      prediction.context.length !== prediction.order - 1 ||
      !Number.isSafeInteger(prediction.token) ||
      prediction.token < 0 ||
      prediction.token >= model.vocabularySize ||
      !Number.isSafeInteger(prediction.count) ||
      prediction.count < 1 ||
      !Number.isInteger(prediction.probabilityQ16) ||
      prediction.probabilityQ16 < 1 ||
      prediction.probabilityQ16 > Q16_MAX
    ) {
      throw new Error('MKN trie prediction payload is invalid.');
    }
    ensureContext(prediction.context).predictions.push(prediction);
  }
  const nodes = [root];
  const assignChildren = (node: MutableTrieNode) => {
    const children = [...node.children.values()].sort((left, right) => left.token - right.token);
    if (children.length > 0xffff) throw new Error('MKN trie node has too many children.');
    node.firstChild = children.length === 0 ? 0 : nodes.length;
    for (const child of children) {
      child.index = nodes.length;
      nodes.push(child);
    }
    for (const child of children) assignChildren(child);
  };
  assignChildren(root);
  const predictions: MknPredictionRecord[] = [];
  for (const node of nodes) {
    node.predictions.sort((left, right) => left.token - right.token);
    if (node.predictions.length > 0xffff) {
      throw new Error('MKN trie node has too many predictions.');
    }
    for (let index = 1; index < node.predictions.length; index += 1) {
      if (node.predictions[index - 1]!.token === node.predictions[index]!.token) {
        throw new Error('MKN trie contains a duplicate prediction.');
      }
    }
    node.firstPrediction = node.predictions.length === 0 ? 0 : predictions.length;
    predictions.push(...node.predictions);
  }
  if (nodes.length > 0xffffffff || predictions.length > 0xffffffff) {
    throw new Error('MKN trie exceeds its 32-bit index space.');
  }
  return { nodes, predictions };
}

function calculateMknLayout(
  vocabularySize: number,
  nodeCount: number,
  predictionCount: number,
): MknBinaryLayout {
  let offset = 24;
  const take = (elements: number, bytesPerElement: number) => {
    const start = offset;
    offset += elements * bytesPerElement;
    if (!Number.isSafeInteger(offset)) throw new Error('MKN binary layout overflows.');
    return start;
  };
  const align4 = () => {
    offset = Math.ceil(offset / 4) * 4;
  };
  const unigram = take(vocabularySize, 2);
  align4();
  const nodeToken = take(nodeCount, 4);
  const nodeFirstChild = take(nodeCount, 4);
  const nodeChildCount = take(nodeCount, 2);
  align4();
  const nodeFirstPrediction = take(nodeCount, 4);
  const nodePredictionCount = take(nodeCount, 2);
  const nodeBackoffQ16 = take(nodeCount, 2);
  const predictionToken = take(predictionCount, 4);
  const predictionProbabilityQ16 = take(predictionCount, 2);
  align4();
  const storedPredictionCount = take(predictionCount, 4);
  return {
    unigram,
    nodeToken,
    nodeFirstChild,
    nodeChildCount,
    nodeFirstPrediction,
    nodePredictionCount,
    nodeBackoffQ16,
    predictionToken,
    predictionProbabilityQ16,
    predictionCount: storedPredictionCount,
    byteLength: offset,
  };
}

function scoreLowerOrderQ16(
  model: MknModel,
  prediction: MknPredictionRecord,
  predictionsByContext: ReadonlyMap<string, ReadonlyMap<number, MknPredictionRecord>>,
  backoffByContext: ReadonlyMap<string, MknBackoffRecord>,
): number {
  let probabilityQ16 = model.unigramQ16[prediction.token] ?? 0;
  for (let order = 2; order < prediction.order; order += 1) {
    const context = prediction.context.slice(-(order - 1));
    const identity = contextIdentity(order, context);
    const localPredictions = predictionsByContext.get(identity);
    const backoff = backoffByContext.get(identity);
    if (!localPredictions && !backoff) continue;
    const localProbabilityQ16 = localPredictions?.get(prediction.token)?.probabilityQ16 ?? 0;
    probabilityQ16 = Math.min(
      Q16_MAX,
      localProbabilityQ16 + multiplyQ16(backoff?.weightQ16 ?? Q16_MAX, probabilityQ16),
    );
  }
  return probabilityQ16;
}

function multiplyQ16(left: number, right: number): number {
  return Math.round((left * right) / Q16_MAX);
}

function compareRankedPrediction(left: RankedPrediction, right: RankedPrediction): number {
  return (
    right.informationGainPerByteQ - left.informationGainPerByteQ ||
    right.informationGainQ - left.informationGainQ ||
    right.prediction.count - left.prediction.count ||
    right.prediction.probabilityQ16 - left.prediction.probabilityQ16 ||
    comparePredictionStorage(left.prediction, right.prediction)
  );
}

function comparePredictionStorage(left: MknPredictionRecord, right: MknPredictionRecord): number {
  return (
    left.order - right.order ||
    compareStrings(left.context.join(','), right.context.join(',')) ||
    left.token - right.token
  );
}

function compareBackoffStorage(left: MknBackoffRecord, right: MknBackoffRecord): number {
  return (
    left.order - right.order || compareStrings(left.context.join(','), right.context.join(','))
  );
}
