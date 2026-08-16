#!/usr/bin/env node
/**
 * verify-dist.mjs — JotLuck 官网 SSG 产物逐文件断言。
 *
 * 运行：node scripts/verify-dist.mjs（从 site/ 根目录）
 * 依赖：仅 Node 标准库（fs/path/url），无第三方包。
 *
 * 布局（postbuild.mjs 迁移后）：
 *   dist/index.html            门页（lang=en）
 *   dist/404.html              404（门页副本，canonical 指 /）
 *   dist/{l}/index.html        五语首页
 *   dist/{l}/{page}.html       五语 × 4 子页
 *   dist/sitemap.xml           sitemap（loc → dist 文件映射）
 *
 * 断言矩阵：
 *   (a) 26 个 HTML 文件全部存在（index + 5 语首页 + 5 语 × 4 子页）
 *   (b) html lang：门页 en；zh 页 zh-CN；其余 en/ja/ko/fr
 *   (c) canonical = https://jotluck.com 绝对 URL（门页 /、首页 /{l}/、子页 /{l}/{page}）
 *   (d) 5 条 alternate hreflang（zh-CN/en/ja/ko/fr 指向对应语言同页）+ 1 条 x-default → https://jotluck.com/
 *   (e) og:image 与 twitter:image = https://jotluck.com/assets/brand/social-preview.png；
 *       twitter:card = summary_large_image
 *   (f) 404.html 存在且 canonical = https://jotluck.com/
 *   (g) sitemap.xml：loc 恰好 26 条、无重复、与预期 URL 集合完全相等，且每条
 *       映射为 dist 文件（'/'→index.html、'/{l}/'→{l}/index.html、'/{l}/{page}'→{l}/{page}.html）
 *   (h) 五语首页：<h1 class="statement"> 在 SSG 态为连续纯文本（零 .ch 字符 span、
 *       display-line 行无嵌套标签、去标签文本非空）且与 EXPECTED_H1 预期句逐字一致；
 *       字符动画仅在水合后挂载
 *   (i) 25 个语言页（门页与 404 除外）：恰好 1 个 type="application/ld+json" <script>，
 *       可解析且实体语义正确（WebSite url/name/publisher 关联 + Organization 法律主体/alternateName）
 *   (j) title 非空含品牌名且全站唯一；meta description 子页 70–160 / 首页与门页 20–200；
 *       og:image:alt / twitter:title / twitter:description 均存在
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
const PAGES = ['download', 'themes', 'studio', 'privacy'];

/** (h) 五语首页 H1 预期完整句（品牌主句，稳定文案；content 改动时需同步——这正是护栏意义） */
const EXPECTED_H1 = {
  zh: '写作，本应轻盈。把生态留在纸页之外。',
  en: 'Writing was meant to feel light. Begin with a file.',
  ja: '書くことは、もともと軽やかなもの。まずは、ひとつのファイルから。',
  ko: '글쓰기는 본래 가벼워야 했다. 파일 하나에서 시작합니다.',
  fr: 'Écrire devait être léger. Commencez par un fichier.',
};

/** (i) JSON-LD 实体语义期望（与 src/release.ts 的 LEGAL_ENTITY / STUDIO_NAME 同源） */
const EXPECTED_ORG_NAME = '鸰湖科技（深圳）有限公司';
const EXPECTED_ORG_ALT = 'LeankomStudio';

/** (k) 下载页 Preview 事实期望（裁决 33，与 src/release.ts RELEASE.preview 同源；改版本须同步——护栏意义即在此） */
const EXPECTED_PREVIEW = {
  exe: 'https://github.com/jiay98528-dev/JotLuck/releases/download/v0.12.1-preview/JotLuck_0.12.1_x64-setup.exe',
  tag: 'https://github.com/jiay98528-dev/JotLuck/releases/tag/v0.12.1-preview',
  sha: '1cebc263801c22d40d7f8c4f9c2a5303d57a17ae8e9b754e8dd25f0dc6cddd28',
  policy: 'https://github.com/jiay98528-dev/JotLuck/blob/main/CODE_SIGNING.md',
  releases: 'https://github.com/jiay98528-dev/JotLuck/releases',
};

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
 * path 相对 dist/；pageKind ∈ 'gate' | 'home' | 'download' | 'themes' | 'studio' | 'privacy'
 */
