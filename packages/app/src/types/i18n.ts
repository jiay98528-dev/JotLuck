export const SUPPORTED_LOCALES = ['zh-CN', 'en', 'ja', 'ko', 'fr'] as const;

export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

export type TextDirection = 'ltr' | 'rtl';

export interface LocaleDefinition {
  code: SupportedLocale;
  nativeName: string;
  htmlLang: string;
  dir: TextDirection;
}

export type TranslationArgs = Record<string, string | number>;

export type AppErrorCode =
  | 'not_found'
  | 'permission_denied'
  | 'already_exists'
  | 'invalid_path'
  | 'outside_notebook'
  | 'not_utf8'
  | 'file_too_large'
  | 'conflict'
  | 'disk_full'
  | 'notebook_not_open'
  | 'index_unavailable'
  | 'operation_failed';

export interface CommandErrorPayload {
  code: AppErrorCode;
  args?: TranslationArgs;
}
