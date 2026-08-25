#!/usr/bin/env node
/**
 * postbuild.mjs — SSG 产物整形（build 后自动运行，见 package.json）。
 *
 * 1) 目录式首页：dist/{locale}.html → dist/{locale}/index.html（5 语）
 *    根因：canonical/内部链接/sitemap 均为 /{locale}/ 目录式 URL，
 *    扁平 {locale}.html 无法被静态托管（含 vite preview）映射到 /{locale}/。
 * 2) dist/404.html：复制语言门页，供支持 404.html 约定的静态托管返回真 404。
 *
 * 依赖：仅 Node 标准库。任一源文件缺失即非零退出（构建断路）。
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const SITE_ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIST = join(SITE_ROOT, 'dist');
const LOCALES = ['zh', 'en', 'ja', 'ko', 'fr'];

for (const locale of LOCALES) {
  const src = join(DIST, `${locale}.html`);
  const dir = join(DIST, locale);
  const dest = join(dir, 'index.html');
  if (!existsSync(src)) {
    console.error(`[postbuild] FAIL 缺少 ${locale}.html（SSG 产物不完整）`);
    process.exit(1);
  }
  mkdirSync(dir, { recursive: true });
  renameSync(src, dest);
  console.log(`[postbuild] ${locale}.html → ${locale}/index.html`);
}

const gate = join(DIST, 'index.html');
if (!existsSync(gate)) {
  console.error('[postbuild] FAIL 缺少 index.html（语言门页）');
  process.exit(1);
}
copyFileSync(gate, join(DIST, '404.html'));
console.log('[postbuild] index.html → 404.html');

// 3) 内联每页构建产生的 CSS：保留完整规则与 CSS 资产，只消除首屏样式请求往返。
// 路由动态导入仍可在客户端导航时复用 dist/assets 中的 CSS 文件。
const htmlFiles = [
  'index.html',
  '404.html',
  ...LOCALES.flatMap((locale) => [
    `${locale}/index.html`,
    `${locale}/download.html`,
    `${locale}/themes.html`,
    `${locale}/studio.html`,
    `${locale}/privacy.html`,
  ]),
];
let inlineCount = 0;
for (const relativePath of htmlFiles) {
  const htmlPath = join(DIST, relativePath);
  let html = readFileSync(htmlPath, 'utf8');
  html = html.replace(/<link\b[^>]*\brel="stylesheet"[^>]*>/g, (tag) => {
    const href = /\bhref="([^"]+\.css)"/.exec(tag)?.[1];
    if (!href?.startsWith('/assets/')) return tag;
    const css = readFileSync(join(DIST, href.slice(1)), 'utf8');
    if (css.includes('</style>')) {
      throw new Error(`[postbuild] CSS 含有不可内联的 </style>: ${href}`);
    }
    inlineCount += 1;
    return `<style data-inline-source="${href}">${css}</style>`;
  });
  writeFileSync(htmlPath, html);
}
console.log(
  `[postbuild] inline stylesheets × ${inlineCount} across ${htmlFiles.length} HTML files`,
);

// 4) sitemap lastmod 构建日化（随每次构建刷新为当天；按页面内容时间维护为更优解，裁决 24 记为可接受近似）
const sitemapPath = join(DIST, 'sitemap.xml');
if (existsSync(sitemapPath)) {
  const today = new Date().toISOString().slice(0, 10);
  const sm = readFileSync(sitemapPath, 'utf8');
  const count = (sm.match(/<lastmod>/g) ?? []).length;
  writeFileSync(
    sitemapPath,
    sm.replace(/<lastmod>[^<]*<\/lastmod>/g, `<lastmod>${today}</lastmod>`),
  );
  console.log(`[postbuild] sitemap lastmod × ${count} → ${today}`);
}
