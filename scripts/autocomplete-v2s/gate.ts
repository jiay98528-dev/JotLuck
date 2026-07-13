export type GateLabel = 'show' | 'silence' | 'bank-miss';
export type GateLanguage = 'zh' | 'en';
export type GateExpectedBehavior = 'complete' | 'silence';
export type GateCalibrationRole = 'fit' | 'calibration';
export const V2S_GATE_FEATURE_SCHEMA = 'v2s-gate-features-v1';
export const V2S_GATE_FEATURE_COUNT = 10;
const Q16_MAX = 65_535;

export interface GateSample {
  features: number[];
  label: GateLabel;
  group: string;
  language: GateLanguage;
  expectedBehavior: GateExpectedBehavior;
  calibrationRole: GateCalibrationRole;
}

export interface GateCalibrationMetrics {
  examples: number;
  triggers: number;
  triggerRate: number;
  usable: number;
  absoluteUsableRate: number;
  silenceExamples: number;
  silenceFalseTriggers: number;
  silenceFalseRate: number;
  byLanguage: Record<
    GateLanguage,
    { examples: number; usable: number; absoluteUsableRate: number }
  >;
}

export interface GateCalibrationResult {
  status: 'passed' | 'calibration-failed';
  failureReasons: string[];
  thresholdQ16: number;
  metrics: GateCalibrationMetrics;
  fitGroups: number;
  calibrationGroups: number;
}

export interface G0GateModel {
  schema: 'jotluck.autocomplete.v2s-gate.v1';
  kind: 'g0-rules';
  featureSchema: typeof V2S_GATE_FEATURE_SCHEMA;
  featureCount: typeof V2S_GATE_FEATURE_COUNT;
  trainingExamples: number;
  excludedBankMisses: number;
  weightScale: number;
  ruleWeightsQ16: number[];
  biasScale: number;
  biasQ16: number;
  showThresholdQ16: number;
  calibration: GateCalibrationResult;
}

export interface G1GateModel {
  schema: 'jotluck.autocomplete.v2s-gate.v1';
  kind: 'g1-mlp16-int8';
  featureSchema: typeof V2S_GATE_FEATURE_SCHEMA;
  featureCount: typeof V2S_GATE_FEATURE_COUNT;
  hiddenSize: 16;
  trainingExamples: number;
  excludedBankMisses: number;
  inputScale: number;
  inputWeightsQ8: number[];
  hiddenBiasScale: number;
  hiddenBiasQ16: number[];
  outputScale: number;
  outputWeightsQ8: number[];
  outputBiasScale: number;
  outputBiasQ16: number;
  showThresholdQ16: number;
  calibration: GateCalibrationResult;
}

export type V2SGateModel = G0GateModel | G1GateModel;

export interface GateTrainingOptions {
  epochs?: number;
  learningRate?: number;
  l2?: number;
  seed?: number;
}

export function trainG0Gate(
  samples: readonly GateSample[],
  options: GateTrainingOptions = {},
): G0GateModel {
  const prepared = prepareSamples(samples);
  const weights = new Array<number>(prepared.featureCount).fill(0);
  let bias = 0;
  const epochs = options.epochs ?? 80;
  const learningRate = options.learningRate ?? 0.04;
  const l2 = options.l2 ?? 0.001;
  for (let epoch = 0; epoch < epochs; epoch += 1) {
    for (const sample of prepared.fitSamples) {
      const prediction = sigmoid(dot(weights, sample.features) + bias);
      const error = prediction - sample.target;
      for (let feature = 0; feature < weights.length; feature += 1) {
        weights[feature] -=
          learningRate * (error * sample.features[feature]! + l2 * weights[feature]!);
      }
      bias -= learningRate * error;
    }
  }
  const quantizedWeights = quantizeSigned(weights, 32_767);
  const biasScale = Math.max(Math.abs(bias) / 32_767, Number.EPSILON);
  const biasQ16 = Math.max(-32_768, Math.min(32_767, Math.round(bias / biasScale)));
  const calibrationScores = prepared.calibrationSamples.map((sample) =>
    evaluateG0Quantized(
      quantizedWeights.values,
      quantizedWeights.scale,
      biasQ16,
      biasScale,
      sample.features,
    ),
  );
  const calibration = calibrateShowThreshold(
    calibrationScores,
    prepared.calibrationSamples,
    prepared.fitGroups,
    prepared.calibrationGroups,
  );
  return {
    schema: 'jotluck.autocomplete.v2s-gate.v1',
    kind: 'g0-rules',
    featureSchema: V2S_GATE_FEATURE_SCHEMA,
    featureCount: V2S_GATE_FEATURE_COUNT,
    trainingExamples: prepared.fitSamples.length,
    excludedBankMisses: prepared.excludedBankMisses,
    weightScale: quantizedWeights.scale,
    ruleWeightsQ16: quantizedWeights.values,
    biasScale,
    biasQ16,
    showThresholdQ16: calibration.thresholdQ16,
    calibration,
  };
}

