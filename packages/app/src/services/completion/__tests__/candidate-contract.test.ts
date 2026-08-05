import { describe, expect, it } from 'vitest';
import { DEFAULT_COMPLETION_SETTINGS } from '../../CompletionSettings';
import { normalizeCandidateContract } from '../candidate-contract';
import { buildCompletionContext } from '../context';
import { resolveCompletionCandidates } from '../resolver';
import type { CompletionCandidate } from '../types';

function structured(providerId: string): CompletionCandidate {
  const doc = '链接 [[项😀';
  const cursor = doc.length;
  return {
    text: '目]]',
    displayText: '目]]',
    edit: {
      from: cursor - '项😀'.length,
      to: cursor,
      insertText: '项目😀]]',
    },
    confidence: 0.9,
    from: cursor,
    providerId,
    source: 'structured',
    sourceLayer: 'provider',
    syntaxType: 'wiki-link',
    learnable: false,
    priority: 100,
  };
}

describe('CompletionTextEdit candidate contract', () => {
  it('keeps UTF-16 replacement coordinates separate from ghost display text', () => {
    const candidate = normalizeCandidateContract(structured('wiki-link'));
    expect(candidate.displayText).toBe('目]]');
    expect(candidate.edit).toEqual({
      from: '链接 [['.length,
      to: '链接 [[项😀'.length,
      insertText: '项目😀]]',
    });
  });

  it('deduplicates by authoritative edit and preserves every contributor', () => {
    const doc = '链接 [[项😀';
    const context = buildCompletionContext({
      doc,
      cursorPos: doc.length,
      settings: DEFAULT_COMPLETION_SETTINGS,
      indexData: null,
      n: 4,
    });
    const result = resolveCompletionCandidates(context, [
      structured('wiki-link'),
      { ...structured('workspace-title'), confidence: 0.8 },
    ]);

    expect(result.rankedCandidates).toHaveLength(1);
    expect(result.candidate?.contributors?.map((item) => item.providerId).sort()).toEqual([
      'wiki-link',
      'workspace-title',
    ]);
  });

  it('maps legacy local priorities without promoting generic heuristics into a learned tier', () => {
    const candidate = (priority: number, sourceLayer: CompletionCandidate['sourceLayer']) =>
      normalizeCandidateContract({
        text: ' detail',
        confidence: 0.8,
        from: 7,
        providerId: `legacy-${priority}`,
        source: 'ngram',
        sourceLayer,
        syntaxType: 'general',
        learnable: true,
        priority,
      });

    expect(candidate(82, 'provider').priorityTier).toBe('document-session');
    expect(candidate(78, 'provider').priorityTier).toBe('personal-workspace');
    expect(candidate(65, 'provider').priorityTier).toBe('fallback');
    expect(candidate(50, 'session').priorityTier).toBe('document-session');
    expect(candidate(50, 'short-l3').priorityTier).toBe('public');
  });
});
