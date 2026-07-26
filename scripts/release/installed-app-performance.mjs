export const PERFORMANCE_ADVISORY_CODES = Object.freeze({
  coldStart: 'PERF-COLD-START-P90',
  hotWindow: 'PERF-HOT-WINDOW-P90',
});

export function buildPerformanceEvidence(summary, rule) {
  validateRule(rule);
  const coldStartMs = validateSamples(summary?.coldStartMs, rule.coldStartSamples, 'cold start');
  const hotWindowMs = validateSamples(summary?.hotWindowMs, rule.hotWindowSamples, 'hot window');
  const coldStartP90Ms = percentile90(coldStartMs);
  const hotWindowP90Ms = percentile90(hotWindowMs);
  return {
    coldStartMs,
    hotWindowMs,
    coldStartP90Ms,
    hotWindowP90Ms,
    advisories: derivePerformanceAdvisories({ coldStartP90Ms, hotWindowP90Ms }, rule),
  };
}

function validateRule(rule) {
  if (
    !rule ||
    ![
      rule.coldStartSamples,
      rule.hotWindowSamples,
      rule.coldStartP90ReferenceMs,
      rule.hotWindowP90ReferenceMs,
    ].every((value) => Number.isInteger(value) && value > 0)
  ) {
    throw new Error('performance sampling rule is invalid');
  }
}

export function validatePerformanceEvidence(value, rule) {
  assertObject(value, 'performance');
  assertExactKeys(
    value,
    ['coldStartMs', 'hotWindowMs', 'coldStartP90Ms', 'hotWindowP90Ms', 'advisories'],
    'performance',
  );
  const expected = buildPerformanceEvidence(value, rule);
  if (
    value.coldStartP90Ms !== expected.coldStartP90Ms ||
    value.hotWindowP90Ms !== expected.hotWindowP90Ms
  ) {
    throw new Error('performance p90 is not reproducible');
  }
  if (canonicalJson(value.advisories) !== canonicalJson(expected.advisories)) {
    throw new Error('performance advisories are not reproducible');
  }
  return expected;
}

export function derivePerformanceAdvisories(performance, rule) {
  const advisories = [];
  if (performance.coldStartP90Ms > rule.coldStartP90ReferenceMs) {
    advisories.push({
      code: PERFORMANCE_ADVISORY_CODES.coldStart,
      actualMs: performance.coldStartP90Ms,
      referenceMs: rule.coldStartP90ReferenceMs,
    });
  }
  if (performance.hotWindowP90Ms > rule.hotWindowP90ReferenceMs) {
    advisories.push({
      code: PERFORMANCE_ADVISORY_CODES.hotWindow,
      actualMs: performance.hotWindowP90Ms,
      referenceMs: rule.hotWindowP90ReferenceMs,
    });
  }
  return advisories;
}

export function percentile90(samples) {
  const ordered = [...samples].sort((left, right) => left - right);
  return ordered[Math.ceil(ordered.length * 0.9) - 1];
}

function validateSamples(samples, count, label) {
  if (
    !Array.isArray(samples) ||
    samples.length !== count ||
    samples.some((value) => !Number.isFinite(value) || value <= 0)
  ) {
    throw new Error(`${label} samples must contain exactly ${count} positive durations`);
  }
  return [...samples];
}

function assertObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
}

function assertExactKeys(value, expected, label) {
  if (canonicalJson(Object.keys(value).sort()) !== canonicalJson([...expected].sort())) {
    throw new Error(`${label} fields do not match the strict schema`);
  }
}

function canonicalJson(value) {
  return JSON.stringify(sortValue(value));
}

function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortValue(value[key])]),
    );
  }
  return value;
}
