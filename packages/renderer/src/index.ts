/**
 * @markluck/renderer — Markdown rendering pipeline
 *
 * Markdown text → marked parse → DOMPurify sanitize → highlight.js → safe HTML
 *
 * Shared by @markluck/app (main editor) and @markluck/vscode-ext (VS Code webview).
 */

/**
 * Render Markdown string to safe HTML.
 * Placeholder implementation — full pipeline built in M1.
 */
export function renderMarkdown(_source: string): string {
  // M0 placeholder — implementation in M1
  return '';
}

export type { RendererOptions, RenderResult } from './types';
