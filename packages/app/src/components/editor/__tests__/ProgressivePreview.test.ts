import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, type VueWrapper } from '@vue/test-utils';
import { nextTick } from 'vue';
import { renderMarkdown, parseDocument } from '@jotluck/renderer';
import { preparePreviewFragments, type PreviewFragment } from '@jotluck/renderer/progressive';
import ProgressivePreview from '../ProgressivePreview.vue';
import { DocumentAnalysis } from '@/services/document-analysis';
import { prepareDocumentHtml } from '@/services/progressive-print';

const wrappers: VueWrapper[] = [];
const sessions: DocumentAnalysis[] = [];
const scrollOwners: HTMLElement[] = [];
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
  scrollOwners.splice(0).forEach((owner) => owner.remove());
  vi.unstubAllGlobals();
});
async function create(source: string, scrollParent?: HTMLElement) {
  const analysis = new DocumentAnalysis();
  sessions.push(analysis);
  const wrapper = mount(ProgressivePreview, {
    attachTo: scrollParent ?? document.body,
    props: { source, analysis, options: {}, scrollParent },
  });
  wrappers.push(wrapper);
  await vi.waitFor(() => expect(analysis.previewComplete).toBe(true));
  await nextTick();
  await vi.waitFor(() => expect(wrapper.find('.preview-fragment h1').exists()).toBe(true));
  return { wrapper, analysis };
}

describe('virtual reading correctness', () => {
  it('mounts distant content and reports source positions using the host reading scroll', async () => {
    const owner = document.createElement('div');
    owner.innerHTML = '<div class="reader-workbench__bar"></div>';
    document.body.append(owner);
    scrollOwners.push(owner);
    Object.defineProperty(owner, 'clientHeight', { value: 300 });
    vi.spyOn(owner, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 100, 600, 300));
    vi.spyOn(owner.firstElementChild!, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(0, 100, 600, 50),
    );
    const source = '# Book\n\n' + 'ordinary paragraph\n\n'.repeat(300) + 'END-OF-HOST-SCROLL';
    const { wrapper } = await create(source, owner);
    const root = wrapper.element as HTMLElement;
    vi.spyOn(root, 'getBoundingClientRect').mockImplementation(
      () => new DOMRect(0, 150 - owner.scrollTop, 600, 8000),
    );
    expect(wrapper.text()).not.toContain('END-OF-HOST-SCROLL');
    owner.dispatchEvent(new Event('wheel'));
    (wrapper.vm as unknown as { scrollToPosition: (position: number) => void }).scrollToPosition(
      source.length - 1,
    );
    owner.dispatchEvent(new Event('scroll'));
    await vi.waitFor(() => expect(wrapper.text()).toContain('END-OF-HOST-SCROLL'));
    expect(owner.scrollTop).toBeGreaterThan(0);
    expect(root.scrollTop).toBe(0);
    await vi.waitFor(() =>
      expect(
        (wrapper.emitted('position-change')?.at(-1)?.[0] as { position: number })?.position,
      ).toBeGreaterThan(source.length / 2),
    );
  });
  it('copies across a not-yet-prepared gap and prints complete content after a priority jump', async () => {
    const source = '# Book\n\nstart\n\nmiddle **words**\n\n## Last\n\nlast';
    const fragments = await preparePreviewFragments(source);
    let normal!: (parts: PreviewFragment[]) => void;
    let priority!: (parts: PreviewFragment[]) => void;
    const analysis = {
      result: { ast: parseDocument(source), revision: 1 },
      version: 1,
      previewComplete: false,
      subscribe: () => () => {},
      subscribePreview: (listener: typeof normal) => {
        normal = listener;
        return () => {};
      },
      subscribePriority: (listener: typeof priority) => {
        priority = listener;
        return () => {};
      },
      update: () => {},
      requestRange: () => {},
      cancelPriority: () => {},
      requestPreview: () => normal(fragments.slice(0, 2)),
    } as unknown as DocumentAnalysis;
    const wrapper = mount(ProgressivePreview, {
      attachTo: document.body,
      props: { source, analysis, options: {} },
    });
    wrappers.push(wrapper);
    await vi.waitFor(() => expect(wrapper.text()).toContain('start'));
    priority(fragments.slice(-2));
    await vi.waitFor(() => expect(wrapper.text()).toContain('Last'));
    const paragraphs = wrapper.findAll('p');
    const range = document.createRange();
    range.setStart(paragraphs[0]!.element.firstChild!, 0);
    range.setEnd(paragraphs.at(-1)!.element.firstChild!, 4);
    document.getSelection()!.removeAllRanges();
    document.getSelection()!.addRange(range);
    const clipboard = new Map<string, string>();
    const event = new Event('copy', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', {
      value: { setData: (type: string, value: string) => clipboard.set(type, value) },
    });
    wrapper.element.dispatchEvent(event);
    expect(clipboard.get('text/plain')).toBe('start\nmiddle words\nLast\nlast');
    const html = await (
      wrapper.vm as unknown as { prepareFullHtml: () => Promise<string> }
    ).prepareFullHtml();
    expect(html).toContain('middle');
    expect(html).toContain('Last');
    document.getSelection()!.removeAllRanges();
  });
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
