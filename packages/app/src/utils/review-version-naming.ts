/**
 * 改稿模式版本化导出命名 — `${stem} ${datePart}${prefix}${paddedNum}.md`。
 *
 * 递进规则：扫描导出目录既有文件名，识别
 *   `${stem} `(可选 `YYYY-MM-DD ` 日期段)`${prefix}`(1-6 位数字)`.md`
 * 的既有版本，取 max(最大既有号, start - 1) + 1；无匹配时用 start。
 * stem 与 prefix 一律按字面量参与识别（正则元字符转义），
 * 如「C++ 笔记」不会被「C+ +笔记」类模式误配，无关文件名不干扰递进。
 */

import type { ReviewVersionRule } from './review-types';

/** 正则元字符转义（stem/前缀必须字面量匹配） */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 既有版本文件识别：stem 空格 + 可选日期段 + 前缀 + 1-6 位数字 + .md（锚定全名） */
function buildExistingNamePattern(stem: string, prefix: string): RegExp {
  return new RegExp(
    `^${escapeRegExp(stem)} (?:\\d{4}-\\d{2}-\\d{2} )?${escapeRegExp(prefix)}(\\d{1,6})\\.md$`,
  );
}

/** 本地时区日期段：`YYYY-MM-DD `（含尾随空格；includeDate=false 时为空串） */
function datePartOf(rule: ReviewVersionRule, today: Date): string {
  if (!rule.includeDate) return '';
  const year = String(today.getFullYear()).padStart(4, '0');
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
  return `${year}-${month}-${day} `;
}

/** 版本化文件名预览（导出卡片实时展示用；不做目录扫描） */
export function formatReviewVersionPreview(
  stem: string,
  rule: ReviewVersionRule,
  num: number,
  today = new Date(),
): string {
  const paddedNum = String(num).padStart(rule.padding, '0');
  return `${stem} ${datePartOf(rule, today)}${rule.prefix}${paddedNum}.md`;
}

/** 基于目录既有文件名计算下一个版本化导出文件名 */
export function nextReviewVersionFileName(
  stem: string,
  existingNames: readonly string[],
  rule: ReviewVersionRule,
  today = new Date(),
): string {
  const pattern = buildExistingNamePattern(stem, rule.prefix);
  let maxSeen = 0;
  for (const name of existingNames) {
    const match = pattern.exec(name);
    if (match) maxSeen = Math.max(maxSeen, Number(match[1]!));
  }
  const next = Math.max(maxSeen, rule.start - 1) + 1;
  return formatReviewVersionPreview(stem, rule, next, today);
}
