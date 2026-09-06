import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_COMPLETION_SETTINGS } from '../../CompletionSettings';
import { buildCompletionContext } from '../context';
import { createV24LocalCascade, V24_LOCAL_CASCADE_STAGE_IDS } from '../v24-local-cascade';

function context(doc: string) {
  return buildCompletionContext({
    doc,
    cursorPos: doc.length,
    settings: DEFAULT_COMPLETION_SETTINGS,
    indexData: null,
    n: 4,
  });
}

function provider(id: string, text: string, support?: number) {
  return {
    id,
    priority: 100,
    canProvide: () => true,
    provide: () => ({
      text,
      confidence: 0.99,
      from: 0,
      providerId: id,
      source: 'structured' as const,
      syntaxType: 'markdown-structure',
      learnable: false,
      priority: 100,
      support,
    }),
  };
}

describe('V2.4 fixed local cascade', () => {
  it('keeps the prescribed seven-stage order and stops before later model stages', () => {
    const routeModel = provider('route-model', 'model candidate');
    const modelSpy = vi.spyOn(routeModel, 'provide');
    const cascade = createV24LocalCascade({
      markdownProviders: [],
      codeSyntaxProviders: [],
      sessionProviders: [],
      acceptedProviders: [provider('accepted-phrase', 'one two six', 2)],
      documentProviders: [],
      personalNotebookProviders: [],
      routeModelProviders: [routeModel],
      fallbackProviders: [provider('unique-fallback', 'fallback candidate')],
    });

    const result = cascade.resolve(context('A paragraph '));
    expect(result).toMatchObject({
      stageId: 'accepted-phrase',
      shortCircuited: true,
    });
    expect(modelSpy).not.toHaveBeenCalled();
    expect(result.consultedStages).toEqual(V24_LOCAL_CASCADE_STAGE_IDS.slice(0, 3));
  });
});
