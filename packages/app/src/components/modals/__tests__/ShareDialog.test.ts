import { mount, type VueWrapper } from '@vue/test-utils';
import { nextTick } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ShareDialog from '../ShareDialog.vue';

/**
 * 分享面板 PDF 渠道防误用（SH）：getFormattedContent 对 PDF 只返回 md 原文，
 * 系统分享/邮件/剪贴板渠道会产出 md 字节假 PDF（损坏文件）。修复口径：
 * PDF 形态下三个非本地渠道禁用 + 引导文案 + doShare 硬闸兜底。
 */
const MARKDOWN = '# 标题\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n';

describe('ShareDialog PDF 渠道禁用', () => {
  let wrapper: VueWrapper | null = null;
  let shareSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    setActivePinia(createPinia());
    shareSpy = vi.fn();
    // jsdom 无 navigator.share：以 spy 占位区分「渠道被触发」与「被硬闸拦截」
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: shareSpy,
    });
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    Reflect.deleteProperty(navigator, 'share');
    document.body.replaceChildren();
  });

  function mountDialog() {
    wrapper = mount(ShareDialog, {
      props: { visible: true, noteTitle: '笔记', markdownContent: MARKDOWN },
      global: { stubs: { Teleport: true } },
      attachTo: document.body,
    });
    return wrapper;
  }

  async function selectFormatAndNext(label: string) {
    const dialog = mountDialog();
    await nextTick();
    const formatCard = dialog
      .findAll('.modal-body .option-card')
      .find((card) => card.text().includes(label));
    if (!formatCard) throw new Error(`format card ${label} not found`);
    await formatCard.trigger('click');
    await nextTick();
    const nextButton = dialog
      .findAll('button')
      .find((button) => button.text().includes('下一步') || button.text().includes('Next'));
    if (!nextButton) throw new Error('next button not found');
    await nextButton.trigger('click');
    await nextTick();
    return dialog;
  }

  function channelCard(dialog: VueWrapper, name: string) {
    const card = dialog
      .findAll('.modal-body .option-card')
      .find((option) => option.text().includes(name));
    if (!card) throw new Error(`channel card ${name} not found`);
    return card;
  }

  it('PDF 形态：系统分享/邮件/剪贴板禁用 + 引导文案，本地导出保持可用', async () => {
    const dialog = await selectFormatAndNext('PDF');

    const systemCard = channelCard(dialog, '系统分享');
    expect(systemCard.attributes('disabled')).toBeDefined();
    expect(systemCard.attributes('aria-disabled')).toBe('true');
    expect(channelCard(dialog, '邮件').attributes('disabled')).toBeDefined();
    expect(channelCard(dialog, '剪贴板').attributes('disabled')).toBeDefined();
    expect(channelCard(dialog, '本地导出').attributes('disabled')).toBeUndefined();

    // 引导文案存在（PDF 仅本地导出可产出真 .pdf 文件）
    expect(dialog.get('.channel-hint').text()).toContain('本地导出');
  });

  it('PDF 形态：非本地渠道点击被硬闸拦截（不触发分享、不关闭面板）', async () => {
    const dialog = await selectFormatAndNext('PDF');
    await channelCard(dialog, '系统分享').trigger('click');

    expect(shareSpy).not.toHaveBeenCalled();
    // doShare 未走完关闭链（disabled 拦截失效时由硬闸兜底）
    expect(dialog.emitted('update:visible')).toBeUndefined();
  });

  it('非 PDF 形态（Markdown）：四个渠道全部可用，正常路径不受影响', async () => {
    const dialog = await selectFormatAndNext('Markdown');

    for (const name of ['系统分享', '邮件', '剪贴板', '本地导出']) {
      expect(channelCard(dialog, name).attributes('disabled')).toBeUndefined();
    }
    expect(dialog.find('.channel-hint').exists()).toBe(false);

    // 系统分享正常触发（navigator.share 占位 spy；无 canShare 分支直接 resolve）
    await channelCard(dialog, '系统分享').trigger('click');
    await nextTick();
    expect(shareSpy).toHaveBeenCalled();
  });

  it('回到非 PDF 格式后渠道恢复可用（disabled 随 selectedFormat 响应式）', async () => {
    const dialog = await selectFormatAndNext('PDF');
    expect(channelCard(dialog, '系统分享').attributes('disabled')).toBeDefined();

    const backButton = dialog
      .findAll('button')
      .find((button) => button.text().includes('返回') || button.text().includes('Back'));
    if (!backButton) throw new Error('back button not found');
    await backButton.trigger('click');
    await nextTick();
    const mdCard = dialog
      .findAll('.modal-body .option-card')
      .find((card) => card.text().includes('Markdown'));
    await mdCard!.trigger('click');
    const nextButton = dialog
      .findAll('button')
      .find((button) => button.text().includes('下一步') || button.text().includes('Next'));
    await nextButton!.trigger('click');
    await nextTick();

    expect(channelCard(dialog, '系统分享').attributes('disabled')).toBeUndefined();
  });
});
