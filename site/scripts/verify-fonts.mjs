#!/usr/bin/env node
/**
 * verify-fonts.mjs — JotLuck 官网字体核查（纯 Node，无第三方依赖）。
 *
 * 用法：在 site 根目录运行  node scripts/verify-fonts.mjs
 * （脚本以自身位置定位 site 根，与当前工作目录无关）
 *
 * 核查内容：
 *  (a) 从 src/content/{zh,en,ja,ko,fr}.ts 提取每语言全部字符串字面量（含键路径），
 *      再并入 src/ 各 .vue 模板中的硬编码可见文本（品牌名、语言标签、SVG 图标符号等，五语共有），
 *      得到每语言实际字符集（codepoint 集合）。
 *  (b) 对照 src/fonts/font-manifest.json 声明的 unicode-range，断言每语言字符
 *      百分之百被该语言页面实际加载的字族（display / body / mono 任一覆盖即可）覆盖；
 *      缺字符逐字列出并给出出现位置（文件 + 键路径 / 模板位置）。
 *  (c) 加载面审计：html[lang=X] 绑定的 font-family 只应解析到本语言 @font-face 文件；
 *      若某语言页面会触发其他语言字体文件下载则报告（按页面组件闭包静态分析）。
 *  (d) 断言 src/styles/tokens.css 存在 font-synthesis: none。
 *
 * 任一断言失败 → 退出码非零。
 */
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(p, 'utf8');
const rel = (p) => relative(ROOT, p).split(sep).join('/');

const LOCALES = ['zh', 'en', 'ja', 'ko', 'fr'];
const LOCALE_TAGS = { zh: 'zh-CN', en: 'en', ja: 'ja', ko: 'ko', fr: 'fr' };
const CONTENT_FILES = {
  zh: 'src/content/zh.ts',
  en: 'src/content/en.ts',
  ja: 'src/content/ja.ts',
  ko: 'src/content/ko.ts',
  fr: 'src/content/fr.ts',
};
const PAGES = ['home', 'download', 'themes', 'studio'];
const PAGE_ENTRIES = {
  home: ['src/pages/HomePage.vue'],
  download: ['src/pages/DownloadPage.vue'],
  themes: ['src/pages/ThemesPage.vue'],
  studio: ['src/pages/StudioPage.vue'],
  gate: ['src/pages/LocaleGate.vue'],
};

let failures = 0;
const fail = (msg) => {
  failures += 1;
  console.log(`  ✗ ${msg}`);
};
const ok = (msg) => console.log(`  ✓ ${msg}`);
const warn = (msg) => console.log(`  ⚠ ${msg}`);

/* ------------------------------------------------------------------ */
/* 工具                                                                */
/* ------------------------------------------------------------------ */

function decodeEntities(s) {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&copy;/g, '©')
    .replace(/&mdash;/g, '—')
    .replace(/&middot;/g, '·')
    .replace(/&amp;/g, '&');
}

function addTextChars(set, positions, str, where) {
  for (const ch of str) {
    const cp = ch.codePointAt(0);
    if (cp < 0x20 || cp === 0x7f) continue; // 控制字符不渲染，不计入字符集
    set.add(ch);
    if (positions) (positions[ch] ??= new Set()).add(where);
  }
}

function parseUnicodeRanges(str) {
  return str.split(',').map((s) => {
    const m = /^U\+([0-9A-Fa-f]+)(?:-(?:U\+)?([0-9A-Fa-f]+))?$/.exec(s.trim());
    if (!m) throw new Error(`无法解析 unicode-range 片段: "${s}"`);
    const start = parseInt(m[1], 16);
    return { start, end: m[2] ? parseInt(m[2], 16) : start };
  });
}

function inRanges(cp, ranges) {
  return ranges.some((r) => cp >= r.start && cp <= r.end);
}

