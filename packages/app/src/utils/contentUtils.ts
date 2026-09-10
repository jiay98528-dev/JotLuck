/** contentUtils — 内容安全扫描 + 错误人性化 @see migration-map.md §6 */

import { translate } from '@/i18n';
import { normalizeCommandError } from '@/services/command-errors';

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
        message: translate('program.zeroWidth', { code: cp.toString(16), position: i }),
        position: i,
      });
    }
    if (cp === 0x202a || cp === 0x202b || cp === 0x202c || cp === 0x202d || cp === 0x202e) {
      warnings.push({
        type: 'bidi-override',
        message: translate('program.bidiOverride', { code: cp.toString(16), position: i }),
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
  return normalizeCommandError(error).message;
}

/**
 * 笔记标题/文件名的 Unicode NFC 归一：macOS 文件系统以 NFD 存储
 * 韩文 Hangul、带音符拉丁文等文件名，而 IME 输入与 wiki 链接正文是
 * NFC——精确等值比较会把这些链接误判为死链。汉字无 canonical
 * decomposition 不受影响。比较前对两侧统一归一。
 */
export function normalizeNoteTitle(value: string): string {
  return value.normalize('NFC');
}
