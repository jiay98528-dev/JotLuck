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
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---- 类型 ----

type NGramTable = Map<string, Map<string, number>>;

interface SourceConfig {
  path: string;
  weight: number;
  description: string;
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
  totalEntries: number;
  totalRawEntries: number;
  estimatedSize: string;
  sources: Record<string, { files: number; entries: number; rawSize: number; coverage: string }>;
  topContexts: Array<{ ctx: string; preds: string; from: string }>;
}

// ---- N-gram 引擎 ----

const CORPUS_DIR = path.join(__dirname, 'corpus');
const CONFIG_PATH = path.join(CORPUS_DIR, 'corpus.config.json');

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
      .map(([ch, cnt]) => `${ch},${cnt}`)
      .join('|');
    lines.push(`${ctxHex}|${predParts}|b`);
  }
  return lines.join('\n');
}

/** 估算序列化后大小 */
function estimateSize(table: NGramTable): string {
  const kb = Math.round(serialize(table).length / 1024);
  return `${kb}KB`;
}

// ---- P0 硬编码格式闭合规则 ----

function generateHardcodedPatterns(): { ctx: string; preds: [string, number][] }[] {
  const baseCount = 20;
  return [
    // ** 强调闭合
    { ctx: '**', preds: [['粗', baseCount], ['强', baseCount - 5], ['关', baseCount - 10]] },
    { ctx: '体*', preds: [['*', baseCount + 5]] },
    { ctx: '心*', preds: [['*', baseCount]] },
    { ctx: '粗*', preds: [['*', baseCount - 2]] },
    { ctx: '线*', preds: [['*', baseCount - 3]] },
    // * 斜体闭合
    { ctx: ' *', preds: [['*', baseCount - 5]] },
    // __ 强调闭合
    { ctx: '__', preds: [['强', baseCount - 5], ['注', baseCount - 8], ['重', baseCount - 10]] },
    { ctx: '注_', preds: [['_', baseCount - 2]] },
    // `` 行内代码闭合
    { ctx: '``', preds: [['`', baseCount], ['c', baseCount - 10], ['v', baseCount - 12]] },
    { ctx: 'de', preds: [['`', baseCount - 2]] },
    // [...] 链接语法
    { ctx: ']', preds: [['(', baseCount + 10], [']', baseCount - 15]] },
    { ctx: '](', preds: [['h', baseCount - 5], ['.', baseCount - 3], ['#', baseCount - 8]] },
    // ![ 图片语法
    { ctx: '![', preds: [['s', baseCount - 5], ['i', baseCount - 8], ['S', baseCount - 10]] },
    { ctx: '![]', preds: [['(', baseCount + 10]] },
    // # 标题
    { ctx: '# ', preds: [['J', baseCount - 5], ['快', baseCount - 8], ['创', baseCount - 10]] },
    { ctx: '## ', preds: [['使', baseCount - 5], ['配', baseCount - 8], ['如', baseCount - 12]] },
    { ctx: '### ', preds: [['安', baseCount - 8], ['注', baseCount - 10], ['步', baseCount - 12]] },
    // - 列表
    { ctx: '- ', preds: [['打', baseCount - 5], ['使', baseCount - 8], ['创', baseCount - 10]] },
    { ctx: '1. ', preds: [['打', baseCount - 8], ['安', baseCount - 10], ['创', baseCount - 12]] },
    { ctx: '- [', preds: [[' ', baseCount + 5]] },
    // > 引用
    { ctx: '> ', preds: [['引', baseCount - 5], ['注', baseCount - 8], ['这', baseCount - 10]] },
    // ``` 代码块
    { ctx: '```', preds: [['j', baseCount - 3], ['p', baseCount - 5], ['r', baseCount - 8]] },
    { ctx: '```j', preds: [['s', baseCount + 5]] },
    { ctx: '```p', preds: [['y', baseCount], ['h', baseCount - 5]] },
    // | 表格
    { ctx: '| ', preds: [['字', baseCount - 8], ['参', baseCount - 10], ['属', baseCount - 12]] },
    // --- 分割线
    { ctx: '---', preds: [['\n', baseCount]] },
    // 中文标点上下文
    { ctx: '。\n', preds: [['#', baseCount - 5], ['但', baseCount - 8]] },
    { ctx: '，', preds: [['但', baseCount - 5], ['并', baseCount - 8], ['这', baseCount - 10]] },
    { ctx: '：', preds: [['\n', baseCount], ['它', baseCount - 10]] },
    // 英文标点
    { ctx: '. ', preds: [['T', baseCount - 5], ['I', baseCount - 8], ['A', baseCount - 10]] },
    // 换行模式
    { ctx: '\n\n', preds: [['#', baseCount], ['-', baseCount - 5], ['>', baseCount - 10]] },
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

/** 扫描源目录下的所有 .md 文件 */
function scanSource(dirPath: string, weight: number, ngramN: number): { table: NGramTable; fileCount: number; rawSize: number } {
  const table: NGramTable = new Map();
  let fileCount = 0;
  let rawSize = 0;

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
        const raw = fs.readFileSync(fullPath, 'utf-8');
        const cleaned = stripInlineCode(stripFencedCode(raw));
        rawSize += Buffer.byteLength(raw, 'utf-8');
        const subTable = scanText(cleaned, ngramN, weight);
        mergeTables(table, subTable);
        fileCount++;
      }
    }
  }

  walk(dirPath);
  return { table, fileCount, rawSize };
}

