import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { createPinia } from 'pinia';
import { MockFSService } from '@/services/MockFSService';
import Toast, { useToast } from '@/components/common/Toast.vue';
import type { JotLuckE2EBridge, JotLuckE2EOpenedFile } from '@/utils/e2e-bridge';
import NotebookHome from '../NotebookHome.vue';

/**
 * 编辑壳「加入笔记」反馈链回归测试（波次7 GR）。
 *
 * 缺陷形态：openExternalParentAsNotebook 失败（workspace 未提交分支）只写
 * externalError——但编辑壳（externalSessionMode === 'edit-shell'）模板不渲染
 * externalError，用户点击后无任何可见反馈；叠加 Rust 侧 grant 过期文本
 * 分类缺失（EC 修复前落 operation_failed），专属文案不可达。
 *
 * 修复口径：编辑壳内失败以 toast 呈现错误（含 EC 结构化错误码
 * external_grant_expired 的专属文案），横幅「加入笔记」按钮保留可重试。
 * 本用例走真实挂载链路：只读壳 → 启用编辑 → 编辑壳横幅 → 加入笔记失败。
 */

// vitest MODE 非 e2e，peekJotLuckE2EBridge 原实现恒 null；mock 固定回测试夹具。
const bridgeHolder = vi.hoisted((): { bridge: JotLuckE2EBridge | null } => ({ bridge: null }));
vi.mock('@/utils/e2e-bridge', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/e2e-bridge')>();
  return {
    ...actual,
    peekJotLuckE2EBridge: vi.fn(() => bridgeHolder.bridge),
  };
});
vi.mock('vue-router', () => ({ useRouter: () => ({ replace: vi.fn() }) }));

const NOTE_ABSOLUTE_PATH = 'D:/notes/授权过期.md';

describe('NotebookHome 编辑壳「加入笔记」失败反馈链', () => {
  let wrapper: VueWrapper | null = null;
  let toastHost: VueWrapper | null = null;

  beforeEach(() => {
    bridgeHolder.bridge = {
      mockOpenedFile: {
        absolutePath: NOTE_ABSOLUTE_PATH,
        notebookRoot: 'D:/notes/',
        relativePath: '/授权过期.md',
        accessToken: 'token-1',
      } as JotLuckE2EOpenedFile & { accessToken: string },
      externalFiles: { [NOTE_ABSOLUTE_PATH]: '# 授权过期\n\n正文内容。\n' },
    };
    wrapper = mount(NotebookHome, {
      global: {
        plugins: [createPinia()],
        stubs: {
          ThemeSlotBoundary: {
            props: ['slotId', 'themeId', 'recipe', 'actions', 'slotProps'],
            template: '<slot />',
          },
        },
      },
    });
    // Toast 宿主与页面同进程共享模块级单例：挂载后 toast 文案可断言。
    toastHost = mount(Toast);
  });

  afterEach(() => {
    useToast().dismiss();
    wrapper?.unmount();
    toastHost?.unmount();
    wrapper = null;
    toastHost = null;
    bridgeHolder.bridge = null;
    document.body.replaceChildren();
  });

  it('编辑壳加入笔记失败：授权过期专属文案经 toast 可见且横幅按钮保留', async () => {
    if (!wrapper) throw new Error('页面挂载未就绪');

    // 启动链：mockOpenedFile → 外部只读壳渲染。
    await vi.waitFor(() => {
      expect(wrapper!.find('.external-reader').exists()).toBe(true);
      expect(wrapper!.find('.external-preview').exists()).toBe(true);
    });

    // Web 运行时跳过 IPC 直接确认进入编辑壳。
    const enable = wrapper.findAll('button').find((button) => button.text() === '启用编辑');
    expect(enable).toBeDefined();
    await enable!.trigger('click');
    await flushPromises();
    await vi.waitFor(() => {
      expect(wrapper!.find('.external-edit-banner').exists()).toBe(true);
    });

    // 让推广路径以 wire 形态抛结构化错误码（diagnostic 不上线）。
    const openSpy = vi
      .spyOn(MockFSService.prototype, 'openNotebookAt')
      .mockRejectedValue({ code: 'external_grant_expired' } as never);

    const add = wrapper.findAll('button').find((button) => button.text() === '添加到笔记');
    expect(add, '编辑壳横幅应提供「加入笔记」入口').toBeDefined();
    await add!.trigger('click');
    await flushPromises();

    // 反馈链接通：EC 专属文案经 toast 呈现（编辑壳本身不渲染 externalError）。
    await vi.waitFor(() => {
      const toasts = [...document.body.querySelectorAll('.toast')];
      expect(
        toasts.some((toast) => toast.textContent?.includes('当前外部文件的写入授权已失效')),
        '授权过期失败应以专属文案 toast 呈现',
      ).toBe(true);
    });

    // 横幅保留：加入笔记可重试，会话未因此静默退出编辑壳。
    expect(wrapper.find('.external-edit-banner').exists()).toBe(true);
    expect(wrapper.findAll('button').some((button) => button.text() === '添加到笔记')).toBe(true);

    openSpy.mockRestore();
  });
});
