import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SettingsDialog from '../SettingsDialog.vue';

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock('@tauri-apps/api/core', () => ({
  invoke,
  isTauri: () => true,
}));
vi.mock('@/utils/runtime', () => ({
  isDesktopRuntime: () => true,
}));

describe('SettingsDialog Windows file associations', () => {
  beforeEach(() => {
    invoke.mockReset();
    document.body.replaceChildren();
    invoke.mockImplementation(async (command: string) => {
      if (command === 'get_windows_association_status') {
        return {
          supported: true,
          groups: [
            {
              id: 'markdown',
              extensions: ['.md', '.markdown', '.mdx'],
              state: 'partial',
              activeProgIds: ['JotLuck.Note', null, 'JotLuck.Note'],
            },
            {
              id: 'text',
              extensions: ['.txt'],
              state: 'not-applied',
              activeProgIds: ['txtfile'],
            },
            {
              id: 'word',
              extensions: ['.docx'],
              state: 'not-applied',
              activeProgIds: ['Word.Document.12'],
            },
            {
              id: 'pdf',
              extensions: ['.pdf'],
              state: 'applied',
              activeProgIds: ['JotLuck.DocumentImport'],
            },
            {
              id: 'excel',
              extensions: ['.xlsx', '.xls'],
              state: 'not-applied',
              activeProgIds: ['Excel.Sheet.12', 'Excel.Sheet.8'],
            },
          ],
        };
      }
      if (command === 'open_jotluck_default_apps_settings') return undefined;
      throw new Error(`unexpected command: ${command}`);
    });
  });

  afterEach(() => document.body.replaceChildren());

  it('shows effective per-group states and opens the JotLuck-specific Windows page', async () => {
    const wrapper = mount(SettingsDialog, {
      props: { visible: true },
      attachTo: document.body,
    });
    await vi.waitFor(() => expect(document.querySelectorAll('.association-row')).toHaveLength(5));

    const rows = [...document.querySelectorAll<HTMLElement>('.association-row')];
    expect(rows[0]?.textContent).toContain('Markdown');
    expect(rows[0]?.textContent).toContain('部分应用');
    expect(rows[3]?.textContent).toContain('PDF');
    expect(rows[3]?.textContent).toContain('已应用');

    const changeButton = [...document.querySelectorAll<HTMLButtonElement>('button')].find(
      (button) => button.textContent?.trim() === '在 Windows 中更改',
    );
    changeButton?.click();
    await flushPromises();
    expect(invoke).toHaveBeenCalledWith('open_jotluck_default_apps_settings');
    wrapper.unmount();
  });
});
