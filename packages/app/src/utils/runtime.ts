import { isTauri } from '@tauri-apps/api/core';
import { invoke } from '@tauri-apps/api/core';

export type OsPlatform = 'macos' | 'windows' | 'linux';

export function isDesktopRuntime(): boolean {
  return isTauri();
}

let cachedPlatform: OsPlatform | null = null;
let platformPromise: Promise<OsPlatform> | null = null;

/**
 * 桌面运行时返回真实操作系统（Rust get_platform：macos/windows/linux）。
 * Web 预览回落 'windows'：产品下载页与 e2e 断言均以 Windows 语义为准，
 * 保持既有行为零变化；失败时同样回落并清缓存，下次重试。
 */
export function getOsPlatform(): Promise<OsPlatform> {
  if (cachedPlatform) return Promise.resolve(cachedPlatform);
  if (platformPromise) return platformPromise;
  platformPromise = (async () => {
    if (!isDesktopRuntime()) return 'windows';
    try {
      const platform = await invoke<string>('get_platform');
      const value = platform === 'macos' || platform === 'linux' ? platform : 'windows';
      cachedPlatform = value;
      return value;
    } catch {
      return 'windows';
    } finally {
      platformPromise = null;
    }
  })();
  return platformPromise;
}

/** 测试注入用：重置平台缓存。 */
export function resetOsPlatformCacheForTesting(): void {
  cachedPlatform = null;
}

export function shouldPersistMockFs(): boolean {
  return (
    import.meta.env.MODE === 'e2e' ||
    import.meta.env.VITE_JotLuck_MOCKFS_PERSIST === '1' ||
    Boolean(window.__jotluck_e2e)
  );
}
