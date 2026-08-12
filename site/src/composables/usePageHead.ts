import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { useHead } from '@unhead/vue';
import { LOCALES, LOCALE_TAGS, getContent, type Locale } from '../content';
import { pagePath, type SitePage } from '../router';
import {
  SITE_URL,
  SOCIAL_CARD,
  SOCIAL_CARD_ALT,
  LEGAL_ENTITY,
  STUDIO_NAME,
  EXTERNAL,
} from '../release';

/** 社卡片绝对 URL（单张中英双语默认卡，五语页面共用） */
const CARD_URL = `${SITE_URL}${SOCIAL_CARD}`;

/**
 * 结构化数据（裁决 23/24）：WebSite + Organization 真实事实，实体分层——
 * Organization.name = 法律主体、alternateName = 工作室品牌、JotLuck 为产品品牌，
 * WebSite 经 publisher 关联 Organization；SoftwareApplication 待正式发布。
 */
export const JSON_LD = JSON.stringify({
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'WebSite',
      '@id': `${SITE_URL}/#website`,
      url: SITE_URL,
      name: 'JotLuck',
      inLanguage: ['zh-CN', 'en', 'ja', 'ko', 'fr'],
      publisher: { '@id': `${SITE_URL}/#organization` },
    },
    {
      '@type': 'Organization',
      '@id': `${SITE_URL}/#organization`,
      name: LEGAL_ENTITY,
      alternateName: STUDIO_NAME,
      url: SITE_URL,
      logo: `${SITE_URL}/assets/brand/jotluck-icon.png`,
      sameAs: [EXTERNAL.githubRepo],
    },
  ],
});

/** 弱网适配：每语页面只 preload 本语展示体 + 正文 400 + 等宽（与 site.css 的 locale 字体绑定一致） */
const LOCALE_FONT_FILES: Record<Locale, string[]> = {
  zh: ['display-zh-hans', 'body-zh-hans-400'],
  en: ['display-en', 'body-en-400'],
  fr: ['display-fr', 'body-fr-400'],
  ja: ['display-ja', 'body-ja-400'],
  ko: ['display-ko', 'body-ko-400'],
};

/** 每页 SEO：title/description 按页面差异化（子页用导航标签 + 页首 lead），canonical/hreflang 五语互链 + x-default 指门页 + 社卡片。 */
export function usePageHead(page: SitePage) {
  const route = useRoute();
  const locale = computed<Locale>(() => route.meta.locale as Locale);
  const content = computed(() => getContent(locale.value));
  const title = computed(() =>
    page === 'home' ? content.value.meta.title : content.value.meta.pageTitles[page],
  );
  const description = computed(() =>
    page === 'home' ? content.value.meta.description : content.value.meta.pageDescriptions[page],
  );

  useHead(
    computed(() => ({
      htmlAttrs: { lang: LOCALE_TAGS[locale.value], 'data-locale': locale.value },
      title: title.value,
      meta: [
        { name: 'description', content: description.value },
        { property: 'og:title', content: title.value },
        { property: 'og:description', content: description.value },
        { property: 'og:type', content: 'website' },
        { property: 'og:site_name', content: 'JotLuck' },
        { property: 'og:url', content: `${SITE_URL}${pagePath(locale.value, page)}` },
        { property: 'og:image', content: CARD_URL },
        { property: 'og:image:width', content: '1280' },
        { property: 'og:image:height', content: '640' },
        { property: 'og:image:alt', content: SOCIAL_CARD_ALT },
        { name: 'twitter:card', content: 'summary_large_image' },
        { name: 'twitter:title', content: title.value },
        { name: 'twitter:description', content: description.value },
        { name: 'twitter:image', content: CARD_URL },
      ],
      script: [{ type: 'application/ld+json', innerHTML: JSON_LD }],
      link: [
        { rel: 'canonical', href: `${SITE_URL}${pagePath(locale.value, page)}` },
        ...[...LOCALE_FONT_FILES[locale.value], 'mono-400'].map((file) => ({
          rel: 'preload',
          as: 'font' as const,
          type: 'font/woff2',
          href: `/assets/fonts/files/${file}.woff2`,
          crossorigin: 'anonymous' as const,
        })),
        ...LOCALES.map((l) => ({
          rel: 'alternate',
          hreflang: LOCALE_TAGS[l],
          href: `${SITE_URL}${pagePath(l, page)}`,
        })),
        // x-default：语言不匹配时落到门页（语言选择器，Google 推荐模式）
        { rel: 'alternate', hreflang: 'x-default', href: `${SITE_URL}/` },
      ],
    })),
  );
}
