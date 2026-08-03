import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import { describe, expect, it, vi } from 'vitest';
import type { EditorView } from '@codemirror/view';
import MarkdownEditor from '../MarkdownEditor.vue';

interface EditorExpose {
  getEditorView(): EditorView | null;
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
