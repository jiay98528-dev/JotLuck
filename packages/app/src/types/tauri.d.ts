import type { MarkluckE2EBridge } from '@/utils/e2e-bridge';

/**
 * Runtime globals.
 *
 * `window.__markluck_e2e` is only created by the Vite `e2e` mode bridge.
 */
declare global {
  interface Window {
    __markluck_e2e?: MarkluckE2EBridge;
  }
}

export {};