function collectVueFiles(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = resolve(dir, entry.name);
    if (entry.isDirectory()) collectVueFiles(p, out);
    else if (entry.name.endsWith('.vue')) out.push(p);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* (a) content/*.ts 字符串字面量 + 键路径（纯文本递归解析）            */
/* ------------------------------------------------------------------ */

function parseTsStrings(file) {
  const source = read(file);
  const results = [];
  const n = source.length;
  let i = 0;

  function skipWs() {
    for (;;) {
      const c = source[i];
      if (c === ' ' || c === '\t' || c === '\r' || c === '\n') { i++; continue; }
      if (c === '/' && source[i + 1] === '/') { while (i < n && source[i] !== '\n') i++; continue; }
      if (c === '/' && source[i + 1] === '*') {
        i += 2;
        while (i < n && !(source[i] === '*' && source[i + 1] === '/')) i++;
        i += 2;
        continue;
      }
      break;
    }
  }

  function readString() {
    const quote = source[i];
    i++;
    let out = '';
    while (i < n && source[i] !== quote) {
      const c = source[i];
      if (c === '\\') {
        i++;
        const e = source[i];
        if (e === 'n') out += '\n';
        else if (e === 't') out += '\t';
        else if (e === 'r') out += '\r';
        else if (e === 'u') {
          out += String.fromCharCode(parseInt(source.slice(i + 1, i + 5), 16));
          i += 4;
        } else out += e;
        i++;
      } else {
        out += c;
        i++;
      }
    }
    i++; // 结束引号
    return out;
  }

  function readIdent() {
    const start = i;
    while (i < n && /[A-Za-z0-9_$]/.test(source[i])) i++;
    return source.slice(start, i);
  }

  function readNumber() {
    while (i < n && /[0-9.eE+-]/.test(source[i])) i++;
  }

  function skipBalanced(open, close) {
    i++; // 跳过 open
    let depth = 1;
    while (i < n && depth > 0) {
      const c = source[i];
      if (c === "'" || c === '"' || c === '`') { readString(); continue; }
      if (c === open) depth++;
      else if (c === close) depth--;
      i++;
    }
  }

  function parseValue(path) {
    skipWs();
    const c = source[i];
    if (c === '{') parseObject(path);
    else if (c === '[') parseArray(path);
    else if (c === "'" || c === '"' || c === '`') {
      results.push({ path: path.join('.'), value: readString() });
    } else if (c === '(') skipBalanced('(', ')');
    else if (c === '-' || (c >= '0' && c <= '9')) readNumber();
    else if (/[A-Za-z_$]/.test(c)) readIdent();
    // 值后可能跟 .join(...) / .trim() 等后缀表达式
    for (;;) {
      skipWs();
      if (source[i] === '.') {
        i++;
        readIdent();
        skipWs();
        if (source[i] === '(') skipBalanced('(', ')');
      } else break;
    }
  }

  function parseObject(path) {
    i++; // {
    for (;;) {
      skipWs();
      if (i >= n || source[i] === '}') { i++; break; }
      const key = readIdent();
      skipWs();
      if (source[i] === ':') i++;
      parseValue([...path, key]);
      skipWs();
      if (source[i] === ',') { i++; continue; }
      if (source[i] === '}') { i++; break; }
    }
  }

  function parseArray(path) {
    i++; // [
    let idx = 0;
    for (;;) {
      skipWs();
      if (i >= n || source[i] === ']') { i++; break; }
      parseValue([...path, `[${idx}]`]);
      idx++;
      skipWs();
      if (source[i] === ',') { i++; continue; }
      if (source[i] === ']') { i++; break; }
    }
  }

  const start = source.indexOf('=', source.indexOf('export const'));
  if (start < 0) throw new Error(`${file}: 未找到 export const 赋值`);
  i = source.indexOf('{', start);
  if (i < 0) throw new Error(`${file}: 未找到对象字面量`);
  parseObject([]);
  return results;
}

/* ------------------------------------------------------------------ */
/* (a) vue 模板硬编码可见文本 + 组件字族/import 引用                    */
/* ------------------------------------------------------------------ */

function scanVueFile(absPath) {
  const src = read(absPath);
  const file = rel(absPath);
  const tplStart = src.indexOf('<template');
  const tplEnd = src.lastIndexOf('</template>');
  const tpl = tplStart >= 0 && tplEnd > tplStart ? src.slice(tplStart, tplEnd) : '';
  const set = new Set();
  const positions = new Map();

  const add = (s, where) => addTextChars(set, positions, decodeEntities(s), where);

  // 1) 文本节点：拆分为纯文本与插值表达式，表达式中的字符串字面量也计入
  const nodeRe = />([^<>]*)</g;
  const exprRe = /\{\{([\s\S]*?)\}\}/g;
  const litRe = /(['"`])((?:\\.|(?!\1)[\s\S])*)\1/g;
  for (const m of tpl.matchAll(nodeRe)) {
    const raw = m[1];
    let last = 0;
    const segs = [];
    let em;
    exprRe.lastIndex = 0;
    while ((em = exprRe.exec(raw))) {
      if (em.index > last) segs.push(['text', raw.slice(last, em.index)]);
      segs.push(['expr', em[1]]);
      last = em.index + em[0].length;
    }
    if (last < raw.length) segs.push(['text', raw.slice(last)]);
    for (const [kind, v] of segs) {
      if (kind === 'text') {
        if (v.trim()) add(v, `${file} 模板文本`);
      } else {
        litRe.lastIndex = 0;
        for (const lm of v.matchAll(litRe)) add(lm[2], `${file} 模板插值表达式`);
      }
    }
  }

  // 2) 静态属性（非 :/@/v-/# 绑定），如 alt / aria-label / title
  const attrRe = /<([a-zA-Z][\w-]*)([^>]*)>/g;
  const aRe = /([:@a-zA-Z][\w:-]*)\s*=\s*"([^"]*)"/g;
  for (const m of tpl.matchAll(attrRe)) {
    for (const am of m[2].matchAll(aRe)) {
      const name = am[1];
      if (name.startsWith(':') || name.startsWith('@') || name.startsWith('v-') || name.startsWith('#')) continue;
      const v = am[2];
      if (v.trim()) add(v, `${file} 属性 ${name}`);
    }
  }

  // 3) <style> 中的 font-family 字族引用（加载面审计用）
  const families = new Set();
  const styleRe = /<style[\s\S]*?<\/style>/g;
  const ffRe = /font-family\s*:\s*([^;}]+)/g;
  for (const sm of src.matchAll(styleRe)) {
    for (const fm of sm[0].matchAll(ffRe)) {
      for (const q of fm[1].matchAll(/'([^']+)'/g)) {
        if (q[1].startsWith('JL ')) families.add(q[1]);
      }
    }
  }

  // 4) import 的 .vue 依赖（加载面审计用）
  const imports = [];
  const impRe = /import\s+[^'"]+\s+from\s+['"]([^'"]+\.vue)['"]/g;
  for (const im of src.matchAll(impRe)) imports.push(im[1]);

  return { set, positions, families, imports };
}

