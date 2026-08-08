import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { mkdir, stat } from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import {
  assertSafeIdentifier,
  canonicalSha256,
  decodeUtf8,
  isSha256,
  normalizeV2FreeTextIdentity,
  publishStagedDirectory,
  readPinnedFile,
  resolveCorpusOutput,
  resolveWorkspaceInput,
  safeRemoveStagingDirectory,
  sha256,
  workspaceRelative,
  writeExclusiveBytes,
  writeExclusiveJson,
  type Sha256,
} from './common';

const MAXIMUM_XML_SHARD_BYTES = 64 * 1024 * 1024;
const MAXIMUM_ARTICLE_BYTES = 16 * 1024;
const MINIMUM_ARTICLE_BYTES = 120;
const execFileAsync = promisify(execFile);

export type OfficialWikimedia20260801RawSourceId =
  | 'enwiki-partition-1'
  | 'enwikibooks-full'
  | 'zhwiki-partition-1'
  | 'zhwikibooks-full'
  | 'zhwikisource-prefix-0-300313200';

export interface OfficialWikimediaRawIdentity {
  sourceId: OfficialWikimedia20260801RawSourceId;
  filename: string;
  bytes: number;
  sha1: string;
  sha256: Sha256;
  language: 'zh' | 'en';
  project: 'wikipedia' | 'wikibooks' | 'wikisource';
  dumpDate: '2026-08-01';
  upstreamObjectBytes?: number;
  upstreamObjectSha1?: string;
  byteRange?: string;
}

/** Exact raw identities verified before registration and streamed directly by the cleaner. */
export const OFFICIAL_WIKIMEDIA_20260801_RAW_SOURCES = Object.freeze({
  'enwiki-partition-1': {
    sourceId: 'enwiki-partition-1',
    filename: 'enwiki-20260801-pages-articles-multistream1.xml-p1p41242.bz2',
    bytes: 299_138_062,
    sha1: 'c70c36ca1b892ed97b0dbce2bc889468f7abe858',
    sha256: '856411e9a99bdc38f809ee36960ae05249a41815d56e08f015b138feaad8fe9f',
    language: 'en',
    project: 'wikipedia',
    dumpDate: '2026-08-01',
  },
  'enwikibooks-full': {
    sourceId: 'enwikibooks-full',
    filename: 'enwikibooks-20260801-pages-articles-multistream.xml.bz2',
    bytes: 207_199_592,
    sha1: '726667a53896e6d43b692f916441086ae6382384',
    sha256: '424f5b63febed2f3bc5979841ca4fb8bf3dbd57de959004c46d221611ff5c4dd',
    language: 'en',
    project: 'wikibooks',
    dumpDate: '2026-08-01',
  },
  'zhwiki-partition-1': {
    sourceId: 'zhwiki-partition-1',
    filename: 'zhwiki-20260801-pages-articles-multistream1.xml-p1p187712.bz2',
    bytes: 255_349_033,
    sha1: '18f50054deb180b806ac45bf15894b409c3bc3e1',
    sha256: '6277a5bc5a833a8ec7e9a3d90a81d2eaa9400b52732223094e4bf2f5c595b4f2',
    language: 'zh',
    project: 'wikipedia',
    dumpDate: '2026-08-01',
  },
  'zhwikibooks-full': {
    sourceId: 'zhwikibooks-full',
    filename: 'zhwikibooks-20260801-pages-articles-multistream.xml.bz2',
    bytes: 19_924_402,
    sha1: '3575564cc9c1fd11ae6c97330fa3d519d691a9e0',
    sha256: '0494eee9136ada51499af78d923477a629b04627d4af1e2ac49d24bcbb721aeb',
    language: 'zh',
    project: 'wikibooks',
    dumpDate: '2026-08-01',
  },
  'zhwikisource-prefix-0-300313200': {
    sourceId: 'zhwikisource-prefix-0-300313200',
    filename: 'zhwikisource-20260801-pages-articles-multistream.prefix-0-300313200.xml.bz2',
    bytes: 300_313_201,
    sha1: '56519f980146aa598b544598cb1276bb1a5d2130',
    sha256: 'ce51188c0b2d89e1386de81677f22df01dbabf174b3dc32f476d21d1a366c559',
    language: 'zh',
    project: 'wikisource',
    dumpDate: '2026-08-01',
    upstreamObjectBytes: 7_168_395_497,
    upstreamObjectSha1: '61011491bf408e8e647eefc4560e531965df7e52',
    byteRange: 'bytes=0-300313200',
  },
} satisfies Record<OfficialWikimedia20260801RawSourceId, OfficialWikimediaRawIdentity>);