export function trainG1Gate(
  samples: readonly GateSample[],
  options: GateTrainingOptions = {},
): G1GateModel {
  const prepared = prepareSamples(samples);
  const hiddenSize = 16;
  const random = mulberry32(options.seed ?? 0x5eed_2026);
  const inputWeights = new Array<number>(hiddenSize * prepared.featureCount)
    .fill(0)
    .map(() => (random() - 0.5) * 0.1);
  const hiddenBias = new Array<number>(hiddenSize).fill(0);
  const outputWeights = new Array<number>(hiddenSize).fill(0).map(() => (random() - 0.5) * 0.1);
  let outputBias = 0;
  const epochs = options.epochs ?? 60;
  const learningRate = options.learningRate ?? 0.02;
  const l2 = options.l2 ?? 0.0001;

  for (let epoch = 0; epoch < epochs; epoch += 1) {
    for (const sample of prepared.fitSamples) {
      const hidden = new Array<number>(hiddenSize);
      for (let unit = 0; unit < hiddenSize; unit += 1) {
        let activation = hiddenBias[unit]!;
        for (let feature = 0; feature < prepared.featureCount; feature += 1) {
          activation +=
            inputWeights[unit * prepared.featureCount + feature]! * sample.features[feature]!;
        }
        hidden[unit] = Math.tanh(activation);
      }
      const prediction = sigmoid(dot(outputWeights, hidden) + outputBias);
      const outputError = prediction - sample.target;
      const outputBeforeUpdate = [...outputWeights];
      for (let unit = 0; unit < hiddenSize; unit += 1) {
        outputWeights[unit] -=
          learningRate * (outputError * hidden[unit]! + l2 * outputWeights[unit]!);
      }
      outputBias -= learningRate * outputError;
      for (let unit = 0; unit < hiddenSize; unit += 1) {
        const hiddenGradient = outputError * outputBeforeUpdate[unit]! * (1 - hidden[unit]! ** 2);
        for (let feature = 0; feature < prepared.featureCount; feature += 1) {
          const index = unit * prepared.featureCount + feature;
          inputWeights[index] -=
            learningRate * (hiddenGradient * sample.features[feature]! + l2 * inputWeights[index]!);
        }
        hiddenBias[unit] -= learningRate * hiddenGradient;
      }
    }
  }

  const input = quantizeSigned(inputWeights, 127);
  const hidden = quantizeSigned(hiddenBias, 32_767);
  const output = quantizeSigned(outputWeights, 127);
  const outputBiasScale = Math.max(Math.abs(outputBias) / 32_767, Number.EPSILON);
  const outputBiasQ16 = Math.max(
    -32_768,
    Math.min(32_767, Math.round(outputBias / outputBiasScale)),
  );
  const calibrationScores = prepared.calibrationSamples.map((sample) =>
    evaluateG1Quantized(
      input.values,
      input.scale,
      hidden.values,
      hidden.scale,
      output.values,
      output.scale,
      outputBiasQ16,
      outputBiasScale,
      sample.features,
    ),
  );
  const calibration = calibrateShowThreshold(
    calibrationScores,
    prepared.calibrationSamples,
    prepared.fitGroups,
    prepared.calibrationGroups,
  );
  return {
    schema: 'jotluck.autocomplete.v2s-gate.v1',
    kind: 'g1-mlp16-int8',
    featureSchema: V2S_GATE_FEATURE_SCHEMA,
    featureCount: V2S_GATE_FEATURE_COUNT,
    hiddenSize,
    trainingExamples: prepared.fitSamples.length,
    excludedBankMisses: prepared.excludedBankMisses,
    inputScale: input.scale,
    inputWeightsQ8: input.values,
    hiddenBiasScale: hidden.scale,
    hiddenBiasQ16: hidden.values,
    outputScale: output.scale,
    outputWeightsQ8: output.values,
    outputBiasScale,
    outputBiasQ16,
    showThresholdQ16: calibration.thresholdQ16,
    calibration,
  };
}

export function gateModelToBytes(model: V2SGateModel): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(model));
}