/* ------------------------------------------------------------------ */
/* 字体清单 / CSS 绑定                                                  */
/* ------------------------------------------------------------------ */

function loadFonts() {
  const manifest = JSON.parse(read('src/fonts/font-manifest.json'));
  const outputs = manifest.families.flatMap((f) =>
    f.outputs.map((o) => ({ ...o, family: f.family, role: f.role })),
  );
  const byFile = new Map(outputs.map((o) => [o.file, o]));
  const filesDir = resolve(ROOT, 'public/assets/fonts/files');
  const onDisk = new Set(
    readdirSync(filesDir).filter((f) => f.endsWith('.woff2')),
  );
  return { manifest, outputs, byFile, onDisk };
}

function loadCssBindings() {
  const css = read('src/styles/site.css');
  // @font-face: family -> 文件
  const familyToFile = {};
  const ffRe = /@font-face\s*\{([^}]+)\}/g;
  for (const m of css.matchAll(ffRe)) {
    const fm = m[1];
    const name = /font-family:\s*'([^']+)'/.exec(fm);
    const src = /src:\s*url\(['"]?([^'")]+)['"]?\)/.exec(fm);
    if (name && src) familyToFile[name[1]] = src[1].split('/').pop();
  }
  // html[lang='xx'] -> { display, body }
  const langBindings = {};
  const langRe = /html\[lang='([^']+)'\]\s*\{([^}]+)\}/g;
  for (const m of css.matchAll(langRe)) {
    const lang = m[1];
    const body = m[2];
    const display = /--font-display:\s*'([^']+)'/.exec(body);
    const fontBody = /--font-body:\s*'([^']+)'/.exec(body);
    langBindings[lang] = {
      display: display ? display[1] : null,
      body: fontBody ? fontBody[1] : null,
    };
  }
  // tokens.css: --font-mono + font-synthesis
  const tokens = read('src/styles/tokens.css');
  const mono = /--font-mono:\s*'([^']+)'/.exec(tokens);
  const synth = /font-synthesis\s*:\s*none/.test(tokens);
  return { familyToFile, langBindings, monoFamily: mono ? mono[1] : null, synth };
}

