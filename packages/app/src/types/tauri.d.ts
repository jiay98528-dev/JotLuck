import type { JotLuckE2EBridge } from '@/utils/e2e-bridge';

/**
 * Runtime globals.
 *
 * `window.__jotluck_e2e` is only created by the Vite `e2e` or the isolated
 * `autocomplete-v2r-evaluation` mode bridge. Normal production builds never
 * expose it.
 */
declare global {
  const __APP_VERSION__: string;

  interface Window {
    __jotluck_e2e?: JotLuckE2EBridge;
  }
}

export {};