function expectationFor(path) {
  if (path === 'index.html') {
    return { pageKind: 'gate', lang: 'en', canonical: `${SITE_URL}/` };
  }
  const m = /^([a-z]{2})\/(index\.html|(download|themes|studio|privacy)\.html)$/.exec(path);
  if (!m) return null;
  const locale = m[1];
  const pageKind = m[2] === 'index.html' ? 'home' : m[3];
  const canonical = pageKind === 'home' ? `${SITE_URL}/${locale}/` : `${SITE_URL}/${locale}/${pageKind}`;
  return { pageKind, lang: TAGS[locale], canonical };
}

/** 某 pageKind 在语言 ll 下的 hreflang 目标 URL。 */
function hreflangHref(ll, pageKind) {
  if (pageKind === 'gate' || pageKind === 'home') return `${SITE_URL}/${ll}/`;
  return `${SITE_URL}/${ll}/${pageKind}`;
}

/** (g) sitemap <loc> → dist 相对路径；无法映射时抛错。 */
function locToRel(loc) {
  let pathname;
  try {
    pathname = new URL(loc, SITE_URL).pathname;
  } catch {
    throw new Error('无效 URL');
  }
  if (pathname === '/') return 'index.html';
  const home = /^\/([a-z]{2})\/$/.exec(pathname);
  if (home) return `${home[1]}/index.html`;
  const page = /^\/([a-z]{2})\/(download|themes|studio|privacy)$/.exec(pathname);
  if (page) return `${page[1]}/${page[2]}.html`;
  throw new Error('无法映射到 dist 文件');
}

