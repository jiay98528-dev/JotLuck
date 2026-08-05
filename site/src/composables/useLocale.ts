import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { DEFAULT_LOCALE, LOCALE_TAGS, getContent, type Locale } from '../content';

/** 当前路由的 locale 与对应文案（响应式）。 */
export function useLocale() {
  const route = useRoute();
  const locale = computed<Locale>(
    () => (route.meta.locale as Locale | undefined) ?? DEFAULT_LOCALE,
  );
  const content = computed(() => getContent(locale.value));
  const langTag = computed(() => LOCALE_TAGS[locale.value]);
  return { locale, content, langTag };
}
