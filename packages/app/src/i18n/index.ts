import { readonly, shallowRef, type App, type DeepReadonly, type Plugin, type Ref } from 'vue';
import { createI18n } from 'vue-i18n';
import zhCN, { type MessageSchema } from '@/locales/zh-CN';
import {
  SUPPORTED_LOCALES,
  type LocaleDefinition,
  type SupportedLocale,
  type TranslationArgs,
} from '@/types/i18n';

export const LOCALE_STORAGE_KEY = 'jotluck:locale:v1';
export const DEFAULT_LOCALE: SupportedLocale = 'zh-CN';

export const localeDefinitions: readonly LocaleDefinition[] = [
  { code: 'zh-CN', nativeName: '简体中文', htmlLang: 'zh-CN', dir: 'ltr' },
  { code: 'en', nativeName: 'English', htmlLang: 'en', dir: 'ltr' },
  { code: 'ja', nativeName: '日本語', htmlLang: 'ja', dir: 'ltr' },
  { code: 'ko', nativeName: '한국어', htmlLang: 'ko', dir: 'ltr' },
  { code: 'fr', nativeName: 'Français', htmlLang: 'fr', dir: 'ltr' },
] as const;

const localeLoaders: Record<SupportedLocale, () => Promise<{ default: MessageSchema }>> = {
  'zh-CN': async () => ({ default: zhCN }),
  en: () => import('@/locales/en'),
  ja: () => import('@/locales/ja'),
  ko: () => import('@/locales/ko'),
  fr: () => import('@/locales/fr'),
};

const i18n = createI18n<MessageSchema, SupportedLocale, false>({
  legacy: false,
  locale: DEFAULT_LOCALE,
  fallbackLocale: DEFAULT_LOCALE,
  messages: { [DEFAULT_LOCALE]: zhCN } as unknown as Record<SupportedLocale, MessageSchema>,
  missingWarn: import.meta.env.DEV,
  fallbackWarn: import.meta.env.DEV,
  missing: (_locale, key) => {
    if (import.meta.env.DEV || import.meta.env.MODE === 'test') {
      throw new Error(`[i18n] Missing message: ${key}`);
    }
    return key;
  },
});

const loadedLocales = new Set<SupportedLocale>([DEFAULT_LOCALE]);
const localeListeners = new Set<(locale: SupportedLocale) => void>();
const currentLocaleState = shallowRef<SupportedLocale>(DEFAULT_LOCALE);
export const currentLocale: DeepReadonly<Ref<SupportedLocale>> = readonly(currentLocaleState);
let localeRequest = 0;
let storageListenerInstalled = false;

function safeStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function readStoredLocale(): string | null {
  try {
    return safeStorage()?.getItem(LOCALE_STORAGE_KEY) ?? null;
  } catch {
    return null;
  }
}

function persistLocale(locale: SupportedLocale): void {
  try {
    safeStorage()?.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // Language switching must remain available when storage is blocked or full.
  }
}

