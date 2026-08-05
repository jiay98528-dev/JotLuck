#!/usr/bin/env node
/**
 * verify-dist.mjs — JotLuck 官网 SSG 产物（21 HTML）逐文件断言。
 *
 * 运行：node scripts/verify-dist.mjs（从 site/ 根目录）
 * 依赖：仅 Node 标准库（fs/path/url），无第三方包。
 *
 * 断言矩阵（每文件 6 项）：
 *   (a) 21 个 HTML 文件全部存在（index + 5 语根页 + 5 语 × 3 子页）
 *   (b) html lang：门页 en；zh 页 zh-CN；其余 en/ja/ko/fr
 *   (c) canonical = https://jotluck.com 绝对 URL（门页 /、首页 /{l}/、子页 /{l}/{page}）
 *   (d) 5 条 alternate hreflang（zh-CN/en/ja/ko/fr 指向对应语言同页）+ 1 条 x-default → https://jotluck.com/
 *   (e) og:image 与 twitter:image = https://jotluck.com/assets/brand/social-preview.png；
 *       twitter:card = summary_large_image
 *
 * 任一断言失败：打印 FAIL 明细，进程退出码非零。
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const SITE_ROOT = fileURLToPath(new URL('..', import.meta.url)); // scripts/ 的上级 = site/
const DIST = join(SITE_ROOT, 'dist');

const SITE_URL = 'https://jotluck.com';
const CARD_URL = `${SITE_URL}/assets/brand/social-preview.png`;
const LOCALES = ['zh', 'en', 'ja', 'ko', 'fr'];
const TAGS = { zh: 'zh-CN', en: 'en', ja: 'ja', ko: 'ko', fr: 'fr' };
const PAGES = ['download', 'themes', 'studio'];

let passCount = 0;
let failCount = 0;

function check(ok, label, detail = '') {
  if (ok) {
    passCount += 1;
    console.log(`[PASS] ${label}${detail ? ` — ${detail}` : ''}`);
  } else {
    failCount += 1;
    console.log(`[FAIL] ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

/** 从标签 HTML 中提取全部属性键值对。 */
function extractAttrs(tagHtml) {
  const attrs = {};
  const re = /([\w:-]+)\s*=\s*"([^"]*)"/g;
  let m;
  while ((m = re.exec(tagHtml)) !== null) attrs[m[1]] = m[2];
  return attrs;
}

/** 解析 HTML：返回 { htmlLang, links: [attrs...], metas: [attrs...] }。 */
function parseHtml(html) {
  const langMatch = /<html[^>]*>/i.exec(html);
  const htmlLang = langMatch ? extractAttrs(langMatch[0]).lang : undefined;
  const links = [];
  const linkRe = /<link\b[^>]*>/gi;
  let lm;
  while ((lm = linkRe.exec(html)) !== null) links.push(extractAttrs(lm[0]));
  const metas = [];
  const metaRe = /<meta\b[^>]*>/gi;
  let mm;
  while ((mm = metaRe.exec(html)) !== null) metas.push(extractAttrs(mm[0]));
  return { htmlLang, links, metas };
}

/**
 * 文件 → 期望值。
 * path 相对 dist/；pageKind ∈ 'gate' | 'home' | 'download' | 'themes' | 'studio'
 */
function expectationFor(path) {
  if (path === 'index.html') {
    return { pageKind: 'gate', lang: 'en', canonical: `${SITE_URL}/` };
  }
  const m = /^([a-z]{2})(?:\.html|\/(download|themes|studio)\.html)$/.exec(path);
  if (!m) return null;
  const locale = m[1];
  const pageKind = m[2] ? m[2] : 'home';
  const canonical = pageKind === 'home' ? `${SITE_URL}/${locale}/` : `${SITE_URL}/${locale}/${pageKind}`;
  return { pageKind, lang: TAGS[locale], canonical };
}

/** 某 pageKind 在语言 ll 下的 hreflang 目标 URL。 */
function hreflangHref(ll, pageKind) {
  if (pageKind === 'gate' || pageKind === 'home') return `${SITE_URL}/${ll}/`;
  return `${SITE_URL}/${ll}/${pageKind}`;
}

