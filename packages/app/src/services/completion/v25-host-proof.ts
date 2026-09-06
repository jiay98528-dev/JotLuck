/**
 * Runtime-only proof that a V2.5 candidate crossed the trusted host boundary.
 * The symbol is deliberately module-private and cannot arrive from JSON or a
 * Worker response. It is enumerable so resolver-owned object spreads retain
 * the proof while ordinary provider objects cannot reproduce it.
 */
const V25_HOST_CANDIDATE_PROOF = Symbol('jotluck.v25.host-candidate-proof');
const validatedPredictions = new WeakSet<object>();

export function stampV25HostCandidate<T extends object>(candidate: T): T {
  Object.defineProperty(candidate, V25_HOST_CANDIDATE_PROOF, {
    value: true,
    enumerable: true,
    configurable: false,
    writable: false,
  });
  return candidate;
}

export function isV25HostCandidate(candidate: object): boolean {
  return Reflect.get(candidate, V25_HOST_CANDIDATE_PROOF) === true;
}

export function stampV25HostPrediction<T extends object>(prediction: T): T {
  validatedPredictions.add(prediction);
  return prediction;
}

export function isV25HostPrediction(prediction: object): boolean {
  return validatedPredictions.has(prediction);
}
