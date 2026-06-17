/** contentUtils — 内容安全扫描 + 错误人性化 @see migration-map.md §6 */

export interface ContentWarning {
  type: 'zero-width' | 'bidi-override' | 'control-char';
  message: string;
  position?: number;
}

export function scanContentWarnings(content: string): ContentWarning[] {
  const warnings: ContentWarning[] = [];
  for (let i = 0; i < content.length; i++) {
    const c = content[i]!;
    const cp = c.codePointAt(0)!;
    if (cp === 0x200b || cp === 0x200c || cp === 0x200d || cp === 0xfeff) {
      warnings.push({
        type: 'zero-width',
        message: `检测到零宽字符 (U+${cp.toString(16)}) 在位置 ${i}`,
        position: i,
      });
    }
    if (cp === 0x202a || cp === 0x202b || cp === 0x202c || cp === 0x202d || cp === 0x202e) {
      warnings.push({
        type: 'bidi-override',
        message: `检测到双向文本覆盖字符 (U+${cp.toString(16)}) 在位置 ${i}`,
        position: i,
      });
    }
  }
  return warnings;
}

export function hasRTLContent(content: string): boolean {
  return /[֐-ࣿיִ-﷿ﹰ-ﻼ]/.test(content);
}

export function humanizeError(error: unknown): string {
  if (error instanceof Error) {
    const msg = error.message;
    if (msg.includes('文件不存在')) return '文件不存在，可能已被移动或删除';
    if (msg.includes('权限')) return '没有访问权限，请检查文件权限设置';
    if (msg.includes('空间不足') || msg.includes('磁盘')) return '磁盘空间不足，请清理后重试';
    if (msg.includes('路径')) return '文件路径无效';
    return msg;
  }
  return String(error);
}
