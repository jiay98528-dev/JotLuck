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
        // 仅当失败请求仍是当前缓存条目时清空，避免失效后旧请求的迟到失败误清新缓存。
        if (cached === request) cached = null;
      });
  }
  return cached;
}

/**
 * 显式失效窗口级缓存。
 *
 * enable_external_edit / promote_external_file_to_notebook 成功后，后端窗口身份
 * 已切换，旧 bootstrap 结果不再可信；调用方须在路由跳转前调用本函数，使下一次
 * getWindowBootstrap 重新发起 IPC。重复调用幂等（缓存已清空时再清一次无副作用）。
 */
export function invalidateWindowBootstrap(): void {
  cached = null;
}
