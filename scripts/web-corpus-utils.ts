import * as crypto from 'crypto';

export type WebCorpusProfile = 'release' | 'web-local';
export type FragmentLanguage = 'zh' | 'en' | 'mixed' | 'unknown';

export interface WebSourceConfig {
  id?: string;
  url: string;
  category: string;
  language: string;
  weight?: number;
  depth?: number;
  maxPages?: number;
  enabled?: boolean;
  license?: {
    status: 'approved' | 'unverified' | 'rejected';
    licenseId?: string;
    evidence?: string;
  };
  allowPathPrefixes?: string[];
  denyPathPrefixes?: string[];
}

export interface WebSourceManifest {
  version: number;
  description?: string;
  licensePolicy?: string;
  defaults?: {
    weight?: number;
    depth?: number;
    maxPages?: number;
  };
  sources: WebSourceConfig[];
}

export interface ScrubResult {
  action: 'keep' | 'drop';
  text: string;
  hits: string[];
  reason?: string;
}

export interface CleanFragmentResult extends ScrubResult {
  originalLength: number;
  language?: FragmentLanguage;
}

export interface CollectedPageResult {
  sourceId: string;
  category: string;
  language: string;
  weight: number;
  url: string;
  rawPath: string;
  cleanPath: string | null;
  rawBytes: number;
  extractedChars: number;
  fragmentsSeen: number;
  fragmentsKept: number;
  fragmentsDropped: number;
  languageDistribution: Record<FragmentLanguage, number>;
  scrubHits: Record<string, number>;
  dropReasons: Record<string, number>;
  licenseId?: string;
  licenseEvidence?: string;
  cleanSha256?: string;
  error?: string;
}

