import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ExternalReaderPage from '../ExternalReaderPage.vue';
import { getWindowBootstrap, invalidateWindowBootstrap } from '../../services/windowSession';

const { invoke, replace, isTauri, shellOpen, Channel, channels } = vi.hoisted(() => {
  const channelInstances: Array<{ onmessage?: (event: unknown) => void }> = [];
  class MockChannel {
    onmessage?: (event: unknown) => void;

    constructor() {
      channelInstances.push(this);
    }
  }
  return {
    invoke: vi.fn(),
    replace: vi.fn(),
    isTauri: vi.fn(),
    shellOpen: vi.fn(),
    Channel: MockChannel,
    channels: channelInstances,
  };
});

vi.mock('@tauri-apps/api/core', () => ({ Channel, invoke, isTauri }));
vi.mock('@tauri-apps/plugin-shell', () => ({ open: shellOpen }));
vi.mock('vue-router', () => ({ useRouter: () => ({ replace }) }));

function mountReader() {
  return mount(ExternalReaderPage, {
    global: {
      stubs: {
        ExternalReaderSlotBoundary: {
          props: ['themeId', 'slotProps'],
          template: '<slot />',
        },
      },
    },
  });
}

describe('ExternalReaderPage', () => {
  beforeEach(() => {
    invoke.mockReset();
    replace.mockReset();
    isTauri.mockReset();
    isTauri.mockReturnValue(false);
    // 页面经 getWindowBootstrap 走窗口级共享缓存；逐测清缓存保证各测冷启动。
    invalidateWindowBootstrap();
    shellOpen.mockReset();
    channels.splice(0);
    document.title = 'JotLuck';
  });

  it('renders txt as literal pre-wrapped text without interpreting HTML or Markdown', async () => {
    invoke.mockImplementation(async (command: string) => {
      if (command === 'get_window_bootstrap') {
        return {
          mode: 'external-readonly',
          openedFile: {
            absolutePath: 'D:/notes/plain.txt',
            relativePath: '/plain.txt',
            accessToken: 'token',
          },
        };
      }
      if (command === 'read_external_note_file') return '<script>alert(1)</script>\n# literal';
      throw new Error(`unexpected command: ${command}`);
    });

    const wrapper = mountReader();
    await flushPromises();

    expect(wrapper.find('pre').text()).toBe('<script>alert(1)</script>\n# literal');
    expect(wrapper.find('script').exists()).toBe(false);
    expect(wrapper.find('article').exists()).toBe(false);
    expect(document.title).toBe('plain.txt · JotLuck');
    expect(invoke.mock.calls.map(([command]) => command)).toEqual([
      'get_window_bootstrap',
      'read_external_note_file',
    ]);
    wrapper.unmount();
  });

  it('sanitizes markdown and routes fixed window-scoped actions', async () => {
    invoke.mockImplementation(async (command: string) => {
      if (command === 'get_window_bootstrap') {
        return {
          mode: 'external-readonly',
          openedFile: {
            absolutePath: 'D:/notes/safe.md',
            relativePath: '/safe.md',
            accessToken: 'token',
          },
        };
      }
      if (command === 'read_external_note_file') {
        return '# Safe\n\n[Website](https://example.com)\n\n[[Related]]\n\n#tag\n\n<img src=x onerror="globalThis.pwned=true">';
      }
      if (command === 'enable_external_edit') return undefined;
      if (command === 'promote_external_file_to_notebook') {
        return { rootPath: 'D:/notes', name: 'notes', initialRelativePath: '/safe.md' };
      }
      throw new Error(`unexpected command: ${command}`);
    });

    const wrapper = mountReader();
    await vi.waitFor(() => expect(wrapper.find('article h1').exists()).toBe(true));
    expect(invoke.mock.calls.map(([command]) => command)).toEqual([
      'get_window_bootstrap',
      'read_external_note_file',
    ]);
    expect(wrapper.find('h1').text()).toBe('safe.md');
    expect(wrapper.find('article h1').text()).toBe('Safe');
    expect(wrapper.find('article img').attributes('onerror')).toBeUndefined();
    expect(wrapper.find('img[alt="JotLuck"]').attributes('src')).toContain('128x128');
    expect(wrapper.text()).toContain('大纲');
    expect(wrapper.text()).toContain('反链');
    expect(wrapper.text()).toContain('添加笔记后可用');

    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    await wrapper.find('article a[href="https://example.com"]').trigger('click');
    expect(open).toHaveBeenCalledWith('https://example.com', '_blank', 'noopener,noreferrer');
    isTauri.mockReturnValue(true);
    shellOpen.mockResolvedValue(undefined);
    await wrapper.find('article a[href="https://example.com"]').trigger('click');
    expect(shellOpen).toHaveBeenCalledWith('https://example.com');
    await wrapper.find('article a[data-note="Related"]').trigger('click');
    expect(wrapper.text()).toContain('Wiki-link“Related”跳转需要笔记本上下文');
    open.mockRestore();

    const buttons = wrapper.findAll('button');
    await buttons.find((button) => button.text() === '启用编辑')!.trigger('click');
    await flushPromises();
    expect(invoke).toHaveBeenCalledWith('enable_external_edit');
    expect(replace).toHaveBeenCalledWith('/workspace');

    replace.mockReset();
    await buttons.find((button) => button.text() === '添加到笔记')!.trigger('click');
    await flushPromises();
    expect(invoke).toHaveBeenCalledWith('promote_external_file_to_notebook');
    expect(replace).toHaveBeenCalledWith('/workspace');
    wrapper.unmount();
  });

  it('invalidates the window bootstrap cache after enable-edit and promote succeed', async () => {
    invoke.mockImplementation(async (command: string) => {
      if (command === 'get_window_bootstrap') {
        return {
          mode: 'external-readonly',
          openedFile: {
            absolutePath: 'D:/notes/cache.md',
            relativePath: '/cache.md',
            accessToken: 'token',
          },
        };
      }
      if (command === 'read_external_note_file') return '# Cache';
      if (command === 'enable_external_edit') return undefined;
      if (command === 'promote_external_file_to_notebook') {
        return { rootPath: 'D:/notes', name: 'notes', initialRelativePath: '/cache.md' };
      }
      throw new Error(`unexpected command: ${command}`);
    });

    // 模拟 BootstrapPage 冷启动已把 external-readonly 写入窗口级缓存。
    invalidateWindowBootstrap();
    await getWindowBootstrap();
    const bootstrapCalls = () =>
      invoke.mock.calls.filter(([command]) => command === 'get_window_bootstrap').length;
    const warmCalls = bootstrapCalls();

    const wrapper = mountReader();
    await vi.waitFor(() => expect(wrapper.find('article h1').exists()).toBe(true));
    // 页面也走 getWindowBootstrap 共享缓存；此时缓存未失效，窗口内读取不再 invoke。
    expect(bootstrapCalls()).toBe(warmCalls);
    await getWindowBootstrap();
    expect(bootstrapCalls()).toBe(warmCalls);

    const buttons = wrapper.findAll('button');
    await buttons.find((button) => button.text() === '启用编辑')!.trigger('click');
    await flushPromises();
    expect(replace).toHaveBeenCalledWith('/workspace');
    await getWindowBootstrap();
    expect(bootstrapCalls()).toBe(warmCalls + 1);

    replace.mockReset();
    await buttons.find((button) => button.text() === '添加到笔记')!.trigger('click');
    await flushPromises();
    expect(replace).toHaveBeenCalledWith('/workspace');
    await getWindowBootstrap();
    expect(bootstrapCalls()).toBe(warmCalls + 2);
    wrapper.unmount();
    invalidateWindowBootstrap();
  });

  it('streams document chunks in order and offers exactly two edit paths after conversion', async () => {
    invoke.mockImplementation(async (command: string) => {
      if (command === 'get_window_bootstrap') {
        return {
          mode: 'document-import-readonly',
          source: {
            fileName: '季度报告.docx',
            kind: 'docx',
            revision: { sha256: 'before', size: 1024, modifiedAtMs: 1 },
          },
        };
      }
      if (command === 'start_document_conversion') return 'conversion-1';
      if (command === 'get_document_editor_candidate') {
        return {
          handlerId: 'word-handler',
          displayName: 'Microsoft Word',
          available: true,
          fallbackToOpenWith: false,
        };
      }
      if (command === 'open_document_source_in_editor') {
        return { displayName: 'Microsoft Word', usedOpenWith: false };
      }
      if (command === 'save_converted_document_as') {
        return {
          absolutePath: 'D:/notes/季度报告.md',
          relativePath: '/季度报告.md',
          accessToken: 'saved-token',
        };
      }
      throw new Error(`unexpected command: ${command}`);
    });

    const wrapper = mountReader();
    await vi.waitFor(() => expect(channels).toHaveLength(1));
    const send = channels[0]!.onmessage!;
    send({ type: 'phase', phase: 'snapshot', unit: 'bytes', completed: 512, total: 1024 });
    await flushPromises();
    const progress = wrapper.get('[role="progressbar"]');
    expect(progress.attributes('aria-valuenow')).toBe('512');
    expect(progress.attributes('aria-valuemax')).toBe('1024');

    send({ type: 'chunk', sequence: 1, markdown: '# 第一季度\n\n' });
    send({ type: 'chunk', sequence: 2, markdown: '正文内容' });
    send({
      type: 'complete',
      conversionId: 'conversion-1',
      revision: { sha256: 'before', size: 1024, modifiedAtMs: 1 },
      markdownBytes: 27,
    });
    await vi.waitFor(() => expect(wrapper.find('article h1').text()).toBe('第一季度'));

    const editButton = wrapper.get('[data-testid="document-edit-button"]');
    expect(editButton.text()).toContain('在 Microsoft Word 中编辑');
    expect(editButton.attributes('disabled')).toBeUndefined();
    await editButton.trigger('click');
    await flushPromises();

    const choices = document.body.querySelectorAll<HTMLButtonElement>(
      '.document-edit-dialog__choice',
    );
    expect(choices).toHaveLength(2);
    expect(choices[0]?.textContent).toContain('Microsoft Word');
    expect(choices[1]?.textContent).toContain('Markdown');

    choices[0]?.click();
    await flushPromises();
    expect(invoke).toHaveBeenCalledWith('open_document_source_in_editor', {
      handlerId: 'word-handler',
    });

    await editButton.trigger('click');
    await flushPromises();
    const reopenedChoices = document.body.querySelectorAll<HTMLButtonElement>(
      '.document-edit-dialog__choice',
    );

    reopenedChoices[1]?.click();
    await flushPromises();
    const confirm = [...document.body.querySelectorAll<HTMLButtonElement>('button')].find(
      (button) => button.textContent?.includes('确认并选择保存位置'),
    );
    expect(confirm).toBeDefined();
    confirm?.click();
    await flushPromises();

    expect(invoke).toHaveBeenCalledWith('save_converted_document_as', {
      conversionId: 'conversion-1',
      dialogRequest: expect.objectContaining({
        defaultFileName: '季度报告.md',
        originalPreservationConfirmed: true,
      }),
    });
    expect(replace).toHaveBeenCalledWith('/workspace');
    wrapper.unmount();
  });

  it('cancels a worker whose identifier arrives after the user cancels', async () => {
    let resolveConversion: ((value: string) => void) | undefined;
    const pendingConversion = new Promise<string>((resolve) => {
      resolveConversion = resolve;
    });
    invoke.mockImplementation(async (command: string) => {
      if (command === 'get_window_bootstrap') {
        return {
          mode: 'document-import-readonly',
          source: {
            fileName: 'slow.pdf',
            kind: 'pdf',
            revision: { sha256: 'before', size: 256, modifiedAtMs: 1 },
          },
        };
      }
      if (command === 'start_document_conversion') return pendingConversion;
      if (command === 'cancel_document_conversion') return undefined;
      throw new Error(`unexpected command: ${command}`);
    });

    const wrapper = mountReader();
    await vi.waitFor(() =>
      expect(wrapper.findAll('button').some((button) => button.text() === '取消')).toBe(true),
    );
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '取消')!
      .trigger('click');
    expect(wrapper.text()).toContain('转换已取消');

    resolveConversion?.('late-conversion');
    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('cancel_document_conversion', {
        conversionId: 'late-conversion',
      }),
    );
    wrapper.unmount();
  });

  it('renders pending assets as neutral placeholders and swaps in loaded data urls', async () => {
    invoke.mockImplementation(async (command: string) => {
      if (command === 'get_window_bootstrap') {
        return {
          mode: 'document-import-readonly',
          source: {
            fileName: '图文.docx',
            kind: 'docx',
            revision: { sha256: 'before', size: 128, modifiedAtMs: 1 },
          },
        };
      }
      if (command === 'start_document_conversion') return 'conversion-3';
      if (command === 'cancel_document_conversion') return undefined;
      if (command === 'get_document_editor_candidate') {
        return {
          handlerId: 'word-handler',
          displayName: 'Microsoft Word',
          available: true,
          fallbackToOpenWith: false,
        };
      }
      if (command === 'read_document_conversion_asset') {
        return { bytes: [1, 2, 3], mediaType: 'image/png', fileName: 'image1.png' };
      }
      throw new Error(`unexpected command: ${command}`);
    });

    const wrapper = mountReader();
    await vi.waitFor(() => expect(channels).toHaveLength(1));
    const send = channels[0]!.onmessage!;
    send({ type: 'chunk', sequence: 1, markdown: '# 图文\n\n![封面](jotluck-asset://asset-1)\n' });

    // 未就绪资产：中性 loading 占位，不得落进远程图片策略显示「已阻止」。
    await vi.waitFor(() =>
      expect(wrapper.find('.document-import__asset-placeholder').exists()).toBe(true),
    );
    const pendingPlaceholder = wrapper.get('.document-import__asset-placeholder');
    expect(pendingPlaceholder.classes()).toContain('document-import__asset-placeholder--loading');
    expect(pendingPlaceholder.text()).toContain('资源读取中…');
    expect(wrapper.text()).not.toContain('远程图片已阻止');

    send({
      type: 'asset',
      assetId: 'asset-1',
      fileName: 'image1.png',
      mediaType: 'image/png',
      bytes: 3,
    });
    // 就绪资产必须真的渲染出来：data: URL 才能穿过渲染管线的 DOMPurify
    // （其默认 URI 规则剥除 blob: src，object URL 从未真正存活）。
    await vi.waitFor(() =>
      expect(wrapper.find('article img[src="data:image/png;base64,AQID"]').exists()).toBe(true),
    );
    expect(wrapper.find('.document-import__asset-placeholder').exists()).toBe(false);
    wrapper.unmount();
  });

  it('renders failed asset reads as a localized failure placeholder', async () => {
    invoke.mockImplementation(async (command: string) => {
      if (command === 'get_window_bootstrap') {
        return {
          mode: 'document-import-readonly',
          source: {
            fileName: '坏图.docx',
            kind: 'docx',
            revision: { sha256: 'before', size: 128, modifiedAtMs: 1 },
          },
        };
      }
      if (command === 'start_document_conversion') return 'conversion-4';
      if (command === 'cancel_document_conversion') return undefined;
      if (command === 'get_document_editor_candidate') {
        return {
          handlerId: 'word-handler',
          displayName: 'Microsoft Word',
          available: true,
          fallbackToOpenWith: false,
        };
      }
      if (command === 'read_document_conversion_asset') {
        throw new Error('asset gone');
      }
      throw new Error(`unexpected command: ${command}`);
    });

    const wrapper = mountReader();
    await vi.waitFor(() => expect(channels).toHaveLength(1));
    const send = channels[0]!.onmessage!;
    send({ type: 'chunk', sequence: 1, markdown: '![坏图](jotluck-asset://asset-9)\n' });
    await flushPromises();

    send({
      type: 'asset',
      assetId: 'asset-9',
      fileName: 'broken.png',
      mediaType: 'image/png',
      bytes: 4,
    });
    await vi.waitFor(() =>
      expect(wrapper.get('.document-import__asset-placeholder').classes()).toContain(
        'document-import__asset-placeholder--failed',
      ),
    );
    expect(wrapper.get('.document-import__asset-placeholder').text()).toContain('资源读取失败');
    expect(wrapper.text()).not.toContain('远程图片已阻止');
    // 失败同时进入格式降级说明列表。
    expect(wrapper.text()).toContain('无法读取转换资源');
    wrapper.unmount();
  });

  it('ignores asset read failures from a superseded conversion generation', async () => {
    let rejectAsset: ((reason: Error) => void) | undefined;
    invoke.mockImplementation(async (command: string) => {
      if (command === 'get_window_bootstrap') {
        return {
          mode: 'document-import-readonly',
          source: {
            fileName: '竞态.docx',
            kind: 'docx',
            revision: { sha256: 'before', size: 128, modifiedAtMs: 1 },
          },
        };
      }
      if (command === 'start_document_conversion') return 'conversion-5';
      if (command === 'read_document_conversion_asset') {
        return new Promise((_resolve, reject) => {
          rejectAsset = reject;
        });
      }
      if (command === 'cancel_document_conversion') return undefined;
      throw new Error(`unexpected command: ${command}`);
    });

    const wrapper = mountReader();
    await vi.waitFor(() => expect(channels).toHaveLength(1));
    const send = channels[0]!.onmessage!;
    send({ type: 'chunk', sequence: 1, markdown: '![竞态](jotluck-asset://asset-7)\n' });
    await flushPromises();
    send({
      type: 'asset',
      assetId: 'asset-7',
      fileName: 'race.png',
      mediaType: 'image/png',
      bytes: 4,
    });
    await flushPromises();

    // 读取未决时用户取消：世代翻页后到达的失败不得污染当前预览与警告列表。
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '取消')!
      .trigger('click');
    rejectAsset?.(new Error('late failure'));
    await flushPromises();

    expect(wrapper.text()).not.toContain('资源读取失败');
    expect(wrapper.text()).not.toContain('无法读取转换资源');
    wrapper.unmount();
  });

  it('marks a completed conversion stale on focus and blocks both edit paths', async () => {
    invoke.mockImplementation(async (command: string) => {
      if (command === 'get_window_bootstrap') {
        return {
          mode: 'document-import-readonly',
          source: {
            fileName: '预算.xlsx',
            kind: 'xlsx',
            revision: { sha256: 'before', size: 512, modifiedAtMs: 1 },
          },
        };
      }
      if (command === 'start_document_conversion') return 'conversion-2';
      if (command === 'get_document_editor_candidate') {
        return {
          handlerId: 'excel-handler',
          displayName: 'Microsoft Excel',
          available: true,
          fallbackToOpenWith: false,
        };
      }
      if (command === 'refresh_document_source_revision') return false;
      throw new Error(`unexpected command: ${command}`);
    });

    const wrapper = mountReader();
    await vi.waitFor(() => expect(channels).toHaveLength(1));
    channels[0]!.onmessage!({ type: 'chunk', sequence: 1, markdown: '## Sheet1\n\n' });
    channels[0]!.onmessage!({
      type: 'complete',
      conversionId: 'conversion-2',
      revision: { sha256: 'before', size: 512, modifiedAtMs: 1 },
      markdownBytes: 12,
    });
    await vi.waitFor(() =>
      expect(
        wrapper.get('[data-testid="document-edit-button"]').attributes('disabled'),
      ).toBeUndefined(),
    );

    window.dispatchEvent(new Event('focus'));
    await vi.waitFor(() => expect(wrapper.text()).toContain('原文件已发生变化'));
    expect(
      wrapper.get('[data-testid="document-edit-button"]').attributes('disabled'),
    ).toBeDefined();
    expect(wrapper.text()).toContain('重新转换');
    wrapper.unmount();
  });
});
