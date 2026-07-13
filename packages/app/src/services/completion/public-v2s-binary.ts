import {
  PUBLIC_ENGINE_CONTEXT_MAX_UTF8_BYTES,
  PUBLIC_ENGINE_MAX_OUTPUT_CODE_POINTS,
  type PublicEngineGenerateRequest,
  type PublicEngineRawCandidate,
} from './public-engine-types';

export const PUBLIC_V2S_ENGINE_ID = 'public-v2s-mkn-v1';
export const PUBLIC_V2S_MODEL_MAX_BYTES = 6 * 1024 * 1024;
export const PUBLIC_V2S_CONTAINER_SCHEMA = 'jotluck.autocomplete.public-container.v6';
export const PUBLIC_V2S_GATE_FEATURE_SCHEMA = 'v2s-gate-features-v1';
export const PUBLIC_V2S_GATE_FEATURE_COUNT = 10;

const CONTAINER_MAGIC = new TextEncoder().encode('JLV2S6\0\0');
const MKN_MAGIC = new TextEncoder().encode('JLMKN2\0\0');
const REQUIRED_SECTIONS = [
  'tokenizer.zh',
  'tokenizer.en',
  'lm.zh',
  'lm.en',
  'gate',
  'metadata',
] as const;
const SPECIAL_TOKENS = ['<unk>', '<bos>', '<eos>', '<abstain>'] as const;
const EOS_TOKEN = 2;
const ABSTAIN_TOKEN = 3;
const Q16_MAX = 65_535;
const MAX_HEADER_BYTES = 256 * 1024;
const BEAM_WIDTH = 16;
const BRANCH_WIDTH = 8;
const MAX_GENERATED_TOKENS = 12;

type V2SLanguage = 'zh' | 'en';

interface ContainerSectionDescriptor {
  id: string;
  relativeOffset: number;
  bytes: number;
  sha256: string;
}

interface ContainerHeader {
  schema: typeof PUBLIC_V2S_CONTAINER_SCHEMA;
  schemaVersion: 6;
  engine: typeof PUBLIC_V2S_ENGINE_ID;
  sections: ContainerSectionDescriptor[];
  payloadBytes: number;
}

interface TokenizerModel {
  schema: 'jotluck.autocomplete.v2s-tokenizer.v1';
  kind: 'bpe' | 'unigram';
  language: V2SLanguage;
  vocabulary: string[];
  merges: Array<[string, string]>;
  scores: number[];
  maxPieceCodePoints: number;
  tokenByPiece: Map<string, number>;
}

interface MknRuntime {
  vocabularySize: number;
  maxOrder: number;
  unigramQ16: Uint16Array;
  nodeToken: Uint32Array;
  nodeFirstChild: Uint32Array;
  nodeChildCount: Uint16Array;
  nodeFirstPrediction: Uint32Array;
  nodePredictionCount: Uint16Array;
  nodeBackoffQ16: Uint16Array;
  predictionToken: Uint32Array;
  predictionProbabilityQ16: Uint16Array;
  predictionCount: Uint32Array;
  topUnigramTokens: number[];
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

interface G0Gate {
  schema: 'jotluck.autocomplete.v2s-gate.v1';
  kind: 'g0-rules';
  featureSchema: typeof PUBLIC_V2S_GATE_FEATURE_SCHEMA;
  featureCount: typeof PUBLIC_V2S_GATE_FEATURE_COUNT;
  weightScale: number;
  ruleWeightsQ16: number[];
  biasScale: number;
  biasQ16: number;
  showThresholdQ16: number;
}

interface G1Gate {
  schema: 'jotluck.autocomplete.v2s-gate.v1';
  kind: 'g1-mlp16-int8';
  featureSchema: typeof PUBLIC_V2S_GATE_FEATURE_SCHEMA;
  featureCount: typeof PUBLIC_V2S_GATE_FEATURE_COUNT;
  hiddenSize: 16;
  inputScale: number;
  inputWeightsQ8: number[];
  hiddenBiasScale: number;
  hiddenBiasQ16: number[];
  outputScale: number;
  outputWeightsQ8: number[];
  outputBiasScale: number;
  outputBiasQ16: number;
  showThresholdQ16: number;
}

type GateModel = G0Gate | G1Gate;

interface StoredMetadata {
  schema: 'jotluck.autocomplete.v2s-runtime-metadata.v1';
  engine: typeof PUBLIC_V2S_ENGINE_ID;
  candidateId: string;
  maxOrder: number;
  providerId: typeof PUBLIC_V2S_ENGINE_ID;
  source: 'public-v2s';
  sourceLayer: 'l3';
}

export interface PublicV2sModelMetadata extends StoredMetadata {
  schemaVersion: 6;
  byteLength: number;
  maxOutputCodePoints: number;
  containerHeaderSha256: string;
  gateFeatureSchema: typeof PUBLIC_V2S_GATE_FEATURE_SCHEMA;
  gateKind: GateModel['kind'];
}

interface ScoredToken {
  token: number;
  probability: number;
  matchedOrder: number;
}

interface BeamState {
  generated: number[];
  logProbability: number;
  matchedOrder: number;
}

interface GeneratedCandidate {
  text: string;
  modelScore: number;
  matchedOrder: number;
}

export interface PublicV2sRuntimeModel {
  readonly metadata: PublicV2sModelMetadata;
  generate(request: PublicEngineGenerateRequest): PublicEngineRawCandidate[];
  /** Evaluation-only observation seam; never exposed by the Worker protocol. */
  generateUngatedForEvaluation(request: PublicEngineGenerateRequest): PublicEngineRawCandidate[];
  observeForGateTraining(request: PublicEngineGenerateRequest): {
    candidates: PublicEngineRawCandidate[];
    gateFeatures: number[] | null;
  };
}

class ParsedPublicV2sModel implements PublicV2sRuntimeModel {
  constructor(
    readonly metadata: PublicV2sModelMetadata,
    private readonly tokenizers: Record<V2SLanguage, TokenizerModel>,
    private readonly languageModels: Record<V2SLanguage, MknRuntime>,
    private readonly gate: GateModel,
  ) {}

