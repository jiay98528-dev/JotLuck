import { describe, expect, it } from 'vitest';
import { DEFAULT_COMPLETION_SETTINGS } from '../../CompletionSettings';
import { buildCompletionContext } from '../context';
import {
  collectProviderCandidates,
  createCompletionResolverTrace,
  resolveCompletion,
  resolveCompletionCandidates,
} from '../resolver';
import type { CompletionCandidate, CompletionContext, CompletionProvider } from '../types';

function context(doc = 'release status'): CompletionContext {
  return buildCompletionContext({
    doc,
    cursorPos: doc.length,
    settings: DEFAULT_COMPLETION_SETTINGS,
    indexData: null,
    n: 4,
  });
}

function provider(
  providerId: string,
  text: string,
  priority: number,
  confidence: number,
  overrides: Partial<CompletionCandidate> = {},
): CompletionProvider {
  const candidate = rawCandidate(providerId, text, priority, confidence, overrides);
  return {
    id: providerId,
    priority,
    canProvide: () => true,
    provide: () => candidate,
  };
}

function rawCandidate(
  providerId: string,
  text: string,
  priority: number,
  confidence: number,
  overrides: Partial<CompletionCandidate> = {},
): CompletionCandidate {
  return {
    text,
    confidence,
    from: 0,
    providerId,
    source: 'ngram',
    sourceLayer: 'provider',
    syntaxType: 'general',
    learnable: true,
    priority,
    ...overrides,
  };
}

function layeredProvider(
  candidates: Array<
    Pick<CompletionCandidate, 'text' | 'confidence' | 'sourceLayer'> & Partial<CompletionCandidate>
  >,
): CompletionProvider {
  const normalized = candidates.map(
    (candidate): CompletionCandidate => ({
      from: 0,
      providerId: 'ngram',
      source: 'ngram',
      syntaxType: 'general',
      learnable: true,
      priority: 50,
      ...candidate,
    }),
  );
  return {
    id: 'ngram',
    priority: 50,
    canProvide: () => true,
    provide: () => normalized[0] ?? null,
    provideMany: () => normalized,
  };
}

