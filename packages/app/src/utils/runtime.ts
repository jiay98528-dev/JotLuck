import { isTauri } from '@tauri-apps/api/core';

export function isDesktopRuntime(): boolean {
  return isTauri();
}

export function shouldPersistMockFs(): boolean {
  return (
    import.meta.env.MODE === 'e2e' ||
    import.meta.env.VITE_JotLuck_MOCKFS_PERSIST === '1' ||
    Boolean(window.__jotluck_e2e)
  );
}