export interface WikimediaRawRegistration {
  schema: 'jotluck.autocomplete.v2-free-wikimedia-raw-registration.v1';
  schemaVersion: 1;
  source: OfficialWikimediaRawIdentity;
  rawPath: string;
  verifiedBytes: number;
  verifiedSha1: string;
  verifiedSha256: Sha256;
  extractionBoundary: 'direct-bzip2-streaming-iterparse';
  registrationSha256: Sha256;
}

export interface WikimediaStreamResult {
  manifestSha256: Sha256;
  selectedBytes: number;
}

export async function materializeRegisteredWikimediaRaw(options: {
  workspaceRoot: string;
  planPath: string;
  pythonExecutable?: string;
}): Promise<WikimediaStreamResult> {
  const workspaceRoot = await resolveWorkspaceInput(options.workspaceRoot, '.');
  const planPath = await resolveWorkspaceInput(options.workspaceRoot, options.planPath);
  const helper = path.join(path.dirname(fileURLToPath(import.meta.url)), 'wikimedia_stream.py');
  const { stdout } = await execFileAsync(
    options.pythonExecutable ?? 'python',
    [helper, '--workspace-root', workspaceRoot, '--plan', planPath],
    { cwd: workspaceRoot, windowsHide: true, maxBuffer: 1024 * 1024 },
  );
  const result = JSON.parse(stdout) as WikimediaStreamResult;
  if (!isSha256(result.manifestSha256) || !Number.isSafeInteger(result.selectedBytes)) {
    throw new Error('Wikimedia streaming helper returned an invalid result.');
  }
  return result;
}

export async function registerOfficialWikimedia20260801Raw(options: {
  workspaceRoot: string;
  sourceId: OfficialWikimedia20260801RawSourceId;
  rawRoot: string;
  outputPath: string;
}): Promise<WikimediaRawRegistration> {
  const source = OFFICIAL_WIKIMEDIA_20260801_RAW_SOURCES[options.sourceId];
  if (!source) throw new Error('Unknown official Wikimedia 20260801 raw source id.');
  const rawPath = await resolveWorkspaceInput(
    options.workspaceRoot,
    `${options.rawRoot.replace(/[\\/]+$/u, '')}/${source.filename}`,
  );
  const identity = await hashFile(rawPath);
  if (
    identity.bytes !== source.bytes ||
    identity.sha1 !== source.sha1 ||
    identity.sha256 !== source.sha256
  ) {
    throw new Error(`Official Wikimedia raw identity mismatch: ${source.sourceId}.`);
  }
  const outputPath = await resolveCorpusOutput(options.workspaceRoot, options.outputPath);
  const registrationWithoutHash = {
    schema: 'jotluck.autocomplete.v2-free-wikimedia-raw-registration.v1' as const,
    schemaVersion: 1 as const,
    source,
    rawPath: workspaceRelative(options.workspaceRoot, rawPath),
    verifiedBytes: identity.bytes,
    verifiedSha1: identity.sha1,
    verifiedSha256: identity.sha256,
    extractionBoundary: 'direct-bzip2-streaming-iterparse' as const,
  };
  const registration: WikimediaRawRegistration = {
    ...registrationWithoutHash,
    registrationSha256: canonicalSha256(registrationWithoutHash),
  };
  await writeExclusiveJson(outputPath, registration);
  return registration;
}

export interface WikimediaXmlFixturePlan {
  schema: 'jotluck.autocomplete.v2-free-wikimedia-fixture-plan.v1';
  schemaVersion: 1;
  sourceId: string;
  language: 'zh' | 'en';
  category: string;
  cleanerVersion: string;
  outputRoot: string;
  snapshot: {
    path: string;
    bytes: number;
    sha256: Sha256;
    upstreamDumpUrl: string;
    upstreamDumpDate: string;
    extractionRecipeSha256: Sha256;
  };
  license: {
    spdx: 'CC-BY-SA-4.0';
    evidencePath: string;
    evidenceBytes: number;
    evidenceSha256: Sha256;
    attributionUrl: string;
    reviewStatus: 'approved-development';
  };
}

export interface WikimediaCleanedDocument {
  documentId: string;
  sourceId: string;
  language: 'zh' | 'en';
  category: string;
  relativePath: string;
  titleSha256: Sha256;
  revisionId: string;
  bytes: number;
  sha256: Sha256;
  normalizedSha256: Sha256;
  licenseApproved: true;
}

