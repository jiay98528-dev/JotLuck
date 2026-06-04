/**
 * M7-03: Content safety & character utilities
 *
 * Detects potentially problematic characters in Markdown content:
 * - Zero-width characters (invisible but affect editing)
 * - Bidirectional text override characters (security risk)
 * - Mixed RTL/LTR content
 */

/** Characters that might cause editing confusion */
const ZERO_WIDTH_CHARS = /[​‌‍﻿­⁠]/g;
const BIDI_OVERRIDE_CHARS = /[‪‫‬‭‮⁦⁧⁨⁩]/g;

/** Warning severity */
export type ContentWarning = {
  type: 'zero-width' | 'bidi-override' | 'large-file';
  message: string;
  count: number;
};

/** Scan content for problematic characters */
export function scanContentWarnings(content: string): ContentWarning[] {
  const warnings: ContentWarning[] = [];

  const zwMatches = content.match(ZERO_WIDTH_CHARS);
  if (zwMatches && zwMatches.length > 0) {
    warnings.push({
      type: 'zero-width',
      message: `检测到 ${zwMatches.length} 个零宽字符（不可见），可能导致编辑异常。`,
      count: zwMatches.length,
    });
  }

  const bidiMatches = content.match(BIDI_OVERRIDE_CHARS);
  if (bidiMatches && bidiMatches.length > 0) {
    warnings.push({
      type: 'bidi-override',
      message: `检测到 ${bidiMatches.length} 个双向文本覆盖字符，存在安全风险。`,
      count: bidiMatches.length,
    });
  }

  return warnings;
}

/** Check if content contains RTL scripts (Arabic, Hebrew, etc.) */
export function hasRTLContent(content: string): boolean {
  // Unicode RTL script ranges
  const rtlRegex = /[֐-׿؀-ۿ܀-ݏݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/;
  return rtlRegex.test(content);
}

/**
 * M7-05: Map technical error messages to user-friendly Chinese messages.
 */
export function humanizeError(error: unknown): string {
  const msg = error instanceof Error ? error.message : String(error);

  // Common file system errors
  if (msg.includes('ENOSPC') || msg.includes('磁盘') || msg.includes('disk full')) {
    return '磁盘空间不足，无法保存文件。请清理磁盘后重试。';
  }
  if (msg.includes('EACCES') || msg.includes('permission') || msg.includes('权限')) {
    return '没有权限访问此文件。请检查文件权限设置。';
  }
  if (msg.includes('ENOENT') || msg.includes('不存在') || msg.includes('not found')) {
    return '文件不存在或已被移动/删除。';
  }
  if (msg.includes('PathTraversal') || msg.includes('超出')) {
    return '路径不安全，文件操作被拒绝。';
  }
  if (msg.includes('未打开笔记本') || msg.includes('notebook')) {
    return '请先打开一个笔记本文件夹。';
  }

  // Default: return the original message
  return msg;
}
