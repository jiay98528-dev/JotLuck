import type { Locale, SiteContent } from './types';
import { zh } from './zh';
import { en } from './en';
import { ja } from './ja';
import { ko } from './ko';
import { fr } from './fr';

export const CONTENT: Record<Locale, SiteContent> = { zh, en, ja, ko, fr };

export function getContent(locale: Locale): SiteContent {
  return CONTENT[locale];
}

export { LOCALES, DEFAULT_LOCALE, LOCALE_TAGS } from './types';
export type { Locale, SiteContent } from './types';
