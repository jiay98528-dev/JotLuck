import { open as openWithSystem } from '@tauri-apps/plugin-shell';
import { translate } from '@/i18n';
import { isDesktopRuntime } from './runtime';

/**
 * URL 规范化工具
 *
 * 自动补全无协议头的链接，避免浏览器将其解析为相对路径。
 * 例如 www.bilibili.com → https://www.bilibili.com
 */

/**
 * 规范化 URL：无协议的裸域名自动补 https://。
 * 已带 http/https 或其他协议（mailto:/tel: 等）的链接原样通过。
 */
export function normalizeUrl(url: string): string {
  // Already has http/https protocol
  if (/^https?:\/\//i.test(url)) return url;
  // Has some other protocol (mailto:, tel:, ftp:, etc.)
  if (/^[a-z][a-z0-9+.-]*:/i.test(url)) return url;
  // Bare domain or www.xxx — prepend https://
  return 'https://' + url;
}

/**
 * 在系统默认应用中打开外部链接。
 *
 * Tauri WebView 不能依赖 window.open 唤起桌面浏览器，因此桌面端
 * 显式交给 shell 插件；Web 版保留原生新标签行为。
 *
 * 失败不再静默：桌面端 shell 打开失败时回退 window.open，仍失败时
 * 报告错误（console + 全局 Toast），避免“点击无反应”无从诊断。
 * 本函数不会 reject，调用方可安全地 `void openExternalUrl(...)`。
 */
export async function openExternalUrl(url: string): Promise<void> {
  const normalized = normalizeUrl(url);
  if (isDesktopRuntime()) {
    try {
      await openWithSystem(normalized);
      return;
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error(`[urlUtils] shell open failed for ${normalized}`, error);
      if (window.open(normalized, '_blank', 'noopener,noreferrer')) return;
      reportOpenFailure(normalized);
      return;
    }
  }
  if (!window.open(normalized, '_blank', 'noopener,noreferrer')) {
    reportOpenFailure(normalized);
  }
}

function reportOpenFailure(url: string): void {
  // eslint-disable-next-line no-console
  console.error(`[urlUtils] unable to open external url: ${url}`);
  // Toast 组件较重且仅主窗口挂载，失败路径才动态加载；不可用时保持 console-only。
  void import('@/components/common/Toast.vue')
    .then(({ useToast }) => {
      useToast().error(translate('errors.openExternalLink', { url }));
    })
    .catch(() => {});
}
