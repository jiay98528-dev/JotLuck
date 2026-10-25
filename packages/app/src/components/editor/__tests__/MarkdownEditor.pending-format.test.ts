import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import { describe, expect, it } from 'vitest';
import type { EditorView } from '@codemirror/view';
import MarkdownEditor from '../MarkdownEditor.vue';

interface EditorExpose {
  getEditorView(): EditorView | null;
}

/**
 * 段落预设待格式状态泄漏（E4）：预设（标题/引用）置 pendingFormat 后不随
 * 选区/交互清理，下一次任意位置 Enter 被 handlePendingFormatEnter 劫持为
 * 裸换行、短路智能续格式。修复口径：交互指针落下（格式 UI 之外皆算"移走"）
 * 或选区离开预设锚点时清理待格式态；inline 动作语义保持现状。
 */
describe('MarkdownEditor 段落预设待格式状态泄漏清理', () => {
  function pressEnter(view: EditorView): void {
    view.contentDOM.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    );
  }

  it('预设→点击他处→pending 清理，Enter 落在列表行走智能续格式（非裸换行）', async () => {
    const wrapper = mount(MarkdownEditor, {
      props: { modelValue: '标题行\n- 项甲', enableAutocomplete: false },
      attachTo: document.body,
    });
    const view = (wrapper.vm as unknown as EditorExpose).getEditorView();
    expect(view).not.toBeNull();

    // 光标置于首行行尾并应用标题预设：行变 '# 标题行'，待格式态挂起
    view!.dispatch({ selection: { anchor: 3 } });
    await wrapper.setProps({ pendingFormat: 'heading1' });
    await nextTick();
    expect(view!.state.doc.toString()).toBe('# 标题行\n- 项甲');
    // 应用后待格式态仍在（Enter 退出语义未触发）
    expect(wrapper.emitted('pending-format-ended')).toBeUndefined();

    // 点击他处（格式 UI 之外的交互指针落下）→ 清理待格式态并通知宿主
    document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }));
    expect(wrapper.emitted('pending-format-ended')).toBeTruthy();

    // 光标移到列表行行尾按 Enter：应续出 '- '，而非被残留 pending 劫持为裸换行
    view!.dispatch({ selection: { anchor: view!.state.doc.length } });
    pressEnter(view!);

    expect(view!.state.doc.toString()).toBe('# 标题行\n- 项甲\n- ');
    wrapper.unmount();
  });

  it('预设后未交互：下一次 Enter 仍走待格式退出语义（回归钉，行为不变）', async () => {
    const wrapper = mount(MarkdownEditor, {
      props: { modelValue: '标题行\n- 项甲', enableAutocomplete: false },
      attachTo: document.body,
    });
    const view = (wrapper.vm as unknown as EditorExpose).getEditorView();

    view!.dispatch({ selection: { anchor: 3 } });
    await wrapper.setProps({ pendingFormat: 'heading1' });
    await nextTick();

    // 未交互直接 Enter：pending 退出语义生效（清理 + 通知）
    pressEnter(view!);
    expect(wrapper.emitted('pending-format-ended')).toBeTruthy();
    // 标题行行尾 Enter 为裸换行（heading 无续格式），光标落新行
    expect(view!.state.doc.toString()).toBe('# 标题行\n\n- 项甲');
    wrapper.unmount();
  });

  it('inline 待格式语义保持现状：点击他处不清理（pending-format-ended 不发出）', async () => {
    const wrapper = mount(MarkdownEditor, {
      props: { modelValue: '正文', enableAutocomplete: false },
      attachTo: document.body,
    });
    const view = (wrapper.vm as unknown as EditorExpose).getEditorView();

    view!.dispatch({ selection: { anchor: 2 } });
    await wrapper.setProps({ pendingFormat: 'bold' });
    await nextTick();
    // inline 预设在光标处插入成对定界符：锚点在文末 → 正文****（光标在定界符对之间）
    expect(view!.state.doc.toString()).toBe('正文****');
    expect(wrapper.emitted('pending-format-ended')).toBeUndefined();

    document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }));
    // inline 动作不受交互清理影响（语义保持现状）
    expect(wrapper.emitted('pending-format-ended')).toBeUndefined();
    wrapper.unmount();
  });
});
