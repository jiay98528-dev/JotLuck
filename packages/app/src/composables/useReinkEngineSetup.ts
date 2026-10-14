import { onBeforeUnmount, ref, type Ref } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { isDesktopRuntime } from '@/utils/runtime';
import type { MarkdownPredictor } from '@/services/MarkdownPredictor';
import { ReinkEngine } from '@/services/completion/reink-engine';
import {
  getReinkSettings,
  subscribeReinkSettings,
  type ReinkSettings,
} from '@/services/completion/reink-settings';

export type ReinkSetupStatus =
  | 'idle'
  | 'disabled'
  | 'configuring'
  | 'installing'
  | 'installed'
  | 'ready'
  | 'error';

export interface UseReinkEngineSetupOptions {
  predictor: MarkdownPredictor;
  /** 浏览器预览等无桌面宿主的场景：不可用不算失败，保持 idle 静默退出。 */
  isAvailable?: () => boolean;
  isUnmounted: () => boolean;
  /**
   * Reink 撤下（禁用/失败回退）后恢复默认公共引擎（如 canonical→flagged
   * public-free-decoder 链）；可选，失败静默。
   */
  restoreDefaultEngine?: () => void | Promise<void>;
}

export interface UseReinkEngineSetupReturn {
  setupNow(): Promise<void>;
  cancel(): void;
  /** 供后续 SettingsDialog 工单展示；本工单只暴露状态。 */
  readonly status: Ref<ReinkSetupStatus>;
  readonly error: Ref<string | null>;
}

/**
 * Reink-1.0 引擎安装编排（工单 S5）：
 * - enabled 时 invoke reink_configure → 创建 ReinkEngine 装进 predictor 的
 *   公共引擎槽位（同一槽位后装胜出——Reink 在默认引擎装完后安装即接管）；
 * - 安装成功后 idle 3s 后台 warmup（真实 spawn + warm 帧）；
 * - 设置变更热重装（先 dispose 旧的再装新的）；
 * - 任何失败静默降级：撤下 Reink、恢复默认引擎链，不向 UI 抛错，
 *   状态只记录在返回的 status/error ref 里。
 */
