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

export type AnchorHrefClass = 'external' | 'bare-domain' | 'relative';

/**
 * 分类锚点 href：
 * - external：绝对外链 → 调用方 preventDefault + openExternalUrl；
 * - bare-domain：无协议裸域名 → 同上（urlUtils.normalizeUrl 自动补 https://）；
 * - relative：站内相对路径 → 调用方仅 preventDefault，不动作。
 */
export function classifyAnchorHref(href: string): AnchorHrefClass {
  if (ABSOLUTE_URL_RE.test(href)) return 'external';
  if (BARE_DOMAIN_RE.test(href)) return 'bare-domain';
  return 'relative';
}
