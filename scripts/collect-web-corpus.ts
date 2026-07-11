/**
 * collect-web-corpus.ts — collect public web text into a local-only training cache.
 *
 * Usage:
 *   pnpm collect-web-corpus -- --profile web-local
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { fileURLToPath, pathToFileURL } from 'url';
import {
  assertApprovedWebSources,
  buildCleanDocument,
  cleanFragment,
  type FragmentLanguage,
  extractReadableText,
  extractSameOriginLinks,
  fragmentText,
  isAllowedCollectionUrl,
  nearDuplicateCorpusKey,
  normalizeCorpusFragment,
  resolveSourceDefaults,
  safeSegment,
  sourceKey,
  type CollectedPageResult,
  type WebCorpusProfile,
  type WebSourceConfig,
  type WebSourceManifest,
} from './web-corpus-utils';

interface CliOptions {
  profile: WebCorpusProfile;
  limit?: number;
  timeoutMs: number;
}

interface CollectionReport {
  generatedAt: string;
  profile: WebCorpusProfile;
  sourceCount: number;
  pageCount: number;
  keptFragments: number;
  droppedFragments: number;
  sources: CollectedPageResult[];
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CORPUS_DIR = path.join(__dirname, 'corpus');
const MANIFEST_PATH = path.join(CORPUS_DIR, 'web-sources.json');
const CACHE_DIR = path.join(CORPUS_DIR, '_web-cache');
const RAW_DIR = path.join(CACHE_DIR, '_raw');
const CLEAN_DIR = path.join(CACHE_DIR, '_clean');
const REPORT_DIR = path.join(CACHE_DIR, '_reports');
const MAX_PAGE_BYTES = 2 * 1024 * 1024;
const MAX_CLEAN_POOL_BYTES = 30 * 1024 * 1024;

export async function collectWebCorpus(options: CliOptions): Promise<CollectionReport> {
  const manifest = readManifest();
  assertApprovedWebSources(manifest);
  ensureDirs();

  const enabledSources = manifest.sources.filter((source) => source.enabled ?? true);
  const selectedSources =
    options.limit && options.limit > 0 ? enabledSources.slice(0, options.limit) : enabledSources;
  const results: CollectedPageResult[] = [];
  const globalExactFragments = new Set<string>();
  const globalNearFragments = new Set<string>();

  for (const source of selectedSources) {
    const sourceResults = await collectSource(source, manifest, options, {
      exact: globalExactFragments,
      near: globalNearFragments,
    });
    results.push(...sourceResults);
  }

  const cleanPoolBytes = [...new Set(results.map((item) => item.cleanPath).filter(Boolean))].reduce(
    (sum, relativePath) => {
      const fullPath = path.resolve(CORPUS_DIR, relativePath!);
      return sum + (fs.existsSync(fullPath) ? fs.statSync(fullPath).size : 0);
    },
    0,
  );
  if (cleanPoolBytes > MAX_CLEAN_POOL_BYTES) {
    throw new Error(
      `Clean corpus ${cleanPoolBytes} bytes exceeds ${MAX_CLEAN_POOL_BYTES} byte verified pool cap`,
    );
  }

  const report: CollectionReport = {
    generatedAt: new Date().toISOString(),
    profile: options.profile,
    sourceCount: selectedSources.length,
    pageCount: results.length,
    keptFragments: results.reduce((sum, item) => sum + item.fragmentsKept, 0),
    droppedFragments: results.reduce((sum, item) => sum + item.fragmentsDropped, 0),
    sources: results,
  };

  const reportPath = path.join(REPORT_DIR, `collection-report.${options.profile}.json`);
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf-8');
  return report;
}

async function collectSource(
  source: WebSourceConfig,
  manifest: WebSourceManifest,
  options: CliOptions,
  globalFragments: { exact: Set<string>; near: Set<string> },
): Promise<CollectedPageResult[]> {
  const defaults = resolveSourceDefaults(source, manifest);
  const sourceId = source.id ?? `${safeSegment(source.category)}-${sourceKey(source.url)}`;
  const queue: Array<{ url: string; depth: number }> = [{ url: source.url, depth: 0 }];
  const visited = new Set<string>();
  const results: CollectedPageResult[] = [];

  while (queue.length > 0 && visited.size < defaults.maxPages) {
    const next = queue.shift();
    if (!next || visited.has(next.url)) continue;
    visited.add(next.url);

    if (!isAllowedCollectionUrl(next.url, source)) continue;
    const result = await collectPage({
      source,
      sourceId,
      url: next.url,
      weight: defaults.weight,
      timeoutMs: options.timeoutMs,
      globalFragments,
    });
    results.push(result);

    if (next.depth >= defaults.depth || result.error) continue;
    try {
      const raw = fs.readFileSync(path.resolve(CORPUS_DIR, result.rawPath), 'utf-8');
      for (const link of extractSameOriginLinks(raw, next.url)) {
        if (!isAllowedCollectionUrl(link, source)) continue;
        if (visited.has(link)) continue;
        queue.push({ url: link, depth: next.depth + 1 });
        if (visited.size + queue.length >= defaults.maxPages) break;
      }
    } catch {
      // A failed raw read should not abort the rest of the collection.
    }
  }

  return results;
}

async function collectPage(args: {
  source: WebSourceConfig;
  sourceId: string;
  url: string;
  weight: number;
  timeoutMs: number;
  globalFragments: { exact: Set<string>; near: Set<string> };
}): Promise<CollectedPageResult> {
  const key = sourceKey(args.url);
  const category = safeSegment(args.source.category);
  const language = safeSegment(args.source.language);
  const rawPath = path.join(RAW_DIR, `${category}-${key}.html`);
  const cleanDir = path.join(CLEAN_DIR, language, category);
  const cleanPath = path.join(cleanDir, `${category}-${key}.md`);
  const baseResult: CollectedPageResult = {
    sourceId: args.sourceId,
    category: args.source.category,
    language: args.source.language,
    weight: args.weight,
    url: args.url,
    rawPath: toCorpusRelative(rawPath),
    cleanPath: null,
    rawBytes: 0,
    extractedChars: 0,
    fragmentsSeen: 0,
    fragmentsKept: 0,
    fragmentsDropped: 0,
    languageDistribution: { zh: 0, en: 0, mixed: 0, unknown: 0 },
    scrubHits: {},
    dropReasons: {},
    licenseId: args.source.license?.licenseId,
    licenseEvidence: args.source.license?.evidence,
  };

  try {
    const html = await fetchText(args.url, args.timeoutMs);
    fs.writeFileSync(rawPath, html, 'utf-8');
    const extracted = extractReadableText(html);
    const fragments = fragmentText(extracted);
    const cleanFragments: string[] = [];
    const dropReasons: Record<string, number> = {};
    const scrubHits: Record<string, number> = {};
    const languageDistribution: Record<FragmentLanguage, number> = {
      zh: 0,
      en: 0,
      mixed: 0,
      unknown: 0,
    };

    for (const fragment of fragments) {
      const clean = cleanFragment(fragment);
      for (const hit of clean.hits) scrubHits[hit] = (scrubHits[hit] ?? 0) + 1;
      if (clean.action === 'keep') {
        const exactKey = normalizeCorpusFragment(clean.text);
        const nearKey = nearDuplicateCorpusKey(clean.text);
        if (args.globalFragments.exact.has(exactKey)) {
          dropReasons['global-exact-duplicate'] = (dropReasons['global-exact-duplicate'] ?? 0) + 1;
          continue;
        }
        if (nearKey.length >= 12 && args.globalFragments.near.has(nearKey)) {
          dropReasons['global-near-duplicate'] = (dropReasons['global-near-duplicate'] ?? 0) + 1;
          continue;
        }
        args.globalFragments.exact.add(exactKey);
        if (nearKey.length >= 12) args.globalFragments.near.add(nearKey);
        cleanFragments.push(clean.text);
        languageDistribution[clean.language ?? 'unknown']++;
      } else {
        const reason = clean.reason ?? 'unknown';
        dropReasons[reason] = (dropReasons[reason] ?? 0) + 1;
      }
    }

    const cleanDocument = buildCleanDocument(cleanFragments);
    const finalFragments = cleanDocument.trim() ? cleanDocument.trim().split(/\n{2,}/) : [];

    let cleanSha256: string | undefined;
    if (finalFragments.length > 0) {
      fs.mkdirSync(cleanDir, { recursive: true });
      fs.writeFileSync(cleanPath, cleanDocument, 'utf-8');
      baseResult.cleanPath = toCorpusRelative(cleanPath);
      cleanSha256 = crypto.createHash('sha256').update(cleanDocument).digest('hex');
    } else if (fs.existsSync(cleanPath)) {
      fs.unlinkSync(cleanPath);
    }

    return {
      ...baseResult,
      rawBytes: Buffer.byteLength(html, 'utf-8'),
      extractedChars: extracted.length,
      fragmentsSeen: fragments.length,
      fragmentsKept: finalFragments.length,
      fragmentsDropped: fragments.length - finalFragments.length,
      languageDistribution,
      scrubHits,
      dropReasons,
      cleanSha256,
    };
  } catch (error) {
    return {
      ...baseResult,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function fetchText(url: string, timeoutMs: number): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'user-agent':
          'JotLuckWebCorpusCollector/0.1 (+local autocomplete corpus; privacy-scrubbed fragments)',
        accept: 'text/html,application/xhtml+xml,text/plain;q=0.8,*/*;q=0.2',
      },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
    if (
      contentType &&
      !contentType.includes('text/html') &&
      !contentType.includes('application/xhtml+xml') &&
      !contentType.includes('text/plain')
    ) {
      throw new Error(`Unsupported content type: ${contentType}`);
    }
    const declaredLength = Number(response.headers.get('content-length') ?? '0');
    if (Number.isFinite(declaredLength) && declaredLength > MAX_PAGE_BYTES) {
      throw new Error(`Response exceeds ${MAX_PAGE_BYTES} bytes`);
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > MAX_PAGE_BYTES) {
      throw new Error(`Response exceeds ${MAX_PAGE_BYTES} bytes`);
    }
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } finally {
    clearTimeout(timer);
  }
}

