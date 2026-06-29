import type { MarkluckE2EBridge } from '@/utils/e2e-bridge';

/**
 * Runtime globals.
 *
 * `window.__TAURI__` is injected by Tauri at runtime.
 * `window.__markluck_e2e` is only created by the Vite `e2e` mode bridge.
 */
declare global {
  interface Window {
    __TAURI__?: {
      /** Convert a device path to a URL that the webview can load. */
      convertFileSrc: (filePath: string, protocol?: string) => string;
    };
    __markluck_e2e?: MarkluckE2EBridge;
  }
}

export {};
