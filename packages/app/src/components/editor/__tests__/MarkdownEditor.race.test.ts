import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import { describe, expect, it, vi } from 'vitest';
import type { EditorView } from '@codemirror/view';
import MarkdownEditor from '../MarkdownEditor.vue';

interface EditorExpose {
  getEditorView(): EditorView | null;
  refreshRenderedAnnotations(): void;
}

describe('MarkdownEditor transition hardening', () => {
  it('reconfigures read-only state without removing selectable document text', async () => {
    const wrapper = mount(MarkdownEditor, {
      props: {
        modelValue: '# 可复制正文',
        enableAutocomplete: false,
        readOnly: false,
      },
      attachTo: document.body,
    });
    const exposed = wrapper.vm as unknown as EditorExpose;
    const view = exposed.getEditorView();
    expect(view?.state.readOnly).toBe(false);

    await wrapper.setProps({ readOnly: true });
    await nextTick();

    expect(view?.state.readOnly).toBe(true);
    expect(view?.state.doc.toString()).toBe('# 可复制正文');
    expect(view?.contentDOM.textContent).toContain('可复制正文');
    wrapper.unmount();
  });

  it('uses the latest paste handler and prevents default in the original event turn', async () => {
    const wrapper = mount(MarkdownEditor, {
      props: {
        modelValue: '',
        enableAutocomplete: false,
      },
      attachTo: document.body,
    });
    const onEditorPaste = vi.fn(() => true);
    await wrapper.setProps({ onEditorPaste });

    const paste = new Event('paste', { bubbles: true, cancelable: true });
    wrapper.get('.markdown-editor').element.dispatchEvent(paste);

    expect(onEditorPaste).toHaveBeenCalledTimes(1);
    expect(paste.defaultPrevented).toBe(true);
    wrapper.unmount();
  });
});

describe('MarkdownEditor annotateRenderedBlock decoupling', () => {
  it('更换 annotateRenderedBlock 函数身份不触发 reconfigure：渲染块 DOM 不重建', async () => {
    const wrapper = mount(MarkdownEditor, {
      props: {
        modelValue: '# 标题\n\n段落正文内容',
        enableAutocomplete: false,
        livePreview: true,
        annotateRenderedBlock: () => {},
      },
      attachTo: document.body,
    });

    // 光标不在标题块 → 标题保持渲染 widget；捕获其 DOM 引用
    const block = await vi.waitFor(() => {
      const found = wrapper.element.querySelector('[data-block-key]') as HTMLElement | null;
      expect(found).not.toBeNull();
      return found!;
    });
    const view = (wrapper.vm as unknown as EditorExpose).getEditorView();
    expect(view).not.toBeNull();

    await wrapper.setProps({ annotateRenderedBlock: () => {} }); // 新函数身份
    await nextTick();
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    await nextTick();

    // 未走 livePreviewCompartment.reconfigure（插件未销毁）：捕获元素仍连接在
    // 同一编辑器视图内（reconfigure 会销毁插件并重建全部 widget DOM）
    expect(block.isConnected).toBe(true);
    expect(view!.dom.contains(block)).toBe(true);
    wrapper.unmount();
  });

  it('refreshRenderedAnnotations 在 livePreview=false 时为安全 no-op', async () => {
    const wrapper = mount(MarkdownEditor, {
      props: {
        modelValue: '# 标题',
        enableAutocomplete: false,
        livePreview: false,
      },
      attachTo: document.body,
    });
    const exposed = wrapper.vm as unknown as EditorExpose;
    const view = exposed.getEditorView();
    const dispatchSpy = vi.spyOn(view!, 'dispatch');

    expect(() => exposed.refreshRenderedAnnotations()).not.toThrow();
    expect(dispatchSpy).not.toHaveBeenCalled();
    dispatchSpy.mockRestore();
    wrapper.unmount();
  });
});