export function isSupportedLocale(value: unknown): value is SupportedLocale {
  return typeof value === 'string' && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

export function normalizeLocale(value: string | null | undefined): SupportedLocale | null {
  if (!value) return null;
  const normalized = value.trim().replace(/_/g, '-').toLowerCase();
  if (!normalized) return null;
  if (normalized === 'zh' || normalized.startsWith('zh-')) return 'zh-CN';
  const primary = normalized.split('-')[0];
  if (primary === 'en' || primary === 'ja' || primary === 'ko' || primary === 'fr') {
    return primary;
  }
  return null;
}

export function detectPreferredLocale(
  languages: readonly string[] = typeof navigator === 'undefined' ? [] : navigator.languages,
): SupportedLocale {
  for (const language of languages) {
    const matched = normalizeLocale(language);
    if (matched) return matched;
  }
  return DEFAULT_LOCALE;
}

function definitionFor(locale: SupportedLocale): LocaleDefinition {
  return localeDefinitions.find((item) => item.code === locale) ?? localeDefinitions[0]!;
}

function applyDocumentLocale(locale: SupportedLocale): void {
  if (typeof document === 'undefined') return;
  const definition = definitionFor(locale);
  const root = document.documentElement;
  root.lang = definition.htmlLang;
  root.dir = definition.dir;
  root.dataset.locale = locale;
  const appRoot = document.getElementById('app');
  if (appRoot) {
    appRoot.lang = definition.htmlLang;
    appRoot.dir = definition.dir;
    appRoot.dataset.locale = locale;
  }
}

async function loadLocale(locale: SupportedLocale): Promise<void> {
  if (loadedLocales.has(locale)) return;
  const module = await localeLoaders[locale]();
  i18n.global.setLocaleMessage(locale, module.default);
  loadedLocales.add(locale);
}

interface SetLocaleOptions {
  persist?: boolean;
}

export async function setLocale(
  locale: SupportedLocale,
  options: SetLocaleOptions = {},
): Promise<SupportedLocale> {
  const request = ++localeRequest;
  let resolved = locale;
  try {
    await loadLocale(locale);
  } catch {
    resolved = DEFAULT_LOCALE;
  }
  if (request !== localeRequest) return getCurrentLocale();

  i18n.global.locale.value = resolved;
  currentLocaleState.value = resolved;
  applyDocumentLocale(resolved);
  if (options.persist !== false) persistLocale(resolved);
  localeListeners.forEach((listener) => listener(resolved));
  return resolved;
}

function installStorageListener(): void {
  if (storageListenerInstalled || typeof window === 'undefined') return;
  storageListenerInstalled = true;
  window.addEventListener('storage', (event) => {
    if (event.key !== LOCALE_STORAGE_KEY || !isSupportedLocale(event.newValue)) return;
    void setLocale(event.newValue, { persist: false });
  });
}

export async function initializeLocale(): Promise<SupportedLocale> {
  installStorageListener();
  const stored = readStoredLocale();
  const locale = isSupportedLocale(stored) ? stored : detectPreferredLocale();
  return setLocale(locale);
}

export function getCurrentLocale(): SupportedLocale {
  return currentLocaleState.value;
}

export function installI18n(app: App): void {
  app.use(i18n);
}

export function getI18nPlugin(): Plugin {
  return i18n as unknown as Plugin;
}

export function translate(key: string, args?: TranslationArgs): string {
  return args ? i18n.global.t(key, args) : i18n.global.t(key);
}

export function translateForLocale(
  locale: SupportedLocale,
  key: string,
  args?: TranslationArgs,
): string {
  return i18n.global.t(key, args ?? {}, { locale });
}

export function formatDate(value: Date | number, options: Intl.DateTimeFormatOptions = {}): string {
  return new Intl.DateTimeFormat(getCurrentLocale(), options).format(value);
}

export function formatNumber(value: number, options: Intl.NumberFormatOptions = {}): string {
  return new Intl.NumberFormat(getCurrentLocale(), options).format(value);
}

export function formatRelativeTime(
  value: number,
  unit: Intl.RelativeTimeFormatUnit,
  options: Intl.RelativeTimeFormatOptions = { numeric: 'auto' },
): string {
  return new Intl.RelativeTimeFormat(getCurrentLocale(), options).format(value, unit);
}

export function createLocaleCollator(
  options: Intl.CollatorOptions = {},
  locale: SupportedLocale = getCurrentLocale(),
): Intl.Collator {
  return new Intl.Collator(locale, {
    numeric: true,
    sensitivity: 'base',
    ...options,
  });
}

const localeFontStacks: Record<SupportedLocale, string> = {
  'zh-CN':
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', 'Noto Sans CJK SC', sans-serif",
  en: "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif",
  fr: "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif",
  ja: "-apple-system, BlinkMacSystemFont, 'Yu Gothic UI', 'Hiragino Kaku Gothic ProN', Meiryo, 'Noto Sans CJK JP', sans-serif",
  ko: "-apple-system, BlinkMacSystemFont, 'Malgun Gothic', 'Apple SD Gothic Neo', 'Noto Sans CJK KR', sans-serif",
};

export function getLocaleFontStack(locale: SupportedLocale = getCurrentLocale()): string {
  return localeFontStacks[locale];
}

const localeDocumentFonts: Record<SupportedLocale, string> = {
  'zh-CN': 'Microsoft YaHei',
  en: 'Segoe UI',
  fr: 'Segoe UI',
  ja: 'Yu Gothic',
  ko: 'Malgun Gothic',
};

export function getLocaleDocumentFont(locale: SupportedLocale = getCurrentLocale()): string {
  return localeDocumentFonts[locale];
}

export function onLocaleChange(listener: (locale: SupportedLocale) => void): () => void {
  localeListeners.add(listener);
  return () => localeListeners.delete(listener);
}
