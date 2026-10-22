import { mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import ReviewAnnotationPanel from '../ReviewAnnotationPanel.vue';
import type { ReviewHunk } from '@/utils/review-types';

function makeHunk(partial: Partial<ReviewHunk> & Pick<ReviewHunk, 'id'>): ReviewHunk {
  return { type: 'modify', leftText: '', rightText: '', ...partial };
}

const HUNKS: ReviewHunk[] = [
  makeHunk({
    id: 'h-modify',
    type: 'modify',
    leftRange: { from: 0, to: 5 },
    rightRange: { from: 0, to: 5 },
    leftText: '旧的内容'.repeat(11), // 44 字符 > 40 → 摘要截断
    rightText: '新的内容',
  }),
  makeHunk({
    id: 'h-insert',
    type: 'insert',
    rightRange: { from: 10, to: 12 },
    rightText: '全新段落',
  }),
  makeHunk({
    id: 'h-delete',
    type: 'delete',
    leftRange: { from: 20, to: 24 },
    leftText: '被删除的段落',
  }),
];

function findPopup(): HTMLElement | null {
  return document.body.querySelector<HTMLElement>('.review-decide-popup');
}

describe('ReviewAnnotationPanel', () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  afterEach(() => {
    document.body.replaceChildren();
    vi.useRealTimers();
  });

  it('渲染全部条目：序号 + 类型徽标 + 双侧摘要', () => {
    const wrapper = mount(ReviewAnnotationPanel, { props: { hunks: HUNKS } });
    const items = wrapper.findAll('.review-panel-item');
    expect(items).toHaveLength(3);

    const badges = wrapper.findAll('.review-badge');
    expect(badges[0]?.classes()).toContain('review-badge-modify');
    expect(badges[1]?.classes()).toContain('review-badge-insert');
    expect(badges[2]?.classes()).toContain('review-badge-delete');

    // 摘要：modify 双侧（超 40 字符截断带省略号）；insert 只有右侧；delete 只有左侧
    const first = items[0]!;
    expect(first.text()).toContain('…');
    expect(first.text()).toContain('新的内容');
    expect(items[1]!.text()).toContain('全新段落');
    expect(items[2]!.text()).toContain('被删除的段落');

    // 计数徽标
    expect(wrapper.find('.review-panel-count').text()).toBe('3');
  });

  it('点击条目 → emit locate 且在鼠标位置弹二元小弹窗', async () => {
    const wrapper = mount(ReviewAnnotationPanel, { props: { hunks: HUNKS } });
    await wrapper.findAll('.review-panel-item')[0]!.trigger('click', { clientX: 30, clientY: 40 });

    expect(wrapper.emitted('locate')).toEqual([[HUNKS[0]]]);
    const popup = findPopup();
    expect(popup).not.toBeNull();
    expect(popup!.style.left).toBe('38px');
    expect(popup!.style.top).toBe('48px');
  });

  it('弹窗点击 批准 → emit decide(hunk, adopt) 并关闭', async () => {
    const wrapper = mount(ReviewAnnotationPanel, { props: { hunks: HUNKS } });
    await wrapper.findAll('.review-panel-item')[1]!.trigger('click', { clientX: 10, clientY: 10 });
    document.querySelector<HTMLElement>('.review-decide-adopt')!.click();
    await nextTick();

    expect(wrapper.emitted('decide')).toEqual([[HUNKS[1], 'adopt']]);
    expect(findPopup()).toBeNull();
  });

  it('弹窗点击 丢弃 → emit decide(hunk, discard) 并关闭', async () => {
    const wrapper = mount(ReviewAnnotationPanel, { props: { hunks: HUNKS } });
    await wrapper.findAll('.review-panel-item')[2]!.trigger('click', { clientX: 10, clientY: 10 });
    document.querySelector<HTMLElement>('.review-decide-discard')!.click();
    await nextTick();

    expect(wrapper.emitted('decide')).toEqual([[HUNKS[2], 'discard']]);
    expect(findPopup()).toBeNull();
  });

  it('鼠标移出条目行 300ms 后弹窗自动关闭（150ms 旧时序仍保持）', async () => {
    vi.useFakeTimers();
    const wrapper = mount(ReviewAnnotationPanel, { props: { hunks: HUNKS } });
    const row = wrapper.findAll('.review-panel-item')[0]!;
    await row.trigger('click', { clientX: 10, clientY: 10 });
    expect(findPopup()).not.toBeNull();

    await row.trigger('mouseleave');
    expect(findPopup()).not.toBeNull(); // 延迟内不关
    vi.advanceTimersByTime(150);
    expect(findPopup()).not.toBeNull(); // 150ms（旧时序）仍保持打开
    vi.advanceTimersByTime(150);
    await nextTick();
    expect(findPopup()).toBeNull();
  });

  it('空态：无批注时显示空态文案', () => {
    const wrapper = mount(ReviewAnnotationPanel, { props: { hunks: [] } });
    expect(wrapper.find('.review-panel-empty').exists()).toBe(true);
    expect(wrapper.find('.review-panel-item').exists()).toBe(false);
    expect(wrapper.find('.review-panel-count').text()).toBe('0');
  });

  it('点击头部折叠/展开列表', async () => {
    const wrapper = mount(ReviewAnnotationPanel, { props: { hunks: HUNKS } });
    expect(wrapper.find('.review-panel-list').exists()).toBe(true);
    await wrapper.find('.review-panel-header').trigger('click');
    expect(wrapper.find('.review-panel-list').exists()).toBe(false);
    expect(wrapper.find('.review-panel-empty').exists()).toBe(false); // 折叠态不显示空态
    await wrapper.find('.review-panel-header').trigger('click');
    expect(wrapper.find('.review-panel-list').exists()).toBe(true);
  });

  it('批量入口：hunks 非空时显示，空态与折叠态不显示', async () => {
    const wrapper = mount(ReviewAnnotationPanel, { props: { hunks: HUNKS } });
    expect(wrapper.find('.review-bulk-adopt').exists()).toBe(true);
    expect(wrapper.find('.review-bulk-discard').exists()).toBe(true);

    // 折叠态隐藏（与列表同口径）
    await wrapper.find('.review-panel-header').trigger('click');
    expect(wrapper.find('.review-bulk-bar').exists()).toBe(false);
    await wrapper.find('.review-panel-header').trigger('click');

    // 空态隐藏
    const empty = mount(ReviewAnnotationPanel, { props: { hunks: [] } });
    expect(empty.find('.review-bulk-bar').exists()).toBe(false);
  });

  it('批量丢弃：内联二次确认（第一步不 emit）→ 确认后 emit decideAll(discard)', async () => {
    const wrapper = mount(ReviewAnnotationPanel, { props: { hunks: HUNKS } });
    // 第一步点击只进入确认态，不 emit
    await wrapper.find('.review-bulk-discard').trigger('click');
    expect(wrapper.emitted('decideAll')).toBeUndefined();
    expect(wrapper.find('.review-bulk-confirm-text').text()).toContain('3');
    // 取消 → 回到默认按钮态、仍无 emit
    await wrapper.find('.review-bulk-confirm-cancel').trigger('click');
    expect(wrapper.emitted('decideAll')).toBeUndefined();
    expect(wrapper.find('.review-bulk-discard').exists()).toBe(true);
    // 再次进入确认态并确认 → emit
    await wrapper.find('.review-bulk-discard').trigger('click');
    await wrapper.find('.review-bulk-confirm-ok').trigger('click');
    expect(wrapper.emitted('decideAll')).toEqual([['discard']]);
    expect(wrapper.find('.review-bulk-adopt').exists()).toBe(true); // 复位回默认态
  });

  it('批量批准：内联确认后 emit decideAll(adopt)', async () => {
    const wrapper = mount(ReviewAnnotationPanel, { props: { hunks: HUNKS } });
    await wrapper.find('.review-bulk-adopt').trigger('click');
    expect(wrapper.emitted('decideAll')).toBeUndefined(); // 确认前不 emit
    await wrapper.find('.review-bulk-confirm-ok').trigger('click');
    expect(wrapper.emitted('decideAll')).toEqual([['adopt']]);
  });
});
