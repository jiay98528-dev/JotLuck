import { onBeforeUnmount } from 'vue';
import type { MarkdownPredictor } from '@/services/MarkdownPredictor';
import type { PublicFreeDecoderEngine } from '@/services/completion/public-free-decoder-engine';

export interface PublicDecoderFactoryResult {
  readonly engine: PublicFreeDecoderEngine | null;
  readonly channel: 'canonical' | 'flagged';
}

export interface PublicDecoderInstallResult {
  readonly ok: boolean;
}

export interface UsePublicDecoderSetupOptions {
  predictor: MarkdownPredictor;
  isUnmounted: () => boolean;
  createCanonicalEngine: () => Promise<PublicFreeDecoderEngine | null>;
  createFlaggedEngine: () => Promise<PublicFreeDecoderEngine | null>;
  maxAttempts?: number;
  retryDelaysMs?: readonly number[];
}

export interface UsePublicDecoderSetupReturn {
  setupNow(): Promise<void>;
  retryNow(): Promise<void>;
  getHealth(): ReturnType<MarkdownPredictor['getPublicEngineDiagnostics']>;
  cancel(): void;
  readonly attemptCount: () => number;
}

/**
 * Drives the canonical→flagged public-decoder fallback that the workspace page
 * used to perform once and forget. The previous implementation cached the
 * Promise with `??=` so any failure (factory returning null, warmup rejecting,
 * install returning false, or the silent fetch catch in
 * packages/app/src/services/completion/public-free-decoder-factory.ts:95-97)
 * became permanent for the lifetime of the page. This composable replaces that
 * single-shot cache with bounded auto-retry plus an explicit manual retry
 * exposed to the Settings dialog (工单 B / B1).
 */
export function usePublicDecoderSetup(
  options: UsePublicDecoderSetupOptions,
): UsePublicDecoderSetupReturn {
  const maxAttempts = Math.max(1, options.maxAttempts ?? 3);
  const retryDelaysMs = options.retryDelaysMs ?? [2000, 5000];
  const predictor = options.predictor;
  const isUnmounted = options.isUnmounted;

  let inFlight: Promise<void> | null = null;
  let attempts = 0;
  let pendingTimer: ReturnType<typeof setTimeout> | null = null;
  let cancelled = false;

  function clearPendingTimer(): void {
    if (pendingTimer !== null) {
      clearTimeout(pendingTimer);
      pendingTimer = null;
    }
  }

  async function installOne(
    factory: () => Promise<PublicFreeDecoderEngine | null>,
    channel: 'canonical' | 'flagged',
  ): Promise<boolean> {
    let engine: PublicFreeDecoderEngine | null = null;
    try {
      engine = await factory();
    } catch (error) {
      // eslint-disable-next-line no-console -- 工单 B / B1: 故障信号是修复目标本身
      console.warn(`[public-decoder-setup] factory(${channel}) rejected; will allow retry.`, error);
      return false;
    }
    if (!engine) {
      // eslint-disable-next-line no-console -- 工单 B / B1: 故障信号是修复目标本身
      console.warn(
        `[public-decoder-setup] factory(${channel}) returned null; treating as failure.`,
      );
      return false;
    }
    if (isUnmounted()) {
      try {
        await engine.dispose();
      } catch {
        // dispose 失败不得阻断卸载路径，也不得向 void 调用点抛出 rejection
      }
      return false;
    }
    try {
      const ok = await predictor.installPublicEngineForEvaluation(engine);
      if (!ok) {
        // eslint-disable-next-line no-console -- 工单 B / B1: 故障信号是修复目标本身
        console.warn(
          `[public-decoder-setup] installPublicEngineForEvaluation(${channel}) returned false.`,
        );
      }
      return ok;
    } catch (error) {
      // eslint-disable-next-line no-console -- 工单 B / B1: 故障信号是修复目标本身
      console.warn(
        `[public-decoder-setup] installPublicEngineForEvaluation(${channel}) rejected; will allow retry.`,
        error,
      );
      return false;
    }
  }

  async function attempt(): Promise<void> {
    attempts += 1;
    const canonicalOk = await installOne(options.createCanonicalEngine, 'canonical');
    if (canonicalOk) return;
    const flaggedOk = await installOne(options.createFlaggedEngine, 'flagged');
    if (flaggedOk) return;
    scheduleAutoRetry();
  }

  function scheduleAutoRetry(): void {
    if (cancelled || isUnmounted()) return;
    if (attempts >= maxAttempts) {
      // eslint-disable-next-line no-console -- 工单 B / B1: 故障信号是修复目标本身
      console.warn(
        `[public-decoder-setup] giving up auto-retry; ${attempts}/${maxAttempts} attempts failed.`,
      );
      return;
    }
    const delayIndex = Math.min(attempts - 1, retryDelaysMs.length - 1);
    const delay = retryDelaysMs[delayIndex] ?? retryDelaysMs[retryDelaysMs.length - 1] ?? 5000;
    clearPendingTimer();
    pendingTimer = setTimeout(() => {
      pendingTimer = null;
      if (cancelled || isUnmounted()) return;
      void runOnce();
    }, delay);
  }

  async function runOnce(): Promise<void> {
    if (cancelled || isUnmounted()) return;
    if (inFlight) {
      return inFlight;
    }
    inFlight = attempt().finally(() => {
      inFlight = null;
    });
    return inFlight;
  }

  function setupNow(): Promise<void> {
    cancelled = false;
    if (inFlight) return inFlight;
    if (attempts === 0) {
      return runOnce();
    }
    // Subsequent setupNow() calls while a timer is pending kick off the pending
    // attempt early; it still consumes the same budget the timer would have used.
    if (pendingTimer !== null) {
      clearPendingTimer();
      return runOnce();
    }
    return Promise.resolve();
  }

  async function retryNow(): Promise<void> {
    cancelled = false;
    clearPendingTimer();
    attempts = 0;
    await runOnce();
  }

  function cancel(): void {
    cancelled = true;
    clearPendingTimer();
  }

  onBeforeUnmount(() => {
    cancel();
  });

  return {
    setupNow,
    retryNow,
    getHealth: () => predictor.getPublicEngineDiagnostics(),
    cancel,
    attemptCount: () => attempts,
  };
}
