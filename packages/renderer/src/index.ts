/**
 * @jotluck/renderer — Markdown 渲染管线入口
 *
 * Markdown text → marked parse (with extensions) → DOMPurify sanitize → safe HTML
 *                                                                    ↓
 *                                              highlight.js ← DOM insert ←
 *
 * Shared by @jotluck/app (main editor) and @jotluck/vscode-ext (VS Code webview).
 *
 * @see TAD.md §4
 */

import { marked } from 'marked';
import { jotluckExtensions, setWikiLinkExistsResolver } from './marked-extensions';
import { sanitize } from './sanitize';
import { highlightCodeBlocks } from './highlight';
import { normalizeFullwidthMarkdownSyntaxForRender, headingIdFromText } from './syntax';
import { protectBareJsonBlocks } from './bare-json';
import type { RemoteImageLabels, RemoteImagePolicy, RendererOptions } from './types';

// 语法规则 / 裸 JSON / 块级 AST 已单点化到独立模块，此处整体 re-export（包公共面只增不减）。
export {
  normalizeFullwidthMarkdownSyntax,
  normalizeFullwidthMarkdownSyntaxForRender,
  headingIdFromText,
  findTagStart,
  parseWikiLinkTarget,
  splitTableCells,
  isTableSeparatorLine,
  isTableRowCandidate,
  tableAlignments,
  tableGridTemplate,
  TAG_GLOBAL_RE,
  TAG_TOKEN_RE,
  WIKI_LINK_GLOBAL_RE,
  WIKI_LINK_TOKEN_RE,
} from './syntax';
export type { WikiLinkTarget } from './syntax';
export { findBareJsonBlockLineRanges } from './bare-json';
export type { BareJsonBlockRange } from './bare-json';
export { parseDocument, blockAtLine } from './ast';
export type {
  BlockNode,
  BlockquoteLineInfo,
  BlockquoteNode,
  BlankNode,
  CodeFenceNode,
  DocumentAst,
  FrontmatterNode,
  HeadingNode,
  HorizontalRuleNode,
  JsonBlockNode,
  LineInfo,
  ListItemKind,
  ListItemNode,
  ParagraphNode,
  RefDefinitionNode,
  SourceRange,
  TableCell,
  TableNode,
  TableRowNode,
} from './ast';
export { extractIndexFacts, extractTags, stripToPlainText } from './inline';
export type { IndexFacts, StripToPlainTextOptions } from './inline';
export { lexInlineTokens } from './inline-tokens';
export type { InlineToken } from './inline-tokens';

const DEFAULT_REMOTE_IMAGE_LABELS: RemoteImageLabels = {
  blocked: 'Remote image blocked',
  source: 'Source',
  loadAll: 'Load remote images in this note',
  loading: 'Loading image…',
  failed: 'Image failed to load',
  retry: 'Retry',
  insecure: 'Insecure HTTP image blocked',
  unnamed: 'Image',
};

type ClassifiedRemoteImage =
  | { kind: 'https'; source: string; host: string }
  | { kind: 'http'; source: string; host: string }
  | { kind: 'invalid'; source: string; host: string }
  | { kind: 'local' };

function classifyRemoteImage(source: string): ClassifiedRemoteImage {
  const trimmed = source.trim();
  const candidate = trimmed.startsWith('//') ? `https:${trimmed}` : trimmed;
  try {
    const url = new URL(candidate);
    if (url.protocol === 'data:' || url.protocol === 'blob:') return { kind: 'local' };
    if (url.username || url.password) {
      return { kind: 'invalid', source: candidate, host: url.host || url.protocol };
    }
    if (url.protocol === 'https:') return { kind: 'https', source: url.href, host: url.host };
    if (url.protocol === 'http:') return { kind: 'http', source: url.href, host: url.host };
    return { kind: 'invalid', source: candidate, host: url.host || url.protocol };
  } catch {
    // Relative and host-resolved sources are handled by the local image resolver below.
  }
  return { kind: 'local' };
}