function prepareSamples(samples: readonly GateSample[]): {
  featureCount: number;
  fitSamples: PreparedGateSample[];
  calibrationSamples: PreparedGateSample[];
  excludedBankMisses: number;
  fitGroups: number;
  calibrationGroups: number;
} {
  const featureCount = V2S_GATE_FEATURE_COUNT;
  const groupMetadata = new Map<string, { role: GateCalibrationRole; language: GateLanguage }>();
  const prepared = samples.map((sample, index): PreparedGateSample => {
    if (
      sample.features.length !== featureCount ||
      sample.features.some((value) => !Number.isFinite(value) || value < 0 || value > 1)
    ) {
      throw new Error(`Gate sample ${index} has invalid feature dimensions or values.`);
    }
    if (
      typeof sample.group !== 'string' ||
      sample.group.trim().length === 0 ||
      (sample.language !== 'zh' && sample.language !== 'en') ||
      (sample.expectedBehavior !== 'complete' && sample.expectedBehavior !== 'silence') ||
      (sample.calibrationRole !== 'fit' && sample.calibrationRole !== 'calibration') ||
      (sample.expectedBehavior === 'silence' && sample.label !== 'silence') ||
      (sample.expectedBehavior === 'complete' && sample.label === 'silence')
    ) {
      throw new Error(`Gate sample ${index} has invalid calibration metadata or label semantics.`);
    }
    const group = sample.group.trim();
    const existing = groupMetadata.get(group);
    if (
      existing &&
      (existing.role !== sample.calibrationRole || existing.language !== sample.language)
    ) {
      throw new Error(`Gate group ${group} crosses calibration roles or languages.`);
    }
    groupMetadata.set(group, { role: sample.calibrationRole, language: sample.language });
    return {
      features: [...sample.features],
      label: sample.label,
      group,
      language: sample.language,
      expectedBehavior: sample.expectedBehavior,
      calibrationRole: sample.calibrationRole,
      target: sample.label === 'show' ? (1 as const) : (0 as const),
    };
  });
  const fitSamples = prepared.filter(
    (sample) => sample.calibrationRole === 'fit' && sample.label !== 'bank-miss',
  );
  if (fitSamples.length === 0) {
    throw new Error('Gate fitting requires at least one non-bank-miss fit sample.');
  }
  const calibrationSamples = prepared.filter((sample) => sample.calibrationRole === 'calibration');
  return {
    featureCount,
    fitSamples,
    calibrationSamples,
    excludedBankMisses: prepared.filter((sample) => sample.label === 'bank-miss').length,
    fitGroups: new Set(fitSamples.map((sample) => sample.group)).size,
    calibrationGroups: new Set(calibrationSamples.map((sample) => sample.group)).size,
  };
}

interface PreparedGateSample extends GateSample {
  target: 0 | 1;
}

interface ThresholdEvaluation {
  thresholdQ16: number;
  metrics: GateCalibrationMetrics;
  correct: number;
  failureReasons: string[];
}

function calibrateShowThreshold(
  scores: readonly number[],
  samples: readonly PreparedGateSample[],
  fitGroups: number,
  calibrationGroups: number,
): GateCalibrationResult {
  if (scores.length !== samples.length) {
    throw new Error('Gate calibration scores and samples disagree.');
  }
  if (samples.length === 0) {
    const metrics = evaluateThreshold([], [], Math.round(Q16_MAX / 2));
    return {
      status: 'calibration-failed',
      failureReasons: ['calibration-set-empty'],
      thresholdQ16: Math.round(Q16_MAX / 2),
      metrics,
      fitGroups,
      calibrationGroups,
    };
  }
  const thresholds = [
    ...new Set([
      0,
      Q16_MAX,
      ...scores.map((score) =>
        Math.max(0, Math.min(Q16_MAX, Math.floor(clamp01(score) * Q16_MAX) + 1)),
      ),
    ]),
  ].sort((left, right) => left - right);
  const evaluated = thresholds.map((thresholdQ16) => {
    const metrics = evaluateThreshold(scores, samples, thresholdQ16);
    return {
      thresholdQ16,
      metrics,
      correct: scores.reduce((total, score, index) => {
        const triggered = score * Q16_MAX >= thresholdQ16;
        return total + Number(triggered === (samples[index]!.label === 'show'));
      }, 0),
      failureReasons: calibrationFailureReasons(metrics),
    } satisfies ThresholdEvaluation;
  });
  const feasible = evaluated
    .filter((item) => item.failureReasons.length === 0)
    .sort(compareFeasibleThreshold)[0];
  const selected = feasible ?? [...evaluated].sort(compareFallbackThreshold)[0]!;
  return {
    status: feasible ? 'passed' : 'calibration-failed',
    failureReasons: feasible ? [] : selected.failureReasons,
    thresholdQ16: selected.thresholdQ16,
    metrics: selected.metrics,
    fitGroups,
    calibrationGroups,
  };
}

