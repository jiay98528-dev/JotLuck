import { describe, expect, it } from 'vitest';
import { DEFAULT_COMPLETION_SETTINGS } from '../../CompletionSettings';
import { buildCompletionContext } from '../context';
import { CompletionProviderRegistry, createProviderDescriptor } from '../provider-registry';
import type { CompletionCandidate, CompletionProvider } from '../types';

function provider(id: string, priority = 50): CompletionProvider {
  const candidate: CompletionCandidate = {
    text: ' result',
    confidence: 0.8,
    from: 12,
    providerId: id,
    source: 'ngram',
    sourceLayer: 'provider',
    syntaxType: 'general',
    learnable: true,
    priority,
  };
  return {
    id,
    priority,
    canProvide: () => true,
    provide: () => candidate,
    provideMany: () => [candidate, { ...candidate, text: ' second' }],
  };
}

describe('CompletionProviderRegistry', () => {
  it('registers once, enforces one fallback and seals after use', () => {
    const registry = new CompletionProviderRegistry();
    const first = provider('first');
    registry.register(first, createProviderDescriptor(first, { genericFallback: true }));
    expect(() =>
      registry.register(
        provider('second'),
        createProviderDescriptor(provider('second'), { genericFallback: true }),
      ),
    ).toThrow(/Only one generic/u);

    registry.providersFor('predictive');
    expect(() =>
      registry.register(provider('late'), createProviderDescriptor(provider('late'))),
    ).toThrow(/sealed/u);
  });

  it('caps candidates and reports a 20ms soft-budget overrun', () => {
    const item = provider('bounded');
    const registry = new CompletionProviderRegistry().register(
      item,
      createProviderDescriptor(item, { maxCandidates: 1, softBudgetMs: 20 }),
    );
    const context = buildCompletionContext({
      doc: 'release plan',
      cursorPos: 12,
      settings: DEFAULT_COMPLETION_SETTINGS,
      indexData: null,
      n: 4,
    });
    const times = [0, 21];
    const result = registry.collect(
      context,
      'predictive',
      () => true,
      () => times.shift() ?? 21,
    );

    expect(result.candidates).toHaveLength(1);
    expect(result.diagnostics[0]).toMatchObject({
      providerId: 'bounded',
      returned: 1,
      exceededSoftBudget: true,
    });
  });
});
