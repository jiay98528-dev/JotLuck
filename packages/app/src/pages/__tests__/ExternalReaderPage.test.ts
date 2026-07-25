import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ExternalReaderPage from '../ExternalReaderPage.vue';

const { invoke, replace } = vi.hoisted(() => ({
  invoke: vi.fn(),
  replace: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke }));
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
  });
});
