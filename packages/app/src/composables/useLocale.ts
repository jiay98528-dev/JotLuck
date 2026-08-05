import { currentLocale, localeDefinitions, setLocale } from '@/i18n';

export function useLocale() {
  return {
    locale: currentLocale,
    localeDefinitions,
    setLocale,
  };
}
