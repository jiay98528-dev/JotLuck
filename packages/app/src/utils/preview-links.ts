/**
 * preview-links — 预览区锚点 href 分类
 *
 * 供静态预览（NotebookHome）与改稿左栏（ReviewWorkbench）的点击委托共用：
 * WebView 内绝不允许「未 preventDefault 即放行」的路径，分类结果决定
 * preventDefault 之后是否移交系统浏览器打开。
 */

/** 带协议头的绝对外链（含 www. 前缀）。 */
const ABSOLUTE_URL_RE = /^(?:https?:\/\/|mailto:|tel:|ftp:|www\.)/i;

/** 无协议裸域名（example.com / example.com/path?query），normalizeUrl 会自动补 https://。 */
const BARE_DOMAIN_RE = /^(?:[a-z0-9-]+\.)+[a-z]{2,}(?:[/?#].*)?$/i;

/**
 * 根级裸文件名扩展集：末段（剥 #/? 后取末段）以这些扩展名结尾的 href 在
 * 预览语境是站内文件引用，不得落入 bare-domain（会被 normalizeUrl 补
 * https:// 当域名外抛——notes.md 会打开 https://notes.md 网站）。
 * 收敛来源：笔记扩展集 note-files.ts MARKDOWN_NOTE_EXTENSIONS/
 * PLAIN_TEXT_NOTE_EXTENSIONS（md/markdown/mdx/txt）+ 图片资产位图白名单
 * fs_ops.rs external_asset_extension（png/jpg/jpeg/gif/webp/bmp）+ PDF
 * 导出产物（ShareDialog/ExportDialog 的 .pdf）。
 */
const ROOT_FILENAME_EXTENSIONS = new Set([
  'md',
  'markdown',
  'mdx',
  'txt',
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'bmp',
  'pdf',
]);

/** 末段是否像根级裸文件名（含已知扩展、非点开头的隐藏文件形态）。 */
function looksLikeRootFilename(href: string): boolean {
  const pathOnly = href.split(/[?#]/)[0] ?? href;
  const lastSegment = pathOnly.split('/').pop() ?? href;
  const dotIndex = lastSegment.lastIndexOf('.');
  if (dotIndex <= 0) return false;
  return ROOT_FILENAME_EXTENSIONS.has(lastSegment.slice(dotIndex + 1).toLowerCase());
}

export type AnchorHrefClass = 'external' | 'bare-domain' | 'relative';

/**
 * 分类锚点 href：
 * - external：绝对外链 → 调用方 preventDefault + openExternalUrl；
 * - bare-domain：无协议裸域名 → 同上（urlUtils.normalizeUrl 自动补 https://）；
 * - relative：站内相对路径 → 调用方仅 preventDefault，不动作。
 */
export function classifyAnchorHref(href: string): AnchorHrefClass {
  if (ABSOLUTE_URL_RE.test(href)) return 'external';
  if (looksLikeRootFilename(href)) return 'relative';
  if (BARE_DOMAIN_RE.test(href)) return 'bare-domain';
  return 'relative';
}
