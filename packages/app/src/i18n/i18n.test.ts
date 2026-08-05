import { createApp } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_LOCALE,
  LOCALE_STORAGE_KEY,
  createLocaleCollator,
  detectPreferredLocale,
  formatNumber,
  getCurrentLocale,
  getI18nPlugin,
  initializeLocale,
  normalizeLocale,
  onLocaleChange,
  setLocale,
} from '@/i18n';
import {
  createUserMessageError,
  getErrorDiagnostic,
  localizeCommandError,
  localizeUserError,
  normalizeCommandError,
} from '@/services/command-errors';
import { createSampleNotebookSeed } from '@/services/SampleSeed';
import { getBuiltInTemplates, renderTemplate } from '@/services/TemplateEngine';
import { getAllThemeModules } from '@/themes/registry';
import { getLocalMarketModules } from '@/themes/market/local-catalog';
import type { SupportedLocale } from '@/types';

const locales: SupportedLocale[] = ['zh-CN', 'en', 'ja', 'ko', 'fr'];

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('lang');
  document.documentElement.removeAttribute('dir');
  document.documentElement.removeAttribute('data-locale');
  document.body.innerHTML = '<div id="app"></div>';
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('locale manager', () => {
  it('normalizes exact, regional and Chinese locale codes with a Chinese fallback', () => {
    expect(normalizeLocale('fr-CA')).toBe('fr');
    expect(normalizeLocale('JA_jp')).toBe('ja');
    expect(normalizeLocale('zh-Hant-TW')).toBe('zh-CN');
    expect(normalizeLocale('de-DE')).toBeNull();
    expect(detectPreferredLocale(['de-DE', 'ko-KR'])).toBe('ko');
    expect(detectPreferredLocale(['de-DE'])).toBe(DEFAULT_LOCALE);
  });

  it('prefers a persisted locale and synchronizes document language attributes', async () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, 'fr');
    await initializeLocale();

    expect(getCurrentLocale()).toBe('fr');
    expect(document.documentElement.lang).toBe('fr');
    expect(document.documentElement.dir).toBe('ltr');
    expect(document.documentElement.dataset.locale).toBe('fr');
    expect(document.getElementById('app')?.dataset.locale).toBe('fr');
  });

  it('persists user changes and accepts locale changes from another window', async () => {
    await initializeLocale();
    const listener = vi.fn();
    const unsubscribe = onLocaleChange(listener);

    await setLocale('en');
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('en');
    expect(listener).toHaveBeenLastCalledWith('en');

    window.dispatchEvent(new StorageEvent('storage', { key: LOCALE_STORAGE_KEY, newValue: 'ja' }));
    await vi.waitFor(() => expect(getCurrentLocale()).toBe('ja'));
    unsubscribe();
  });

  it('falls back to system detection when storage reads throw', async () => {
    vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['ko-KR']);
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('storage blocked', 'SecurityError');
    });

    await expect(initializeLocale()).resolves.toBe('ko');
    expect(getCurrentLocale()).toBe('ko');
    expect(document.documentElement.lang).toBe('ko');
  });

  it('falls back to system detection when obtaining localStorage throws', async () => {
    vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['ja-JP']);
    vi.spyOn(globalThis, 'localStorage', 'get').mockImplementation(() => {
      throw new DOMException('storage unavailable', 'SecurityError');
    });

    await expect(initializeLocale()).resolves.toBe('ja');
    expect(getCurrentLocale()).toBe('ja');
    expect(document.documentElement.lang).toBe('ja');
  });

  it('keeps the selected locale and permits mounting when storage writes throw', async () => {
    vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['fr-FR']);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('storage full', 'QuotaExceededError');
    });

    await expect(initializeLocale()).resolves.toBe('fr');
    const app = createApp({ template: '<main data-testid="mounted">mounted</main>' });
    app.use(getI18nPlugin());
    expect(() => app.mount('#app')).not.toThrow();
    expect(document.querySelector('[data-testid="mounted"]')).not.toBeNull();
    app.unmount();
  });

  it('uses the active locale for number formatting and collation', async () => {
    await setLocale('fr');
    expect(formatNumber(12345.6)).toBe(new Intl.NumberFormat('fr').format(12345.6));
    expect(['note2', 'note10'].sort(createLocaleCollator().compare)).toEqual(['note2', 'note10']);
  });
});

describe('localized program content', () => {
  it.each(locales)('loads complete built-in templates and sample seed for %s', async (locale) => {
    await setLocale(locale, { persist: false });
    const templates = getBuiltInTemplates(locale);
    const seed = createSampleNotebookSeed(locale);

    expect(templates).toHaveLength(3);
    expect(templates.every((template) => template.name && template.content)).toBe(true);
    expect(seed.directoryName).not.toMatch(/^samples\./);
    expect(seed.files).toHaveLength(5);
    expect(seed.files.every((file) => file.path.endsWith('.md') && file.content.length > 20)).toBe(
      true,
    );
  });

  it.each(locales)('recomputes all official theme presentation models for %s', async (locale) => {
    await setLocale(locale, { persist: false });
    const themes = [...getAllThemeModules(), ...getLocalMarketModules()];

    expect(themes).toHaveLength(5);
    expect(themes.every((theme) => theme.name && theme.meta.headline && theme.meta.story)).toBe(
      true,
    );
    expect(themes.every((theme) => theme.meta.bestFor.length > 0)).toBe(true);
    expect(themes.every((theme) => theme.meta.visualFeatures.length > 0)).toBe(true);
    expect(JSON.stringify(themes)).not.toMatch(/(?:theme|settings|common)\.[a-z]/u);
  });

  it('keeps stable machine placeholders while localizing natural-language wrappers', async () => {
    const date = new Date(2026, 5, 3, 9, 7, 8);
    await setLocale('en', { persist: false });
    const rendered = renderTemplate(
      '{{date}}|{{time}}|{{datetime}}|{{weekRange}}|{{weekday}}|{{week}}',
      date,
      'en',
    );

    expect(rendered).toContain(date.toISOString().slice(0, 10));
    expect(rendered).toContain('09:07');
    expect(rendered).toContain('Wednesday');
    expect(rendered).not.toContain('{{');
  });

  it('localizes structured command errors without exposing diagnostics', async () => {
    await setLocale('fr', { persist: false });
    expect(localizeCommandError({ code: 'not_found' })).toContain('introuvable');
    expect(localizeCommandError({ code: 'file_too_large', args: { maxSize: '5 MB' } })).toContain(
      '5 MB',
    );
  });

  it('never exposes plain Error diagnostics as user messages', async () => {
    await setLocale('en', { persist: false });
    const raw = new Error('C:\\private\\note.md: access denied');
    const normalized = normalizeCommandError(raw);

    expect(normalized.message).toBe('The operation failed. Try again.');
    expect(normalized.message).not.toContain('private');
    expect(getErrorDiagnostic(normalized)).toContain('private');
    expect(localizeUserError(raw, 'dialogs.export.unknownError')).toBe(
      'An unknown error occurred while exporting',
    );
  });

  it('preserves explicit user message keys while keeping diagnostics separate', async () => {
    await setLocale('fr', { persist: false });
    const error = createUserMessageError(
      'theme.validation.missingManifest',
      undefined,
      'zip parser offset 42',
    );

    expect(localizeUserError(error)).toContain('manifest.json');
    expect(localizeUserError(error)).not.toContain('offset 42');
    expect(getErrorDiagnostic(error)).toBe('zip parser offset 42');
  });
});
