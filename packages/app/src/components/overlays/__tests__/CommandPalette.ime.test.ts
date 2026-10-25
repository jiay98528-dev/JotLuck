import { mount, type VueWrapper } from '@vue/test-utils';
import { nextTick } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useSearchStore } from '@/stores/search';
import type { SearchResult } from '@/types';
import CommandPalette from '../CommandPalette.vue';

/**
 * 命令面板 IME 守卫（E7）：handleKeydown 与 handleWindowKeydown 补
 * isComposing/keyCode=229 守卫（对齐 MarkdownEditor 既有先例）——组合期
 * Enter 是确认候选不误选、Escape 是取消组合不误关面板。
 */
const RESULT: SearchResult = {
  notePath: '/甲.md',
  noteTitle: '甲',
  matches: [],
  score: 1,
};

describe('CommandPalette IME 组合守卫', () => {
  let wrapper: VueWrapper | null = null;

  function mountPalette() {
    const searchStore = useSearchStore();
    searchStore.setResults([RESULT]);
    wrapper = mount(CommandPalette, {
      props: { visible: true },
      global: { stubs: { Teleport: true, Transition: false } },
      attachTo: document.body,
    });
    return wrapper;
  }

  function composingEvent(key: string): KeyboardEvent {
    // isComposing=true 且 IME 确认键常用 keyCode 229（Chrome 语义）
    return new KeyboardEvent('keydown', {
      key,
      bubbles: true,
      cancelable: true,
    });
  }

  beforeEach(() => {
    setActivePinia(createPinia());
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    document.body.replaceChildren();
  });

  it('组合期 Enter 不误选结果（isComposing）', async () => {
    const palette = mountPalette();
    await nextTick();
    const overlay = palette.get('.palette-overlay');

    const event = composingEvent('Enter');
    Object.defineProperty(event, 'isComposing', { value: true });
    overlay.element.dispatchEvent(event);

    expect(palette.emitted('select-result')).toBeUndefined();
    // 面板未关闭（组合期 Enter 不触发选中关闭链）
    expect(palette.emitted('update:visible')).toBeUndefined();
  });

  it('组合期 Escape 不误关面板（keyCode 229 通道）', async () => {
    const palette = mountPalette();
    await nextTick();

    // 捕获监听挂在 window：IME 确认键走 keyCode=229（isComposing 可能已被清）
    const event = composingEvent('Escape');
    Object.defineProperty(event, 'keyCode', { value: 229 });
    window.dispatchEvent(event);

    expect(palette.emitted('update:visible')).toBeUndefined();
  });

  it('非组合期 Enter 正常选中、Escape 正常关闭（守卫不误伤常规导航）', async () => {
    const palette = mountPalette();
    await nextTick();
    const overlay = palette.get('.palette-overlay');

    overlay.element.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    );
    expect(palette.emitted('select-result')).toEqual([[RESULT]]);
    // 选中即关闭
    expect(palette.emitted('update:visible')).toEqual([[false]]);
    palette.setProps({ visible: true });
    await nextTick();

    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    );
    expect(palette.emitted('update:visible')?.at(-1)).toEqual([false]);
  });
});