describe('completion resolver', () => {
  it('keeps the facade equivalent to the two-stage resolver API', () => {
    const itemContext = context();
    const providers = [
      provider('provider-a', 'owner review', 72, 0.72),
      provider('provider-b', 'risk review', 72, 0.78),
    ];
    const options = {
      getBoost: (candidate: CompletionCandidate) =>
        candidate.providerId === 'provider-a' ? 0.1 : 0,
    };

    const facade = resolveCompletion(itemContext, providers, options);
    const staged = resolveCompletionCandidates(
      itemContext,
      collectProviderCandidates(itemContext, providers),
      options,
      providers.length,
    );

    expect(staged).toEqual(facade);
    expect(facade.candidate).toBe(facade.rankedCandidates[0]);
  });

  it('merges and deduplicates raw candidates before ranking', () => {
    const result = resolveCompletionCandidates(
      context(),
      [
        rawCandidate('provider-a', 'Owner   Plan', 72, 0.72),
        rawCandidate('provider-b', 'owner plan', 72, 0.65),
      ],
      { getBoost: (candidate) => (candidate.providerId === 'provider-b' ? 0.15 : 0) },
      2,
    );

    expect(result).toMatchObject({ providerCount: 2 });
    expect(result.rankedCandidates).toHaveLength(1);
    expect(result.candidate).toMatchObject({ providerId: 'provider-b', text: 'owner plan' });
  });

  it('returns all surviving candidates in final resolver order', () => {
    const result = resolveCompletionCandidates(context(), [
      rawCandidate('low', 'release detail', 65, 0.95),
      rawCandidate('winner', 'owner review', 72, 0.8),
      rawCandidate('runner-up', 'risk review', 72, 0.7),
    ]);

    expect(result.rankedCandidates.map((candidate) => candidate.providerId)).toEqual([
      'winner',
      'runner-up',
      'low',
    ]);
    expect(result.candidate).toBe(result.rankedCandidates[0]);
  });

  it('truncates candidate text by Unicode code point without splitting emoji', () => {
    const result = resolveCompletionCandidates(context('项目计划'), [
      rawCandidate('notebook', '继续推进继续推🙂后续', 72, 0.82, {
        sourceLayer: 'notebook',
      }),
    ]);

    expect(result.candidate?.text).toBe('继续推进继续推🙂');
    expect(result.candidate?.text).not.toContain('\uFFFD');
  });

  it('never exposes a phrase-retrieval candidate ending in a truncated English word', () => {
    const rejected = resolveCompletionCandidates(context('The main risk '), [
      rawCandidate('hybrid-retrieval-en', 'is configuration drift', 73, 0.82, {
        source: 'recent',
        sourceLayer: 'notebook',
        syntaxType: 'phrase-retrieval',
      }),
    ]);
    const retained = resolveCompletionCandidates(context('When debugging '), [
      rawCandidate('hybrid-retrieval-en', 'the issue repeats', 73, 0.82, {
        source: 'recent',
        sourceLayer: 'notebook',
        syntaxType: 'phrase-retrieval',
      }),
    ]);

    expect(rejected.candidate).toBeNull();
    expect(retained.candidate?.text).toBe('the issue');
  });

  it('preserves neural leading spaces and never truncates its first English word', () => {
    const rejected = resolveCompletionCandidates(context('The current issue'), [
      rawCandidate('public-phrase-transformer-v1', ' configuration', 66, 0.9, {
        source: 'neural',
        sourceLayer: 'l3',
      }),
    ]);
    const retained = resolveCompletionCandidates(context('The next step needs'), [
      rawCandidate('public-phrase-transformer-v1', ' review checkpoint', 66, 0.9, {
        source: 'neural',
        sourceLayer: 'l3',
      }),
    ]);

    expect(rejected.candidate).toBeNull();
    expect(retained.candidate?.text).toBe(' review');
  });

  it('keeps structured candidates above higher-confidence prose candidates', () => {
    const result = resolveCompletionCandidates(context(), [
      rawCandidate('prose', 'owner review', 82, 0.99),
      rawCandidate('format-closure', '**', 10, 0.2, {
        source: 'structured',
        sourceLayer: 'provider',
        syntaxType: 'markdown-format',
        learnable: false,
      }),
    ]);

    expect(result.rankedCandidates.map((candidate) => candidate.providerId)).toEqual([
      'format-closure',
      'prose',
    ]);
    expect(result.candidate?.source).toBe('structured');
  });

  it('deduplicates normalized text before selecting the learned winner', () => {
    const result = resolveCompletion(
      context(),
      [
        provider('provider-a', 'Owner   Review', 72, 0.72),
        provider('provider-b', 'owner review', 72, 0.65),
      ],
      { getBoost: (candidate) => (candidate.providerId === 'provider-b' ? 0.15 : 0) },
    );

    expect(result.candidate).toMatchObject({ providerId: 'provider-b', text: 'owner review' });
  });

  it('applies a rejection of duplicate text across provider boundaries', () => {
    const result = resolveCompletion(
      context(),
      [
        provider('provider-a', 'Risk Plan', 72, 0.72),
        provider('provider-b', 'risk  plan', 72, 0.8),
      ],
      { getRejectionCount: (candidate) => (candidate.providerId === 'provider-a' ? 2 : 0) },
    );

    expect(result.candidate).toBeNull();
  });

  it('applies a rejected text across Personal L2, notebook, and L3 layers', () => {
    const result = resolveCompletion(
      context('项目风险'),
      [
        layeredProvider([
          { text: '处理方案', confidence: 0.72, sourceLayer: 'l2' },
          { text: '处理方案', confidence: 0.76, sourceLayer: 'notebook' },
          { text: '处理方案', confidence: 0.8, sourceLayer: 'l3' },
        ]),
      ],
      { getRejectionCount: (candidate) => (candidate.sourceLayer === 'l3' ? 2 : 0) },
    );

    expect(result.candidate).toBeNull();
  });

  it('allows learning to change the winner within one semantic tier', () => {
    const result = resolveCompletion(
      context(),
      [
        provider('lexicon-like', 'owner review', 78, 0.75),
        provider('recent-like', 'risk review', 72, 0.65),
      ],
      { getBoost: (candidate) => (candidate.providerId === 'recent-like' ? 0.2 : 0) },
    );

    expect(result.candidate?.providerId).toBe('recent-like');
  });

  it('allows learning to change the winner between Personal L2 and notebook candidates', () => {
    const result = resolveCompletion(
      context('项目计划'),
      [
        layeredProvider([
          { text: '负责人', confidence: 0.7, sourceLayer: 'l2' },
          { text: '验收范围', confidence: 0.68, sourceLayer: 'notebook' },
        ]),
      ],
      { getBoost: (candidate) => (candidate.sourceLayer === 'notebook' ? 0.12 : 0) },
    );

    expect(result.candidate).toMatchObject({ text: '验收范围', sourceLayer: 'notebook' });
  });

  it('preserves semantic tier ordering across tiers', () => {
    const result = resolveCompletion(context(), [
      provider('line-echo', 'owner detail', 82, 0.2, { syntaxType: 'line-echo' }),
      provider('lexicon-like', 'risk review', 78, 0.95),
    ]);

    expect(result.candidate?.providerId).toBe('line-echo');
  });

  it.each([
    ['The replacement', 'ation the ca'],
    ['household example', 'tion the'],
    ['Compare the', ' candidate i'],
    ['Record the', ' candidate i'],
  ])('rejects unsupported public-baseline English fragments: %s + %s', (doc, text) => {
    const result = resolveCompletion(context(doc), [
      provider('ngram', text, 50, 0.9, { sourceLayer: 'l3' }),
    ]);

    expect(result.candidate).toBeNull();
  });

  it.each([
    ['项目 update', ' owner'],
    ['project 项目', '负责人'],
  ])('uses the nearest local language fragment in a mixed context: %s', (doc, expected) => {
    const result = resolveCompletion(context(doc), [
      layeredProvider([
        { text: ' owner', confidence: 0.72, sourceLayer: 'l2' },
        { text: '负责人', confidence: 0.72, sourceLayer: 'notebook' },
      ]),
    ]);

    expect(context(doc).languageHint).toBe('mixed');
    expect(result.candidate?.text).toBe(expected);
  });

  it('does not use the pure-Chinese Markdown-token exception in a mixed context', () => {
    const result = resolveCompletion(context('project 项目'), [
      layeredProvider([
        { text: ' TS', confidence: 0.95, sourceLayer: 'l3' },
        { text: '负责人', confidence: 0.72, sourceLayer: 'notebook' },
      ]),
    ]);

    expect(result.candidate?.text).toBe('负责人');
  });

  it('rejects a mixed-language candidate even when the cursor-local language is known', () => {
    const result = resolveCompletion(context('项目 update'), [
      layeredProvider([{ text: ' owner负责人', confidence: 0.9, sourceLayer: 'l2' }]),
    ]);

    expect(result.candidate).toBeNull();
  });

  it('does not switch Chinese prose to English on a trailing glue word', () => {
    const result = resolveCompletion(context('他笑着说 the'), [
      layeredProvider([{ text: ' input', confidence: 0.9, sourceLayer: 'notebook' }]),
    ]);

    expect(result.candidate).toBeNull();
  });

  it('emits read-only resolver diagnostics without changing the winner', () => {
    const trace = createCompletionResolverTrace();
    const result = resolveCompletion(
      context(),
      [
        provider('provider-a', 'owner plan', 72, 0.7),
        provider('provider-b', 'Owner   Plan', 72, 0.8),
        provider('wrong-language', '负责人', 72, 0.9),
      ],
      { trace },
    );

    expect(result.candidate).toMatchObject({ providerId: 'provider-b' });
    expect(trace).toMatchObject({
      rawCandidates: 3,
      normalizedCandidates: 2,
      deduplicatedCandidates: 1,
      rejectionReasons: { language: 1 },
      winner: { providerId: 'provider-b', text: 'Owner   Plan' },
    });
  });
});