  generate(request: PublicEngineGenerateRequest): PublicEngineRawCandidate[] {
    const observation = this.observeForGateTraining(request);
    const gateScore = observation.candidates[0]?.gateScore;
    return gateScore !== undefined && gateScore * Q16_MAX >= this.gate.showThresholdQ16
      ? observation.candidates
      : [];
  }

  generateUngatedForEvaluation(request: PublicEngineGenerateRequest): PublicEngineRawCandidate[] {
    return this.observeForGateTraining(request).candidates;
  }

  observeForGateTraining(request: PublicEngineGenerateRequest): {
    candidates: PublicEngineRawCandidate[];
    gateFeatures: number[] | null;
  } {
    if (
      (request.languageHint !== 'zh' && request.languageHint !== 'en') ||
      !isSupportedBlock(request.blockType) ||
      request.cursorBoundary === 'other' ||
      request.maxCandidates < 1
    ) {
      return { candidates: [], gateFeatures: null };
    }
    const language = request.languageHint;
    const tokenizer = this.tokenizers[language];
    const languageModel = this.languageModels[language];
    const tokenizerInput =
      request.contextTailUtf8Bytes >= PUBLIC_ENGINE_CONTEXT_MAX_UTF8_BYTES
        ? discardPotentiallyPartialLeadingSegment(request.contextTail)
        : request.contextTail;
    const contextTokens = encodeWithTokenizer(tokenizer, tokenizerInput);
    const generated = generateCandidates(
      tokenizer,
      languageModel,
      contextTokens,
      language,
      request,
    );
    if (generated.length === 0) return { candidates: [], gateFeatures: null };

    const top = generated[0]!;
    const secondScore = generated[1]?.modelScore ?? 0;
    const features = buildGateFeatures({
      top1Probability: top.modelScore,
      top1MinusTop2: Math.max(0, top.modelScore - secondScore),
      matchedOrder: top.matchedOrder,
      contextTokenCount: contextTokens.length,
      candidateCodePoints: codePointLength(top.text),
      maxOutputCodePoints: this.metadata.maxOutputCodePoints,
      cursorBoundary: request.cursorBoundary,
      language,
    });
    const gateScore = evaluateGate(this.gate, features);
    return {
      candidates: generated.slice(0, request.maxCandidates).map((candidate) => ({
        candidateId: `${this.metadata.candidateId}:${language}:${stableTextHash(candidate.text)}`,
        text: candidate.text,
        modelScore: candidate.modelScore,
        gateScore,
        confidence: clamp01(candidate.modelScore * 0.65 + gateScore * 0.35),
        language,
      })),
      gateFeatures: features,
    };
  }
}

export async function parsePublicV2sModel(
  binary: ArrayBuffer | Uint8Array,
  expectedHeaderSha256?: string,
): Promise<PublicV2sRuntimeModel> {
  const bytes = toBytes(binary);
  if (bytes.byteLength < CONTAINER_MAGIC.byteLength + 4) {
    throw new Error('Public V2S container is truncated.');
  }
  if (bytes.byteLength > PUBLIC_V2S_MODEL_MAX_BYTES) {
    throw new Error('Public V2S container exceeds the 6 MiB limit.');
  }
  assertMagic(bytes, CONTAINER_MAGIC, 'Public V2S container');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const headerLength = view.getUint32(CONTAINER_MAGIC.byteLength, true);
  if (headerLength < 2 || headerLength > MAX_HEADER_BYTES) {
    throw new Error('Public V2S header length is invalid.');
  }
  const headerOffset = CONTAINER_MAGIC.byteLength + 4;
  const payloadOffset = headerOffset + headerLength;
  if (payloadOffset > bytes.byteLength) throw new Error('Public V2S header is truncated.');
  const headerBytes = bytes.slice(headerOffset, payloadOffset);
  const headerSha256 = await sha256Hex(headerBytes);
  if (expectedHeaderSha256 !== undefined && headerSha256 !== expectedHeaderSha256) {
    throw new Error('Public V2S container header SHA-256 mismatch.');
  }
  const header = parseContainerHeader(parseJson(headerBytes, 'container header'));
  if (payloadOffset + header.payloadBytes !== bytes.byteLength) {
    throw new Error('Public V2S payload length is invalid.');
  }

  const sections = new Map<string, Uint8Array>();
  let expectedRelativeOffset = 0;
  for (let index = 0; index < header.sections.length; index += 1) {
    const descriptor = header.sections[index]!;
    if (
      descriptor.id !== REQUIRED_SECTIONS[index] ||
      descriptor.relativeOffset !== expectedRelativeOffset
    ) {
      throw new Error('Public V2S sections are missing, reordered or non-contiguous.');
    }
    const start = payloadOffset + descriptor.relativeOffset;
    const end = start + descriptor.bytes;
    if (end > bytes.byteLength)
      throw new Error(`Public V2S section ${descriptor.id} is truncated.`);
    const section = bytes.slice(start, end);
    if ((await sha256Hex(section)) !== descriptor.sha256) {
      throw new Error(`Public V2S section ${descriptor.id} failed SHA-256 verification.`);
    }
    sections.set(descriptor.id, section);
    expectedRelativeOffset += descriptor.bytes;
  }
  if (expectedRelativeOffset !== header.payloadBytes) {
    throw new Error('Public V2S section byte totals do not match the payload.');
  }

  const tokenizerZh = parseTokenizer(requireSection(sections, 'tokenizer.zh'), 'zh');
  const tokenizerEn = parseTokenizer(requireSection(sections, 'tokenizer.en'), 'en');
  const lmZh = parseMkn(requireSection(sections, 'lm.zh'), tokenizerZh.vocabulary.length);
  const lmEn = parseMkn(requireSection(sections, 'lm.en'), tokenizerEn.vocabulary.length);
  const gate = parseGate(requireSection(sections, 'gate'));
  const storedMetadata = parseStoredMetadata(requireSection(sections, 'metadata'));
  if (storedMetadata.maxOrder !== lmZh.maxOrder || storedMetadata.maxOrder !== lmEn.maxOrder) {
    throw new Error('Public V2S metadata and language-model orders disagree.');
  }
  const metadata: PublicV2sModelMetadata = {
    ...storedMetadata,
    schemaVersion: 6,
    byteLength: bytes.byteLength,
    maxOutputCodePoints: PUBLIC_ENGINE_MAX_OUTPUT_CODE_POINTS,
    containerHeaderSha256: headerSha256,
    gateFeatureSchema: gate.featureSchema,
    gateKind: gate.kind,
  };
  return new ParsedPublicV2sModel(
    metadata,
    { zh: tokenizerZh, en: tokenizerEn },
    { zh: lmZh, en: lmEn },
    gate,
  );
}

function parseContainerHeader(value: unknown): ContainerHeader {
  const header = asRecord(value, 'Public V2S container header');
  if (
    header.schema !== PUBLIC_V2S_CONTAINER_SCHEMA ||
    header.schemaVersion !== 6 ||
    header.engine !== PUBLIC_V2S_ENGINE_ID ||
    !Array.isArray(header.sections) ||
    header.sections.length !== REQUIRED_SECTIONS.length ||
    !isSafeIntegerInRange(header.payloadBytes, 1, PUBLIC_V2S_MODEL_MAX_BYTES)
  ) {
    throw new Error('Public V2S container header schema is invalid.');
  }
  const sections = header.sections.map((entry) => {
    const section = asRecord(entry, 'Public V2S section descriptor');
    if (
      typeof section.id !== 'string' ||
      !isSafeIntegerInRange(section.relativeOffset, 0, PUBLIC_V2S_MODEL_MAX_BYTES) ||
      !isSafeIntegerInRange(section.bytes, 1, PUBLIC_V2S_MODEL_MAX_BYTES) ||
      typeof section.sha256 !== 'string' ||
      !isSha256(section.sha256)
    ) {
      throw new Error('Public V2S section descriptor is invalid.');
    }
    return {
      id: section.id,
      relativeOffset: section.relativeOffset,
      bytes: section.bytes,
      sha256: section.sha256,
    };
  });
  return {
    schema: PUBLIC_V2S_CONTAINER_SCHEMA,
    schemaVersion: 6,
    engine: PUBLIC_V2S_ENGINE_ID,
    sections,
    payloadBytes: header.payloadBytes,
  };
}

function parseTokenizer(bytes: Uint8Array, language: V2SLanguage): TokenizerModel {
  const value = asRecord(parseJson(bytes, `${language} tokenizer`), 'Public V2S tokenizer');
  if (
    value.schema !== 'jotluck.autocomplete.v2s-tokenizer.v1' ||
    (value.kind !== 'bpe' && value.kind !== 'unigram') ||
    value.language !== language ||
    !Array.isArray(value.vocabulary) ||
    value.vocabulary.length < SPECIAL_TOKENS.length + 1 ||
    value.vocabulary.length > 4096 ||
    !Array.isArray(value.merges) ||
    !Array.isArray(value.scores) ||
    value.scores.length !== value.vocabulary.length ||
    !isSafeIntegerInRange(value.maxPieceCodePoints, 1, 16)
  ) {
    throw new Error(`Public V2S ${language} tokenizer schema is invalid.`);
  }
  const vocabulary = value.vocabulary.map((piece) => {
    if (typeof piece !== 'string' || piece.length === 0 || /[\r\0]/u.test(piece)) {
      throw new Error(`Public V2S ${language} tokenizer contains an invalid piece.`);
    }
    return piece;
  });
  if (new Set(vocabulary).size !== vocabulary.length) {
    throw new Error(`Public V2S ${language} tokenizer contains duplicate pieces.`);
  }
  for (let index = 0; index < SPECIAL_TOKENS.length; index += 1) {
    if (vocabulary[index] !== SPECIAL_TOKENS[index]) {
      throw new Error(`Public V2S ${language} tokenizer special-token order is invalid.`);
    }
  }
  const scores = value.scores.map((score) => {
    if (typeof score !== 'number' || !Number.isFinite(score)) {
      throw new Error(`Public V2S ${language} tokenizer contains an invalid score.`);
    }
    return score;
  });
  const merges = value.merges.map((merge) => {
    if (
      !Array.isArray(merge) ||
      merge.length !== 2 ||
      typeof merge[0] !== 'string' ||
      typeof merge[1] !== 'string' ||
      merge[0].length === 0 ||
      merge[1].length === 0
    ) {
      throw new Error(`Public V2S ${language} tokenizer contains an invalid merge.`);
    }
    return [merge[0], merge[1]] as [string, string];
  });
  if (value.kind === 'unigram' && merges.length !== 0) {
    throw new Error('Public V2S unigram tokenizer must not contain BPE merges.');
  }
  return {
    schema: 'jotluck.autocomplete.v2s-tokenizer.v1',
    kind: value.kind,
    language,
    vocabulary,
    merges,
    scores,
    maxPieceCodePoints: value.maxPieceCodePoints,
    tokenByPiece: new Map(vocabulary.map((piece, index) => [piece, index])),
  };
}

function parseMkn(bytes: Uint8Array, expectedVocabularySize: number): MknRuntime {
  const minimumBytes = 24;
  if (bytes.byteLength < minimumBytes) throw new Error('Public V2S MKN section is truncated.');
  assertMagic(bytes, MKN_MAGIC, 'Public V2S MKN section');
  const storage = bytes.byteOffset % 4 === 0 ? bytes : bytes.slice();
  const view = new DataView(storage.buffer, storage.byteOffset, storage.byteLength);
  const maxOrder = view.getUint8(8);
  const vocabularySize = view.getUint32(12, true);
  const nodeCount = view.getUint32(16, true);
  const predictionCount = view.getUint32(20, true);
  if (
    maxOrder < 2 ||
    maxOrder > 5 ||
    vocabularySize !== expectedVocabularySize ||
    nodeCount < 1 ||
    view.getUint8(9) !== 0 ||
    view.getUint8(10) !== 0 ||
    view.getUint8(11) !== 0
  ) {
    throw new Error('Public V2S MKN identity is invalid.');
  }
  const layout = calculateMknLayout(vocabularySize, nodeCount, predictionCount);
  if (layout.byteLength !== storage.byteLength) {
    throw new Error('Public V2S MKN section length is invalid.');
  }
  const at = (offset: number) => storage.byteOffset + offset;
  const unigramQ16 = new Uint16Array(storage.buffer, at(layout.unigram), vocabularySize);
  const nodeToken = new Uint32Array(storage.buffer, at(layout.nodeToken), nodeCount);
  const nodeFirstChild = new Uint32Array(storage.buffer, at(layout.nodeFirstChild), nodeCount);
  const nodeChildCount = new Uint16Array(storage.buffer, at(layout.nodeChildCount), nodeCount);
  const nodeFirstPrediction = new Uint32Array(
    storage.buffer,
    at(layout.nodeFirstPrediction),
    nodeCount,
  );
  const nodePredictionCount = new Uint16Array(
    storage.buffer,
    at(layout.nodePredictionCount),
    nodeCount,
  );
  const nodeBackoffQ16 = new Uint16Array(storage.buffer, at(layout.nodeBackoffQ16), nodeCount);
  const predictionToken = new Uint32Array(
    storage.buffer,
    at(layout.predictionToken),
    predictionCount,
  );
  const predictionProbabilityQ16 = new Uint16Array(
    storage.buffer,
    at(layout.predictionProbabilityQ16),
    predictionCount,
  );
  const storedPredictionCount = new Uint32Array(
    storage.buffer,
    at(layout.predictionCount),
    predictionCount,
  );
  validateMknTrie({
    vocabularySize,
    maxOrder,
    unigramQ16,
    nodeToken,
    nodeFirstChild,
    nodeChildCount,
    nodeFirstPrediction,
    nodePredictionCount,
    nodeBackoffQ16,
    predictionToken,
    predictionProbabilityQ16,
    predictionCount: storedPredictionCount,
  });
  const topUnigramTokens = [...unigramQ16.keys()]
    .filter((token) => token >= SPECIAL_TOKENS.length && unigramQ16[token]! > 0)
    .sort((left, right) => unigramQ16[right]! - unigramQ16[left]! || left - right)
    .slice(0, 16);
  return {
    vocabularySize,
    maxOrder,
    unigramQ16,
    nodeToken,
    nodeFirstChild,
    nodeChildCount,
    nodeFirstPrediction,
    nodePredictionCount,
    nodeBackoffQ16,
    predictionToken,
    predictionProbabilityQ16,
    predictionCount: storedPredictionCount,
    topUnigramTokens,
  };
}

function parseGate(bytes: Uint8Array): GateModel {
  const value = asRecord(parseJson(bytes, 'gate'), 'Public V2S gate');
  if (
    value.schema !== 'jotluck.autocomplete.v2s-gate.v1' ||
    value.featureSchema !== PUBLIC_V2S_GATE_FEATURE_SCHEMA ||
    value.featureCount !== PUBLIC_V2S_GATE_FEATURE_COUNT ||
    !isQ16(value.showThresholdQ16)
  ) {
    throw new Error('Public V2S gate feature contract is invalid.');
  }
  if (value.kind === 'g0-rules') {
    const weightScale = parsePositiveFinite(value.weightScale, 'G0 weight scale');
    const biasScale = parsePositiveFinite(value.biasScale, 'G0 bias scale');
    const weights = parseIntegerArray(
      value.ruleWeightsQ16,
      PUBLIC_V2S_GATE_FEATURE_COUNT,
      -32_768,
      32_767,
      'G0 weights',
    );
    return {
      schema: 'jotluck.autocomplete.v2s-gate.v1',
      kind: 'g0-rules',
      featureSchema: PUBLIC_V2S_GATE_FEATURE_SCHEMA,
      featureCount: PUBLIC_V2S_GATE_FEATURE_COUNT,
      weightScale,
      ruleWeightsQ16: weights,
      biasScale,
      biasQ16: parseInteger(value.biasQ16, -32_768, 32_767, 'G0 bias'),
      showThresholdQ16: value.showThresholdQ16,
    };
  }
  if (value.kind !== 'g1-mlp16-int8' || value.hiddenSize !== 16) {
    throw new Error('Public V2S gate kind is unsupported.');
  }
  const inputScale = parsePositiveFinite(value.inputScale, 'G1 input scale');
  const hiddenBiasScale = parsePositiveFinite(value.hiddenBiasScale, 'G1 hidden bias scale');
  const outputScale = parsePositiveFinite(value.outputScale, 'G1 output scale');
  const outputBiasScale = parsePositiveFinite(value.outputBiasScale, 'G1 output bias scale');
  return {
    schema: 'jotluck.autocomplete.v2s-gate.v1',
    kind: 'g1-mlp16-int8',
    featureSchema: PUBLIC_V2S_GATE_FEATURE_SCHEMA,
    featureCount: PUBLIC_V2S_GATE_FEATURE_COUNT,
    hiddenSize: 16,
    inputScale,
    inputWeightsQ8: parseIntegerArray(
      value.inputWeightsQ8,
      16 * PUBLIC_V2S_GATE_FEATURE_COUNT,
      -128,
      127,
      'G1 input weights',
    ),
    hiddenBiasScale,
    hiddenBiasQ16: parseIntegerArray(value.hiddenBiasQ16, 16, -32_768, 32_767, 'G1 bias'),
    outputScale,
    outputWeightsQ8: parseIntegerArray(value.outputWeightsQ8, 16, -128, 127, 'G1 output'),
    outputBiasScale,
    outputBiasQ16: parseInteger(value.outputBiasQ16, -32_768, 32_767, 'G1 output bias'),
    showThresholdQ16: value.showThresholdQ16,
  };
}

function parseStoredMetadata(bytes: Uint8Array): StoredMetadata {
  const value = asRecord(parseJson(bytes, 'runtime metadata'), 'Public V2S runtime metadata');
  if (
    value.schema !== 'jotluck.autocomplete.v2s-runtime-metadata.v1' ||
    value.engine !== PUBLIC_V2S_ENGINE_ID ||
    typeof value.candidateId !== 'string' ||
    !/^[a-zA-Z0-9._-]{1,128}$/u.test(value.candidateId) ||
    !isSafeIntegerInRange(value.maxOrder, 2, 5) ||
    value.providerId !== PUBLIC_V2S_ENGINE_ID ||
    value.source !== 'public-v2s' ||
    value.sourceLayer !== 'l3'
  ) {
    throw new Error('Public V2S runtime metadata is invalid.');
  }
  return {
    schema: 'jotluck.autocomplete.v2s-runtime-metadata.v1',
    engine: PUBLIC_V2S_ENGINE_ID,
    candidateId: value.candidateId,
    maxOrder: value.maxOrder,
    providerId: PUBLIC_V2S_ENGINE_ID,
    source: 'public-v2s',
    sourceLayer: 'l3',
  };
}

function generateCandidates(
  tokenizer: TokenizerModel,
  model: MknRuntime,
  contextTokens: number[],
  language: V2SLanguage,
  request: PublicEngineGenerateRequest,
): GeneratedCandidate[] {
  let beam: BeamState[] = [{ generated: [], logProbability: 0, matchedOrder: 1 }];
  const collected = new Map<string, GeneratedCandidate>();
  for (let step = 0; step < MAX_GENERATED_TOKENS && beam.length > 0; step += 1) {
    const expanded: BeamState[] = [];
    for (const state of beam) {
      const history = [...contextTokens, ...state.generated];
      for (const next of scoreNextTokens(model, history).slice(0, BRANCH_WIDTH)) {
        if (next.token === ABSTAIN_TOKEN || next.probability <= 0) continue;
        if (next.token === EOS_TOKEN) {
          collectCandidate(collected, tokenizer, state, language, request);
          continue;
        }
        const piece = tokenizer.vocabulary[next.token];
        if (piece === undefined || piece === '\n') {
          collectCandidate(collected, tokenizer, state, language, request);
          continue;
        }
        if (language === 'en' && piece.startsWith('▁') && state.generated.length > 0) {
          collectCandidate(collected, tokenizer, state, language, request);
        }
        const generated = [...state.generated, next.token];
        if (hasTokenCycle(generated)) continue;
        const nextState: BeamState = {
          generated,
          logProbability: state.logProbability + Math.log(Math.max(next.probability, 1e-12)),
          matchedOrder: Math.max(state.matchedOrder, next.matchedOrder),
        };
        const decoded = decodeWithTokenizer(tokenizer, generated);
        if (codePointLength(decoded) > PUBLIC_ENGINE_MAX_OUTPUT_CODE_POINTS) {
          continue;
        }
        if (language === 'zh' || /[.!?;:。！？；：]$/u.test(decoded)) {
          collectCandidate(collected, tokenizer, nextState, language, request);
        }
        expanded.push(nextState);
      }
    }
    beam = expanded
      .sort(
        (left, right) =>
          normalizedBeamScore(right) - normalizedBeamScore(left) ||
          compareNumberArrays(left.generated, right.generated),
      )
      .slice(0, BEAM_WIDTH);
  }
  return [...collected.values()].sort(
    (left, right) =>
      right.modelScore - left.modelScore ||
      right.matchedOrder - left.matchedOrder ||
      compareStrings(left.text, right.text),
  );
}

function collectCandidate(
  collected: Map<string, GeneratedCandidate>,
  tokenizer: TokenizerModel,
  state: BeamState,
  language: V2SLanguage,
  request: PublicEngineGenerateRequest,
): void {
  if (state.generated.length === 0) return;
  const firstPiece = tokenizer.vocabulary[state.generated[0]!] ?? '';
  let text = decodeWithTokenizer(tokenizer, state.generated);
  if (request.cursorBoundary === 'space') text = text.replace(/^ /u, '');
  if (!isValidGeneratedText(text, firstPiece, language, request)) return;
  const modelScore = clamp01(Math.exp(state.logProbability / state.generated.length));
  if (!Number.isFinite(modelScore) || modelScore <= 0) return;
  const previous = collected.get(text);
  if (!previous || modelScore > previous.modelScore) {
    collected.set(text, { text, modelScore, matchedOrder: state.matchedOrder });
  }
}

function isValidGeneratedText(
  text: string,
  firstPiece: string,
  language: V2SLanguage,
  request: PublicEngineGenerateRequest,
): boolean {
  if (
    text.length === 0 ||
    /[\r\n\0]/u.test(text) ||
    codePointLength(text) > PUBLIC_ENGINE_MAX_OUTPUT_CODE_POINTS
  ) {
    return false;
  }
  const containsHan = /\p{Script=Han}/u.test(text);
  const containsLatin = /\p{Script=Latin}/u.test(text);
  if (containsHan && containsLatin) return false;
  if (language === 'zh') {
    return containsHan && !containsLatin && (text.match(/\p{Script=Han}/gu)?.length ?? 0) >= 3;
  }
  if (!containsLatin || containsHan || (text.match(/[A-Za-z]/gu)?.length ?? 0) < 5) return false;
  if (
    (request.cursorBoundary === 'word' || request.cursorBoundary === 'space') &&
    !firstPiece.startsWith('▁')
  ) {
    return false;
  }
  return /(?:^|[\s\p{P}\p{S}])[A-Za-z][A-Za-z'-]{4,}(?=$|[\s\p{P}\p{S}])/u.test(text);
}

function scoreNextTokens(model: MknRuntime, history: readonly number[]): ScoredToken[] {
  const candidateTokens = new Set<number>(model.topUnigramTokens);
  candidateTokens.add(EOS_TOKEN);
  const contextNodes: Array<{ order: number; node: number }> = [];
  for (let order = 2; order <= model.maxOrder; order += 1) {
    if (history.length < order - 1) continue;
    const context = history.slice(-(order - 1));
    const node = findContextNode(model, context);
    if (node === -1) continue;
    contextNodes.push({ order, node });
    const first = model.nodeFirstPrediction[node]!;
    const end = first + model.nodePredictionCount[node]!;
    for (let index = first; index < end; index += 1) {
      candidateTokens.add(model.predictionToken[index]!);
    }
  }
  const scored = [...candidateTokens]
    .map((token) => scoreToken(model, contextNodes, token))
    .filter((item) => item.probability > 0)
    .sort(
      (left, right) =>
        right.probability - left.probability ||
        right.matchedOrder - left.matchedOrder ||
        left.token - right.token,
    );
  const relativeFloor = (scored[0]?.probability ?? 0) * 0.1;
  return scored.filter((candidate) => candidate.probability >= relativeFloor);
}

function scoreToken(
  model: MknRuntime,
  contextNodes: readonly { order: number; node: number }[],
  token: number,
): ScoredToken {
  let probabilityQ16 = model.unigramQ16[token] ?? 0;
  let matchedOrder = probabilityQ16 > 0 ? 1 : 0;
  for (const { order, node } of contextNodes) {
    const predictionIndex = findPrediction(model, node, token);
    const localProbabilityQ16 =
      predictionIndex === -1 ? 0 : model.predictionProbabilityQ16[predictionIndex]!;
    probabilityQ16 = Math.min(
      Q16_MAX,
      localProbabilityQ16 + multiplyQ16(model.nodeBackoffQ16[node]!, probabilityQ16),
    );
    if (localProbabilityQ16 > 0) matchedOrder = order;
  }
  return { token, probability: probabilityQ16 / Q16_MAX, matchedOrder };
}

function findContextNode(model: MknRuntime, context: readonly number[]): number {
  let node = 0;
  for (const token of context) {
    let left = model.nodeFirstChild[node]!;
    let right = left + model.nodeChildCount[node]! - 1;
    let found = -1;
    while (left <= right) {
      const middle = (left + right) >>> 1;
      const candidate = model.nodeToken[middle]!;
      if (candidate === token) {
        found = middle;
        break;
      }
      if (candidate < token) left = middle + 1;
      else right = middle - 1;
    }
    if (found === -1) return -1;
    node = found;
  }
  return node;
}

function findPrediction(model: MknRuntime, node: number, token: number): number {
  let left = model.nodeFirstPrediction[node]!;
  let right = left + model.nodePredictionCount[node]! - 1;
  while (left <= right) {
    const middle = (left + right) >>> 1;
    const candidate = model.predictionToken[middle]!;
    if (candidate === token) return middle;
    if (candidate < token) left = middle + 1;
    else right = middle - 1;
  }
  return -1;
}

function multiplyQ16(left: number, right: number): number {
  return Math.round((left * right) / Q16_MAX);
}

function encodeWithTokenizer(model: TokenizerModel, text: string): number[] {
  const unknown = model.tokenByPiece.get('<unk>') ?? 0;
  const output: number[] = [];
  for (const segment of segmentText(text)) {
    const pieces =
      model.kind === 'bpe'
        ? applyBpe(segment, model.merges)
        : tokenizeUnigram(segment, model.vocabulary, model.scores);
    for (const piece of pieces) output.push(model.tokenByPiece.get(piece) ?? unknown);
  }
  return output;
}

function decodeWithTokenizer(model: TokenizerModel, tokenIds: readonly number[]): string {
  let output = '';
  for (const tokenId of tokenIds) {
    const piece = model.vocabulary[tokenId];
    if (piece === undefined || SPECIAL_TOKENS.includes(piece as (typeof SPECIAL_TOKENS)[number])) {
      continue;
    }
    output += piece;
  }
  return output.replaceAll('▁', ' ');
}

function segmentText(text: string): string[][] {
  const normalized = text.normalize('NFKC').replace(/\r\n?/gu, '\n');
  const pieces = normalized.match(/\n|[\t ]+|[\p{L}\p{M}\p{N}_'-]+|[^\s]/gu) ?? [];
  const segments: string[][] = [];
  // Keep this byte-for-byte aligned with the training tokenizer: only an
  // actual horizontal-space run creates the boundary marker. Inventing a
  // marker at document/line start changes the MKN context seen at runtime.
  let pendingSpace = false;
  for (const piece of pieces) {
    if (piece === '\n') {
      segments.push(['\n']);
      pendingSpace = false;
      continue;
    }
    if (/^[\t ]+$/u.test(piece)) {
      pendingSpace = true;
      continue;
    }
    const prefix = pendingSpace ? '▁' : '';
    segments.push([...piece].map((point, index) => (index === 0 ? prefix + point : point)));
    pendingSpace = false;
  }
  return segments;
}

function discardPotentiallyPartialLeadingSegment(text: string): string {
  return text.replace(/^[\p{L}\p{M}\p{N}_'-]+/u, '');
}

function applyBpe(segment: string[], merges: Array<[string, string]>): string[] {
  let output = [...segment];
  for (const [left, right] of merges) {
    const merged: string[] = [];
    for (let index = 0; index < output.length; index += 1) {
      if (output[index] === left && output[index + 1] === right) {
        merged.push(left + right);
        index += 1;
      } else {
        merged.push(output[index]!);
      }
    }
    output = merged;
  }
  return output;
}

function tokenizeUnigram(segment: string[], vocabulary: string[], scores: number[]): string[] {
  const points = [...segment.join('')];
  const entries = new Map<string, number>();
  for (let index = SPECIAL_TOKENS.length; index < vocabulary.length; index += 1) {
    entries.set(vocabulary[index]!, scores[index] ?? 0);
  }
  const best: Array<{ score: number; pieces: string[] } | undefined> = new Array(points.length + 1);
  best[0] = { score: 0, pieces: [] };
  for (let end = 1; end <= points.length; end += 1) {
    let winner: { score: number; pieces: string[] } | undefined;
    for (let start = 0; start < end; start += 1) {
      const previous = best[start];
      if (!previous) continue;
      const piece = points.slice(start, end).join('');
      const pieceScore = entries.get(piece);
      if (pieceScore === undefined) continue;
      const candidate = { score: previous.score + pieceScore, pieces: [...previous.pieces, piece] };
      if (!winner || compareTokenizations(candidate, winner) < 0) winner = candidate;
    }
    best[end] = winner;
  }
  return best[points.length]?.pieces ?? segment;
}

function compareTokenizations(
  left: { score: number; pieces: string[] },
  right: { score: number; pieces: string[] },
): number {
  if (left.score !== right.score) return right.score - left.score;
  if (left.pieces.length !== right.pieces.length) return left.pieces.length - right.pieces.length;
  for (let index = 0; index < left.pieces.length; index += 1) {
    const leftLength = codePointLength(left.pieces[index]!);
    const rightLength = codePointLength(right.pieces[index]!);
    if (leftLength !== rightLength) return rightLength - leftLength;
  }
  return compareStrings(left.pieces.join('\0'), right.pieces.join('\0'));
}

function buildGateFeatures(options: {
  top1Probability: number;
  top1MinusTop2: number;
  matchedOrder: number;
  contextTokenCount: number;
  candidateCodePoints: number;
  maxOutputCodePoints: number;
  cursorBoundary: PublicEngineGenerateRequest['cursorBoundary'];
  language: V2SLanguage;
}): number[] {
  const features = [
    clamp01(options.top1Probability),
    clamp01(options.top1MinusTop2),
    clamp01(options.matchedOrder / 5),
    clamp01(Math.min(options.contextTokenCount, 32) / 32),
    clamp01(options.candidateCodePoints / options.maxOutputCodePoints),
    Number(options.cursorBoundary === 'word'),
    Number(options.cursorBoundary === 'space'),
    Number(options.cursorBoundary === 'punctuation'),
    Number(options.language === 'zh'),
    Number(options.language === 'en'),
  ];
  if (
    features.length !== PUBLIC_V2S_GATE_FEATURE_COUNT ||
    features.some((feature) => !Number.isFinite(feature) || feature < 0 || feature > 1)
  ) {
    throw new Error('Public V2S gate features violate schema v1.');
  }
  return features;
}

function evaluateGate(model: GateModel, features: readonly number[]): number {
  if (model.kind === 'g0-rules') {
    return sigmoid(
      features.reduce(
        (sum, feature, index) => sum + feature * model.ruleWeightsQ16[index]! * model.weightScale,
        model.biasQ16 * model.biasScale,
      ),
    );
  }
  const hidden = new Array<number>(model.hiddenSize);
  for (let unit = 0; unit < model.hiddenSize; unit += 1) {
    let activation = model.hiddenBiasQ16[unit]! * model.hiddenBiasScale;
    for (let feature = 0; feature < PUBLIC_V2S_GATE_FEATURE_COUNT; feature += 1) {
      activation +=
        model.inputWeightsQ8[unit * PUBLIC_V2S_GATE_FEATURE_COUNT + feature]! *
        model.inputScale *
        features[feature]!;
    }
    hidden[unit] = Math.tanh(activation);
  }
  let output = model.outputBiasQ16 * model.outputBiasScale;
  for (let unit = 0; unit < model.hiddenSize; unit += 1) {
    output += model.outputWeightsQ8[unit]! * model.outputScale * hidden[unit]!;
  }
  return sigmoid(output);
}

function isSupportedBlock(blockType: PublicEngineGenerateRequest['blockType']): boolean {
  return blockType === 'paragraph' || blockType === 'list' || blockType === 'quote';
}

function hasTokenCycle(tokens: readonly number[]): boolean {
  const length = tokens.length;
  if (
    length >= 3 &&
    tokens[length - 1] === tokens[length - 2] &&
    tokens[length - 2] === tokens[length - 3]
  ) {
    return true;
  }
  if (
    length >= 4 &&
    tokens[length - 1] === tokens[length - 3] &&
    tokens[length - 2] === tokens[length - 4]
  ) {
    return true;
  }
  return false;
}

function normalizedBeamScore(state: BeamState): number {
  return state.generated.length === 0 ? 0 : state.logProbability / state.generated.length;
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
    if (!Number.isSafeInteger(offset)) throw new Error('Public V2S MKN layout overflows.');
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

function validateMknTrie(model: Omit<MknRuntime, 'topUnigramTokens'>): void {
  const nodeCount = model.nodeToken.length;
  const predictionCount = model.predictionToken.length;
  if (model.nodeToken[0] !== 0xffffffff) {
    throw new Error('Public V2S MKN trie root is invalid.');
  }
  const parent = new Int32Array(nodeCount).fill(-1);
  parent[0] = 0;
  const predictionOwner = new Int32Array(predictionCount).fill(-1);
  for (let node = 0; node < nodeCount; node += 1) {
    if (node > 0 && model.nodeToken[node]! >= model.vocabularySize) {
      throw new Error('Public V2S MKN trie token is out of range.');
    }
    const firstChild = model.nodeFirstChild[node]!;
    const childCount = model.nodeChildCount[node]!;
    if (
      (childCount === 0 && firstChild !== 0) ||
      firstChild + childCount > nodeCount ||
      (childCount > 0 && firstChild === 0)
    ) {
      throw new Error('Public V2S MKN trie child range is invalid.');
    }
    let previousChildToken = -1;
    for (let child = firstChild; child < firstChild + childCount; child += 1) {
      if (parent[child] !== -1 || model.nodeToken[child]! <= previousChildToken) {
        throw new Error('Public V2S MKN trie is cyclic, shared or unsorted.');
      }
      parent[child] = node;
      previousChildToken = model.nodeToken[child]!;
    }
    const firstPrediction = model.nodeFirstPrediction[node]!;
    const localPredictionCount = model.nodePredictionCount[node]!;
    if (
      (localPredictionCount === 0 && firstPrediction !== 0) ||
      firstPrediction + localPredictionCount > predictionCount
    ) {
      throw new Error('Public V2S MKN prediction range is invalid.');
    }
    let previousPredictionToken = -1;
    for (
      let prediction = firstPrediction;
      prediction < firstPrediction + localPredictionCount;
      prediction += 1
    ) {
      if (
        predictionOwner[prediction] !== -1 ||
        model.predictionToken[prediction]! >= model.vocabularySize ||
        model.predictionToken[prediction]! <= previousPredictionToken ||
        model.predictionProbabilityQ16[prediction] === 0 ||
        model.predictionCount[prediction] === 0
      ) {
        throw new Error('Public V2S MKN prediction payload is invalid or unsorted.');
      }
      predictionOwner[prediction] = node;
      previousPredictionToken = model.predictionToken[prediction]!;
    }
  }
  if (parent.some((value) => value === -1) || predictionOwner.some((value) => value === -1)) {
    throw new Error('Public V2S MKN trie contains unreachable data.');
  }
  for (let node = 1; node < nodeCount; node += 1) {
    let depth = 0;
    let cursor = node;
    while (cursor !== 0 && depth <= model.maxOrder) {
      cursor = parent[cursor]!;
      depth += 1;
    }
    if (cursor !== 0 || depth > model.maxOrder - 1) {
      throw new Error('Public V2S MKN trie exceeds its declared maximum order.');
    }
  }
}

function requireSection(sections: Map<string, Uint8Array>, id: string): Uint8Array {
  const section = sections.get(id);
  if (!section) throw new Error(`Public V2S section ${id} is missing.`);
  return section;
}

function parseJson(bytes: Uint8Array, label: string): unknown {
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`Public V2S ${label} JSON is invalid.`);
  }
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function parseIntegerArray(
  value: unknown,
  length: number,
  minimum: number,
  maximum: number,
  label: string,
): number[] {
  if (!Array.isArray(value) || value.length !== length)
    throw new Error(`${label} length is invalid.`);
  return value.map((item) => parseInteger(item, minimum, maximum, label));
}

function parseInteger(value: unknown, minimum: number, maximum: number, label: string): number {
  if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new Error(`${label} contains an invalid integer.`);
  }
  return value as number;
}

function parsePositiveFinite(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}

function assertMagic(bytes: Uint8Array, magic: Uint8Array, label: string): void {
  for (let index = 0; index < magic.length; index += 1) {
    if (bytes[index] !== magic[index]) throw new Error(`${label} magic is invalid.`);
  }
}

function isSafeIntegerInRange(value: unknown, minimum: number, maximum: number): value is number {
  return (
    Number.isSafeInteger(value) && (value as number) >= minimum && (value as number) <= maximum
  );
}

function isQ16(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= Q16_MAX;
}

function isSha256(value: string): boolean {
  return /^[0-9a-f]{64}$/u.test(value);
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error('Web Crypto is unavailable.');
  const input = Uint8Array.from(bytes);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', input.buffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function toBytes(binary: ArrayBuffer | Uint8Array): Uint8Array {
  return binary instanceof Uint8Array
    ? new Uint8Array(binary.buffer, binary.byteOffset, binary.byteLength)
    : new Uint8Array(binary);
}

function codePointLength(value: string): number {
  return [...value.replace(/^▁/u, '')].length;
}

function compareNumberArrays(left: readonly number[], right: readonly number[]): number {
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    if (left[index] !== right[index]) return left[index]! - right[index]!;
  }
  return left.length - right.length;
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function stableTextHash(text: string): string {
  let hash = 2166136261;
  for (const point of text.normalize('NFKC')) {
    hash ^= point.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function sigmoid(value: number): number {
  if (value >= 0) return 1 / (1 + Math.exp(-value));
  const exponential = Math.exp(value);
  return exponential / (1 + exponential);
}