export interface WikimediaShardManifest {
  schema: 'jotluck.autocomplete.v2-free-wikimedia-shard.v1';
  schemaVersion: 1;
  source: {
    id: string;
    kind: 'wikimedia-cc-by-sa';
    language: 'zh' | 'en';
    category: string;
    cleanerVersion: string;
    contentRoot: string;
    contentTreeSha256: Sha256;
    licenseSpdx: 'CC-BY-SA-4.0';
    licenseEvidencePath: string;
    licenseEvidenceBytes: number;
    licenseEvidenceSha256: Sha256;
    attributionUrl: string;
    upstreamDumpUrl: string;
    upstreamDumpDate: string;
    extractionRecipeSha256: Sha256;
    snapshotBytes: number;
    snapshotSha256: Sha256;
  };
  documents: WikimediaCleanedDocument[];
  selectedBytes: number;
  rejected: Record<string, number>;
  manifestSha256: Sha256;
}

/** Small uncompressed XML fixture entry used only to exercise cleaning rules in tests. */
export async function materializeWikimediaXmlFixture(options: {
  workspaceRoot: string;
  plan: WikimediaXmlFixturePlan;
}): Promise<{ manifest: WikimediaShardManifest; manifestPath: string }> {
  validatePlan(options.plan);
  const snapshot = await readPinnedFile(
    options.workspaceRoot,
    options.plan.snapshot,
    'Wikimedia XML shard',
  );
  if (snapshot.bytes.byteLength > MAXIMUM_XML_SHARD_BYTES) {
    throw new Error('Wikimedia fixture cleaner accepts XML fixtures up to 64 MiB.');
  }
  const evidence = await readPinnedFile(
    options.workspaceRoot,
    {
      path: options.plan.license.evidencePath,
      bytes: options.plan.license.evidenceBytes,
      sha256: options.plan.license.evidenceSha256,
    },
    'Wikimedia license evidence',
  );
  const outputRoot = await resolveCorpusOutput(options.workspaceRoot, options.plan.outputRoot);
  if (await exists(outputRoot)) throw new Error('Wikimedia output root already exists.');
  const staging = path.join(
    path.dirname(outputRoot),
    `.staging-${path.basename(outputRoot)}-${process.pid}-${Date.now()}`,
  );
  await mkdir(staging, { recursive: false });
  try {
    const xml = decodeUtf8(snapshot.bytes, 'Wikimedia XML shard');
    const parsed = parsePages(xml, options.plan);
    const documents: WikimediaCleanedDocument[] = [];
    let selectedBytes = 0;
    for (const article of parsed.articles) {
      const id = `${options.plan.sourceId}-${sha256(`${article.revisionId}\u0000${article.title}`).slice(0, 16)}`;
      const relativeName = `${id}.txt`;
      const bytes = Buffer.from(`${article.text}\n`, 'utf8');
      await writeExclusiveBytes(path.join(staging, relativeName), bytes);
      selectedBytes += bytes.byteLength;
      documents.push({
        documentId: id,
        sourceId: options.plan.sourceId,
        language: options.plan.language,
        category: options.plan.category,
        relativePath: `${options.plan.outputRoot}/${relativeName}`.replaceAll('\\', '/'),
        titleSha256: sha256(article.title.normalize('NFKC')),
        revisionId: article.revisionId,
        bytes: bytes.byteLength,
        sha256: sha256(bytes),
        normalizedSha256: sha256(normalizeArticle(article.text)),
        licenseApproved: true,
      });
    }
    if (documents.length === 0) throw new Error('Wikimedia shard produced no approved prose.');
    const sourceWithoutTree = documents.map(({ documentId, bytes, sha256: identity }) => ({
      documentId,
      bytes,
      sha256: identity,
    }));
    const manifestWithoutHash = {
      schema: 'jotluck.autocomplete.v2-free-wikimedia-shard.v1' as const,
      schemaVersion: 1 as const,
      source: {
        id: options.plan.sourceId,
        kind: 'wikimedia-cc-by-sa' as const,
        language: options.plan.language,
        category: options.plan.category,
        cleanerVersion: options.plan.cleanerVersion,
        contentRoot: options.plan.outputRoot,
        contentTreeSha256: canonicalSha256(sourceWithoutTree),
        licenseSpdx: options.plan.license.spdx,
        licenseEvidencePath: workspaceRelative(options.workspaceRoot, evidence.path),
        licenseEvidenceBytes: evidence.bytes.byteLength,
        licenseEvidenceSha256: sha256(evidence.bytes),
        attributionUrl: options.plan.license.attributionUrl,
        upstreamDumpUrl: options.plan.snapshot.upstreamDumpUrl,
        upstreamDumpDate: options.plan.snapshot.upstreamDumpDate,
        extractionRecipeSha256: options.plan.snapshot.extractionRecipeSha256,
        snapshotBytes: snapshot.bytes.byteLength,
        snapshotSha256: sha256(snapshot.bytes),
      },
      documents,
      selectedBytes,
      rejected: parsed.rejected,
    };
    const manifest: WikimediaShardManifest = {
      ...manifestWithoutHash,
      manifestSha256: canonicalSha256(manifestWithoutHash),
    };
    await writeExclusiveJson(path.join(staging, 'manifest.json'), manifest);
    await publishStagedDirectory(staging, outputRoot);
    return {
      manifest,
      manifestPath: `${options.plan.outputRoot}/manifest.json`.replaceAll('\\', '/'),
    };
  } catch (error) {
    if (await exists(staging)) await safeRemoveStagingDirectory(staging);
    throw error;
  }
}

