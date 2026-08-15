/**
 * 站点内容模型 — 五语键对称由 TypeScript 结构类型强制保证：
 * 每个 locale 文件必须完整实现 SiteContent，缺键即编译错误。
 */

export const LOCALES = ['zh', 'en', 'ja', 'ko', 'fr'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'zh';

export const LOCALE_TAGS: Record<Locale, string> = {
  zh: 'zh-CN',
  en: 'en',
  ja: 'ja',
  ko: 'ko',
  fr: 'fr',
};

export interface HeroContent {
  eyebrow: string;
  /** 巨型主句：展示体语气段，按语言显式断行（每元素一行） */
  lines: string[];
  /** 强调段：正文粗体，炭墨，橘红印面承托 */
  emphasis: string;
  /** 强调段内需反白高亮的子串（可选）：印面上呈暖白，印面未就位回退套准橙 */
  emphasisHighlight?: string;
  /** 主句下方的安静补充行 */
  subline: string;
  action: string;
  dateLine: string;
}

export interface NarrativeAct {
  id: string;
  title: string;
  body: string;
  /** mono 技术边注（本地化标签 + 不可翻译标记原样） */
  rail: string[];
}

export interface MultilingualContent {
  eyebrow: string;
  title: string;
  body: string;
  /** 五种语言的本地名称，按 zh/ja/ko/en/fr 序 */
  languages: string[];
  note: string;
}

export interface DownloadContent {
  eyebrow: string;
  title: string;
  lead: string;
  statusLabel: string;
  statusValue: string;
  platformTitle: string;
  platforms: Array<{ name: string; state: string }>;
  honestyTitle: string;
  honestyBody: string;
  /** Preview 下载区文案（裁决 33；版本/SHA-256/链接等事实值在 release.ts RELEASE.preview） */
  previewTitle: string;
  downloadBtn: string;
  releaseBtn: string;
  signNote: string;
  /** 代码签名政策链接文案（URL 在 release.ts EXTERNAL.codeSigning） */
  signPolicyLink: string;
  notesTitle: string;
  notes: string[];
}

export interface ThemesContent {
  eyebrow: string;
  title: string;
  lead: string;
  items: Array<{ id: 'paper' | 'halo-canvas' | 'lumen-field'; name: string; blurb: string }>;
  blueprintTitle: string;
  blueprintBody: string;
  marketplaceNote: string;
}

/**
 * 主题预览 SVG 的全部可见文案。
 * 行内迷你标记：[[wikilink]] 与 #tag 由 SVG 组件解析为高亮 tspan。
 */
export interface ThemePreviewUi {
  outline: string;
  backlinks: string;
  tags: string;
  noTags: string;
  search: string;
  searchShortcut: string;
  templates: string;
  live: string;
  syntax: string;
  unsaved: string;
  saved: string;
  /** 主题预览模拟操作的重播按钮标签 */
  replay: string;
  exportAction: string;
  share: string;
  recent: string;
  clearFormat: string;
  scratch: string;
  quote: string;
  body: string;
  ready: string;
}

export interface ThemeSampleNote {
  title: string;
  intro: string;
  section: string;
  bullets: string[];
  quoteLine: string;
  statusLeft: string;
}

export interface ThemeHaloNote {
  notebook: string;
  files: string[];
  filePaths: string[];
  /** 模拟操作演示中逐字键入的新 bullet（含 [[wikilink]] 标记），追加在 sampleNote.bullets 之后 */
  typedBullet: string;
  frontmatterTitle: string;
  frontmatterTags: string[];
}

export interface ThemePreviewContent {
  ui: ThemePreviewUi;
  sampleNote: ThemeSampleNote;
  /** Halo Canvas 预览的界面框架（侧栏/标签页/frontmatter）；正文与 Paper/Lumen 共享 sampleNote */
  haloNote: ThemeHaloNote;
}

export interface StudioContent {
  eyebrow: string;
  title: string;
  lead: string;
  quote: string;
  body: string;
  action: string;
}

/** 隐私页（裁决 26）：分节正文 + 联系段；邮箱地址由页面组件从 release.ts 注入，不进文案 */
export interface PrivacyContent {
  eyebrow: string;
  title: string;
  lead: string;
  sections: Array<{ title: string; body: string }>;
  contactTitle: string;
  contactBody: string;
}

export interface SiteContent {
  meta: {
    title: string;
    description: string;
    /** 子页 <title>：栏目词 · JotLuck — 类别短句（≤60 字符，SEO 差异化，2026-08-05 裁决 23） */
    pageTitles: Record<'download' | 'themes' | 'studio' | 'privacy', string>;
    /** 子页搜索摘要（70–160 字符，不复用视觉 lead——lead 过短/过长失衡，裁决 24） */
    pageDescriptions: Record<'download' | 'themes' | 'studio' | 'privacy', string>;
  };
  localeName: string;
  header: {
    nav: { home: string; download: string; themes: string; studio: string };
    langSelectorLabel: string;
  };
  hero: HeroContent;
  narrative: NarrativeAct[];
  multilingual: MultilingualContent;
  download: DownloadContent;
  themes: ThemesContent;
  themePreview: ThemePreviewContent;
  studio: StudioContent;
  privacy: PrivacyContent;
  footer: {
    studio: string;
    tagline: string;
    copyright: string;
    links: { support: string; privacy: string; signing: string; github: string };
  };
}
