import { mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, ref } from 'vue';
import { usePublicDecoderSetup } from '../usePublicDecoderSetup';

/**
 * Tests target usePublicDecoderSetup (工单 B / B1). Source references for the
 * mocked contract:
 * - installPublicEngineForEvaluation: packages/app/src/services/MarkdownPredictor.ts:572
 * - getPublicEngineDiagnostics: packages/app/src/services/MarkdownPredictor.ts:562
 * - factory returning null on fetch failure:
 *   packages/app/src/services/completion/public-free-decoder-factory.ts:95-97
 */

interface EngineStub {
  id: string;
  dispose: ReturnType<typeof vi.fn>;
}

interface Harness {
  setup(): Promise<void>;
  retry(): Promise<void>;
  unmount(): void;
  canonicalFactory: ReturnType<typeof vi.fn>;
  flaggedFactory: ReturnType<typeof vi.fn>;
  install: ReturnType<typeof vi.fn>;
  disposeEngine(engine: EngineStub): void;
}

function createEngine(id: string): EngineStub {
  return { id, dispose: vi.fn().mockResolvedValue(undefined) };
}

function buildHarness(): Harness {
  const canonicalFactory = vi.fn<() => Promise<EngineStub | null>>(async () => null);
  const flaggedFactory = vi.fn<() => Promise<EngineStub | null>>(async () => null);
  const install = vi.fn<(engine: EngineStub) => Promise<boolean>>(async () => true);
  const getHealth = vi.fn(() => null);
  let unmounted = false;
  const api = ref<ReturnType<typeof usePublicDecoderSetup> | null>(null);
  const wrapper = mount(
    defineComponent({
      setup() {
        api.value = usePublicDecoderSetup({
          predictor: {
            installPublicEngineForEvaluation: install,
            getPublicEngineDiagnostics: getHealth,
          } as unknown as Parameters<typeof usePublicDecoderSetup>[0]['predictor'],
          isUnmounted: () => unmounted,
          // Engines are stubbed; the composable only calls .dispose() on them.
          createCanonicalEngine: canonicalFactory as unknown as () => Promise<never>,
          createFlaggedEngine: flaggedFactory as unknown as () => Promise<never>,
          retryDelaysMs: [2000, 5000],
        });
        return () => h('div');
      },
    }),
    { attachTo: document.body },
  );
  return {
    setup: () => api.value!.setupNow(),
    retry: () => api.value!.retryNow(),
    unmount: () => {
      unmounted = true;
      wrapper.unmount();
    },
    canonicalFactory,
    flaggedFactory,
    install,
    disposeEngine: (engine) => engine.dispose.mockResolvedValue(undefined),
  };
}

afterEach(() => {
  document.body.replaceChildren();
  vi.useRealTimers();
});

