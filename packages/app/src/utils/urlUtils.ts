/**
 * URL 规范化工具
 *
 * 自动补全无协议头的链接，避免浏览器将其解析为相对路径。
 * 例如 www.bilibili.com → https://www.bilibili.com
 */

/**
 * 规范化 URL：无协议的裸域名自动补 https://。
 * 已带 http/https 或其他协议（mailto:/tel: 等）的链接原样通过。
 */
export function normalizeUrl(url: string): string {
  // Already has http/https protocol
  if (/^https?:\/\//i.test(url)) return url;
  // Has some other protocol (mailto:, tel:, ftp:, etc.)
  if (/^[a-z][a-z0-9+.-]*:/i.test(url)) return url;
  // Bare domain or www.xxx — prepend https://
  return 'https://' + url;
}
