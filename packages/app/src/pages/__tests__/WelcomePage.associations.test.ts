import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WelcomePage from '../WelcomePage.vue';

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock('@tauri-apps/api/core', () => ({
  invoke,
  isTauri: () => true,
}));

describe('WelcomePage Windows default-app decision', () => {
  let markdownApplied = false;

  beforeEach(() => {
    localStorage.clear();
    document.body.replaceChildren();
    markdownApplied = false;
    invoke.mockReset();
    invoke.mockImplementation(async (command: string) => {
      if (command === 'open_jotluck_default_apps_settings') return undefined;
      if (command === 'get_windows_association_status') {
        return {
          supported: true,
          groups: [
            {
              id: 'markdown',
              extensions: ['.md', '.markdown', '.mdx'],
              state: markdownApplied ? 'applied' : 'not-applied',
              activeProgIds: markdownApplied
                ? ['JotLuck.Note', 'JotLuck.Note', 'JotLuck.Note']
                : [null, null, null],
            },
            {
              id: 'text',
              extensions: ['.txt'],
              state: 'not-applied',
              activeProgIds: [null],
            },
            {
              id: 'word',
              extensions: ['.docx'],
              state: 'applied',
              activeProgIds: ['JotLuck.DocumentImport'],
            },
            {
              id: 'pdf',
              extensions: ['.pdf'],
              state: 'partial',
              activeProgIds: ['JotLuck.DocumentImport'],
            },
            {
              id: 'excel',
              extensions: ['.xlsx', '.xls'],
              state: 'not-applied',
              activeProgIds: [null, null],
            },
          ],
        };
      }
      throw new Error(`unexpected command: ${command}`);
    });
  });

  afterEach(() => document.body.replaceChildren());

  it('shows five independent choices and refreshes their separate system states on return', async () => {
    const wrapper = mount(WelcomePage, {
      props: { visible: true },
      attachTo: document.body,
    });
    const next = () => document.querySelector<HTMLButtonElement>('.welcome-next-btn')?.click();
    next();
    await flushPromises();
    next();
    await flushPromises();
    next();
    await flushPromises();

    const choices = [
      ...document.querySelectorAll<HTMLInputElement>('.welcome-association-checkbox'),
    ];
    expect(choices).toHaveLength(5);
    expect(choices.map((choice) => [choice.dataset.associationId, choice.checked])).toEqual([
      ['markdown', true],
      ['text', false],
      ['word', false],
      ['pdf', false],
      ['excel', false],
    ]);
    expect(document.body.textContent).toContain('Markdown');
    expect(document.body.textContent).toContain('纯文本');
    expect(document.body.textContent).toContain('Word');
    expect(document.body.textContent).toContain('PDF');
    expect(document.body.textContent).toContain('Excel');
    expect(document.body.textContent).toContain('.xlsx, .xls');

    const wordRow = document
      .querySelector<HTMLInputElement>('[data-association-id="word"]')
      ?.closest('label');
    expect(wordRow?.textContent).toContain('已应用');
    expect(document.querySelector<HTMLInputElement>('[data-association-id="word"]')?.checked).toBe(
      false,
    );

    const textChoice = document.querySelector<HTMLInputElement>('[data-association-id="text"]');
    textChoice?.click();
    expect(textChoice?.checked).toBe(true);
    expect(textChoice?.closest('label')?.textContent).toContain('未应用');

    const openSettings = [...document.querySelectorAll<HTMLButtonElement>('button')].find(
      (button) => button.textContent?.includes('在 Windows 中确认并应用'),
    );
    openSettings?.click();
    await flushPromises();
    expect(invoke).toHaveBeenCalledWith('open_jotluck_default_apps_settings');

    markdownApplied = true;
    window.dispatchEvent(new Event('focus'));
    await vi.waitFor(() => {
      expect(
        document.querySelector('[data-association-id="markdown"]')?.closest('label')?.textContent,
      ).toContain('已应用');
      expect(document.body.textContent).toContain('继续在 Windows 中设置');
    });
    wrapper.unmount();
  });
});