export function useReinkEngineSetup(
  options: UseReinkEngineSetupOptions,
): UseReinkEngineSetupReturn {
  const status = ref<ReinkSetupStatus>('idle');
  const error = ref<string | null>(null);
  const predictor = options.predictor;
  const isUnmounted = options.isUnmounted;

  let generation = 0;
  let installedEngine: ReinkEngine | null = null;
  let idleWarmupTimer: ReturnType<typeof setTimeout> | null = null;
  let unsubscribeSettings: (() => void) | null = null;
  let cancelled = false;
  let swapChain: Promise<void> = Promise.resolve();

  function warn(message: string, detail?: unknown): void {
    if (isDesktopRuntime())
      // eslint-disable-next-line no-console
      console.warn(`[reink-engine-setup] ${message}`, detail ?? '');
  }

  function clearIdleWarmupTimer(): void {
    if (idleWarmupTimer !== null) {
      clearTimeout(idleWarmupTimer);
      idleWarmupTimer = null;
    }
  }

  async function teardown(restoreDefault: boolean): Promise<void> {
    generation += 1;
    clearIdleWarmupTimer();
    const engine = installedEngine;
    installedEngine = null;
    if (!engine) return;
    try {
      await predictor.removePublicEngineForEvaluation(engine.id);
    } catch {
      // 槽位已被后装引擎接管时此处返回 false/抛错，均不影响流程
    }
    try {
      await engine.dispose();
    } catch {
      // dispose 失败不得阻断降级路径
    }
    if (restoreDefault) {
      try {
        await options.restoreDefaultEngine?.();
      } catch {
        warn('restoreDefaultEngine rejected during teardown');
      }
    }
  }

  async function recoverWithDefault(message: string): Promise<void> {
    error.value = message;
    status.value = 'error';
    await teardown(true);
  }

  async function applySettings(settings: ReinkSettings, runGeneration: number): Promise<void> {
    if (cancelled || isUnmounted() || options.isAvailable?.() === false) return;
    if (runGeneration !== generation) return;

    if (!settings.enabled) {
      await teardown(true);
      error.value = null;
      status.value = 'disabled';
      return;
    }

    status.value = 'configuring';
    try {
      await invoke('reink_configure', {
        request: {
          pythonPath: settings.pythonPath,
          runtimeDir: settings.runtimeDir,
          tier: settings.tier,
          fast: settings.mode === 'fast',
        },
      });
    } catch (configureError) {
      warn('reink_configure rejected; falling back to the default engine.', configureError);
      await recoverWithDefault(errorMessage(configureError));
      return;
    }
    if (runGeneration !== generation || cancelled || isUnmounted()) return;

    status.value = 'installing';
    const engine = new ReinkEngine({ tier: settings.tier, mode: settings.mode });
    try {
      const ok = await predictor.installPublicEngineForEvaluation(engine);
      if (!ok) throw new Error('reink engine install was rejected by the router');
    } catch (installError) {
      warn('installPublicEngineForEvaluation rejected; falling back.', installError);
      try {
        await engine.dispose();
      } catch {
        // 引擎被 router 拒绝后的 dispose 失败可忽略
      }
      await recoverWithDefault(errorMessage(installError));
      return;
    }
    if (runGeneration !== generation || cancelled || isUnmounted()) {
      try {
        await predictor.removePublicEngineForEvaluation(engine.id);
      } catch {
        // 竞态撤回失败交由 teardown/dispose 兜底
      }
      try {
        await engine.dispose();
      } catch {
        // 同上
      }
      await Promise.resolve(options.restoreDefaultEngine?.()).catch(() => {
        warn('restoreDefaultEngine rejected after a superseded install');
      });
      return;
    }

    installedEngine = engine;
    status.value = 'installed';
    scheduleIdleWarmup(runGeneration);
  }

  function scheduleIdleWarmup(runGeneration: number): void {
    clearIdleWarmupTimer();
    idleWarmupTimer = setTimeout(() => {
      idleWarmupTimer = null;
      const engine = installedEngine;
      if (!engine || runGeneration !== generation || cancelled || isUnmounted()) return;
      void engine
        .ensureWarmed()
        .then((warmed) => {
          if (runGeneration !== generation || cancelled || isUnmounted()) return;
          if (warmed) {
            status.value = 'ready';
            error.value = null;
            return;
          }
          warn('idle warmup failed; falling back to the default engine.');
          return recoverWithDefault(engine.diagnostics().lastError ?? 'reink warmup failed');
        })
        .catch((warmupError: unknown) => {
          warn('idle warmup rejected; falling back to the default engine.', warmupError);
          return recoverWithDefault(errorMessage(warmupError));
        });
    }, 3_000);
  }

  function enqueue(job: () => Promise<void>): Promise<void> {
    swapChain = swapChain.then(job).catch(() => {
      // swap 链上的错误已在内部处理为降级；链本身不得断裂
    });
    return swapChain;
  }

  async function setupNow(): Promise<void> {
    cancelled = false;
    unsubscribeSettings ??= subscribeReinkSettings((settings) => {
      void enqueue(() => hotSwap(settings));
    });
    return enqueue(() => applySettings(getReinkSettings(), generation));
  }

  async function hotSwap(settings: ReinkSettings): Promise<void> {
    if (cancelled || isUnmounted()) return;
    if (!settings.enabled) {
      // 禁用路径交给 applySettings 的 disabled 分支：teardown 会恢复默认引擎链。
      await applySettings(settings, generation);
      return;
    }
    // 先撤下旧引擎但不恢复默认（新设置马上重装）；若后续安装失败，
    // applySettings 的错误路径会恢复默认引擎链。
    await teardown(false);
    await applySettings(settings, generation);
  }

  function cancel(): void {
    cancelled = true;
    clearIdleWarmupTimer();
    unsubscribeSettings?.();
    unsubscribeSettings = null;
    void teardown(false);
  }

  onBeforeUnmount(() => {
    cancel();
  });

  return {
    setupNow,
    cancel,
    status,
    error,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
