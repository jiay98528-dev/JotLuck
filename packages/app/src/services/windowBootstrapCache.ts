import { invoke } from '@tauri-apps/api/core';
import type { WindowBootstrapPayload } from '@/types';

/**
 * 启动引导 IPC 的窗口级共享缓存。
 *
 * BootstrapPage 与 NotebookHome 冷启动都需要 get_window_bootstrap；
 * 各自 invoke 会串行发起两次 IPC。这里缓存同一份 Promise，窗口内
 * 第二个调用方立即复用结果；失败不缓存，下次调用自动重试。
 */
let cached: Promise<WindowBootstrapPayload> | null = null;

export function getWindowBootstrap(): Promise<WindowBootstrapPayload> {
  if (!cached) {
    const startedAt = performance.now();
    const request = invoke<WindowBootstrapPayload>('get_window_bootstrap');
    cached = request;
    void request
      .then((payload) => {
        performance.mark('jotluck:bootstrap-ipc-resolved', {
          detail: { mode: payload.mode, ms: Math.round(performance.now() - startedAt) },
        });
      })
      .catch(() => {
        cached = null;
      });
  }
  return cached;
}
