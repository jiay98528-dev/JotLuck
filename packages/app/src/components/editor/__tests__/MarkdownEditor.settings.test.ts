import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import { describe, expect, it } from 'vitest';
import type { EditorView } from '@codemirror/view';
import { indentUnit } from '@codemirror/language';
import MarkdownEditor from '../MarkdownEditor.vue';

interface EditorExpose {
  getEditorView(): EditorView | null;
}

/**
 * 设置页「编辑器」区四项在 MarkdownEditor 的应用契约：
 * - 字号/行高经宿主 CSS 变量（--editor-font-size / --editor-line-height）下发；
 * - Tab 宽度 = tabSize facet + indentUnit 同源（Tab 键缩进与列宽计数一致），
 *   运行中变更走 Compartment 重配（同一 view 实例，文档与选区保留）；
 * - 自动换行经 wrapCompartment：关闸后 contentDOM 失去 cm-lineWrapping 类。
 */
describe('MarkdownEditor editor settings application', () => {
  function hostOf(wrapper: { get(selector: string): { element: Element } }): HTMLElement {
    return wrapper.get('.markdown-editor').element as HTMLElement;
  }

  it('默认态对齐接线前行为：16px / 1.8 行高 / Tab 2 空格 / 恒换行', () => {
    const wrapper = mount(MarkdownEditor, {
      props: { modelValue: '# 标题', enableAutocomplete: false },
      attachTo: document.body,
    });
    const host = hostOf(wrapper);
    expect(host.style.getPropertyValue('--editor-font-size')).toBe('16px');
    expect(host.style.getPropertyValue('--editor-line-height')).toBe('1.8');

    const view = (wrapper.vm as unknown as EditorExpose).getEditorView();
    expect(view).not.toBeNull();
    expect(view!.state.tabSize).toBe(2);
    expect(view!.state.facet(indentUnit)).toBe('  ');
    expect(view!.contentDOM.classList.contains('cm-lineWrapping')).toBe(true);
    wrapper.unmount();
  });

  it('tabSize 运行中重配：同一 view 实例 2→4，facet 与缩进单元同步，文档保留', async () => {
    const wrapper = mount(MarkdownEditor, {
      props: { modelValue: '# 标题\n\n正文段落', enableAutocomplete: false },
      attachTo: document.body,
    });
    const before = (wrapper.vm as unknown as EditorExpose).getEditorView();
    expect(before!.state.tabSize).toBe(2);

    await wrapper.setProps({ tabSize: 4 });
    await nextTick();

    const after = (wrapper.vm as unknown as EditorExpose).getEditorView();
    expect(after).toBe(before); // Compartment 重配：不重建编辑器实例
    expect(after!.state.tabSize).toBe(4);
    expect(after!.state.facet(indentUnit)).toBe('    ');
    expect(after!.state.doc.toString()).toBe('# 标题\n\n正文段落');
    wrapper.unmount();
  });

  it('自动换行运行中关闭：contentDOM 失去 cm-lineWrapping 类（基础态 white-space: pre）', async () => {
    const wrapper = mount(MarkdownEditor, {
      props: { modelValue: '长文本', enableAutocomplete: false },
      attachTo: document.body,
    });
    const view = (wrapper.vm as unknown as EditorExpose).getEditorView();
    expect(view!.contentDOM.classList.contains('cm-lineWrapping')).toBe(true);

    await wrapper.setProps({ wordWrap: false });
    await nextTick();

    expect(view!.contentDOM.classList.contains('cm-lineWrapping')).toBe(false);

    await wrapper.setProps({ wordWrap: true });
    await nextTick();
    expect(view!.contentDOM.classList.contains('cm-lineWrapping')).toBe(true);
    wrapper.unmount();
  });

  it('字号/行高 props 变化即时反映到宿主 CSS 变量（无需重配编辑器）', async () => {
    const wrapper = mount(MarkdownEditor, {
      props: { modelValue: '文本', enableAutocomplete: false },
      attachTo: document.body,
    });
    await wrapper.setProps({ fontSize: 20, lineHeight: 2.1 });
    await nextTick();

    const host = hostOf(wrapper);
    expect(host.style.getPropertyValue('--editor-font-size')).toBe('20px');
    expect(host.style.getPropertyValue('--editor-line-height')).toBe('2.1');
    wrapper.unmount();
  });
});