function appendRemoteImageCopy(
  wrapper: HTMLElement,
  alt: string,
  host: string,
  message: string,
  labels: RemoteImageLabels,
): void {
  const title = document.createElement('span');
  title.className = 'remote-image-placeholder__title';
  title.textContent = alt || labels.unnamed;
  const detail = document.createElement('span');
  detail.className = 'remote-image-placeholder__detail';
  detail.textContent = `${message} · ${labels.source}: ${host}`;
  wrapper.append(title, detail);
}

function createRemoteImagePlaceholder(
  image: HTMLImageElement,
  remote: Extract<ClassifiedRemoteImage, { kind: 'https' | 'http' | 'invalid' }>,
  policy?: RemoteImagePolicy,
): HTMLElement {
  const labels = policy?.labels ?? DEFAULT_REMOTE_IMAGE_LABELS;
  const decision =
    remote.kind === 'https' ? (policy?.decide(remote.source) ?? 'blocked') : 'blocked';
  const wrapper = document.createElement('span');
  wrapper.className = `remote-image-placeholder remote-image-placeholder--${
    remote.kind === 'http' || remote.kind === 'invalid' ? 'insecure' : decision
  }`;
  wrapper.setAttribute('role', 'group');
  appendRemoteImageCopy(
    wrapper,
    image.alt,
    remote.host,
    remote.kind === 'http'
      ? labels.insecure
      : remote.kind === 'invalid'
        ? labels.blocked
        : decision === 'failed'
          ? labels.failed
          : labels.blocked,
    labels,
  );
  if (remote.kind === 'https') {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'remote-image-placeholder__action';
    button.dataset.remoteImageControl = 'v1';
    button.dataset.remoteImageAction = decision === 'failed' ? 'retry' : 'load-all';
    button.dataset.remoteImageSource = remote.source;
    if (policy?.scopeId) button.dataset.remoteImageScope = policy.scopeId;
    button.textContent = decision === 'failed' ? labels.retry : labels.loadAll;
    wrapper.append(button);
  }
  return wrapper;
}

function createAllowedRemoteImage(
  image: HTMLImageElement,
  remote: Extract<ClassifiedRemoteImage, { kind: 'https' }>,
  labels: RemoteImageLabels,
  scopeId: string,
): HTMLElement {
  const allowedImage = image.cloneNode(true) as HTMLImageElement;
  const wrapper = document.createElement('span');
  wrapper.className = 'remote-image remote-image--loading';
  wrapper.dataset.remoteImageSource = remote.source;
  if (scopeId) wrapper.dataset.remoteImageScope = scopeId;
  const status = document.createElement('span');
  status.className = 'remote-image__status';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  status.textContent = labels.loading;
  allowedImage.src = remote.source;
  allowedImage.setAttribute('referrerpolicy', 'no-referrer');
  allowedImage.dataset.remoteImageSource = remote.source;
  allowedImage.dataset.remoteImageControl = 'v1';
  if (scopeId) allowedImage.dataset.remoteImageScope = scopeId;
  wrapper.append(status, allowedImage);
  return wrapper;
}

function applyImagePolicy(html: string, options?: RendererOptions): string {
  const template = document.createElement('template');
  template.innerHTML = html;
  for (const image of template.content.querySelectorAll('img')) {
    const source = image.getAttribute('src') ?? '';
    if (!source) continue;
    const remote = classifyRemoteImage(source);
    if (remote.kind === 'https') {
      const decision = options?.remoteImages?.decide(remote.source) ?? 'blocked';
      image.replaceWith(
        decision === 'allowed'
          ? createAllowedRemoteImage(
              image,
              remote,
              options?.remoteImages?.labels ?? DEFAULT_REMOTE_IMAGE_LABELS,
              options?.remoteImages?.scopeId ?? '',
            )
          : createRemoteImagePlaceholder(image, remote, options?.remoteImages),
      );
      continue;
    }
    if (remote.kind === 'http' || remote.kind === 'invalid') {
      image.replaceWith(createRemoteImagePlaceholder(image, remote, options?.remoteImages));
      continue;
    }
    if (!options?.resolveImageSrc) continue;
    let resolved: string | null = null;
    try {
      resolved = options.resolveImageSrc(source);
    } catch {
      resolved = null;
    }
    if (resolved === null) image.removeAttribute('src');
    else image.setAttribute('src', resolved);
  }
  return template.innerHTML;
}

