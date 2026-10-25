import { translate } from '@/i18n';

/** Windows/路径分隔层非法字符（含 / 与 \ 与控制符）：文件名入口消毒共用口径。 */
export const INVALID_FILE_NAME_CHARS = /[<>:"/\\|?*\u0000-\u001f]/g;

/**
 * 收集文件名中的非法字符（去重、按出现序）：供入口"报具体错误"——/ 不再
 * 静默建目录、Windows 非法字符不再落到底层 fs 的模糊报错。
 */
export function invalidFileNameCharsIn(value: string): string[] {
  return [...new Set(value.match(INVALID_FILE_NAME_CHARS) ?? [])];
}

/**
 * 文件名守卫：命中非法字符即返回本地化具体报错（列出字符），合法返回 null。
 * 新建笔记/重命名等用户输入入口共用；模板标题等非输入源用 sanitizeFileBasename。
 */
export function invalidFileNameError(value: string): string | null {
  const chars = invalidFileNameCharsIn(value);
  return chars.length > 0
    ? translate('notebook.error.invalidFileName', { chars: chars.join(' ') })
    : null;
}

function cleanHeadingText(value: string): string {
  return value
    .replace(/\[([^\]]+)]\([^)]+\)/g, '$1')
    .replace(/[`*_~#]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 文件名基名消毒：非法字符替空格、折叠空白、去尾点/空格、截断 80。 */
export function sanitizeFileBasename(value: string): string {
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

  const basename = sanitizeFileBasename(bestTitle) || translate('common.newMarkdownDocument');
  return `${basename}.md`;
}
