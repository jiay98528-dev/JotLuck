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
 * URI 协议白名单沿用 DOMPurify 3.x 默认 IS_ALLOWED_URI（http/https/mailto/tel/
 * callto/sms/cid/xmpp/matrix 等），不再覆写。资产图走 blob: object URL（文档导入
 * reader 经 read_document_conversion_asset 二进制回流换装短引用）；blob: 默认
 * 剥除，仅调用方显式 allowBlobImageSources 时放行 img src 的合法形态（见
 * BLOB_URL_RE 字符类校验），其余标签属性一律仍按默认拒收。data: 由
 * DATA_URI_TAGS 默认放行；javascript:/file:/ftp: 等其余协议仍被拒绝。
 */

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

/** Per-call relaxation switches for sanitize(); every flag defaults to fail-closed. */
export interface SanitizeOptions {
  /** Expose renderer-owned remote-image controls (button + reserved data attrs). */
  remoteImageControls?: boolean;
  /** Allow blob: object URLs as <img src>. Missing flag keeps the default strip. */
  allowBlobImageSources?: boolean;
}

/**
 * object URL 仅接受 blob: + 受限字符集（origin 序列化 + UUID：字母/数字与
 * .:/- ，无引号/空白/百分号等注入面）；非法形态不救，落回默认剥除路径。
 */
const BLOB_URL_RE = /^blob:[A-Za-z0-9.:/-]+$/u;

// 模块同步开关：purifier 钩子注册在单例上，按调用传参只能经模块状态同步。
// sanitize 全程同步、写入即生效；finally 复位保证未声明开关的调用恒 fail-closed。
let blobImageSourcesAllowed = false;

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
  // blob: 不在 DOMPurify 默认 URI 白名单内（默认剥除）。仅当调用方按调用放行
  // 且 IMG src 形态合法时强制保留该属性（forceKeepAttr 跳过 URI 白名单复查）；
  // a href 等其余标签属性不经过此分支，blob: 链接仍被默认拒收。
  purifierInstance.addHook('uponSanitizeAttribute', (node, data) => {
    if (
      !blobImageSourcesAllowed ||
      node.nodeName !== 'IMG' ||
      data.attrName !== 'src' ||
      !data.attrValue.startsWith('blob:') ||
      !BLOB_URL_RE.test(data.attrValue)
    ) {
      return;
    }
    data.forceKeepAttr = true;
  });

  return purifierInstance;
}

export function sanitize(html: string, opts: SanitizeOptions = {}): string {
  const purifier = getPurifier();
  const previousBlobAllowed = blobImageSourcesAllowed;
  blobImageSourcesAllowed = opts.allowBlobImageSources === true;
  try {
    return purifier.sanitize(
      html,
      opts.remoteImageControls
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
  } finally {
    blobImageSourcesAllowed = previousBlobAllowed;
  }
}