function evaluateThreshold(
  scores: readonly number[],
  samples: readonly PreparedGateSample[],
  thresholdQ16: number,
): GateCalibrationMetrics {
  const triggered = scores.map((score) => score * Q16_MAX >= thresholdQ16);
  const triggers = triggered.filter(Boolean).length;
  const usable = samples.reduce(
    (total, sample, index) => total + Number(triggered[index] && sample.label === 'show'),
    0,
  );
  const silenceExamples = samples.filter((sample) => sample.expectedBehavior === 'silence').length;
  const silenceFalseTriggers = samples.reduce(
    (total, sample, index) =>
      total + Number(triggered[index] && sample.expectedBehavior === 'silence'),
    0,
  );
  const byLanguage = Object.fromEntries(
    (['zh', 'en'] as const).map((language) => {
      const indexes = samples.flatMap((sample, index) =>
        sample.language === language ? [index] : [],
      );
      const languageUsable = indexes.reduce(
        (total, index) => total + Number(triggered[index] && samples[index]!.label === 'show'),
        0,
      );
      return [
        language,
        {
          examples: indexes.length,
          usable: languageUsable,
          absoluteUsableRate: ratio(languageUsable, indexes.length),
        },
      ];
    }),
  ) as GateCalibrationMetrics['byLanguage'];
  return {
    examples: samples.length,
    triggers,
    triggerRate: ratio(triggers, samples.length),
    usable,
    absoluteUsableRate: ratio(usable, samples.length),
    silenceExamples,
    silenceFalseTriggers,
    silenceFalseRate: ratio(silenceFalseTriggers, silenceExamples),
    byLanguage,
  };
}

function calibrationFailureReasons(metrics: GateCalibrationMetrics): string[] {
  const reasons: string[] = [];
  if (metrics.triggerRate < 0.35 || metrics.triggerRate > 0.42) {
    reasons.push('trigger-rate-outside-35-42');
  }
  if (metrics.absoluteUsableRate < 0.35) reasons.push('absolute-usable-rate-below-35');
  if (metrics.silenceFalseRate > 0.03) reasons.push('silence-false-rate-above-3');
  for (const language of ['zh', 'en'] as const) {
    if (metrics.byLanguage[language].absoluteUsableRate < 0.3) {
      reasons.push(`${language}-absolute-usable-rate-below-30`);
    }
  }
  return reasons;
}

function compareFeasibleThreshold(left: ThresholdEvaluation, right: ThresholdEvaluation): number {
  return (
    right.metrics.usable - left.metrics.usable ||
    left.metrics.silenceFalseTriggers - right.metrics.silenceFalseTriggers ||
    Math.abs(left.metrics.triggerRate - 0.385) - Math.abs(right.metrics.triggerRate - 0.385) ||
    right.thresholdQ16 - left.thresholdQ16
  );
}

function compareFallbackThreshold(left: ThresholdEvaluation, right: ThresholdEvaluation): number {
  return (
    right.correct - left.correct ||
    right.metrics.usable - left.metrics.usable ||
    left.metrics.silenceFalseTriggers - right.metrics.silenceFalseTriggers ||
    right.thresholdQ16 - left.thresholdQ16
  );
}

function evaluateG0Quantized(
  weights: readonly number[],
  weightScale: number,
  biasQ16: number,
  biasScale: number,
  features: readonly number[],
): number {
  return sigmoid(
    features.reduce(
      (sum, feature, index) => sum + feature * weights[index]! * weightScale,
      biasQ16 * biasScale,
    ),
  );
}

function evaluateG1Quantized(
  inputWeightsQ8: readonly number[],
  inputScale: number,
  hiddenBiasQ16: readonly number[],
  hiddenBiasScale: number,
  outputWeightsQ8: readonly number[],
  outputScale: number,
  outputBiasQ16: number,
  outputBiasScale: number,
  features: readonly number[],
): number {
  const hidden = new Array<number>(16);
  for (let unit = 0; unit < hidden.length; unit += 1) {
    let activation = hiddenBiasQ16[unit]! * hiddenBiasScale;
    for (let feature = 0; feature < V2S_GATE_FEATURE_COUNT; feature += 1) {
      activation +=
        inputWeightsQ8[unit * V2S_GATE_FEATURE_COUNT + feature]! * inputScale * features[feature]!;
    }
    hidden[unit] = Math.tanh(activation);
  }
  return sigmoid(
    dot(
      outputWeightsQ8.map((weight) => weight * outputScale),
      hidden,
    ) +
      outputBiasQ16 * outputBiasScale,
  );
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function dot(left: readonly number[], right: readonly number[]): number {
  let total = 0;
  for (let index = 0; index < left.length; index += 1) total += left[index]! * right[index]!;
  return total;
}

function sigmoid(value: number): number {
  if (value >= 0) return 1 / (1 + Math.exp(-value));
  const exponential = Math.exp(value);
  return exponential / (1 + exponential);
}

function quantizeSigned(
  values: readonly number[],
  maximum: number,
): { scale: number; values: number[] } {
  const greatest = Math.max(...values.map(Math.abs), Number.EPSILON);
  const scale = greatest / maximum;
  return {
    scale,
    values: values.map((value) =>
      Math.max(-maximum - 1, Math.min(maximum, Math.round(value / scale))),
    ),
  };
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b_79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}