/* ------------------------------------------------------------------ */
/* 主流程                                                              */
/* ------------------------------------------------------------------ */

console.log('JotLuck site 字体核查 (verify-fonts.mjs)');
console.log('========================================\n');

/* ---------- [1] 字体文件一致性 ---------- */
console.log('[1] 字体文件与 manifest / site.css 一致性');
const { outputs, onDisk } = loadFonts();
const { familyToFile, langBindings, monoFamily, synth } = loadCssBindings();

const missingOnDisk = outputs.filter((o) => !onDisk.has(o.file));
if (missingOnDisk.length === 0) ok(`manifest 声明 ${outputs.length} 个输出文件，磁盘全部存在`);
else missingOnDisk.forEach((o) => fail(`manifest 声明 ${o.file} 但磁盘不存在`));

const cssFiles = Object.values(familyToFile);
const cssMissing = cssFiles.filter((f) => !onDisk.has(f));
if (cssMissing.length === 0) ok(`site.css 引用 ${cssFiles.length} 个 @font-face 文件，磁盘全部存在`);
else cssMissing.forEach((f) => fail(`site.css 引用 ${f} 但磁盘不存在`));

const unused = [...onDisk].filter((f) => !outputs.some((o) => o.file === f));
unused.forEach((f) => warn(`磁盘存在但 manifest 未声明: ${f}`));

/* ---------- [2] 每语言字符集与覆盖 ---------- */
console.log('\n[2] 每语言字符集与字体覆盖 (unicode-range 来自 manifest)');

const hardChars = new Set(); // vue 硬编码五语共有
const hardPos = new Map();
const hardVueFiles = collectVueFiles(resolve(ROOT, 'src'));
const vueMeta = new Map(); // 组件字族/import（加载面审计 [3] 用）
for (const f of hardVueFiles) {
  const s = scanVueFile(f);
  vueMeta.set(f, s);
  for (const [ch, whereSet] of s.positions) {
    hardChars.add(ch);
    for (const w of whereSet) (hardPos[ch] ??= new Set()).add(w);
  }
}
// 语言标签（LocaleGate 渲染 LOCALE_TAGS，模板动态值）：计入全部五语
for (const tag of Object.values(LOCALE_TAGS)) {
  addTextChars(hardChars, hardPos, tag, 'src/pages/LocaleGate.vue 语言标签(模板动态)');
}

const localeChars = {}; // locale -> Set
const localePos = {}; // locale -> Map<char, Set<位置>>
const localeContent = {}; // locale -> [{path, value}]

for (const loc of LOCALES) {
  const strings = parseTsStrings(resolve(ROOT, CONTENT_FILES[loc]));
  localeContent[loc] = strings;
  const set = new Set(hardChars);
  const pos = new Map();
  for (const [ch, ws] of hardPos) pos.set(ch, new Set(ws));
  for (const s of strings) addTextChars(set, pos, s.value, `${CONTENT_FILES[loc]} (${s.path})`);
  localeChars[loc] = set;
  localePos[loc] = pos;
}

// 每语言加载字族（display / body / mono）→ 文件 → unicode-range
const byFile = new Map(outputs.map((o) => [o.file, o]));
const localeCoverage = {}; // locale -> { files: [], ranges: [] }
for (const loc of LOCALES) {
  const tag = LOCALE_TAGS[loc];
  const b = langBindings[tag];
  const files = [b.display, b.body, monoFamily].filter(Boolean);
  const ranges = [];
  for (const fam of files) {
    const file = familyToFile[fam];
    const o = byFile.get(file);
    if (!o) fail(`字族 ${fam} → ${file} 未在 manifest 中声明`);
    else ranges.push(...parseUnicodeRanges(o.unicodeRange));
  }
  localeCoverage[loc] = { files, ranges };
}

// 覆盖断言
const allMissing = {}; // locale -> [{ch, positions: [..]}]
console.log(`\n${'locale'.padEnd(8)}${'字符集(独码)'.padEnd(12)}${'缺字符'.padEnd(8)}${'覆盖率'}`);
let coverageFailed = false;
for (const loc of LOCALES) {
  const set = localeChars[loc];
  const total = set.size;
  const missing = [];
  for (const ch of set) {
    if (!inRanges(ch.codePointAt(0), localeCoverage[loc].ranges)) {
      missing.push({ ch, positions: [...(localePos[loc].get(ch) ?? [])] });
    }
  }
  allMissing[loc] = missing;
  const cov = total === 0 ? 1 : (total - missing.length) / total;
  console.log(
    `${loc.padEnd(8)}${String(total).padEnd(12)}${String(missing.length).padEnd(8)}${(cov * 100).toFixed(2)}%`,
  );
  if (missing.length > 0) coverageFailed = true;
}

