/**
 * train-baseline.ts — MarkLuck 基准 L2 语料训练工具
 *
 * 读取 corpus/ 目录下的语料文件 → N-gram 扫描 → 合并 → 输出 compact.txt
 * 仅 P0 格式闭合规则硬编码，语言习惯全部来自语料。
 *
 * 用法: npx tsx scripts/train-baseline.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---- 类型 ----

type NGramTable = Map<string, Map<string, number>>;

export type TrainProfile = 'release' | 'web-local';

export interface SourceConfig {
  path: string;
  weight: number;
  description: string;
  category?: string;
  language?: 'zh' | 'en' | 'mixed' | 'unknown';
  localOnly?: boolean;
  maxFragments?: number;
}

interface CorpusConfig {
  ngramN: number;
  minCount: number;
  maxPredsPerContext: number;
  outputFile: string;
  reportFile: string;
  sources: SourceConfig[];
  hardcodedFormatRules: { enabled: boolean };
}

interface TrainReport {
  generatedAt: string;
  profile: TrainProfile;
  outputFile: string;
  totalEntries: number;
  totalRawEntries: number;
  totalWeightedEntries: number;
  estimatedSize: string;
  modelBytes: number;
  modelSizeLimit: string | null;
  modelSoftTarget: string | null;
  languageDistribution: Record<'zh' | 'en' | 'mixed' | 'unknown', number>;
  skippedMixedFragments: number;
  categoryEffectiveWeights: Record<string, { weightedEntries: number; ratio: string }>;
  webBoilerplateHits: number;
  governance: {
    categoryDominanceLimit: string;
    maxCategory: string | null;
    maxCategoryRatio: string;
    mixedFragmentsAllowed: number;
    hardLimitPassed: boolean;
    softTargetPassed: boolean;
  };
  sources: Record<
    string,
    {
      files: number;
      fragments: number;
      entries: number;
      weightedEntries: number;
      rawSize: number;
      coverage: string;
      effectiveCoverage: string;
      languageDistribution: Record<'zh' | 'en' | 'mixed' | 'unknown', number>;
    }
  >;
  topContexts: Array<{
    ctx: string;
    ctxText: string;
    preds: string;
    predsText: string;
    from: string;
  }>;
  lowValueTopContexts: Array<{
    ctx: string;
    ctxText: string;
    predsText: string;
    reason: string;
  }>;
  probes: Array<{
    input: string;
    prediction: string | null;
    source: 'model' | 'fallback' | 'none';
  }>;
  probeSummary: {
    modelHits: number;
    fallbackHits: number;
    none: number;
  };
}

interface WebCollectionReport {
  sources: Array<{
    cleanPath: string | null;
    category: string;
    language?: string;
    weight: number;
    fragmentsKept: number;
    scrubHits?: Record<string, number>;
    dropReasons?: Record<string, number>;
  }>;
}

// ---- N-gram 引擎 ----

const CORPUS_DIR = path.join(__dirname, 'corpus');
const CONFIG_PATH = path.join(CORPUS_DIR, 'corpus.config.json');
const WEB_LOCAL_OUTPUT_FILE = '../../packages/app/public/baseline-ngram.web-local.compact.txt';
const WEB_LOCAL_REPORT_FILE = '_web-cache/_reports/training-report.web-local.json';
const WEB_COLLECTION_REPORT_FILE = '_web-cache/_reports/collection-report.web-local.json';
export const WEB_LOCAL_MAX_BYTES = 6 * 1024 * 1024;
export const WEB_LOCAL_SOFT_TARGET_BYTES = Math.floor(5.7 * 1024 * 1024);
export const WEB_LOCAL_SOFT_TARGET_MAX_BYTES = WEB_LOCAL_MAX_BYTES;
export const WEB_LOCAL_MIN_COUNT = 0.85;
const CATEGORY_DOMINANCE_LIMIT = 0.45;

/** 对文本进行 4-gram 扫描，返回统计表 */
function scanText(text: string, n: number, weight: number): NGramTable {
  const table: NGramTable = new Map();
  for (let i = 0; i < text.length - n; i++) {
    const ctx = text.slice(i, i + n);
    const next = text[i + n];
    if (!table.has(ctx)) table.set(ctx, new Map());
    const counts = table.get(ctx)!;
    // 权重影响：加 weight 而非 1，使加权源的条目频次更高
    counts.set(next, (counts.get(next) ?? 0) + weight);
  }
  return table;
}

