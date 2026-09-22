import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, type VueWrapper } from '@vue/test-utils';
import { nextTick } from 'vue';
import { renderMarkdown } from '@jotluck/renderer';
import ProgressivePreview from '../ProgressivePreview.vue';
import { DocumentAnalysis } from '@/services/document-analysis';
import { prepareDocumentHtml } from '@/services/progressive-print';

const wrappers: VueWrapper[] = [];
const sessions: DocumentAnalysis[] = [];
beforeEach(() => {
  vi.stubGlobal('Worker', undefined);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  sessions.splice(0).forEach((session) => session.destroy());
  vi.unstubAllGlobals();
});
async function create(source: string) {
  const analysis = new DocumentAnalysis();
  sessions.push(analysis);
  const wrapper = mount(ProgressivePreview, {
    attachTo: document.body,
    props: { source, analysis, options: {} },
  });
  wrappers.push(wrapper);
  await vi.waitFor(() => expect(analysis.previewComplete).toBe(true));
  await nextTick();
  await vi.waitFor(() => expect(wrapper.find('.preview-fragment h1').exists()).toBe(true));
  return { wrapper, analysis };
}

describe('virtual reading correctness', () => {
  it('progressively fills a long paragraph without splitting its paragraph or bold semantics', async () => {
    const text = '长段落 mixed text '.repeat(7000).trimEnd();
    const { wrapper } = await create('# Book\n\n**' + text + '**');
    await vi.waitFor(
      () => {
        const actual = wrapper
          .findAll('strong')
          .map((node) => node.text())
          .join('');
        expect(actual.replaceAll(' ', '').length).toBe(text.replaceAll(' ', '').length);
      },
      { timeout: 5000 },
    );
    expect(wrapper.findAll('.preview-fragment p')).toHaveLength(1);
  });
  it('copies the whole document, including text not mounted in the viewport', async () => {
    const source =
      '# Book\n\n' +
      Array.from({ length: 150 }, (_, i) => `Paragraph **${i}** with text.\n\n`).join('') +
      'END-OF-BOOK';
    const { wrapper } = await create(source);
    expect(wrapper.findAll('.preview-fragment').length).toBeLessThan(150);
    expect(wrapper.text()).not.toContain('END-OF-BOOK');
    await wrapper.trigger('keydown', { key: 'a', ctrlKey: true });
    const clipboard = new Map<string, string>();
    const event = new Event('copy', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', {
      value: { setData: (type: string, value: string) => clipboard.set(type, value) },
    });
    wrapper.element.dispatchEvent(event);
    const expected = document.createElement('div');
    expected.innerHTML = renderMarkdown(source);
    expect(clipboard.get('text/plain')).toBe(expected.textContent);
  });
  it('uses full source for a search target outside mounted fragments', async () => {
    const source = '# Book\n\n' + 'Ordinary paragraph.\n\n'.repeat(200) + 'TAIL-NEEDLE';
    const { wrapper } = await create(source);
    await wrapper.trigger('keydown', { key: 'f', ctrlKey: true });
    await wrapper.find('input').setValue('TAIL-NEEDLE');
    await vi.waitFor(() => expect(wrapper.text()).toContain('TAIL-NEEDLE'));
  });
  it('cancels printing before any work and prepares every large-document fragment', async () => {
    const signal = AbortSignal.abort();
    await expect(prepareDocumentHtml('text', undefined, signal)).rejects.toThrow('cancelled');
    const source =
      '# Book\n\n' + 'paragraph text\n\n'.repeat(8000) + '# Final chapter\n\nPRINT-END';
    const html = await prepareDocumentHtml(source);
    const dom = document.createElement('div');
    dom.innerHTML = html;
    expect(dom.textContent).toContain('PRINT-END');
    expect(dom.querySelectorAll('p')).toHaveLength(8001);
    expect(dom.querySelectorAll('h1')).toHaveLength(2);
  }, 20000);
});
