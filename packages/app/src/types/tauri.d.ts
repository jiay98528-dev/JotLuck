/**
 * Tauri runtime type declarations.
 *
 * window.__TAURI__ is injected by Tauri at runtime (tauri dev / tauri build).
 * Not present in vite dev / E2E test environments.
 */
declare global {
  interface Window {
    __TAURI__?: {
      /** Convert a device path to a URL that the webview can load */
      convertFileSrc: (filePath: string, protocol?: string) => string;
    };

    // ── E2E diagnostic hooks (MarkdownEditor.vue) ──
    __markluck_getEditorContent?: () => string;
    __markluck_getEditorView?: () => unknown;
    __markluck_editorInitValue?: string;
    __markluck_predictor?: unknown;
    __markluck_mockOpenedFile?: {
      absolutePath: string;
      notebookRoot?: string;
      relativePath?: string;
    };
    __markluck_externalFiles?: Record<string, string>;
    __markluck_externalWrites?: Array<{
      absolutePath: string;
      content: string;
      time: number;
    }>;
    __markluck_modelOverwrites?: Array<{
      fromLen: number;
      toLen: number;
      fromStart: string;
      toStart: string;
      time: number;
    }>;
    __markluck_lifecycleLog?: Array<{
      event: 'setup' | 'mounted' | 'unmounting' | 'unmounted';
      id: string;
      t: number;
      hasView?: boolean;
      docLen?: number;
    }>;
  }
}

export {};