/** 将源表合并到目标表 */
function mergeTables(target: NGramTable, source: NGramTable): void {
  for (const [ctx, preds] of source) {
    if (!target.has(ctx)) {
      target.set(ctx, new Map(preds));
      continue;
    }
    const tPreds = target.get(ctx)!;
    for (const [ch, cnt] of preds) {
      tPreds.set(ch, (tPreds.get(ch) ?? 0) + cnt);
    }
  }
}

/** 裁剪：min-count 过滤 + Top-N per context */
function pruneTable(table: NGramTable, minCount: number, maxPreds: number): NGramTable {
  const pruned: NGramTable = new Map();
  for (const [ctx, preds] of table) {
    // 过滤低频
    const filtered = new Map([...preds].filter(([, c]) => c >= minCount));
    if (filtered.size === 0) continue;
    // 保留 Top-N
    const sorted = [...filtered].sort((a, b) => b[1] - a[1]).slice(0, maxPreds);
    if (sorted.length === 0) continue;
    pruned.set(ctx, new Map(sorted));
  }
  return pruned;
}

/** 序列化为紧凑文本格式 */
function serialize(table: NGramTable): string {
  const lines: string[] = [];
  for (const [ctx, preds] of table) {
    const ctxHex = Buffer.from(ctx, 'utf-8').toString('hex');
    const predParts = [...preds]
      .sort((a, b) => b[1] - a[1])
      .map(([ch, cnt]) => [Buffer.from(ch, 'utf-8').toString('hex'), cnt]);
    lines.push(JSON.stringify([ctxHex, predParts, 'b']));
  }
  return lines.join('\n');
}

/** 估算序列化后大小 */
function estimateSize(table: NGramTable): string {
  const kb = Math.round(serialize(table).length / 1024);
  return `${kb}KB`;
}

function sumCounts(table: NGramTable): number {
  let total = 0;
  for (const preds of table.values()) {
    for (const count of preds.values()) total += count;
  }
  return total;
}

const PROBES = [
  '这是',
  '这是我',
  '我喜欢',
  '最喜欢',
  '为了',
  '用户',
  '项目',
  '今天',
  '今天主要',
  '今天记录',
  '今天计划',
  '会议结论',
  '会议记录',
  '任务进度',
  '下一步',
  '当前状态',
  '当前问题',
  '风险在于',
  '主要风险',
  '需要确认',
  '需要跟进',
  '解决方案',
  '验收结果',
  '复盘结论',
  '- ',
  '[[',
  '#',
  '**粗',
];
const RUNTIME_PROBE_FALLBACKS: Record<string, string> = {
  这是: '一个',
  这是我: '最喜欢',
  我喜欢: '去',
  最喜欢: '的事情',
  为了: '更好',
  用户: '可以',
  项目: '进度',
  今天: '的',
  今天记录: '一下',
  今天计划: '先',
  会议记录: '如下',
  任务进度: '正常',
  下一步: '继续',
  当前问题: '是',
  主要风险: '在于',
  需要跟进: '一下',
  解决方案: '是',
  验收结果: '通过',
  复盘结论: '是',
  '- ': '[ ] ',
  '[[': '结构化 wiki-link',
  '#': '标题',
  '**粗': '**',
};

function predictProbe(
  table: NGramTable,
  input: string,
  n: number,
  maxLen = 8,
): { prediction: string | null; source: 'model' | 'fallback' | 'none' } {
  if (input.length < n) {
    return RUNTIME_PROBE_FALLBACKS[input]
      ? { prediction: RUNTIME_PROBE_FALLBACKS[input], source: 'fallback' }
      : { prediction: null, source: 'none' };
  }
  let ctx = input.slice(-n);
  let out = '';
  for (let i = 0; i < maxLen; i++) {
    const counts = table.get(ctx);
    if (!counts || counts.size === 0) break;
    const sorted = [...counts].sort((a, b) => b[1] - a[1]);
    const best = sorted[0];
    if (!best) break;
    if (best[0] === '\n' || best[0] === '\r') break;
    out += best[0];
    ctx = (ctx + best[0]).slice(-n);
  }
  if (out) return { prediction: out, source: 'model' };
  return RUNTIME_PROBE_FALLBACKS[input]
    ? { prediction: RUNTIME_PROBE_FALLBACKS[input], source: 'fallback' }
    : { prediction: null, source: 'none' };
}