function readManifest(): WebSourceManifest {
  return JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf-8')) as WebSourceManifest;
}

function ensureDirs(): void {
  fs.mkdirSync(RAW_DIR, { recursive: true });
  fs.mkdirSync(CLEAN_DIR, { recursive: true });
  fs.mkdirSync(REPORT_DIR, { recursive: true });
}

function toCorpusRelative(fullPath: string): string {
  return path.relative(CORPUS_DIR, fullPath).replace(/\\/g, '/');
}

function parseCli(argv: string[]): CliOptions {
  const profile = readArg(argv, '--profile') ?? 'web-local';
  if (profile !== 'release' && profile !== 'web-local') {
    throw new Error(`Unsupported profile: ${profile}`);
  }
  const limit = readArg(argv, '--limit');
  const timeout = readArg(argv, '--timeout-ms');
  return {
    profile,
    limit: limit ? Number(limit) : undefined,
    timeoutMs: timeout ? Number(timeout) : 15000,
  };
}

function readArg(argv: string[], name: string): string | undefined {
  const inline = argv.find((item) => item.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

async function main(): Promise<void> {
  const options = parseCli(process.argv.slice(2));
  console.log(`🌐 Collecting web corpus (${options.profile})...`);
  const report = await collectWebCorpus(options);
  console.log(`✅ Collection complete`);
  console.log(`   Sources: ${report.sourceCount}`);
  console.log(`   Pages: ${report.pageCount}`);
  console.log(`   Kept fragments: ${report.keptFragments}`);
  console.log(`   Dropped fragments: ${report.droppedFragments}`);
  console.log(
    `   Report: ${path.relative(process.cwd(), path.join(REPORT_DIR, `collection-report.${options.profile}.json`))}`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
