import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  V25_ROUTE_VALIDATOR_ID,
  V25_ROUTE_VALIDATOR_VERSION,
  validateV25DisplayCandidate,
  type V25DisplayValidationInput,
} from '../v25-route-validator';

interface GoldenCase {
  id: string;
  input: V25DisplayValidationInput;
  allowed: boolean;
  reasons: string[];
}

interface GoldenContract {
  validatorId: string;
  validatorVersion: number;
  cases: GoldenCase[];
}

describe('V2.5 route validator', () => {
  it('matches the shared Python/product display eligibility contract', () => {
    const golden = JSON.parse(
      readFileSync(
        resolve(
          process.cwd(),
          '../../scripts/autocomplete-v2.5-train/v25-route-validator-golden.json',
        ),
        'utf8',
      ),
    ) as GoldenContract;

    expect(golden.validatorId).toBe(V25_ROUTE_VALIDATOR_ID);
    expect(golden.validatorVersion).toBe(V25_ROUTE_VALIDATOR_VERSION);
    for (const testCase of golden.cases) {
      const decision = validateV25DisplayCandidate(testCase.input);
      expect(decision.allowed, testCase.id).toBe(testCase.allowed);
      expect(decision.reasons, testCase.id).toEqual(testCase.reasons);
    }
  });

  it('fails closed on a non-finite calibrated confidence', () => {
    expect(
      validateV25DisplayCandidate({
        route: 'writing',
        text: ' next step.',
        language: 'en',
        prefix: 'Review the',
        blockType: 'paragraph',
        confidence: Number.NaN,
      }),
    ).toMatchObject({ allowed: false, reasons: ['visibility-score-invalid'] });
  });
});
