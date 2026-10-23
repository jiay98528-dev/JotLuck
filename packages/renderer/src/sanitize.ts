/**
 * DOMPurify security configuration for rendered Markdown.
 */
import createDOMPurify from 'dompurify';

let purifierInstance: ReturnType<typeof createDOMPurify> | null = null;

const REMOTE_IMAGE_RESERVED_ATTRS = [
  'data-remote-image-action',
  'data-remote-image-control',
  'data-remote-image-scope',
  'data-remote-image-source',
] as const;

/**
 * 在 DOMPurify 3.x 默认 IS_ALLOWED_URI 的基础上仅追加 blob: 协议：应用自身经
 * URL.createObjectURL 生成的资源对象 URL（文档导入资产图）需要可渲染，与各窗口
 * CSP img-src 已放行的 blob: 口径一致，也与 data: 图片（DATA_URI_TAGS 默认放行）
 * 同级——blob 仅限本源、不可执行。javascript:/file:/ftp: 等其余协议仍被拒绝。
 */
const ALLOWED_URI_REGEXP =
  /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|xmpp|matrix|blob):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i;

const purifyConfig = {
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
    'input',
    'span',
    'div',
    'sup',
    'sub',
    // DOCX 导入把下划线 run 映射为 <u> 内联 HTML（document_import.rs
    // apply_docx_run_format），与 <sup>/<sub> 同为排版级内联标签，放行使
    // 下划线在预览端闭合为可见样式（无属性、不可执行）。
    'u',
    'details',
    'summary',
  ],
  ALLOWED_ATTR: [
    'href',
    'src',
    'alt',
    'class',
    'id',
    'data-note',
    'data-anchor',
    'data-tag',
    'type',
    'checked',
    'disabled',
    'target',
    'rel',
    'role',
    'aria-label',
    'aria-live',
    'referrerpolicy',
    'align',
  ],
  ALLOWED_URI_REGEXP,
  ALLOW_DATA_ATTR: true,
  FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form'],
  FORBID_ATTR: [
    'onerror',
    'onload',
    'onclick',
    'onmouseover',
    'onfocus',
    'onblur',
    ...REMOTE_IMAGE_RESERVED_ATTRS,
  ],
};

function getPurifier(): ReturnType<typeof createDOMPurify> {
  if (purifierInstance) {
    return purifierInstance;
  }

  if (typeof window === 'undefined') {
    throw new Error('DOMPurify requires a browser DOM window.');
  }

  purifierInstance = createDOMPurify(window);
  // Marked's GFM renderer adds disabled="" to all task list checkboxes.
  // Remove it during sanitization so live preview task boxes can stay interactive.
  purifierInstance.addHook('beforeSanitizeElements', (node) => {
    if (node.nodeName === 'INPUT' && (node as Element).getAttribute('type') === 'checkbox') {
      (node as Element).removeAttribute('disabled');
    }
  });

  return purifierInstance;
}

export function sanitize(html: string, allowRemoteImageControls = false): string {
  return getPurifier().sanitize(
    html,
    allowRemoteImageControls
      ? {
          ...purifyConfig,
          ALLOWED_TAGS: [...purifyConfig.ALLOWED_TAGS, 'button'],
          FORBID_ATTR: purifyConfig.FORBID_ATTR.filter(
            (attribute) =>
              !REMOTE_IMAGE_RESERVED_ATTRS.includes(
                attribute as (typeof REMOTE_IMAGE_RESERVED_ATTRS)[number],
              ),
          ),
        }
      : purifyConfig,
  );
}
