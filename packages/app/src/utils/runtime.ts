import { isTauri } from '@tauri-apps/api/core';
import { currentPlatform, type OsPlatform } from './platform';

export type { OsPlatform };
export { currentPlatform };

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
      // 动态导入：模块顶层仅依赖 isTauri，避免旧测试对
      // @tauri-apps/api/core 的最小 mock（只有 isTauri）被 invoke 具名
      // 导入打破；运行时行为不变。
      const { invoke } = await import('@tauri-apps/api/core');
      const platform = await invoke<string>('get_platform');
      const value: OsPlatform = platform === 'macos' || platform === 'linux' ? platform : 'windows';
      cachedPlatform = value;
      currentPlatform.value = value;
      return value;
    } catch {
      return 'windows';
    } finally {
      platformPromise = null;
    }
  })();
  return platformPromise;
}

/** 应用挂载前调用一次（幂等）：解析平台并更新 currentPlatform。 */
export function initOsPlatform(): Promise<OsPlatform> {
  return getOsPlatform();
}

/** 测试注入用：重置平台缓存与响应式镜像。 */
export function resetOsPlatformCacheForTesting(): void {
  cachedPlatform = null;
  currentPlatform.value = 'windows';
}

export function shouldPersistMockFs(): boolean {
  return (
    import.meta.env.MODE === 'e2e' ||
    import.meta.env.VITE_JotLuck_MOCKFS_PERSIST === '1' ||
    Boolean(window.__jotluck_e2e)
  );
}