function validatePlan(plan: WikimediaXmlFixturePlan): void {
  if (
    plan.schema !== 'jotluck.autocomplete.v2-free-wikimedia-fixture-plan.v1' ||
    plan.schemaVersion !== 1 ||
    (plan.language !== 'zh' && plan.language !== 'en') ||
    !plan.category ||
    !plan.cleanerVersion ||
    plan.license.spdx !== 'CC-BY-SA-4.0' ||
    plan.license.reviewStatus !== 'approved-development' ||
    !isHttpsUrl(plan.license.attributionUrl) ||
    !isHttpsUrl(plan.snapshot.upstreamDumpUrl) ||
    !/^\d{4}-\d{2}-\d{2}$/u.test(plan.snapshot.upstreamDumpDate) ||
    !/^[a-f0-9]{64}$/u.test(plan.snapshot.extractionRecipeSha256)
  ) {
    throw new Error('Wikimedia shard plan contract is invalid.');
  }
  assertSafeIdentifier(plan.sourceId, 'Wikimedia source id');
}

function parsePages(
  xml: string,
  plan: WikimediaXmlFixturePlan,
): {
  articles: Array<{ title: string; revisionId: string; text: string }>;
  rejected: Record<string, number>;
} {
  const articles: Array<{ title: string; revisionId: string; text: string }> = [];
  const rejected: Record<string, number> = {};
  const identities = new Set<Sha256>();
  for (const match of xml.matchAll(/<page>([\s\S]*?)<\/page>/gu)) {
    const page = match[1]!;
    const title = decodeXml(extract(page, 'title') ?? '').trim();
    const namespace = extract(page, 'ns')?.trim();
    const redirect = /<redirect(?:\s|\/|>)/u.test(page);
    const revision = page.match(/<revision>([\s\S]*?)<\/revision>/u)?.[1] ?? '';
    const revisionId = extract(revision, 'id')?.trim() ?? '';
    const rawText = decodeXml(extractText(revision) ?? '');
    const reason = rejectPage({ title, namespace, redirect, revisionId, rawText }, plan.language);
    if (reason) {
      rejected[reason] = (rejected[reason] ?? 0) + 1;
      continue;
    }
    const text = cleanWikiText(rawText);
    const bytes = Buffer.byteLength(text, 'utf8');
    const safety = rejectedTextReason(text);
    if (bytes < MINIMUM_ARTICLE_BYTES || bytes > MAXIMUM_ARTICLE_BYTES || safety) {
      const key = safety ?? (bytes < MINIMUM_ARTICLE_BYTES ? 'too-short' : 'too-long');
      rejected[key] = (rejected[key] ?? 0) + 1;
      continue;
    }
    if (!normalizeFingerprintEligibleText(text)) {
      rejected['url-only'] = (rejected['url-only'] ?? 0) + 1;
      continue;
    }
    if (!hasDeclaredLanguageShingle(text, plan.language)) {
      rejected['segment-language-mismatch'] = (rejected['segment-language-mismatch'] ?? 0) + 1;
      continue;
    }
    const identity = sha256(normalizeArticle(text));
    if (identities.has(identity)) {
      rejected['exact-duplicate'] = (rejected['exact-duplicate'] ?? 0) + 1;
      continue;
    }
    identities.add(identity);
    articles.push({ title, revisionId, text });
  }
  return { articles, rejected };
}