if (coverageFailed) {
  fail('覆盖断言失败：存在缺字符（将回退系统字体渲染，不下载任何字体文件）');
  for (const loc of LOCALES) {
    if (allMissing[loc].length === 0) continue;
    console.log(`\n  ${loc} 缺字符明细：`);
    for (const { ch, positions } of allMissing[loc]) {
      const cp = ch.codePointAt(0);
      const where = [...new Set(positions)].join('；');
      console.log(`    '${ch}' U+${cp.toString(16).toUpperCase().padStart(4, '0')} → ${where}`);
    }
  }
} else {
  ok('五语字符集全部被本语言 display/body/mono 字族覆盖');
}

/* ---------- [3] 加载面审计 ---------- */
console.log('\n[3] 加载面审计（html[lang] 绑定 → 字体文件下载）');

// 字族 → 归属语言集合
const familyToLocales = {};
for (const loc of LOCALES) {
  const b = langBindings[LOCALE_TAGS[loc]];
  if (b.display) familyToLocales[b.display] = [loc];
  if (b.body) familyToLocales[b.body] = [loc];
}
if (monoFamily) familyToLocales[monoFamily] = [...LOCALES];

// 组件图
const importsOf = new Map();
const familiesOf = new Map();
for (const [f, meta] of vueMeta) {
  importsOf.set(f, meta.imports.map((p) => resolve(dirname(f), p)));
  familiesOf.set(f, meta.families);
}

function pageClosure(entries) {
  const seen = new Set();
  const queue = [...entries];
  while (queue.length) {
    const f = queue.pop();
    if (!f || seen.has(f)) continue;
    seen.add(f);
    for (const dep of importsOf.get(f) ?? []) queue.push(dep);
  }
  return seen;
}

// 每 (locale, page) 触发下载的字体文件
const auditRows = [];
let loadViolations = 0;
for (const loc of LOCALES) {
  const baseFamilies = [...localeCoverage[loc].files]; // display/body/mono
  for (const page of [...PAGES, 'gate']) {
    const closure = pageClosure(PAGE_ENTRIES[page]);
    const fams = new Set(baseFamilies);
    for (const f of closure) for (const fam of familiesOf.get(f) ?? []) fams.add(fam);
    const files = new Set();
    const violations = [];
    for (const fam of fams) {
      const file = familyToFile[fam];
      if (!file) continue;
      files.add(file);
      const owners = familyToLocales[fam] ?? [];
      if (!owners.includes(loc)) {
        violations.push(`${file}（${fam}）`);
        loadViolations++;
      }
    }
    auditRows.push({ loc, page, files, violations });
  }
}

for (const loc of LOCALES) {
  console.log(`\n  locale=${loc}（html lang=${LOCALE_TAGS[loc]}）`);
  for (const row of auditRows.filter((r) => r.loc === loc)) {
    const dl = [...row.files].sort().join(', ');
    if (row.violations.length === 0) {
      ok(`  ${row.page.padEnd(9)} → ${dl}`);
    } else {
      warn(`${row.page.padEnd(9)} → 触发他语字体下载: ${row.violations.join('；')}`);
    }
  }
}
if (loadViolations > 0) {
  fail(`加载面违规：${loadViolations} 处页面触发他语字体文件下载（unicode-range 按需加载失效）`);
} else {
  ok('所有语言页面只下载本语言字体文件');
}

/* ---------- [4] font-synthesis ---------- */
console.log('\n[4] font-synthesis');
if (synth) ok('tokens.css 存在 font-synthesis: none');
else fail('tokens.css 缺少 font-synthesis: none');

/* ---------- 结论 ---------- */
console.log('\n======== 结论 ========');
if (failures === 0) {
  console.log('PASS — 全部断言通过');
} else {
  console.log(`FAIL — ${failures} 项断言失败（详见上文）`);
}
process.exit(failures > 0 ? 1 : 0);