function findLowValueTopContexts(
  entries: Array<{ ctx: string; preds: Map<string, number> }>,
): TrainReport['lowValueTopContexts'] {
  const results: TrainReport['lowValueTopContexts'] = [];
  for (const { ctx, preds } of entries) {
    const predsText = [...preds]
      .slice(0, 3)
      .map(([ch]) => ch.replace(/\n/g, '\\n'))
      .join('/');
    const reason = classifyLowValueContext(ctx, predsText);
    if (!reason) continue;
    results.push({
      ctx: Buffer.from(ctx, 'utf-8').toString('hex'),
      ctxText: ctx.replace(/\n/g, '\\n'),
      predsText,
      reason,
    });
    if (results.length >= 20) break;
  }
  return results;
}

function classifyLowValueContext(ctx: string, predsText: string): string | null {
  const combined = `${ctx}${predsText}`;
  if (/[\u3400-\u9fff]/u.test(combined) && /[A-Za-z]{3,}/.test(combined)) {
    return 'mixed-language';
  }
  if (/^[的了在和与及或而但并就都很更再也还又把被对为以中上下一是有用个/]+$/u.test(predsText)) {
    return 'low-value-zh-function-word';
  }
  if (/\b(cookie|copyright|login|sign up|read more|subscribe)\b/i.test(combined)) {
    return 'web-boilerplate';
  }
  return null;
}

// ---- P0 硬编码格式闭合规则 ----

function generateHardcodedPatterns(): { ctx: string; preds: [string, number][] }[] {
  const baseCount = 20;
  return [
    // ** 强调闭合
    {
      ctx: '**',
      preds: [
        ['粗', baseCount],
        ['强', baseCount - 5],
        ['关', baseCount - 10],
      ],
    },
    { ctx: '体*', preds: [['*', baseCount + 5]] },
    { ctx: '心*', preds: [['*', baseCount]] },
    { ctx: '粗*', preds: [['*', baseCount - 2]] },
    { ctx: '线*', preds: [['*', baseCount - 3]] },
    // * 斜体闭合
    { ctx: ' *', preds: [['*', baseCount - 5]] },
    // __ 强调闭合
    {
      ctx: '__',
      preds: [
        ['强', baseCount - 5],
        ['注', baseCount - 8],
        ['重', baseCount - 10],
      ],
    },
    { ctx: '注_', preds: [['_', baseCount - 2]] },
    // `` 行内代码闭合
    {
      ctx: '``',
      preds: [
        ['`', baseCount],
        ['c', baseCount - 10],
        ['v', baseCount - 12],
      ],
    },
    { ctx: 'de', preds: [['`', baseCount - 2]] },
    // [...] 链接语法
    {
      ctx: ']',
      preds: [
        ['(', baseCount + 10],
        [']', baseCount - 15],
      ],
    },
    {
      ctx: '](',
      preds: [
        ['h', baseCount - 5],
        ['.', baseCount - 3],
        ['#', baseCount - 8],
      ],
    },
    // ![ 图片语法
    {
      ctx: '![',
      preds: [
        ['s', baseCount - 5],
        ['i', baseCount - 8],
        ['S', baseCount - 10],
      ],
    },
    { ctx: '![]', preds: [['(', baseCount + 10]] },
    // # 标题
    {
      ctx: '# ',
      preds: [
        ['J', baseCount - 5],
        ['快', baseCount - 8],
        ['创', baseCount - 10],
      ],
    },
    {
      ctx: '## ',
      preds: [
        ['使', baseCount - 5],
        ['配', baseCount - 8],
        ['如', baseCount - 12],
      ],
    },
    {
      ctx: '### ',
      preds: [
        ['安', baseCount - 8],
        ['注', baseCount - 10],
        ['步', baseCount - 12],
      ],
    },
    // - 列表
    {
      ctx: '- ',
      preds: [
        ['打', baseCount - 5],
        ['使', baseCount - 8],
        ['创', baseCount - 10],
      ],
    },
    {
      ctx: '1. ',
      preds: [
        ['打', baseCount - 8],
        ['安', baseCount - 10],
        ['创', baseCount - 12],
      ],
    },
    { ctx: '- [', preds: [[' ', baseCount + 5]] },
    // > 引用
    {
      ctx: '> ',
      preds: [
        ['引', baseCount - 5],
        ['注', baseCount - 8],
        ['这', baseCount - 10],
      ],
    },
    // ``` 代码块
    {
      ctx: '```',
      preds: [
        ['j', baseCount - 3],
        ['p', baseCount - 5],
        ['r', baseCount - 8],
      ],
    },
    { ctx: '```j', preds: [['s', baseCount + 5]] },
    {
      ctx: '```p',
      preds: [
        ['y', baseCount],
        ['h', baseCount - 5],
      ],
    },
    // | 表格
    {
      ctx: '| ',
      preds: [
        ['字', baseCount - 8],
        ['参', baseCount - 10],
        ['属', baseCount - 12],
      ],
    },
    // --- 分割线
    { ctx: '---', preds: [['\n', baseCount]] },
    // 中文标点上下文
    {
      ctx: '。\n',
      preds: [
        ['#', baseCount - 5],
        ['但', baseCount - 8],
      ],
    },
    {
      ctx: '，',
      preds: [
        ['但', baseCount - 5],
        ['并', baseCount - 8],
        ['这', baseCount - 10],
      ],
    },
    {
      ctx: '：',
      preds: [
        ['\n', baseCount],
        ['它', baseCount - 10],
      ],
    },
    // 英文标点
    {
      ctx: '. ',
      preds: [
        ['T', baseCount - 5],
        ['I', baseCount - 8],
        ['A', baseCount - 10],
      ],
    },
    // 换行模式
    {
      ctx: '\n\n',
      preds: [
        ['#', baseCount],
        ['-', baseCount - 5],
        ['>', baseCount - 10],
      ],
    },
    // {{ 模板占位符
    { ctx: '{{d', preds: [['a', baseCount + 5]] },
    { ctx: '{{da', preds: [['t', baseCount + 5]] },
    { ctx: '{{dat', preds: [['e', baseCount + 5]] },
    { ctx: '{{date', preds: [['}', baseCount + 5]] },
    { ctx: '{{t', preds: [['i', baseCount]] },
    { ctx: '{{ti', preds: [['m', baseCount]] },
    { ctx: '{{time', preds: [['}', baseCount]] },
  ];
}

