/**
 * DOMPurify 安全清洗配置
 *
 * 渲染管线第二步：marked 输出 → DOMPurify.sanitize → 安全 HTML
 * 阻断所有已知 XSS 攻击向量。
 *
 * @module sanitize
 * @see TAD.md §4.3
 */

import DOMPurify from 'dompurify';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const purifyConfig: Record<string, any> = {
  ALLOWED_TAGS: [
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'p',
    'br',
    'hr',
    'strong',
    'em',
    'del',
    's',
    'a',
    'img',
    'ul',
    'ol',
    'li',
    'blockquote',
    'pre',
    'code',
    'table',
    'thead',
    'tbody',
    'tr',
    'th',
    'td',
    'input', // 任务列表 checkbox
    'span',
    'div',
    'sup',
    'sub', // 上下标 / 脚注
    'details',
    'summary', // 折叠块
  ],
  ALLOWED_ATTR: [
    'href',
    'src',
    'alt',
    'class',
    'id',
    'data-note',
    'data-anchor',
    'data-tag', // MarkLuck 自定义属性
    'type',
    'checked',
    'disabled', // 任务列表
    'target',
    'rel',
  ],
  ALLOW_DATA_ATTR: true,
  FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form'],
  FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover', 'onfocus', 'onblur'],
};

/**
 * 清洗 HTML 字符串，移除所有恶意代码。
 * 必须在 marked 输出之后、DOM 插入之前执行。
 */
export function sanitize(html: string): string {
  return DOMPurify.sanitize(html, purifyConfig) as unknown as string;
}
