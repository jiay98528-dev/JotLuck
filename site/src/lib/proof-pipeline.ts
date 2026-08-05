/**
 * 编辑器证明渲染管线（两段式）。
 *
 * SSR（Node 构建期）：marked + 本地镜像扩展直出。
 * 浏览器：@jotluck/renderer.renderMarkdown（marked + DOMPurify + highlight）真实清洗管线接管。
 *
 * 镜像说明：wikiLink/tag 两个 tokenizer 与 packages/renderer/src/marked-extensions.ts 保持 1:1
 * （该文件未从包入口导出，site 无法直接引用；上游改动必须同步回这里）。
 * 演示文档自洽：wikiLinkExists 恒 true（[[...]] 目标在演示笔记本中都存在）。
 */
import { marked, type TokenizerAndRendererExtension } from 'marked';

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(text: string): string {
  return text.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const wikiLinkExtension: TokenizerAndRendererExtension = {
  name: 'wikiLink',
  level: 'inline',
  start(src: string) {
    return src.indexOf('[[');
  },
  tokenizer(src: string) {
    const match = /^\[\[([^\]]+)\]\]/.exec(src);
    if (!match) return undefined;
    const parts = match[1]!.split('|');
    const target = parts[0]!.split('#');
    return {
      type: 'wikiLink',
      raw: match[0],
      text: parts[1] || target[0],
      note: target[0],
      anchor: target[1] || null,
    };
  },
  renderer(token) {
    const t = token as unknown as { text: string; note: string; anchor: string | null };
    return `<a class="wikilink" data-note="${escapeAttr(t.note)}" data-anchor="${escapeAttr(t.anchor || '')}">${escapeHtml(t.text)}</a>`;
  },
};

const tagExtension: TokenizerAndRendererExtension = {
  name: 'tag',
  level: 'inline',
  start(src: string) {
    return src.indexOf('#');
  },
  tokenizer(src: string) {
    const match = /^#([^\s#]+)/.exec(src);
    if (!match) return undefined;
    return { type: 'tag', raw: match[0], text: match[1] };
  },
  renderer(token) {
    const t = token as unknown as { text: string };
    return `<a class="md-tag" data-tag="${escapeAttr(t.text)}">#${escapeHtml(t.text)}</a>`;
  },
};

marked.use({ extensions: [wikiLinkExtension, tagExtension] });

/** 构建期（Node）直出：内容为仓库内静态可信母稿，无需 DOMPurify。 */
export function renderProofSsr(source: string): string {
  return marked.parse(source) as string;
}

/** 浏览器接管：真实清洗管线（marked + DOMPurify + highlight）。 */
export async function renderProofClient(source: string): Promise<string> {
  const { renderMarkdown } = await import('@jotluck/renderer');
  return renderMarkdown(source, {
    gfm: true,
    wikiLinks: true,
    tags: true,
    wikiLinkExists: () => true,
  });
}
