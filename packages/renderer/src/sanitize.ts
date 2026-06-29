/**
 * DOMPurify security configuration for rendered Markdown.
 */
import createDOMPurify from 'dompurify';

let purifierInstance: ReturnType<typeof createDOMPurify> | null = null;

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
  ],
  ALLOW_DATA_ATTR: true,
  FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form'],
  FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover', 'onfocus', 'onblur'],
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

export function sanitize(html: string): string {
  return getPurifier().sanitize(html, purifyConfig);
}
