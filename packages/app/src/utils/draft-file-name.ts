const FALLBACK_DRAFT_BASENAME = '新MD文档';
const INVALID_FILE_NAME_CHARS = /[<>:"/\\|?*\u0000-\u001f]/g;

function cleanHeadingText(value: string): string {
  return value
    .replace(/\[([^\]]+)]\([^)]+\)/g, '$1')
    .replace(/[`*_~#]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function sanitizeFileBasename(value: string): string {
  return value
    .replace(INVALID_FILE_NAME_CHARS, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '')
    .slice(0, 80)
    .trim();
}

export function getDraftMarkdownFileName(content: string): string {
  const headingPattern = /^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/gm;
  let bestLevel = 7;
  let bestTitle = '';

  for (const match of content.matchAll(headingPattern)) {
    const marker = match[1] ?? '';
    const rawTitle = match[2] ?? '';
    const level = marker.length;
    const title = cleanHeadingText(rawTitle);

    if (title && level < bestLevel) {
      bestLevel = level;
      bestTitle = title;
      if (level === 1) break;
    }
  }

  const basename = sanitizeFileBasename(bestTitle) || FALLBACK_DRAFT_BASENAME;
  return `${basename}.md`;
}