const BOILERPLATE_PATTERNS = [
  /版权所有|保留所有权利|copyright|all rights reserved/i,
  /ICP备|公网安备|备案号/i,
  /licensed under|creative commons|attribution-sharealike|license\b/i,
  /登录|注册|退出登录|忘记密码/,
  /cookie|隐私政策|用户协议/i,
  /上一篇|下一篇|相关推荐|相关文章|阅读更多|返回顶部/,
  /分享到|分享至|复制链接|扫码|二维码|微信公众号|微博|朋友圈/,
  /发表评论|评论区|暂无评论|我要评论/,
  /广告|赞助|推广|立即购买|免费下载/,
  /点击查看|点击阅读|立即查看|立即注册|扫码关注|展开全文/,
  /\b(click here|read more|sign up|log in|subscribe|download now)\b/i,
  /^目录$/,
  /^导航$/,
  /you (?:switched accounts|signed out|signed in).*reload to refresh your session/i,
  /you can[’']?t perform that action at this time/i,
  /there was an error while loading.*reload this page/i,
  /was this page helpful to you/i,
  /press .* to (?:navigate between chapters|show this help|search in the book)/i,
  /last updated on .*utc/i,
  /菜鸟教程\s*--\s*学的不仅是技术/i,
  /查看此页面.*报告此内容的问题/i,
];

const WEB_TONE_PATTERNS = [
  /本文来自|原文链接|转载请注明|责任编辑|相关阅读/,
  /更多精彩|关注我们|欢迎留言|点赞收藏|一键三连/,
  /\b(?:cookie|newsletter|subscribe|advertisement|sponsored)\b/i,
];

const FIELD_PATTERNS: Array<[string, RegExp, string]> = [
  ['email', /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, ''],
  [
    'obfuscated-email',
    /[A-Z0-9._%+-]+\s*(?:\(at\)|\[at\]|\sat\s|@)\s*[A-Z0-9.-]+\s*(?:\(dot\)|\[dot\]|\sdot\s|\.)\s*[A-Z]{2,}/gi,
    '',
  ],
  ['phone', /(?:(?:\+?86[-\s]?)?1[3-9]\d{9})|(?:0\d{2,3}[-\s]?\d{7,8}(?:-\d{1,6})?)/g, ''],
  ['id-number', /\b\d{15,19}[0-9Xx]?\b/g, ''],
  ['url', /https?:\/\/[^\s<>"'）)]+|www\.[^\s<>"'）)]+/gi, ''],
  ['social-account', /@[A-Za-z0-9_\-\u4e00-\u9fa5]{2,24}/gu, ''],
  [
    'contact-field',
    /(?:地址|联系方式|联系人|联系电话|电话|手机|邮箱|邮编|负责人|QQ|微信|WeChat|VX|wx|qq)[:：\s]*[A-Za-z0-9_\-\u4e00-\u9fa5@.，,、（）()]{3,80}/giu,
    '',
  ],
  [
    'company',
    /[\u4e00-\u9fa5A-Za-z0-9（）()·]{2,40}(?:股份有限公司|有限责任公司|有限公司|集团|工作室|出版社|基金会|协会|研究院|委员会|学校|大学|学院|中心|公司)/gu,
    '某机构',
  ],
  [
    'english-org',
    /\b(?:[A-Z][A-Za-z&.-]*(?:\s+[A-Z][A-Za-z&.-]*){0,3}\s+(?:Inc|LLC|Ltd|Foundation|Association|University|Institute|Group|Studio|Press|Company|Corporation|Corp)|GitHub|Stack\s*Overflow|Reddit|Mozilla|Google|Microsoft|Apple|Meta)\b/g,
    'an organization',
  ],
  ['english-person', /\b[A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,}){1,2}\b/g, 'someone'],
  [
    'english-person-context',
    /\b(?:by|from|with|including|introduced by|help from|comment by)\s+[A-Z][a-z]{2,}\b/g,
    'by someone',
  ],
  ['english-possessive-person', /\b[A-Z][a-z]{2,}[’']s\b/g, "someone's"],
  [
    'byline',
    /(?:作者|编辑|记者|撰文|文|译者|校对|笔名|来源)[:：/／\s]*[\u4e00-\u9fa5A-Za-z·]{2,24}/gu,
    '',
  ],
  [
    'person-said',
    /(?<![\u4e00-\u9fa5])[\u4e00-\u9fa5]{2,4}(?:说|表示|指出|认为|介绍|称)/gu,
    '有人表示',
  ],
  [
    'identity-context',
    /(?:我是|网名|笔名|作者|posted\s+by)[:：\s，,]*[\u4e00-\u9fa5A-Za-z·]{2,32}/giu,
    '',
  ],
];

// The collector is intentionally aggressive: a false positive only discards one web
// fragment. The release audit must be narrower because it scans authored, local corpus
// text and must not mistake ordinary prose such as "written by design" for an identity.
const RELEASE_PRIVACY_PATTERNS: Array<[string, RegExp]> = [
  ['email', /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi],
  [
    'obfuscated-email',
    /[A-Z0-9._%+-]+\s*(?:\(at\)|\[at\]|\sat\s|@)\s*[A-Z0-9.-]+\s*(?:\(dot\)|\[dot\]|\sdot\s|\.)\s*[A-Z]{2,}/gi,
  ],
  ['phone', /(?:(?:\+?86[-\s]?)?1[3-9]\d{9})|(?:0\d{2,3}[-\s]?\d{7,8}(?:-\d{1,6})?)/g],
  ['id-number', /\b\d{15,19}[0-9Xx]?\b/g],
  ['social-account', /@[A-Za-z0-9_\-\u4e00-\u9fa5]{2,24}/gu],
  [
    'contact-field',
    /(?:^|[。！？!?\n])\s*(?:联系方式|联系人|联系电话|电话|手机|邮箱|邮编|QQ|微信|WeChat|VX|wx|qq)[:：\s]+[^。！？!?\n]{3,80}/giu,
  ],
  [
    'byline',
    /(?:^|\n)\s*(?:作者|编辑|记者|撰文|译者|校对|笔名|来源)[:：]\s*[\u4e00-\u9fa5A-Za-z·]{2,32}(?:\s|$)/gmu,
  ],
  [
    'identity-context',
    /(?:^|[。！？!?\n])\s*(?:我是|网名|笔名|posted\s+by)[:：\s]+[\u4e00-\u9fa5A-Za-z·]{2,32}(?:\s|$)/gimu,
  ],
];

const RELEASE_BOILERPLATE_PATTERNS: Array<[string, RegExp]> = [
  [
    'github-session-banner',
    /you (?:switched accounts|signed out|signed in).*reload to refresh your session/i,
  ],
  ['github-action-error', /you can[’']?t perform that action at this time/i],
  ['github-load-error', /there was an error while loading.*reload this page/i],
  ['mdn-feedback', /was this page helpful to you/i],
  [
    'rust-book-navigation',
    /press .* to (?:navigate between chapters|show this help|search in the book)/i,
  ],
  ['last-updated-utc', /last updated on .*utc/i],
  ['runoob-tagline', /菜鸟教程\s*--\s*学的不仅是技术/i],
  ['report-page', /查看此页面.*报告此内容的问题/i],
  ['auth-call-to-action', /^\s*(?:登录|注册|退出登录|忘记密码|log in|sign up)\s*$/imu],
];

const PLACEHOLDER_PATTERNS = [
  /\bsomeone(?:'s)?\b/i,
  /\ban organization\b/i,
  /某机构/u,
  /有人表示/u,
];

const DEFAULT_DENIED_PATH_PREFIXES = [
  '/login',
  '/logout',
  '/signup',
  '/register',
  '/account',
  '/settings',
  '/notifications',
];

export interface CorpusTextFinding {
  type: 'privacy' | 'boilerplate' | 'placeholder';
  rule: string;
}

export function assertApprovedWebSources(manifest: WebSourceManifest): void {
  const errors: string[] = [];
  for (const source of manifest.sources.filter((item) => item.enabled ?? true)) {
    const license = source.license;
    if (
      license?.status !== 'approved' ||
      !license.licenseId ||
      license.licenseId.toLowerCase() === 'unknown' ||
      !license.evidence
    ) {
      errors.push(`${source.id ?? source.url}: missing approved license provenance`);
    }
  }
  if (errors.length > 0) {
    throw new Error(`Web corpus provenance rejected:\n${errors.join('\n')}`);
  }
}

export function isAllowedCollectionUrl(urlValue: string, source: WebSourceConfig): boolean {
  let url: URL;
  let root: URL;
  try {
    url = new URL(urlValue);
    root = new URL(source.url);
  } catch {
    return false;
  }
  if (url.origin !== root.origin || !/^https?:$/.test(url.protocol)) return false;
  const pathname = url.pathname.toLowerCase();
  const denied = [...DEFAULT_DENIED_PATH_PREFIXES, ...(source.denyPathPrefixes ?? [])];
  if (denied.some((prefix) => pathname.startsWith(prefix.toLowerCase()))) return false;
  const allowed = source.allowPathPrefixes;
  if (allowed && allowed.length > 0) {
    return allowed.some((prefix) => pathname.startsWith(prefix.toLowerCase()));
  }
  return true;
}

export function findForbiddenCorpusText(text: string): CorpusTextFinding[] {
  const findings: CorpusTextFinding[] = [];
  RELEASE_BOILERPLATE_PATTERNS.forEach(([name, pattern]) => {
    pattern.lastIndex = 0;
    if (pattern.test(text)) findings.push({ type: 'boilerplate', rule: name });
  });
  RELEASE_PRIVACY_PATTERNS.forEach(([name, pattern]) => {
    pattern.lastIndex = 0;
    if (pattern.test(text)) findings.push({ type: 'privacy', rule: name });
  });
  PLACEHOLDER_PATTERNS.forEach((pattern, index) => {
    pattern.lastIndex = 0;
    if (pattern.test(text)) findings.push({ type: 'placeholder', rule: `placeholder-${index}` });
  });
  return findings;
}

export function normalizeCorpusFragment(text: string): string {
  return text.normalize('NFKC').toLowerCase().replace(/\s+/gu, '').trim();
}

export function nearDuplicateCorpusKey(text: string): string {
  return normalizeCorpusFragment(text).replace(/[\p{P}\p{S}\d]/gu, '');
}

export function sourceKey(url: string): string {
  return crypto.createHash('sha256').update(url).digest('hex').slice(0, 12);
}

export function safeSegment(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[^\w.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .toLowerCase();
}

export function resolveSourceDefaults(
  source: WebSourceConfig,
  manifest: Pick<WebSourceManifest, 'defaults'>,
): Required<Pick<WebSourceConfig, 'weight' | 'depth' | 'maxPages' | 'enabled'>> {
  return {
    weight: source.weight ?? manifest.defaults?.weight ?? 1,
    depth: source.depth ?? manifest.defaults?.depth ?? 0,
    maxPages: source.maxPages ?? manifest.defaults?.maxPages ?? 1,
    enabled: source.enabled ?? true,
  };
}

export function extractReadableText(html: string): string {
  const normalized = html
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[\s\S]*?<\/style>/gi, '')
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, '')
    .replace(/<svg\b[\s\S]*?<\/svg>/gi, '')
    .replace(/<form\b[\s\S]*?<\/form>/gi, '')
    .replace(/<pre\b[\s\S]*?<\/pre>/gi, '')
    .replace(/<code\b[\s\S]*?<\/code>/gi, '')
    .replace(/<nav\b[\s\S]*?<\/nav>/gi, '')
    .replace(/<footer\b[\s\S]*?<\/footer>/gi, '')
    .replace(/<aside\b[\s\S]*?<\/aside>/gi, '')
    .replace(/<header\b[\s\S]*?<\/header>/gi, '');

  const candidates = [
    ...matchSections(normalized, 'article'),
    ...matchSections(normalized, 'main'),
    ...matchClassSections(normalized),
    normalized,
  ];
  const best = candidates
    .map((candidate) => stripHtml(candidate))
    .sort((a, b) => scoreReadableText(b) - scoreReadableText(a))[0];
  return normalizePlainText(best ?? '');
}

export function extractSameOriginLinks(html: string, baseUrl: string): string[] {
  const base = new URL(baseUrl);
  const links = new Set<string>();
  const re = /<a\b[^>]*href=["']([^"']+)["'][^>]*>/gi;
  for (const match of html.matchAll(re)) {
    const href = match[1];
    if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) {
      continue;
    }
    try {
      const url = new URL(href, base);
      url.hash = '';
      if (url.origin === base.origin) links.add(url.toString());
    } catch {
      // Ignore malformed links from noisy pages.
    }
  }
  return [...links];
}

export function fragmentText(text: string, minLength = 20, maxLength = 120): string[] {
  const fragments: string[] = [];
  const blocks = normalizePlainText(text)
    .split(/\n{1,}/)
    .map((block) => block.trim())
    .filter(Boolean);

  for (const block of blocks) {
    const sentences = splitSentences(block);
    let current = '';
    for (const sentence of sentences) {
      const piece = sentence.trim();
      if (!piece) continue;
      if (piece.length > maxLength) {
        flushFragment(fragments, current, minLength, maxLength);
        current = '';
        for (const chunk of splitLongPiece(piece, maxLength)) {
          flushFragment(fragments, chunk, minLength, maxLength);
        }
        continue;
      }
      const next = current ? `${current}${piece}` : piece;
      if (next.length > maxLength) {
        flushFragment(fragments, current, minLength, maxLength);
        current = piece;
      } else {
        current = next;
      }
    }
    flushFragment(fragments, current, minLength, maxLength);
  }

  return dedupeFragments(fragments);
}

export function cleanFragment(fragment: string): CleanFragmentResult {
  const originalLength = fragment.length;
  const trimmed = normalizePlainText(fragment).trim();
  if (!trimmed) return { action: 'drop', text: '', hits: [], reason: 'empty', originalLength };
  if (BOILERPLATE_PATTERNS.some((pattern) => pattern.test(trimmed))) {
    return {
      action: 'drop',
      text: '',
      hits: ['boilerplate'],
      reason: 'boilerplate',
      originalLength,
    };
  }
  if (digitRatio(trimmed) > 0.3 || symbolRatio(trimmed) > 0.35) {
    return {
      action: 'drop',
      text: '',
      hits: [],
      reason: 'low-quality-ratio',
      originalLength,
    };
  }
  if (WEB_TONE_PATTERNS.some((pattern) => pattern.test(trimmed))) {
    return {
      action: 'drop',
      text: '',
      hits: ['web-tone'],
      reason: 'web-tone',
      originalLength,
    };
  }

  const scrubbed = scrubPrivacy(trimmed);
  if (scrubbed.action === 'drop') return { ...scrubbed, originalLength };
  if (scrubbed.text.length < 20 || scrubbed.text.length > 120) {
    return {
      action: 'drop',
      text: '',
      hits: scrubbed.hits,
      reason: 'length-after-scrub',
      originalLength,
    };
  }
  if (!hasLanguageSignal(scrubbed.text)) {
    return {
      action: 'drop',
      text: '',
      hits: scrubbed.hits,
      reason: 'weak-language-signal',
      originalLength,
    };
  }
  const language = detectFragmentLanguage(scrubbed.text);
  if (language === 'mixed') {
    return {
      action: 'drop',
      text: '',
      hits: scrubbed.hits,
      reason: 'mixed-language',
      originalLength,
      language,
    };
  }
  return { ...scrubbed, originalLength, language };
}

export function scrubPrivacy(fragment: string): ScrubResult {
  let text = fragment;
  const hits: string[] = [];

  for (const [name, pattern, replacement] of FIELD_PATTERNS) {
    pattern.lastIndex = 0;
    if (pattern.test(text)) {
      hits.push(name);
      pattern.lastIndex = 0;
      text = text.replace(pattern, replacement);
    }
  }

  const uniqueHits = new Set(hits);
  if (uniqueHits.size > 0) {
    return { action: 'drop', text: '', hits, reason: 'privacy-hit' };
  }

  const normalized = normalizePlainText(text)
    .replace(/\s{2,}/g, ' ')
    .replace(/[，,、：:；;]\s*([。！？!?])/g, '$1')
    .replace(/^[，,、：:；;\s]+|[，,、：:；;\s]+$/g, '')
    .trim();

  if (!normalized) return { action: 'drop', text: '', hits, reason: 'empty-after-scrub' };
  return { action: 'keep', text: normalized, hits };
}

export function buildCleanDocument(fragments: string[]): string {
  return `${shuffleDeterministic(dedupeFragments(fragments)).join('\n\n')}\n`;
}

export function detectFragmentLanguage(text: string): FragmentLanguage {
  const cjkCount = (text.match(/[\u3400-\u9fff]/gu) ?? []).length;
  const words = text.match(/[A-Za-z]{3,}/g) ?? [];
  const asciiCount = words.join('').length;

  if (cjkCount >= 4 && words.length >= 4) return 'mixed';
  if (cjkCount >= 4) return 'zh';
  if (words.length >= 4) return 'en';
  if (cjkCount > 0 && asciiCount > 0) return 'mixed';
  return 'unknown';
}

function matchSections(html: string, tag: string): string[] {
  const re = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}>`, 'gi');
  return [...html.matchAll(re)].map((match) => match[0]);
}

function matchClassSections(html: string): string[] {
  const re =
    /<(?:div|section)\b[^>]*(?:class|id)=["'][^"']*(?:article|content|post|entry|markdown-body|doc|page-content|main)[^"']*["'][^>]*>[\s\S]*?<\/(?:div|section)>/gi;
  return [...html.matchAll(re)].map((match) => match[0]);
}

function stripHtml(html: string): string {
  return decodeHtmlEntities(
    html
      .replace(/<(?:br|hr)\b[^>]*>/gi, '\n')
      .replace(/<\/(?:p|h[1-6]|li|blockquote|tr|div|section|article|main)>/gi, '\n')
      .replace(/<li\b[^>]*>/gi, '\n- ')
      .replace(/<[^>]+>/g, ' '),
  );
}

function decodeHtmlEntities(text: string): string {
  const named: Record<string, string> = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' ',
    copy: '',
    mdash: '。',
    ndash: '-',
    hellip: '…',
  };
  return text
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (_, entity: string) => {
      const key = entity.toLowerCase();
      if (key.startsWith('#x')) return String.fromCodePoint(Number.parseInt(key.slice(2), 16));
      if (key.startsWith('#')) return String.fromCodePoint(Number.parseInt(key.slice(1), 10));
      return named[key] ?? ' ';
    })
    .replace(/\u00a0/g, ' ');
}

function normalizePlainText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function scoreReadableText(text: string): number {
  const cjk = (text.match(/[\u3400-\u9fff]/g) ?? []).length;
  const words = (text.match(/[A-Za-z]{3,}/g) ?? []).length;
  return text.length + cjk * 2 + words * 3;
}

function splitSentences(block: string): string[] {
  const matches = block.match(/[^。！？!?；;\n]+[。！？!?；;]?/gu);
  return matches ?? [block];
}

function splitLongPiece(piece: string, maxLength: number): string[] {
  const parts = piece.split(/(?<=[，,、：:])\s*/u).filter(Boolean);
  const chunks: string[] = [];
  let current = '';
  for (const part of parts) {
    if (part.length > maxLength) {
      if (current) chunks.push(current);
      current = '';
      for (let i = 0; i < part.length; i += maxLength) chunks.push(part.slice(i, i + maxLength));
      continue;
    }
    const next = current ? `${current}${part}` : part;
    if (next.length > maxLength) {
      if (current) chunks.push(current);
      current = part;
    } else {
      current = next;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

function flushFragment(
  fragments: string[],
  value: string,
  minLength: number,
  maxLength: number,
): void {
  const text = normalizePlainText(value);
  if (text.length >= minLength && text.length <= maxLength) fragments.push(text);
}

function dedupeFragments(fragments: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const fragment of fragments) {
    const key = fragment.replace(/\s+/g, '').toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(fragment);
  }
  return result;
}

function shuffleDeterministic(fragments: string[]): string[] {
  const result = [...fragments];
  let state = 0x4d4c7633;
  for (let i = result.length - 1; i > 0; i--) {
    state = (state * 1664525 + 1013904223) >>> 0;
    const j = state % (i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function digitRatio(text: string): number {
  if (!text) return 0;
  return (text.match(/\d/g) ?? []).length / text.length;
}

function symbolRatio(text: string): number {
  if (!text) return 0;
  return (
    (text.match(/[^\w\s\u3400-\u9fff。！？；：，、（）《》“”‘’.-]/gu) ?? []).length / text.length
  );
}

function hasLanguageSignal(text: string): boolean {
  return /[\u3400-\u9fff]{4,}/u.test(text) || (text.match(/[A-Za-z]{3,}/g) ?? []).length >= 4;
}