describe('usePublicDecoderSetup', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('does not cache a factory(null) failure and allows the next attempt to install', async () => {
    const h = buildHarness();
    // attempt #1: both factories return null -> no install call
    h.canonicalFactory.mockResolvedValueOnce(null);
    h.flaggedFactory.mockResolvedValueOnce(null);
    await h.setup();
    await Promise.resolve();
    expect(h.install).not.toHaveBeenCalled();
    expect(h.canonicalFactory).toHaveBeenCalledTimes(1);

    // Advance past first backoff so auto-retry fires; attempt #2 succeeds.
    const engine = createEngine('attempt-2');
    h.canonicalFactory.mockResolvedValueOnce(engine);
    await vi.advanceTimersByTimeAsync(2500);
    await Promise.resolve();
    expect(h.install).toHaveBeenCalledWith(engine);
  });

  it('treats installPublicEngineForEvaluation returning false as a recoverable failure', async () => {
    const h = buildHarness();
    const failingEngine = createEngine('failing');
    const okEngine = createEngine('ok');
    h.canonicalFactory.mockResolvedValueOnce(failingEngine);
    h.install.mockResolvedValueOnce(false);
    await h.setup();
    await Promise.resolve();
    expect(h.install).toHaveBeenCalledTimes(1);
    expect(h.install).toHaveBeenCalledWith(failingEngine);

    // The previous cache-of-Promise would have frozen the failure. After the
    // backoff the composable must try again with a new engine.
    h.canonicalFactory.mockResolvedValueOnce(okEngine);
    h.install.mockResolvedValueOnce(true);
    await vi.advanceTimersByTimeAsync(2500);
    await Promise.resolve();
    expect(h.install).toHaveBeenCalledTimes(2);
    expect(h.install).toHaveBeenLastCalledWith(okEngine);
  });

  it('catches a rejecting install so the call site does not see an unhandled rejection', async () => {
    const h = buildHarness();
    const engine = createEngine('rejected');
    h.canonicalFactory.mockResolvedValueOnce(engine);
    h.install.mockRejectedValueOnce(new Error('warmup blew up'));

    const rejections: unknown[] = [];
    const onUnhandled = (event: PromiseRejectionEvent) => {
      rejections.push(event.reason);
      event.preventDefault();
    };
    window.addEventListener('unhandledrejection', onUnhandled);

    await expect(h.setup()).resolves.toBeUndefined();
    // Let the microtask queue settle to confirm no late unhandled surfaces.
    await Promise.resolve();
    await Promise.resolve();
    window.removeEventListener('unhandledrejection', onUnhandled);

    expect(rejections).toEqual([]);
  });

  it('stops auto-retrying after the configured attempt budget is exhausted', async () => {
    const h = buildHarness();
    h.canonicalFactory.mockResolvedValue(null);
    h.flaggedFactory.mockResolvedValue(null);

    await h.setup();
    await Promise.resolve();
    expect(h.canonicalFactory).toHaveBeenCalledTimes(1);

    // Burn through both backoffs (default budget: 3 attempts).
    await vi.advanceTimersByTimeAsync(2500);
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(5500);
    await Promise.resolve();

    expect(h.canonicalFactory).toHaveBeenCalledTimes(3);

    // Any further time advancement must not schedule another factory call.
    const callsAfterBudget = h.canonicalFactory.mock.calls.length;
    await vi.advanceTimersByTimeAsync(60_000);
    await Promise.resolve();
    expect(h.canonicalFactory.mock.calls.length).toBe(callsAfterBudget);
  });

  it('retryNow() resets the attempt counter and immediately re-runs canonical→flagged', async () => {
    const h = buildHarness();
    h.canonicalFactory.mockResolvedValue(null);
    h.flaggedFactory.mockResolvedValue(null);

    await h.setup();
    await Promise.resolve();
    expect(h.canonicalFactory).toHaveBeenCalledTimes(1);

    // Burn the auto-retry budget.
    await vi.advanceTimersByTimeAsync(2500);
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(5500);
    await Promise.resolve();
    expect(h.canonicalFactory).toHaveBeenCalledTimes(3);

    // retryNow() must immediately invoke canonical again (no backoff).
    const engine = createEngine('retry');
    h.canonicalFactory.mockResolvedValueOnce(engine);
    await h.retry();
    await Promise.resolve();
    expect(h.canonicalFactory).toHaveBeenCalledTimes(4);
    expect(h.install).toHaveBeenCalledWith(engine);

    // retryNow must restore the auto-retry budget. Force another failing run
    // and walk through both backoffs: it should produce exactly 3 calls
    // (initial + 2 retries), proving the counter was zeroed, not carried over.
    h.canonicalFactory.mockResolvedValue(null);
    h.flaggedFactory.mockResolvedValue(null);
    await h.retry();
    await Promise.resolve();
    expect(h.canonicalFactory).toHaveBeenCalledTimes(5);
    await vi.advanceTimersByTimeAsync(2500);
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(5500);
    await Promise.resolve();
    expect(h.canonicalFactory).toHaveBeenCalledTimes(7);
  });
});
