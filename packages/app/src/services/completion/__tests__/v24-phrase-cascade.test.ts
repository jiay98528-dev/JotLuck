import { describe, expect, it } from 'vitest';
import { DEFAULT_COMPLETION_SETTINGS } from '../../CompletionSettings';
import { buildCompletionContext } from '../context';
import {
  V24LocalCascade,
  V24DocumentPhraseProvider,
  V24DocumentPhraseStore,
  V24PhraseProvider,
  V24RetainedPhraseStore,
  V24SessionPhraseStore,
} from '../v24-phrase-cascade';

function context(doc: string) {
  return buildCompletionContext({
    doc,
    cursorPos: doc.length,
    settings: DEFAULT_COMPLETION_SETTINGS,
    indexData: null,
    n: 4,
  });
}

describe('V2.4 local phrase cascade', () => {
  it('requires two retained observations before Accepted phrase can short-circuit', () => {
    const store = new V24RetainedPhraseStore(false);
    const args = {
      scope: 'workspace-a',
      context: 'The release plan ',
      phrase: 'needs careful review today',
      language: 'en' as const,
      sessionKind: 'workspace' as const,
      blockType: 'paragraph' as const,
      mode: 'predictive' as const,
    };
    store.recordRetained(args);
    expect(store.match('workspace-a', args.context, 'en')).toHaveLength(0);
    store.recordRetained(args);
    expect(store.match('workspace-a', args.context, 'en')).toHaveLength(1);
  });

  it('keeps Session retained in memory and keeps code/sensitive phrases out', () => {
    const store = new V24SessionPhraseStore();
    const contextValue = context('The release plan ');
    expect(
      store.recordRetained({
        scope: 'temporary',
        context: 'The release plan ',
        phrase: 'needs careful review today',
        language: 'en',
        sessionKind: 'temporary',
        blockType: 'paragraph',
        mode: 'predictive',
      }),
    ).toBe(true);
    expect(
      store.recordRetained({
        scope: 'temporary',
        context: 'The release plan ',
        phrase: 'secret api key value',
        language: 'en',
        sessionKind: 'temporary',
        blockType: 'code',
        mode: 'predictive',
      }),
    ).toBe(false);
    store.recordRetained({
      scope: 'temporary',
      context: 'The release plan ',
      phrase: 'needs careful review today',
      language: 'en',
      sessionKind: 'temporary',
      blockType: 'paragraph',
      mode: 'predictive',
    });
    const provider = new V24PhraseProvider(store, () => 'temporary', 'session-retained-phrase');
    expect(provider.provide(contextValue)).toMatchObject({
      text: 'needs careful review today',
      feedbackPolicy: 'retained',
    });
  });

  it('does not short-circuit without an explicit stage contract and preserves contributors', () => {
    const first = {
      id: 'first',
      provide: () => [
        {
          text: 'same',
          from: 3,
          confidence: 0.9,
          providerId: 'first',
          source: 'structured' as const,
          sourceLayer: 'provider' as const,
          syntaxType: 'x',
          learnable: false,
          priority: 100,
        },
      ],
    };
    const second = {
      id: 'second',
      provide: () => [
        {
          text: 'same',
          from: 3,
          confidence: 0.9,
          providerId: 'second',
          source: 'structured' as const,
          sourceLayer: 'provider' as const,
          syntaxType: 'x',
          learnable: false,
          priority: 99,
        },
      ],
    };
    const result = new V24LocalCascade([first, second]).resolve(context('abc'));
    expect(result).toMatchObject({ stageId: 'first', shortCircuited: false });
    expect(result.consultedStages).toEqual(['first', 'second']);
    expect(result.candidate?.contributors?.map((item) => item.providerId).sort()).toEqual([
      'first',
      'second',
    ]);
  });

  it('applies a stage short-circuit rule only to candidates introduced by that stage', () => {
    const earlier = {
      id: 'earlier',
      provide: () => [
        {
          text: ' one two six',
          from: 3,
          confidence: 0.99,
          providerId: 'earlier',
          source: 'recent' as const,
          sourceLayer: 'session' as const,
          syntaxType: 'phrase',
          learnable: true,
          priority: 100,
        },
      ],
    };
    const current = {
      id: 'current',
      provide: () => [
        {
          text: ' other two six',
          from: 3,
          confidence: 0.5,
          providerId: 'current',
          source: 'recent' as const,
          sourceLayer: 'l2' as const,
          syntaxType: 'phrase',
          learnable: true,
          priority: 80,
        },
      ],
      shortCircuit: (candidate: { providerId: string }) => candidate.providerId === 'earlier',
    };

    const result = new V24LocalCascade([earlier, current]).resolve(context('abc'));

    expect(result.shortCircuited).toBe(false);
    expect(result.stageId).toBe('earlier');
  });

  it('requires the same phrase to occur in two different document paragraphs', () => {
    const store = new V24DocumentPhraseStore();
    store.updateParagraph({
      documentSessionId: 'document-a',
      documentRevision: 1,
      paragraphId: 'paragraph-1',
      occurrences: [
        { context: 'The release plan ', phrase: 'needs careful review today', language: 'en' },
      ],
    });
    const provider = new V24DocumentPhraseProvider(store, () => 'document-a');
    expect(provider.provide(context('The release plan '))).toBeNull();
    store.updateParagraph({
      documentSessionId: 'document-a',
      documentRevision: 2,
      paragraphId: 'paragraph-2',
      occurrences: [
        { context: 'The release plan ', phrase: 'needs careful review today', language: 'en' },
      ],
    });
    expect(provider.provide(context('The release plan '))).toMatchObject({
      text: 'needs careful review today',
      syntaxType: 'v24-document-phrase',
    });
  });

  it('counts only continuous context plus phrase occurrences in exact paragraph indexes', () => {
    const store = new V24DocumentPhraseStore();
    store.updateParagraphText({
      documentSessionId: 'document-a',
      paragraphId: 'paragraph-1',
      text: 'plan needs careful owner review today',
    });
    store.updateParagraphText({
      documentSessionId: 'document-a',
      paragraphId: 'paragraph-2',
      text: 'plan needs unrelated words; careful owner review today',
    });

    expect(store.exactSupport('document-a', 'plan', ' needs careful owner review', 4)).toBe(1);
  });

  it('preserves one leading English boundary space in retained phrases', () => {
    const store = new V24RetainedPhraseStore();
    const args = {
      scope: 'workspace-a',
      context: 'The release plan',
      phrase: ' needs careful review today',
      language: 'en' as const,
      sessionKind: 'workspace' as const,
      blockType: 'paragraph' as const,
      mode: 'predictive' as const,
    };
    store.recordRetained(args);
    store.recordRetained(args);
    expect(store.match(args.scope, args.context, 'en')[0]?.phrase).toBe(
      ' needs careful review today',
    );
  });
});
