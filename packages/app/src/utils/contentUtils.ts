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
