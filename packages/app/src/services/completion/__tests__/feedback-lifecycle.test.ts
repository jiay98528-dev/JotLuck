import { describe, expect, it } from 'vitest';
import { CompletionFeedbackLifecycle } from '../feedback-lifecycle';

describe('CompletionFeedbackLifecycle', () => {
  it('requires accepted before a positive settlement', () => {
    const lifecycle = new CompletionFeedbackLifecycle<{ providerId: string }>(4, () => 10);
    lifecycle.shown('one', { providerId: 'ngram' });

    expect(lifecycle.settleAccepted('one', 'retained')).toBeNull();
    expect(lifecycle.accept('one')?.state).toBe('accepted');
    expect(lifecycle.settleAccepted('one', 'retained')).toMatchObject({
      state: 'retained',
      binding: { providerId: 'ngram' },
    });
    expect(lifecycle.get('one')).toBeNull();
  });

  it('distinguishes explicit rejection from abandonment', () => {
    const lifecycle = new CompletionFeedbackLifecycle<string>();
    lifecycle.shown('escape', 'a');
    lifecycle.shown('typing', 'b');

    expect(lifecycle.settleShown('escape', 'explicitRejected')?.state).toBe('explicitRejected');
    expect(lifecycle.settleShown('typing', 'abandoned')?.state).toBe('abandoned');
    expect(lifecycle.size).toBe(0);
  });

  it('keeps its in-memory token table bounded', () => {
    const lifecycle = new CompletionFeedbackLifecycle<number>(2);
    lifecycle.shown('one', 1);
    lifecycle.shown('two', 2);
    lifecycle.shown('three', 3);

    expect(lifecycle.get('one')).toBeNull();
    expect(lifecycle.get('two')).not.toBeNull();
    expect(lifecycle.get('three')).not.toBeNull();
  });
});
