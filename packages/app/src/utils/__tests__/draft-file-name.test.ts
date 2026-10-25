import { describe, expect, it } from 'vitest';
import {
  getDraftMarkdownFileName,
  invalidFileNameCharsIn,
  invalidFileNameError,
  sanitizeFileBasename,
} from '../draft-file-name';

describe('getDraftMarkdownFileName', () => {
  it('uses the highest-level markdown heading as default file name', () => {
    expect(getDraftMarkdownFileName('### 小节\n\n## 章节\n\n正文')).toBe('章节.md');
  });

  it('prefers the first H1 when present', () => {
    expect(getDraftMarkdownFileName('## 章节\n\n# 总标题\n\n# 第二标题')).toBe('总标题.md');
  });

  it('falls back when no heading exists', () => {
    expect(getDraftMarkdownFileName('只有正文，没有标题')).toBe('新MD文档.md');
  });

  it('removes markdown markers and invalid file-system characters', () => {
    expect(getDraftMarkdownFileName('# **项目**: [Alpha](https://example.com) / 计划?')).toBe(
      '项目 Alpha 计划.md',
    );
  });
});

describe('文件名入口守卫（E2）：invalidFileNameCharsIn / invalidFileNameError', () => {
  it('收集 / 与 Windows 非法字符（去重、按出现序），供具体报错', () => {
    expect(invalidFileNameCharsIn('a/b:c*?d')).toEqual(['/', ':', '*', '?']);
    expect(invalidFileNameCharsIn('x<<>>y')).toEqual(['<', '>']);
    expect(invalidFileNameCharsIn('合法名')).toEqual([]);
  });

  it('invalidFileNameError 命中即返回含具体字符的本地化报错，合法返回 null', () => {
    // setup-i18n beforeEach 已置 zh-CN；断言含字符子串即可，不钉整句文案
    expect(invalidFileNameError('子目录/笔记:名')).toContain('/');
    expect(invalidFileNameError('子目录/笔记:名')).toContain(':');
    expect(invalidFileNameError('普通笔记.md')).toBeNull();
    expect(invalidFileNameError('')).toBeNull();
  });
});

describe('文件名基名消毒（E2）：sanitizeFileBasename', () => {
  it('非法字符替空格并折叠空白，去尾点/空格，截断 80', () => {
    expect(sanitizeFileBasename('会议/纪要 2024:06')).toBe('会议 纪要 2024 06');
    expect(sanitizeFileBasename('尾点...')).toBe('尾点');
    expect(sanitizeFileBasename('  折叠   空白  ')).toBe('折叠 空白');
    expect(sanitizeFileBasename('长'.repeat(90))).toHaveLength(80);
  });

  it('全非法字符输入消毒为空串（调用方负责回退默认名）', () => {
    expect(sanitizeFileBasename('???')).toBe('');
  });
});