function addHeadingIds(html: string, source: string): string {
  // 锚点 id 注入的是 marked 产出的 HTML，必须跟随渲染引擎自己的 token 序列
  //（含引用/列表内嵌标题、缩进 ATX 等边界形态），否则配对错位、张冠李戴。
  // 结构性消费（大纲/索引/编辑器）走 AST；此处与渲染同引擎是刻意取舍（R1-C3）。
  const headings: string[] = [];
  marked.walkTokens(marked.lexer(source), (token) => {
    if (token.type === 'heading') headings.push(token.text);
  });
  const occurrences = new Map<string, number>();
  let index = 0;
  return html.replace(/<h([1-6])>/g, (_match, depth: string) => {
    const text = headings[index++] ?? `heading-${index}`;
    const base = headingIdFromText(text);
    const occurrence = (occurrences.get(base) ?? 0) + 1;
    occurrences.set(base, occurrence);
    return `<h${depth} id="${headingIdFromText(text, occurrence)}">`;
  });
}

// 配置 marked 使用 JotLuck 自定义扩展
marked.use({ extensions: jotluckExtensions });

// 启用 GFM (GitHub Flavored Markdown: 表格、任务列表、删除线等)
marked.setOptions({ gfm: true, breaks: false });

/**
 * 渲染 Markdown 字符串为安全 HTML。
 *
 * 管线流程：
 *   1. marked.parse(source) — Markdown → HTML（含 Wiki-link + #tag 扩展）
 *   2. sanitize(html)       — 清洗 Markdown 与原始 HTML
 *   3. applyImagePolicy     — 统一处理 Markdown/HTML 图片与远程隐私策略
 *   4. sanitize(html)       — 再清洗宿主解析结果和生成的占位控件
 *   5. (DOM insert)         — 由调用方插入 DOM
 *   6. highlightCodeBlocks  — 对 <pre><code> 执行语法高亮
 *
 * @param source - Raw Markdown source text
 * @param options - Renderer options, including host-provided image resolution
 * @returns Rendered safe HTML string
 */
export function renderMarkdown(source: string, options?: RendererOptions): string {
  // Step 1: Parse with the custom extensions. Image policy is applied to the
  // complete sanitized DOM so raw HTML <img> cannot bypass the host contract.
  const normalizedSource = protectBareJsonBlocks(normalizeFullwidthMarkdownSyntaxForRender(source));
  setWikiLinkExistsResolver(options?.wikiLinkExists ?? null);
  let rawHtml: string;
  try {
    rawHtml = marked.parse(normalizedSource, {
      async: false,
    }) as string;
  } finally {
    setWikiLinkExistsResolver(null);
  }

  const initiallyCleanHtml = sanitize(addHeadingIds(rawHtml, normalizedSource));
  const cleanHtml = sanitize(applyImagePolicy(initiallyCleanHtml, options), true);

  return cleanHtml;
}

/**
 * 对已插入 DOM 的 HTML 容器执行代码高亮。
 * 必须在 mounted/updated 生命周期中调用。
 */
export { highlightCodeBlocks };

export type {
  RemoteImageDecision,
  RemoteImageLabels,
  RemoteImagePolicy,
  RendererOptions,
  RenderResult,
} from './types';
