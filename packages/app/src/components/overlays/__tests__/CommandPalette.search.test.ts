import { mount, type VueWrapper } from '@vue/test-utils';
import { nextTick } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useSearchStore } from '@/stores/search';
import { useIndexStore } from '@/stores/notebookIndex';
import { translate } from '@/i18n';
import type { SearchResult } from '@/types';
import CommandPalette from '../CommandPalette.vue';

/**
 * 命令面板搜索状态接线（SC + IX）：
 * - SC-1：清空输入框同步打通 useSearch 清空分支（旧结果不再残留）；
 * - SC-2：重开面板打开空白面板（不自动恢复上一轮查询重放）；
 *         外部预设查询（tag 点击 → tag:xxx）一次性消费仍生效；
 * - IX：索引失败态（超限/不可用）空态透出 store 的错误文案，替代误导性「无匹配」。
 */
const RESULT: SearchResult = {
  notePath: '/甲.md',
  noteTitle: '甲',
  matches: [],
  score: 1,
};

async function inputValue(wrapper: VueWrapper): Promise<string> {
  await nextTick();
  return (wrapper.get('input.search-input').element as HTMLInputElement).value;
}

describe('CommandPalette 搜索状态接线', () => {
  let wrapper: VueWrapper | null = null;

  function mountPalette(visible = false) {
    wrapper = mount(CommandPalette, {
      props: { visible },
      global: { stubs: { Teleport: true, Transition: false } },
      attachTo: document.body,
    });
    return wrapper;
  }

  beforeEach(() => {
    setActivePinia(createPinia());
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    document.body.replaceChildren();
  });

  it('SC-1：清空输入框打通 useSearch 清空分支，旧结果即时清空', async () => {
    const searchStore = useSearchStore();
    searchStore.setResults([RESULT]);
    const palette = mountPalette(true);
    await nextTick();

    expect(palette.findAll('.result-item')).toHaveLength(1);
    await palette.get('input.search-input').setValue('甲');
    expect(searchStore.results).toHaveLength(1);

    // 清空输入：空串分支此前被 trim 守卫拦掉，结果残留
    await palette.get('input.search-input').setValue('');
    expect(searchStore.results).toEqual([]);
    expect(searchStore.query).toBe('');
  });

  it('SC-2：重开面板打开空白面板——不恢复上一轮查询与结果', async () => {
    const searchStore = useSearchStore();
    const palette = mountPalette(false);
    await nextTick();

    // 第一轮：打开 → 输入查询 → 关闭（store 残留查询与结果）
    await palette.setProps({ visible: true });
    await palette.get('input.search-input').setValue('旧查询');
    searchStore.setResults([RESULT]);
    await palette.setProps({ visible: false });
    expect(searchStore.query).toBe('旧查询');

    // 重开：按「打开空白面板」意图，不自动恢复旧查询重放
    await palette.setProps({ visible: true });
    expect(await inputValue(palette)).toBe('');
    expect(searchStore.query).toBe('');
    expect(searchStore.results).toEqual([]);
  });

  it('SC-2：外部预设查询（tag 点击）一次性消费，重开不再恢复', async () => {
    const searchStore = useSearchStore();
    const palette = mountPalette(false);
    await nextTick();

    // 外部预设路径：onTagSelect → searchStore.open('tag:重点')
    searchStore.open('tag:重点');
    await palette.setProps({ visible: true });
    expect(await inputValue(palette)).toBe('tag:重点');
    expect(searchStore.query).toBe('tag:重点');

    // 关闭再重开：预设已消费，回落空白面板（不把上一轮查询当预设恢复）
    await palette.setProps({ visible: false });
    await palette.setProps({ visible: true });
    expect(await inputValue(palette)).toBe('');
    expect(searchStore.query).toBe('');
  });

  it('IX：索引超限失败态——空态透出超限文案，不再误报「无匹配」', async () => {
    const indexStore = useIndexStore();
    const limitMessage = translate('program.indexTooLarge', { limit: 2000 });
    indexStore.status = 'error';
    indexStore.error = limitMessage;

    const palette = mountPalette(true);
    await nextTick();
    await palette.get('input.search-input').setValue('甲');

    const empty = palette.get('.no-results');
    expect(empty.text()).toContain(limitMessage);
    expect(empty.text()).not.toContain(translate('command.noMatch'));
  });

  it('IX：索引通用失败态——空态透出 errors.indexUnavailable 兜底文案', async () => {
    const indexStore = useIndexStore();
    const fallback = translate('errors.indexUnavailable');
    indexStore.status = 'error';
    indexStore.error = fallback;

    const palette = mountPalette(true);
    await nextTick();
    await palette.get('input.search-input').setValue('甲');

    expect(palette.get('.no-results').text()).toContain(fallback);
  });
});
