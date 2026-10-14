import { describe, expect, it } from 'vitest';

import { DEFAULT_REVIEW_VERSION_RULE, type ReviewVersionRule } from '../review-types';
import { formatReviewVersionPreview, nextReviewVersionFileName } from '../review-version-naming';

// 固定「今天」：本地时区 2026-10-14（月份 0 基，9 = 十月）
const TODAY = new Date(2026, 9, 14);

describe('nextReviewVersionFileName', () => {
  it('空目录 → 默认 V1 起步', () => {
    expect(nextReviewVersionFileName('笔记', [], DEFAULT_REVIEW_VERSION_RULE, TODAY)).toBe(
      '笔记 V1.md',
    );
  });

  it('已有 V1/V2/V3 → 下一个 V4', () => {
    const existing = ['笔记 V3.md', '笔记 V1.md', '笔记 V2.md'];
    expect(nextReviewVersionFileName('笔记', existing, DEFAULT_REVIEW_VERSION_RULE, TODAY)).toBe(
      '笔记 V4.md',
    );
  });

  it('自定义前缀「修订」', () => {
    const rule: ReviewVersionRule = { prefix: '修订', start: 1, padding: 1, includeDate: false };
    expect(nextReviewVersionFileName('草稿', [], rule, TODAY)).toBe('草稿 修订1.md');
    expect(nextReviewVersionFileName('草稿', ['草稿 修订1.md'], rule, TODAY)).toBe('草稿 修订2.md');
  });

  it('padding=2 → V01 两位补零，识别不受补零影响', () => {
    const rule: ReviewVersionRule = { prefix: 'V', start: 1, padding: 2, includeDate: false };
    expect(nextReviewVersionFileName('笔记', [], rule, TODAY)).toBe('笔记 V01.md');
    expect(nextReviewVersionFileName('笔记', ['笔记 V01.md'], rule, TODAY)).toBe('笔记 V02.md');
  });

  it('start=5 → 空目录从 V5 起；既有更大号优先', () => {
    const rule: ReviewVersionRule = { prefix: 'V', start: 5, padding: 1, includeDate: false };
    expect(nextReviewVersionFileName('笔记', [], rule, TODAY)).toBe('笔记 V5.md');
    // 既有号小于 start - 1 时仍从 start 起
    expect(nextReviewVersionFileName('笔记', ['笔记 V2.md'], rule, TODAY)).toBe('笔记 V5.md');
    // 既有最大号超过 start - 1 时按最大号递进
    expect(nextReviewVersionFileName('笔记', ['笔记 V7.md'], rule, TODAY)).toBe('笔记 V8.md');
  });

  it('includeDate：命名含本地日期段，识别跨日期累计', () => {
    const rule: ReviewVersionRule = { prefix: 'V', start: 1, padding: 1, includeDate: true };
    expect(nextReviewVersionFileName('笔记', [], rule, TODAY)).toBe('笔记 2026-10-14 V1.md');
    const existing = ['笔记 2026-10-13 V1.md', '笔记 2026-10-14 V2.md', '笔记 V7.md'];
    expect(nextReviewVersionFileName('笔记', existing, rule, TODAY)).toBe('笔记 2026-10-14 V8.md');
  });

  it('stem 含正则元字符（C++ 笔记）不误配', () => {
    expect(nextReviewVersionFileName('C++ 笔记', [], DEFAULT_REVIEW_VERSION_RULE, TODAY)).toBe(
      'C++ 笔记 V1.md',
    );
    const existing = ['C++ 笔记 V1.md', 'C 笔记 V9.md', 'C+ 笔记 V5.md', 'C+++ 笔记 V99.md'];
    expect(
      nextReviewVersionFileName('C++ 笔记', existing, DEFAULT_REVIEW_VERSION_RULE, TODAY),
    ).toBe('C++ 笔记 V2.md');
  });

  it('无关文件名不干扰递进', () => {
    const existing = [
      'random.md',
      '笔记 V2.txt',
      '笔记x V9.md',
      '笔记 V99 备份.md',
      '副本 笔记 V5.md',
      '笔记V3.md',
    ];
    expect(nextReviewVersionFileName('笔记', existing, DEFAULT_REVIEW_VERSION_RULE, TODAY)).toBe(
      '笔记 V1.md',
    );
  });
});

describe('formatReviewVersionPreview', () => {
  it('与 nextReviewVersionFileName 同格式', () => {
    expect(formatReviewVersionPreview('笔记', DEFAULT_REVIEW_VERSION_RULE, 3, TODAY)).toBe(
      '笔记 V3.md',
    );
    const padded: ReviewVersionRule = { prefix: 'V', start: 1, padding: 2, includeDate: false };
    expect(formatReviewVersionPreview('笔记', padded, 3, TODAY)).toBe('笔记 V03.md');
    const dated: ReviewVersionRule = { prefix: 'V', start: 1, padding: 1, includeDate: true };
    expect(formatReviewVersionPreview('笔记', dated, 12, TODAY)).toBe('笔记 2026-10-14 V12.md');
  });

  it('版本号超出补零位数时不截断', () => {
    const padded: ReviewVersionRule = { prefix: 'V', start: 1, padding: 2, includeDate: false };
    expect(formatReviewVersionPreview('笔记', padded, 123, TODAY)).toBe('笔记 V123.md');
  });
});
