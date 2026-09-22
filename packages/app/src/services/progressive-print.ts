import { finalizePreparedHtml, renderMarkdown, type RendererOptions } from '@jotluck/renderer';
import type { PreviewFragment } from '@jotluck/renderer/progressive';
import { DocumentAnalysis, isLargeDocument } from './document-analysis';

/** Full source, never the virtual preview DOM. Caller prints only after completion. */
export async function prepareDocumentHtml(
  source: string,
  options?: RendererOptions,
  signal?: AbortSignal,
): Promise<string> {
  const aborted = () => {
    if (signal?.aborted) throw new DOMException('Export cancelled', 'AbortError');
  };
  aborted();
  if (!isLargeDocument(source)) return renderMarkdown(source, options);
  const analysis = new DocumentAnalysis();
  try {
    const fragments = await new Promise<PreviewFragment[]>((resolve, reject) => {
      let unsubscribe = () => {};
      const cleanup = () => {
        if (timer !== undefined) clearInterval(timer);
        unsubscribe();
        signal?.removeEventListener('abort', onAbort);
      };
      const onAbort = () => {
        cleanup();
        reject(new DOMException('Export cancelled', 'AbortError'));
      };
      unsubscribe = analysis.subscribePreview((parts) => {
        if (analysis.previewComplete) {
          cleanup();
          resolve(parts);
        }
      });
      signal?.addEventListener('abort', onAbort, { once: true });
      const timer = setInterval(() => {
        if (analysis.error) {
          cleanup();
          reject(analysis.error);
        }
      }, 50);
      analysis.update(source);
    });
    const html: string[] = [];
    let deadline = performance.now() + 8;
    for (const fragment of fragments) {
      aborted();
      html.push(finalizePreparedHtml(fragment.html, options));
      if (performance.now() >= deadline) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        deadline = performance.now() + 8;
      }
    }
    aborted();
    return html.join('');
  } finally {
    analysis.destroy();
  }
}