// ---------- (a) 21 文件清单 ----------
const expectedFiles = ['index.html'];
for (const l of LOCALES) expectedFiles.push(`${l}.html`);
for (const l of LOCALES) for (const p of PAGES) expectedFiles.push(`${l}/${p}.html`);
if (expectedFiles.length !== 21) {
  console.error(`[FATAL] 期望文件数 != 21（实际 ${expectedFiles.length}）`);
  process.exit(2);
}

// ---------- 逐文件断言 ----------
for (const rel of expectedFiles) {
  const abs = join(DIST, rel);
  console.log(`\n=== dist/${rel} ===`);

  // (a) 存在性
  if (!existsSync(abs)) {
    check(false, `存在性`, `缺少文件 dist/${rel}`);
    failCount += 1; // 存在性失败计入全局
    continue;
  }
  check(true, `存在性`, `dist/${rel} 存在`);

  let html;
  try {
    html = readFileSync(abs, 'utf8');
  } catch (err) {
    check(false, `读取`, String(err));
    continue;
  }
  const exp = expectationFor(rel);
  const { htmlLang, links, metas } = parseHtml(html);

  // (b) html lang
  check(htmlLang === exp.lang, `html lang`, `期望 ${exp.lang}，实际 ${htmlLang ?? '(缺失)'}`);

  // (c) canonical
  const canonical = links.find((a) => a.rel === 'canonical');
  const canonicalHref = canonical?.href;
  check(
    canonicalHref === exp.canonical,
    `canonical`,
    `期望 ${exp.canonical}${canonicalHref ? `，实际 ${canonicalHref}` : '，缺失'}`,
  );

  // (d) hreflang：5 alternate + 1 x-default，href 精确匹配
  const alternates = links.filter((a) => a.rel === 'alternate' && a.hreflang);
  const byLang = Object.fromEntries(alternates.map((a) => [a.hreflang, a.href]));
  const expectHreflang = {};
  for (const ll of LOCALES) expectHreflang[TAGS[ll]] = hreflangHref(ll, exp.pageKind);
  expectHreflang['x-default'] = `${SITE_URL}/`;

  const langNames = Object.keys(expectHreflang);
  for (const tag of langNames) {
    check(byLang[tag] === expectHreflang[tag], `hreflang ${tag}`, `期望 ${expectHreflang[tag]}${byLang[tag] ? `，实际 ${byLang[tag]}` : '，缺失'}`);
  }
  const extraLangs = Object.keys(byLang).filter((t) => !(t in expectHreflang));
  const dupLangs = langNames.filter((t) => alternates.filter((a) => a.hreflang === t).length !== 1);
  check(extraLangs.length === 0, `hreflang 无多余语言`, extraLangs.length ? `多余: ${extraLangs.join(', ')}` : '通过');
  check(dupLangs.length === 0, `hreflang 无重复`, dupLangs.length ? `重复: ${dupLangs.join(', ')}` : '通过');

  // (e) 社卡片
  const ogImage = metas.find((m) => m.property === 'og:image');
  const twImage = metas.find((m) => m.name === 'twitter:image');
  const twCard = metas.find((m) => m.name === 'twitter:card');
  check(ogImage?.content === CARD_URL, `og:image`, `期望 ${CARD_URL}${ogImage?.content ? `，实际 ${ogImage.content}` : '，缺失'}`);
  check(twImage?.content === CARD_URL, `twitter:image`, `期望 ${CARD_URL}${twImage?.content ? `，实际 ${twImage.content}` : '，缺失'}`);
  check(twCard?.content === 'summary_large_image', `twitter:card`, `期望 summary_large_image${twCard?.content ? `，实际 ${twCard.content}` : '，缺失'}`);
}

// ---------- 汇总 ----------
console.log(`\n================ 汇总 ================`);
console.log(`断言总数：${passCount + failCount}｜PASS：${passCount}｜FAIL：${failCount}`);
console.log(`检查文件数：${expectedFiles.length}/21`);
if (failCount > 0) {
  console.log(`结果：FAIL — 存在 ${failCount} 项未通过`);
  process.exitCode = 1;
} else {
  console.log(`结果：PASS — 全部 21 个 HTML 通过全部断言`);
}