// ---- 主流程 ----

function main(): void {
  console.log('🧠 MarkLuck 基准 L2 训练工具');
  console.log('═══════════════════════════════\n');

  // 读取配置
  const config: CorpusConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
  console.log(`配置: ${config.ngramN}-gram, min-count=${config.minCount}, top-${config.maxPredsPerContext}`);
  console.log(`语料源: ${config.sources.length} 个\n`);

  const globalTable: NGramTable = new Map();
  const report: TrainReport = {
    generatedAt: new Date().toISOString(),
    totalEntries: 0,
    totalRawEntries: 0,
    estimatedSize: '0KB',
    sources: {},
    topContexts: [],
  };

  // 扫描所有语料源
  for (const source of config.sources) {
    const absPath = path.resolve(CORPUS_DIR, source.path);
    const label = source.path.replace(/\/+$/, '');
    console.log(`📂 ${label} (weight=${source.weight})...`);

    const { table, fileCount, rawSize } = scanSource(absPath, source.weight, config.ngramN);
    mergeTables(globalTable, table);

    report.sources[label] = {
      files: fileCount,
      entries: table.size,
      rawSize,
      coverage: '', // filled later
    };
    console.log(`   ${fileCount} 个文件, ${table.size} 个原始上下文, ${(rawSize / 1024).toFixed(0)}KB`);
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
    report.sources['hardcoded-p0'] = { files: 0, entries: p0Count, rawSize: 0, coverage: '' };
  }

  const rawTotal = globalTable.size;

  // 裁剪
  console.log('\n✂️  裁剪 (min-count=' + config.minCount + ', top-' + config.maxPredsPerContext + ')...');
  const pruned = pruneTable(globalTable, config.minCount, config.maxPredsPerContext);
  console.log(`   ${rawTotal} → ${pruned.size} 个上下文 (${((1 - pruned.size / rawTotal) * 100).toFixed(1)}% 裁剪率)`);

  // 序列化并输出
  const outputPath = path.resolve(CORPUS_DIR, config.outputFile);
  const outDir = path.dirname(outputPath);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const serialized = serialize(pruned);
  fs.writeFileSync(outputPath, serialized, 'utf-8');

  const sizeKB = (Buffer.byteLength(serialized, 'utf-8') / 1024).toFixed(0);

  // 计算各源覆盖率
  for (const [label, src] of Object.entries(report.sources)) {
    src.coverage = src.entries > 0 ? `${((src.entries / rawTotal) * 100).toFixed(1)}%` : '0%';
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
  report.estimatedSize = `${sizeKB}KB`;
  report.topContexts = topEntries.map((e) => ({
    ctx: Buffer.from(e.ctx, 'utf-8').toString('hex'),
    preds: [...e.preds].slice(0, 3).map(([ch]) => ch).join('/'),
    from: 'various',
  }));

  // 输出报告
  const reportPath = path.resolve(CORPUS_DIR, config.reportFile);
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf-8');

  // 最终报告
  console.log('\n═══════════════════════════════');
  console.log(`✅ 训练完成`);
  console.log(`   产出: ${path.relative(process.cwd(), outputPath)}`);
  console.log(`   条目: ${pruned.size}`);
  console.log(`   大小: ${sizeKB}KB`);
  console.log(`   报告: ${config.reportFile}`);
  console.log('\n来源分布:');
  for (const [label, src] of Object.entries(report.sources)) {
    console.log(`   ${label}: ${src.files} 文件, ${src.entries} 原始条目, ${src.coverage}`);
  }
}

main();
