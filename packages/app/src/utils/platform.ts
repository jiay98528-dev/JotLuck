import { invoke, isTauri } from '@tauri-apps/api/core';
import { currentPlatformOS, type PlatformOS } from './platform-signal';

export type { PlatformOS };
export { currentPlatformOS };

let cachedPlatform: PlatformOS | null = null;
let initPromise: Promise<PlatformOS> | null = null;

function setCachedPlatform(next: PlatformOS): void {
  cachedPlatform = next;
  // 响应式镜像：i18n postTranslation 等同步渲染层从零依赖信号模块读取。
  currentPlatformOS.value = next;
}

function detectFromNavigator(): PlatformOS {
  const hint = `${navigator.platform ?? ''} ${navigator.userAgent ?? ''}`.toLowerCase();
  if (hint.includes('mac') || hint.includes('iphone') || hint.includes('ipad')) return 'macos';
  if (hint.includes('win')) return 'windows';
  return 'linux';
}

export async function getPlatformOS(): Promise<PlatformOS> {
  if (cachedPlatform) return cachedPlatform;
  initPromise ??= (async () => {
    let next: PlatformOS;
    // E2E（vite preview + mock 桥）始终模拟 Windows 桌面——与全仓
    // Control+ 断言的既有语义一致；欢迎引导的关联勾选框等 Windows
    // 分支 UI 需要它在测试里可见。
    if (Boolean((globalThis as { __jotluck_e2e?: boolean }).__jotluck_e2e)) {
      setCachedPlatform('windows');
      return 'windows';
    }
    if (isTauri()) {
      try {
        const value = await invoke<string>('platform_os');
        next = value === 'windows' || value === 'macos' ? value : 'linux';
      } catch {
        next = detectFromNavigator();
      }
    } else {
      next = detectFromNavigator();
    }
    setCachedPlatform(next);
    return next;
  })();
  return initPromise;
}

export function initializePlatform(): Promise<PlatformOS> {
  return getPlatformOS();
}

export function getPlatformOSSync(): PlatformOS | null {
  return cachedPlatform;
}

export function isWindows(): boolean {
  return cachedPlatform === 'windows';
}

export function isMac(): boolean {
  return cachedPlatform === 'macos';
}

export function isLinux(): boolean {
  return cachedPlatform === 'linux';
}

/** 测试注入用：重置平台缓存与响应式镜像。 */
export function resetPlatformForTesting(): void {
  cachedPlatform = null;
  initPromise = null;
  currentPlatformOS.value = 'windows';
}

// macOS 惯例符号（按修饰层级从组合到单键替换；Ctrl/Cmd 双写归一）。
const CTRL_SHIFT_TOKEN = /\bCtrl\s*\+\s*Shift\s*\+\s*/gu;
const CTRL_CMD_TOKEN = /\bCtrl\s*\/\s*Cmd\s*\+\s*/gu;
const CTRL_TOKEN = /\bCtrl\s*\+\s*/gu;

/**
 * Rewrite `Ctrl+X` style labels for the running OS. macOS renders Command
 * symbols（Ctrl+Shift+X → ⇧⌘X、Ctrl/Cmd+O → ⌘O、Ctrl+X → ⌘X、Ctrl+点击
 * → ⌘点击）；Windows/Linux keep Ctrl. Accepts full strings like `加粗
 * (Ctrl+B)` or `选中文字以格式化 · Ctrl+点击固定区块`.
 */
export function formatShortcut(
  label: string,
  platform: PlatformOS | null = cachedPlatform,
): string {
  if (platform !== 'macos') return label;
  return label
    .replace(CTRL_SHIFT_TOKEN, '⇧⌘')
    .replace(CTRL_CMD_TOKEN, '⌘')
    .replace(CTRL_TOKEN, '⌘');
}
