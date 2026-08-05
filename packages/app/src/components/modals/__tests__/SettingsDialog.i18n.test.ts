import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SettingsDialog from '../SettingsDialog.vue';
import { getCurrentLocale, setLocale, translate } from '@/i18n';
import type { CompletionSettings } from '@/services/CompletionSettings';
import type { SupportedLocale } from '@/types';

const locales: SupportedLocale[] = ['zh-CN', 'en', 'ja', 'ko', 'fr'];

describe('SettingsDialog locale switching', () => {
  beforeEach(async () => {
    localStorage.clear();
    document.body.replaceChildren();
    await setLocale('zh-CN', { persist: false });
  });

  afterEach(async () => {
    document.body.replaceChildren();
    await setLocale('zh-CN', { persist: false });
  });

  it('offers every registered locale and switches immediately without moving focus', async () => {
    const completionSettings: CompletionSettings = {
      enabled: true,
      aggressiveness: 'balanced',
      backgroundTraining: false,
      maxSuggestionLength: 12,
      minConfidence: 0.18,
      showDebugStats: false,
    };
    const wrapper = mount(SettingsDialog, {
      props: { visible: true, completionSettings },
      attachTo: document.body,
    });
    const select = document.querySelector<HTMLSelectElement>('#settings-language');
    expect(select).not.toBeNull();
    if (!select) throw new Error('Language selector did not render.');

    expect([...select.options].map((option) => option.value)).toEqual(locales);
    for (const locale of locales) {
      const currentSelect = document.querySelector<HTMLSelectElement>('#settings-language');
      if (!currentSelect) throw new Error('Language selector disappeared.');
      currentSelect.focus();
      currentSelect.value = locale;
      currentSelect.dispatchEvent(new window.Event('change', { bubbles: true }));
      await flushPromises();
      await vi.waitFor(() => expect(getCurrentLocale()).toBe(locale));

      expect(document.activeElement).toBe(currentSelect);
      expect(localStorage.getItem('jotluck:locale:v1')).toBe(locale);
      expect(document.documentElement.dataset.locale).toBe(locale);
      expect(document.querySelector('#settings-dialog-title')?.textContent).toBe(
        translate('settings.title'),
      );
      expect(document.body.textContent).not.toMatch(/settings\.[a-z]/u);
    }

    expect(wrapper.emitted('update-completion-settings')).toBeUndefined();
    expect(completionSettings).toEqual({
      enabled: true,
      aggressiveness: 'balanced',
      backgroundTraining: false,
      maxSuggestionLength: 12,
      minConfidence: 0.18,
      showDebugStats: false,
    });
    wrapper.unmount();
  });
});
