import { isTauri } from '@tauri-apps/api/core';

export function isDesktopRuntime(): boolean {
  return isTauri();
}

export function shouldPersistMockFs(): boolean {
  return (
    import.meta.env.MODE === 'e2e' ||
    import.meta.env.VITE_MARKLUCK_MOCKFS_PERSIST === '1' ||
    Boolean(window.__markluck_e2e)
  );
}