// ---- 扫描语料 ----

/** 剥离代码块 (```...```) */
function stripFencedCode(text: string): string {
  return text.replace(/```[\s\S]*?```/g, '');
}

/** 剥离行内代码 (`...`) */
function stripInlineCode(text: string): string {
  return text.replace(/`[^`]+`/g, '');
}

function normalizeTrainingText(text: string): string {
  const normalized = text
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .replace(/^---[ \t]*\n[\s\S]*?\n---[ \t]*(?:\n|$)/, '')
    .replace(/\n{3,}/g, '\n\n');
  return normalized
    .split('\n')
    .filter((line) => {
      const trimmed = line.trim();
      if (/^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(trimmed)) return false;
      const pipeCount = [...line].filter((ch) => ch === '|').length;
      return pipeCount < 2;
    })
    .join('\n');
}

function detectTrainingLanguage(text: string): 'zh' | 'en' | 'mixed' | 'unknown' {
  const cjkCount = (text.match(/[\u3400-\u9fff]/gu) ?? []).length;
  const words = text.match(/[A-Za-z]{3,}/g) ?? [];
  if (cjkCount >= 4 && words.length >= 4) return 'mixed';
  if (cjkCount >= 4) return 'zh';
  if (words.length >= 4) return 'en';
  if (cjkCount > 0 && words.length > 0) return 'mixed';
  return 'unknown';
}

export function buildWebLocalSourcesFromReport(report: WebCollectionReport): SourceConfig[] {
  const seen = new Set<string>();
  const sources: SourceConfig[] = [];
  for (const source of report.sources) {
    if (!source.cleanPath || source.fragmentsKept <= 0) continue;
    const normalized = source.cleanPath.replace(/\\/g, '/');
    if (!normalized.startsWith('_web-cache/_clean/')) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    const policy = getWebTrainingPolicy(source.category);
    sources.push({
      path: normalized,
      weight: source.weight * policy.weightMultiplier,
      description: `Local-only scrubbed web fragments (${source.category})`,
      category: source.category,
      language: normalizeSourceLanguage(source.language),
      localOnly: true,
      maxFragments: policy.maxFragments,
    });
  }
  return sources;
}

function getWebTrainingPolicy(category: string): {
  weightMultiplier: number;
  maxFragments: number;
} {
  switch (category) {
    case 'zh-note':
      return { weightMultiplier: 1, maxFragments: 900 };
    case 'zh-tech-note':
      return { weightMultiplier: 0.75, maxFragments: 800 };
    case 'markdown-knowledge':
      return { weightMultiplier: 0.85, maxFragments: 650 };
    case 'project-log':
      return { weightMultiplier: 0.55, maxFragments: 350 };
    case 'en-note':
      return { weightMultiplier: 0.85, maxFragments: 550 };
    case 'en-tech-doc':
      return { weightMultiplier: 0.18, maxFragments: 220 };
    case 'general-encyclopedia':
      return { weightMultiplier: 0.2, maxFragments: 200 };
    default:
      return { weightMultiplier: 0.5, maxFragments: 500 };
  }
}

function normalizeSourceLanguage(value: string | undefined): SourceConfig['language'] {
  if (!value) return 'unknown';
  const normalized = value.toLowerCase();
  if (normalized.startsWith('zh')) return 'zh';
  if (normalized.startsWith('en')) return 'en';
  if (normalized === 'mixed') return 'mixed';
  return 'unknown';
}

export function buildProfileSources(
  configSources: SourceConfig[],
  profile: TrainProfile,
  webLocalSources: SourceConfig[] = [],
): SourceConfig[] {
  if (profile === 'release') {
    return configSources.filter(
      (source) => !source.path.replace(/\\/g, '/').includes('_web-cache/'),
    );
  }
  if (webLocalSources.length > 0) return [...configSources, ...webLocalSources];
  return [
    ...configSources,
    {
      path: '_web-cache/_clean/',
      weight: 1,
      description: 'Local-only scrubbed web fragments.',
    },
  ];
}

/** 扫描源目录下的所有 .md 文件 */
export function scanSource(
  dirPath: string,
  weight: number,
  ngramN: number,
  options: { skipMixed?: boolean; maxUnits?: number } = {},
): {
  table: NGramTable;
  fileCount: number;
  fragmentCount: number;
  rawSize: number;
  languageDistribution: Record<'zh' | 'en' | 'mixed' | 'unknown', number>;
  skippedMixedFragments: number;
} {
  const table: NGramTable = new Map();
  let fileCount = 0;
  let fragmentCount = 0;
  let rawSize = 0;
  let skippedMixedFragments = 0;
  const languageDistribution = { zh: 0, en: 0, mixed: 0, unknown: 0 };

  function scanFile(fullPath: string): void {
    const raw = fs.readFileSync(fullPath, 'utf-8');
    const cleaned = normalizeTrainingText(stripInlineCode(stripFencedCode(raw)));
    rawSize += Buffer.byteLength(raw, 'utf-8');
    const isWebClean = fullPath.replace(/\\/g, '/').includes('/_web-cache/_clean/');
    const units = splitTrainingUnits(cleaned, isWebClean, ngramN, options.maxUnits);
    for (const unit of units) {
      const language = detectTrainingLanguage(unit);
      if (options.skipMixed && language === 'mixed') {
        skippedMixedFragments++;
        continue;
      }
      languageDistribution[language]++;
      fragmentCount++;
      mergeTables(table, scanText(unit, ngramN, weight));
    }
    fileCount++;
  }

  function walk(dir: string): void {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      // 跳过 _ 前缀目录和隐藏文件
      if (entry.name.startsWith('_') || entry.name.startsWith('.')) continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.name.endsWith('.md') || entry.name.endsWith('.txt')) {
        scanFile(fullPath);
      }
    }
  }

  if (fs.existsSync(dirPath) && fs.statSync(dirPath).isFile()) {
    scanFile(dirPath);
    return {
      table,
      fileCount,
      fragmentCount,
      rawSize,
      languageDistribution,
      skippedMixedFragments,
    };
  }

  walk(dirPath);
  return { table, fileCount, fragmentCount, rawSize, languageDistribution, skippedMixedFragments };
}

function splitTrainingUnits(
  text: string,
  isWebClean: boolean,
  ngramN: number,
  maxUnits?: number,
): string[] {
  const minLength = ngramN + 1;
  const blocks = text
    .split(isWebClean ? /\n{2,}/ : /\n{2,}|(?<=。|！|？|\.|!|\?)\s+/u)
    .map((fragment) => fragment.trim())
    .filter((fragment) => fragment.length >= minLength);
  if (isWebClean) return sampleTrainingUnits(blocks, maxUnits);
  return blocks.length > 0 ? blocks : text.length >= minLength ? [text] : [];
}

function sampleTrainingUnits(units: string[], maxUnits: number | undefined): string[] {
  if (!maxUnits || units.length <= maxUnits) return units;
  if (maxUnits <= 0) return [];
  if (maxUnits === 1) return [units[0]!];

  const sampled: string[] = [];
  const step = (units.length - 1) / (maxUnits - 1);
  for (let i = 0; i < maxUnits; i++) {
    sampled.push(units[Math.round(i * step)]!);
  }
  return sampled;
}

// ---- 主流程 ----

export function runTraining(argv: string[] = process.argv.slice(2)): TrainReport {
  console.log('🧠 MarkLuck 基准 L3 训练工具');
  console.log('═══════════════════════════════\n');
  const profile = parseProfile(argv);

  // 读取配置
  const config: CorpusConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
  const outputFile = profile === 'web-local' ? WEB_LOCAL_OUTPUT_FILE : config.outputFile;
  const reportFile = profile === 'web-local' ? WEB_LOCAL_REPORT_FILE : config.reportFile;
  const webCollectionReport = profile === 'web-local' ? readWebCollectionReport() : null;
  const profileSources = buildProfileSources(
    config.sources,
    profile,
    webCollectionReport ? buildWebLocalSourcesFromReport(webCollectionReport) : [],
  );
  const profileMinCount = profile === 'web-local' ? WEB_LOCAL_MIN_COUNT : config.minCount;
  console.log(
    `配置: ${config.ngramN}-gram, min-count=${profileMinCount}, top-${config.maxPredsPerContext}`,
  );
  console.log(`Profile: ${profile}`);
  console.log(`语料源: ${profileSources.length} 个\n`);

  const globalTable: NGramTable = new Map();
  const report: TrainReport = {
    generatedAt: new Date().toISOString(),
    profile,
    outputFile,
    totalEntries: 0,
    totalRawEntries: 0,
    totalWeightedEntries: 0,
    estimatedSize: '0KB',
    modelBytes: 0,
    modelSizeLimit: profile === 'web-local' ? `${Math.round(WEB_LOCAL_MAX_BYTES / 1024)}KB` : null,
    modelSoftTarget:
      profile === 'web-local'
        ? `${Math.round(WEB_LOCAL_SOFT_TARGET_BYTES / 1024)}KB-${Math.round(WEB_LOCAL_SOFT_TARGET_MAX_BYTES / 1024)}KB`
        : null,
    languageDistribution: { zh: 0, en: 0, mixed: 0, unknown: 0 },
    skippedMixedFragments: 0,
    categoryEffectiveWeights: {},
    webBoilerplateHits: webCollectionReport ? countWebBoilerplateHits(webCollectionReport) : 0,
    governance: {
      categoryDominanceLimit: `${Math.round(CATEGORY_DOMINANCE_LIMIT * 100)}%`,
      maxCategory: null,
      maxCategoryRatio: '0%',
      mixedFragmentsAllowed: 0,
      hardLimitPassed: true,
      softTargetPassed: true,
    },
    sources: {},
    topContexts: [],
    lowValueTopContexts: [],
    probes: [],
    probeSummary: { modelHits: 0, fallbackHits: 0, none: 0 },
  };

  // 扫描所有语料源
  for (const source of profileSources) {
    const absPath = path.resolve(CORPUS_DIR, source.path);
    const label = source.path.replace(/\/+$/, '');
    console.log(`📂 ${label} (weight=${source.weight})...`);

    const {
      table,
      fileCount,
      fragmentCount,
      rawSize,
      languageDistribution,
      skippedMixedFragments,
    } = scanSource(absPath, source.weight, config.ngramN, {
      skipMixed: profile === 'web-local',
      maxUnits: source.maxFragments,
    });
    const weightedEntries = sumCounts(table);
    mergeTables(globalTable, table);
    for (const [language, count] of Object.entries(languageDistribution)) {
      report.languageDistribution[language as keyof typeof report.languageDistribution] += count;
    }
    report.skippedMixedFragments += skippedMixedFragments;
    addCategoryWeight(report, inferSourceCategory(source), weightedEntries);

    report.sources[label] = {
      files: fileCount,
      fragments: fragmentCount,
      entries: table.size,
      weightedEntries,
      rawSize,
      coverage: '', // filled later
      effectiveCoverage: '',
      languageDistribution,
    };
    console.log(
      `   ${fileCount} 个文件, ${table.size} 个原始上下文, ${(rawSize / 1024).toFixed(0)}KB`,
    );
  }

  // P0 硬编码格式闭合规则
  if (config.hardcodedFormatRules?.enabled) {
    console.log('\n📐 P0 格式闭合规则...');
    const patterns = generateHardcodedPatterns();
    let p0Count = 0;
    for (const { ctx, preds } of patterns) {
      if (!globalTable.has(ctx)) globalTable.set(ctx, new Map());
      const tPreds = globalTable.get(ctx)!;
      for (const [ch, cnt] of preds) {
        tPreds.set(ch, (tPreds.get(ch) ?? 0) + cnt);
      }
      p0Count++;
    }
    console.log(`   ${p0Count} 条规则注入`);
    report.sources['hardcoded-p0'] = {
      files: 0,
      fragments: 0,
      entries: p0Count,
      weightedEntries: p0Count,
      rawSize: 0,
      coverage: '',
      effectiveCoverage: '',
      languageDistribution: { zh: 0, en: 0, mixed: 0, unknown: 0 },
    };
  }

  const rawTotal = globalTable.size;
  const weightedTotal = sumCounts(globalTable);

  // 裁剪
  console.log(
    '\n✂️  裁剪 (min-count=' + profileMinCount + ', top-' + config.maxPredsPerContext + ')...',
  );
  const pruned = pruneTable(globalTable, profileMinCount, config.maxPredsPerContext);
  console.log(
    `   ${rawTotal} → ${pruned.size} 个上下文 (${rawTotal > 0 ? ((1 - pruned.size / rawTotal) * 100).toFixed(1) : '0.0'}% 裁剪率)`,
  );

  // 序列化并输出
  const outputPath = path.resolve(CORPUS_DIR, outputFile);
  const outDir = path.dirname(outputPath);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const serialized = serialize(pruned);
  const sizeBytes = Buffer.byteLength(serialized, 'utf-8');
  const sizeKB = (sizeBytes / 1024).toFixed(0);

  // 计算各源覆盖率
  for (const [label, src] of Object.entries(report.sources)) {
    src.coverage =
      src.entries > 0 && rawTotal > 0 ? `${((src.entries / rawTotal) * 100).toFixed(1)}%` : '0%';
    src.effectiveCoverage =
      src.weightedEntries > 0 && weightedTotal > 0
        ? `${((src.weightedEntries / weightedTotal) * 100).toFixed(1)}%`
        : '0%';
  }

  // Top contexts
  const topEntries = [...pruned.entries()]
    .map(([ctx, preds]) => {
      const total = [...preds.values()].reduce((a, b) => a + b, 0);
      return { ctx, total, preds };
    })
    .sort((a, b) => b.total - a.total)
    .slice(0, 10);

  report.totalEntries = pruned.size;
  report.totalRawEntries = rawTotal;
  report.totalWeightedEntries = Math.round(weightedTotal);
  report.estimatedSize = `${sizeKB}KB`;
  report.modelBytes = sizeBytes;
  finalizeCategoryRatios(report, weightedTotal);
  report.governance = buildGovernance(report, profile, sizeBytes);
  report.topContexts = topEntries.map((e) => ({
    ctx: Buffer.from(e.ctx, 'utf-8').toString('hex'),
    ctxText: e.ctx.replace(/\n/g, '\\n'),
    preds: [...e.preds]
      .slice(0, 3)
      .map(([ch]) => ch)
      .join('/'),
    predsText: [...e.preds]
      .slice(0, 3)
      .map(([ch]) => ch.replace(/\n/g, '\\n'))
      .join('/'),
    from: 'various',
  }));
  report.lowValueTopContexts = findLowValueTopContexts(topEntries);
  report.probes = PROBES.map((input) => ({
    input,
    ...predictProbe(pruned, input, config.ngramN),
  }));
  report.probeSummary = summarizeProbeSources(report.probes);

  // 输出报告
  const reportPath = path.resolve(CORPUS_DIR, reportFile);
  const reportDir = path.dirname(reportPath);
  if (!fs.existsSync(reportDir)) fs.mkdirSync(reportDir, { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf-8');

  const governanceErrors = getGovernanceErrors(report, profile);
  if (governanceErrors.length > 0) {
    throw new Error(`web-local training failed governance checks: ${governanceErrors.join('; ')}`);
  }

  fs.writeFileSync(outputPath, serialized, 'utf-8');

  // 最终报告
  console.log('\n═══════════════════════════════');
  console.log(`✅ 训练完成`);
  console.log(`   产出: ${path.relative(process.cwd(), outputPath)}`);
  console.log(`   条目: ${pruned.size}`);
  console.log(`   大小: ${sizeKB}KB`);
  console.log(`   报告: ${reportFile}`);
  console.log('\n来源分布:');
  for (const [label, src] of Object.entries(report.sources)) {
    console.log(`   ${label}: ${src.files} 文件, ${src.entries} 原始条目, ${src.coverage}`);
  }

  return report;
}

function inferSourceCategory(source: SourceConfig): string {
  if (source.category) return source.category;
  const normalized = source.path.replace(/\\/g, '/');
  if (normalized.includes('note-patterns-zh')) return 'zh-note-patterns';
  if (normalized.includes('tech-writing-zh')) return 'zh-tech-notes';
  if (normalized.includes('markdown-structures')) return 'markdown-structure';
  if (normalized.includes('code-doc-en')) return 'en-tech-docs';
  if (normalized.includes('creative-zh')) return 'zh-natural-notes';
  if (normalized.includes('/doc/') || normalized.endsWith('../../doc/')) return 'project-docs';
  if (normalized.includes('/spec/') || normalized.endsWith('../../spec/')) return 'project-specs';
  if (source.localOnly) return 'web-local';
  return 'uncategorized';
}

function addCategoryWeight(report: TrainReport, category: string, weightedEntries: number): void {
  const current = report.categoryEffectiveWeights[category] ?? {
    weightedEntries: 0,
    ratio: '0%',
  };
  current.weightedEntries += weightedEntries;
  report.categoryEffectiveWeights[category] = current;
}

function finalizeCategoryRatios(report: TrainReport, weightedTotal: number): void {
  for (const entry of Object.values(report.categoryEffectiveWeights)) {
    entry.weightedEntries = Math.round(entry.weightedEntries);
    entry.ratio =
      weightedTotal > 0 ? `${((entry.weightedEntries / weightedTotal) * 100).toFixed(1)}%` : '0%';
  }
}

function buildGovernance(
  report: TrainReport,
  profile: TrainProfile,
  sizeBytes: number,
): TrainReport['governance'] {
  let maxCategory: string | null = null;
  let maxRatio = 0;
  const total = Math.max(1, report.totalWeightedEntries);
  for (const [category, stats] of Object.entries(report.categoryEffectiveWeights)) {
    const ratio = stats.weightedEntries / total;
    if (ratio > maxRatio) {
      maxRatio = ratio;
      maxCategory = category;
    }
  }

  return {
    categoryDominanceLimit: `${Math.round(CATEGORY_DOMINANCE_LIMIT * 100)}%`,
    maxCategory,
    maxCategoryRatio: `${(maxRatio * 100).toFixed(1)}%`,
    mixedFragmentsAllowed: 0,
    hardLimitPassed: profile !== 'web-local' || sizeBytes <= WEB_LOCAL_MAX_BYTES,
    softTargetPassed:
      profile !== 'web-local' ||
      (sizeBytes >= WEB_LOCAL_SOFT_TARGET_BYTES && sizeBytes <= WEB_LOCAL_SOFT_TARGET_MAX_BYTES),
  };
}

function getGovernanceErrors(report: TrainReport, profile: TrainProfile): string[] {
  if (profile !== 'web-local') return [];
  const errors: string[] = [];
  if (!report.governance.hardLimitPassed) {
    errors.push(
      `model size ${Math.round(report.modelBytes / 1024)}KB exceeds ${Math.round(
        WEB_LOCAL_MAX_BYTES / 1024,
      )}KB`,
    );
  }
  const maxRatio = Number.parseFloat(report.governance.maxCategoryRatio) / 100;
  if (
    report.governance.maxCategory &&
    Number.isFinite(maxRatio) &&
    maxRatio > CATEGORY_DOMINANCE_LIMIT
  ) {
    errors.push(
      `category ${report.governance.maxCategory} dominates ${report.governance.maxCategoryRatio}`,
    );
  }
  if (report.languageDistribution.mixed > 0) {
    errors.push(`mixed fragments entered training: ${report.languageDistribution.mixed}`);
  }
  return errors;
}

function summarizeProbeSources(probes: TrainReport['probes']): TrainReport['probeSummary'] {
  return {
    modelHits: probes.filter((probe) => probe.source === 'model').length,
    fallbackHits: probes.filter((probe) => probe.source === 'fallback').length,
    none: probes.filter((probe) => probe.source === 'none').length,
  };
}

function countWebBoilerplateHits(report: WebCollectionReport): number {
  let total = 0;
  for (const source of report.sources) {
    total += source.scrubHits?.boilerplate ?? 0;
    total += source.scrubHits?.['web-tone'] ?? 0;
    total += source.dropReasons?.boilerplate ?? 0;
    total += source.dropReasons?.['web-tone'] ?? 0;
  }
  return total;
}

function parseProfile(argv: string[]): TrainProfile {
  const value = readArg(argv, '--profile') ?? 'web-local';
  if (value !== 'release' && value !== 'web-local') {
    throw new Error(`Unsupported profile: ${value}`);
  }
  return value;
}

function readArg(argv: string[], name: string): string | undefined {
  const inline = argv.find((item) => item.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

function readWebCollectionReport(): WebCollectionReport | null {
  const reportPath = path.join(CORPUS_DIR, WEB_COLLECTION_REPORT_FILE);
  if (!fs.existsSync(reportPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(reportPath, 'utf-8')) as WebCollectionReport;
  } catch {
    return null;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  runTraining();
}
