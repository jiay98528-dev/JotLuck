import { beforeEach, describe, expect, it } from 'vitest';
import { learn } from '@/utils/ngram-engine';
import type { NGramTable } from '@/utils/ngram-engine';
import { buildCompletionContext } from '../context';
import {
  PERSONAL_PRIOR_FUSION_WEIGHT,
  PERSONAL_PRIOR_MAX_PHRASES,
  buildPersonalPrior,
} from '../personal-prior';
import type { CompletionSettings } from '../../CompletionSettings';

const SETTINGS: CompletionSettings = {
  enabled: true,
  aggressiveness: 'balanced',
  backgroundTraining: true,
  personalization: true,
  maxSuggestionLength: 12,
  minConfidence: 0.18,
  showDebugStats: false,
};

function makeContext(doc = 'Reviewing the ', n = 4) {
  return buildCompletionContext({
    doc,
    cursorPos: doc.length,
    settings: SETTINGS,
    indexData: null,
    n,
  });
}

describe('buildPersonalPrior', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns undefined without any source matches', () => {
    const prior = buildPersonalPrior({
      context: makeContext(),
      language: 'en',
      n: 4,
      maxSuggestionLength: 12,
    });
    expect(prior).toBeUndefined();
  });

  it('returns undefined for code blocks and non-general syntax', () => {
    const codeContext = makeContext('const value = ');
    const prior = buildPersonalPrior({
      context: { ...codeContext, blockType: 'code' },
      language: 'en',
      n: 4,
      maxSuggestionLength: 12,
      retainedPhrases: ['value'],
    });
    expect(prior).toBeUndefined();
    const structuredContext = makeContext('[[wiki');
    const structuredPrior = buildPersonalPrior({
      context: { ...structuredContext, syntax: { type: 'wiki-link', prefix: '[[' } },
      language: 'en',
      n: 4,
      maxSuggestionLength: 12,
      retainedPhrases: ['link'],
    });
    expect(structuredPrior).toBeUndefined();
  });

  it('clips chinese to four code points and english to one complete word', () => {
    const prior = buildPersonalPrior({
      context: makeContext(),
      language: 'en',
      n: 4,
      maxSuggestionLength: 12,
      retainedPhrases: ['推迟发布安排的会议', 'the team decided to postpone'],
    });
    expect(prior).toBeDefined();
    expect([...prior!.phrases.map((phrase) => phrase.text)].sort()).toEqual(['the', '推迟发布']);
    expect(prior!.fusionWeight).toBe(PERSONAL_PRIOR_FUSION_WEIGHT);
  });

  it('filters the outbound text: mixed-script and PUA drop, secrets never surface', () => {
    const prior = buildPersonalPrior({
      context: makeContext(),
      language: 'en',
      n: 4,
      maxSuggestionLength: 12,
      retainedPhrases: ['中English混合', 'badroute', 'sk-abcdef1234567890abcd', 'clean'],
    });
    expect(prior).toBeDefined();
    expect(prior!.phrases.map((phrase) => phrase.text)).toEqual(['clean']);
  });

  it('strips newlines and keeps a single word', () => {
    const prior = buildPersonalPrior({
      context: makeContext(),
      language: 'en',
      n: 4,
      maxSuggestionLength: 12,
      sessionMatches: ['postpone\r\nthe meeting'],
    });
    expect(prior!.phrases).toHaveLength(1);
    expect(prior!.phrases[0]!.text).toBe('postpone');
  });

  it('dedupes case-insensitive texts and caps the phrase list', () => {
    const many: string[] = [];
    for (let index = 0; index < 14; index += 1) many.push(`word${index}`);
    const prior = buildPersonalPrior({
      context: makeContext(),
      language: 'en',
      n: 4,
      maxSuggestionLength: 12,
      retainedPhrases: ['Team', 'team', ...many],
    });
    expect(prior!.phrases).toHaveLength(PERSONAL_PRIOR_MAX_PHRASES);
    const texts = prior!.phrases.map((phrase) => phrase.text);
    expect(new Set(texts).size).toBe(texts.length);
    expect(texts.filter((text) => text.toLowerCase() === 'team')).toEqual(['Team']);
  });

  it('flows personal n-gram predictions through clipping and clamps weights', () => {
    const table: NGramTable = new Map();
    learn(table, 'Reviewing the ', 'postpone', 4);
    const prior = buildPersonalPrior({
      context: makeContext(),
      language: 'en',
      n: 4,
      maxSuggestionLength: 12,
      personalLongTable: table,
    });
    expect(prior).toBeDefined();
    for (const phrase of prior!.phrases) {
      expect(phrase.weight).toBeGreaterThan(0);
      expect(phrase.weight).toBeLessThanOrEqual(1);
      expect(Array.from(phrase.text).length).toBeLessThanOrEqual(24);
    }
  });

  it('keeps chinese one-unit predictions bounded', () => {
    const table: NGramTable = new Map();
    learn(table, '今天我们', '推迟发布安排', 4);
    const prior = buildPersonalPrior({
      context: makeContext('今天我们', 4),
      language: 'zh',
      n: 4,
      maxSuggestionLength: 12,
      personalLongTable: table,
    });
    if (prior) {
      for (const phrase of prior!.phrases) {
        expect(Array.from(phrase.text).length).toBeLessThanOrEqual(4);
      }
    }
  });
});