/** (h) 五语首页 h1.statement 结构断言。 */
function checkStatementH1(html, rel) {
  const label = `dist/${rel} h1.statement`;
  const m = /<h1\b[^>]*class="[^"]*\bstatement\b[^"]*"[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
  if (!m) {
    check(false, `${label} 存在`, '未找到 <h1 class="statement">');
    return;
  }
  const inner = m[1];

  // SSG 态 H1 必须是连续纯文本行：零 .ch 字符 span（字符动画仅在水合后挂载，
  // 字符 span 化曾致行边界断词「wasmeant」——裁决 23 定为 SSG 纯文本方案）
  const chSpans = [...inner.matchAll(/<span\b[^>]*>/gi)]
    .map((t) => extractAttrs(t[0]))
    .filter((a) => (a.class || '').split(/\s+/).includes('ch'));
  check(chSpans.length === 0, `${label} 无字符 span`, `期望 0 个 .ch span，实际 ${chSpans.length}`);

  // display-line 行容器存在、为纯文本（无嵌套标签）
  const lineSpans = [...inner.matchAll(/<span\b[^>]*class="[^"]*\bdisplay-line\b[^"]*"[^>]*>([\s\S]*?)<\/span>/gi)];
  check(lineSpans.length > 0, `${label} display-line 存在`, `${lineSpans.length} 行`);
  const nested = lineSpans.filter((s) => /<[a-z]/i.test(s[1]));
  check(nested.length === 0, `${label} 行为纯文本`, nested.length ? `${nested.length} 行含嵌套标签` : '全部行无嵌套标签');

  // 去标签文本非空 + 与预期完整句逐字比对（防"纯文本但断词/缺句"回归）
  const text = inner.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  check(text.length > 0, `${label} 文本非空`, `"${text.slice(0, 60)}${text.length > 60 ? '…' : ''}"`);
  const expected = EXPECTED_H1[rel.slice(0, 2)];
  check(
    text === expected,
    `${label} 文本精确匹配`,
    text === expected ? '与预期句一致' : `期望 "${expected}"，实际 "${text}"`,
  );
}

/** (i) JSON-LD：恰好 1 个 application/ld+json <script>，可解析且实体语义正确。 */
function checkJsonLd(html, rel) {
  const label = `dist/${rel} JSON-LD`;
  const scripts = [...html.matchAll(/<script\b[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)];
  check(scripts.length === 1, `${label} 数量`, `期望恰好 1 个，实际 ${scripts.length}`);
  if (scripts.length !== 1) return;
  const raw = scripts[0][1].trim();
  let data;
  try {
    data = JSON.parse(raw);
    check(true, `${label} 可解析`, 'JSON.parse 成功');
  } catch (err) {
    check(false, `${label} 可解析`, `JSON.parse 抛错：${err.message}`);
    return;
  }
  // 实体语义：WebSite（url/name/publisher 关联）+ Organization（法律主体/alternateName/url）
  const graph = Array.isArray(data?.['@graph']) ? data['@graph'] : [];
  const site = graph.find((n) => n?.['@type'] === 'WebSite');
  const org = graph.find((n) => n?.['@type'] === 'Organization');
  check(
    site?.url === SITE_URL && site?.name === 'JotLuck',
    `${label} WebSite 语义`,
    site ? `url=${site.url} name=${site.name}` : '缺 WebSite 节点',
  );
  check(
    site?.publisher?.['@id'] === `${SITE_URL}/#organization`,
    `${label} publisher 关联`,
    `publisher['@id']=${site?.publisher?.['@id'] ?? '(缺失)'}`,
  );
  check(
    org?.name === EXPECTED_ORG_NAME && org?.alternateName === EXPECTED_ORG_ALT && org?.url === SITE_URL,
    `${label} Organization 语义`,
    org ? `name=${org.name} alternateName=${org.alternateName}` : '缺 Organization 节点',
  );
}

// ---------- (a) 26 文件清单（五语根页 = {locale}/index.html） ----------
const expectedFiles = ['index.html'];
for (const l of LOCALES) expectedFiles.push(`${l}/index.html`);
for (const l of LOCALES) for (const p of PAGES) expectedFiles.push(`${l}/${p}.html`);
if (expectedFiles.length !== 26) {
  console.error(`[FATAL] 期望文件数 != 26（实际 ${expectedFiles.length}）`);
  process.exit(2);
}

// ---------- 21 文件循环：(a)-(e) + (j) + 语言页 (i) + 五语首页 (h) ----------
const titleSeen = [];
for (const rel of expectedFiles) {
  const abs = join(DIST, rel);
  console.log(`\n=== dist/${rel} ===`);

  // (a) 存在性
  if (!existsSync(abs)) {
    check(false, `存在性`, `缺少文件 dist/${rel}`);
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
    check(
      byLang[tag] === expectHreflang[tag],
      `hreflang ${tag}`,
      `期望 ${expectHreflang[tag]}${byLang[tag] ? `，实际 ${byLang[tag]}` : '，缺失'}`,
    );
  }
  const extraLangs = Object.keys(byLang).filter((t) => !(t in expectHreflang));
  const dupLangs = langNames.filter((t) => alternates.filter((a) => a.hreflang === t).length !== 1);
  check(extraLangs.length === 0, `hreflang 无多余语言`, extraLangs.length ? `多余: ${extraLangs.join(', ')}` : '通过');
  check(dupLangs.length === 0, `hreflang 无重复`, dupLangs.length ? `重复: ${dupLangs.join(', ')}` : '通过');

  // (e) 社卡片
  const ogImage = metas.find((m) => m.property === 'og:image');
  const twImage = metas.find((m) => m.name === 'twitter:image');
  const twCard = metas.find((m) => m.name === 'twitter:card');
  check(
    ogImage?.content === CARD_URL,
    `og:image`,
    `期望 ${CARD_URL}${ogImage?.content ? `，实际 ${ogImage.content}` : '，缺失'}`,
  );
  check(
    twImage?.content === CARD_URL,
    `twitter:image`,
    `期望 ${CARD_URL}${twImage?.content ? `，实际 ${twImage.content}` : '，缺失'}`,
  );
  check(
    twCard?.content === 'summary_large_image',
    `twitter:card`,
    `期望 summary_large_image${twCard?.content ? `，实际 ${twCard.content}` : '，缺失'}`,
  );

  // (j) title / description / twitter / og:image:alt
  const titleMatch = /<title>([\s\S]*?)<\/title>/i.exec(html);
  const titleText = titleMatch ? titleMatch[1].trim() : '';
  check(titleText.length > 0, `title 非空`, `"${titleText.slice(0, 50)}"`);
  check(titleText.includes('JotLuck'), `title 含品牌名`, `"${titleText.slice(0, 50)}"`);
  titleSeen.push([rel, titleText]);
  const descMeta = metas.find((m) => m.name === 'description');
  const descLen = descMeta?.content?.length ?? 0;
  // 子页（download/themes/studio/privacy）按契约 70–160；首页/门页单独定义 20–200（裁决 24/25）
  const isSubpage = PAGES.includes(exp.pageKind);
  const [lo, hi] = isSubpage ? [70, 160] : [20, 200];
  check(
    descLen >= lo && descLen <= hi,
    `description 长度 ${lo}–${hi}`,
    `${descLen} 字符${descLen >= lo && descLen <= hi ? '' : '（越界）'}`,
  );
  const ogAlt = metas.find((m) => m.property === 'og:image:alt');
  check(Boolean(ogAlt?.content?.trim()), `og:image:alt 存在`, ogAlt?.content ? '有' : '缺失');
  const twTitle = metas.find((m) => m.name === 'twitter:title');
  const twDesc = metas.find((m) => m.name === 'twitter:description');
  check(Boolean(twTitle?.content?.trim()), `twitter:title 存在`, twTitle?.content ? '有' : '缺失');
  check(Boolean(twDesc?.content?.trim()), `twitter:description 存在`, twDesc?.content ? '有' : '缺失');

  // (i) 全站 26 页（含门页，裁决 32 门页补 JSON-LD）：恰好 1 个且可解析
  checkJsonLd(html, rel);

  // (k) 五语下载页 Preview 事实（裁决 33）：exe 直链 / Release tag 页 / 完整 SHA-256 三者齐全
  if (exp.pageKind === 'download') {
    check(html.includes(EXPECTED_PREVIEW.exe), `Preview exe 直链`, EXPECTED_PREVIEW.exe);
    check(html.includes(EXPECTED_PREVIEW.tag), `Preview tag 页`, EXPECTED_PREVIEW.tag);
    check(html.includes(EXPECTED_PREVIEW.sha), `Preview SHA-256`, EXPECTED_PREVIEW.sha);
    // (k2) 代码签名政策链接（裁决 35，SignPath 审查披露项）
    check(html.includes(EXPECTED_PREVIEW.policy), `签名政策链接`, EXPECTED_PREVIEW.policy);
    // (k4) GitHub 分流按钮（裁决 39）：releases 索引直链（带引号精确匹配，区别 tag 链接）
    check(
      html.includes(`href="${EXPECTED_PREVIEW.releases}"`),
      `GitHub 分流链接`,
      EXPECTED_PREVIEW.releases,
    );
  }

  // (h) 五语首页：h1.statement 结构
  if (/^[a-z]{2}\/index\.html$/.test(rel)) {
    checkStatementH1(html, rel);
    // (k3) 首页页脚签名政策链接（裁决 37，SignPath 首页披露项）
    check(html.includes(EXPECTED_PREVIEW.policy), `页脚签名政策链接`, EXPECTED_PREVIEW.policy);
  }
}

// ---------- (j 续) title 全站唯一 ----------
console.log(`\n=== title 唯一性 ===`);
const titleCounts = new Map();
for (const [, t] of titleSeen) titleCounts.set(t, (titleCounts.get(t) ?? 0) + 1);
const dupTitles = [...titleCounts].filter(([, n]) => n > 1);
check(
  dupTitles.length === 0,
  `title 全站唯一（${titleSeen.length} 页）`,
  dupTitles.length ? `重复: ${dupTitles.map(([t, n]) => `"${t}"×${n}`).join(', ')}` : '无重复',
);

// ---------- (f) 404.html ----------
console.log(`\n=== dist/404.html ===`);
const notFoundPath = join(DIST, '404.html');
if (!existsSync(notFoundPath)) {
  check(false, `存在性`, `缺少文件 dist/404.html`);
} else {
  check(true, `存在性`, `dist/404.html 存在`);
  const nf = parseHtml(readFileSync(notFoundPath, 'utf8'));
  const nfCanonical = nf.links.find((a) => a.rel === 'canonical');
  check(
    nfCanonical?.href === `${SITE_URL}/`,
    `canonical`,
    `期望 ${SITE_URL}/${nfCanonical?.href ? `，实际 ${nfCanonical.href}` : '，缺失'}`,
  );
}

// ---------- (g) sitemap.xml ----------
console.log(`\n=== dist/sitemap.xml ===`);
const sitemapPath = join(DIST, 'sitemap.xml');
if (!existsSync(sitemapPath)) {
  check(false, `sitemap.xml 存在`, `缺少文件 dist/sitemap.xml`);
} else {
  check(true, `sitemap.xml 存在`, `dist/sitemap.xml 存在`);
  const sm = readFileSync(sitemapPath, 'utf8');
  const locs = [...sm.matchAll(/<loc[^>]*>([\s\S]*?)<\/loc>/gi)].map((m) => m[1].trim());
  // 精确集合：恰好 26 条、无重复、与预期 URL 集合完全相等
  const expectedLocs = [`${SITE_URL}/`];
  for (const l of LOCALES) expectedLocs.push(`${SITE_URL}/${l}/`);
  for (const l of LOCALES) for (const p of PAGES) expectedLocs.push(`${SITE_URL}/${l}/${p}`);
  check(locs.length === 26, `loc 数量 = 26`, `实际 ${locs.length} 条`);
  const dupLocs = locs.filter((loc, i) => locs.indexOf(loc) !== i);
  check(dupLocs.length === 0, `loc 无重复`, dupLocs.length ? `重复: ${[...new Set(dupLocs)].join(', ')}` : '通过');
  const missing = expectedLocs.filter((u) => !locs.includes(u));
  const extra = locs.filter((u) => !expectedLocs.includes(u));
  check(
    missing.length === 0 && extra.length === 0,
    `loc 与预期集合相等`,
    missing.length || extra.length ? `缺: ${missing.join(', ') || '无'}｜多: ${extra.join(', ') || '无'}` : '26 条完全匹配',
  );
  for (const loc of locs) {
    let rel;
    try {
      rel = locToRel(loc);
    } catch (err) {
      check(false, `loc 映射`, `${loc} — ${err.message}`);
      continue;
    }
    check(existsSync(join(DIST, rel)), `loc → dist/${rel}`, loc);
  }
}

// ---------- 汇总 ----------
console.log(`\n================ 汇总 ================`);
console.log(`断言总数：${passCount + failCount}｜PASS：${passCount}｜FAIL：${failCount}`);
console.log(`检查文件数：${expectedFiles.length}/26（另有 404.html 与 sitemap.xml 专项）`);
if (failCount > 0) {
  console.log(`结果：FAIL — 存在 ${failCount} 项未通过`);
  process.exitCode = 1;
} else {
  console.log(`结果：PASS — 全部断言通过`);
}
