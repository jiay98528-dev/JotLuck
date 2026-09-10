import { invoke, isTauri } from '@tauri-apps/api/core';

export type PlatformOS = 'windows' | 'macos' | 'linux';

let cachedPlatform: PlatformOS | null = null;
let initPromise: Promise<PlatformOS> | null = null;

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
    cachedPlatform = next;
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

const CTRL_TOKEN = /\bCtrl\s*\+\s*([A-Za-z0-9]+)/gu;

/**
 * Rewrite `Ctrl+X` style labels for the running OS. macOS renders Command;
 * Windows/Linux keep Ctrl. Accepts full strings like `Bold (Ctrl+B)`.
 */
export function formatShortcut(
  label: string,
  platform: PlatformOS | null = cachedPlatform,
): string {
  if (platform !== 'macos') return label;
  return label.replace(CTRL_TOKEN, '⌘$1');
}