function rejectPage(
  page: {
    title: string;
    namespace: string | undefined;
    redirect: boolean;
    revisionId: string;
    rawText: string;
  },
  language: 'zh' | 'en',
): string | undefined {
  if (!page.title || !page.revisionId || !page.rawText) return 'missing-fields';
  if (page.namespace !== '0') return 'non-article-namespace';
  if (page.redirect || /^#(?:REDIRECT|重定向)/iu.test(page.rawText.trim())) return 'redirect';
  if (/(?:消歧义|disambiguation)/iu.test(page.rawText.slice(0, 500))) return 'disambiguation';
  const hasHan = /\p{Script=Han}/u.test(page.rawText);
  const hasEnglish = /[A-Za-z]/u.test(page.rawText);
  if (language === 'zh' ? !hasHan : !hasEnglish) return 'language-mismatch';
  return undefined;
}

function cleanWikiText(value: string): string {
  let text = value
    .replace(/<!--[\s\S]*?-->/gu, ' ')
    .replace(/<ref\b[^>]*\/>/giu, ' ')
    .replace(/<ref\b[^>]*>[\s\S]*?<\/ref>/giu, ' ')
    .replace(/\{\|[\s\S]*?\|\}/gu, ' ');
  for (let round = 0; round < 6; round++) {
    const reduced = text.replace(/\{\{[^{}]*\}\}/gu, ' ');
    if (reduced === text) break;
    text = reduced;
  }
  return text
    .replace(/\[\[(?:[^\]|]+\|)?([^\]]+)\]\]/gu, '$1')
    .replace(/\[(?:https?:\/\/\S+)(?:\s+([^\]]+))?\]/gu, '$1')
    .replace(/'{2,5}/gu, '')
    .replace(/^={2,6}\s*(.*?)\s*={2,6}$/gmu, '$1')
    .replace(/<[^>]+>/gu, ' ')
    .replace(/(?:^|\n)\s*[*#;:]+\s*/gu, '\n')
    .replace(/[ \t]+/gu, ' ')
    .replace(/\n{3,}/gu, '\n\n')
    .trim();
}

function rejectedTextReason(value: string): string | undefined {
  const checks: Array<[string, RegExp]> = [
    ['frontmatter', /^---\s*$/mu],
    ['fenced-code', /(?:^|\n)\s*(?:```|~~~)/u],
    ['email', /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu],
    ['phone', /(?:\+?\d[\s().-]*){8,}/u],
    ['secret', /(?:password|passwd|secret|api[_ -]?key|access[_ -]?token|bearer)\s*[:=]\s*\S+/iu],
    ['conversation-prompt', /(?:^|\n)\s*(?:user|assistant|system)\s*:/iu],
    [
      'navigation-boilerplate',
      /(?:privacy policy|terms of use|cookie settings|登录|注册|隐私政策)/iu,
    ],
  ];
  return checks.find(([, pattern]) => pattern.test(value))?.[0];
}

function extract(value: string, tag: string): string | undefined {
  return value.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'u'))?.[1];
}

function extractText(value: string): string | undefined {
  return value.match(/<text(?:\s[^>]*)?>([\s\S]*?)<\/text>/u)?.[1];
}

function decodeXml(value: string): string {
  return value
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&amp;', '&')
    .replace(/&#(\d+);/gu, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([a-f0-9]+);/giu, (_, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    );
}

function normalizeArticle(value: string): string {
  return normalizeV2FreeTextIdentity(value);
}

function normalizeFingerprintEligibleText(value: string): string {
  return normalizeArticle(value.replace(/https?:\/\/\S+/gu, ' '));
}

function hasDeclaredLanguageShingle(value: string, language: 'zh' | 'en'): boolean {
  const normalized = normalizeFingerprintEligibleText(value);
  if (language === 'en') return (normalized.match(/[a-z0-9]+/gu)?.length ?? 0) >= 5;
  return (normalized.match(/\p{Script=Han}/gu)?.length ?? 0) >= 12;
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

async function exists(value: string): Promise<boolean> {
  try {
    await stat(value);
    return true;
  } catch {
    return false;
  }
}

async function hashFile(value: string): Promise<{ bytes: number; sha1: string; sha256: Sha256 }> {
  const sha1 = createHash('sha1');
  const sha256Hash = createHash('sha256');
  let bytes = 0;
  for await (const chunk of createReadStream(value)) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.byteLength;
    sha1.update(buffer);
    sha256Hash.update(buffer);
  }
  return {
    bytes,
    sha1: sha1.digest('hex'),
    sha256: sha256Hash.digest('hex'),
  };
}
