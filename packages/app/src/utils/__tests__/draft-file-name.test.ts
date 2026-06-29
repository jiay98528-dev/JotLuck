import { describe, expect, it } from 'vitest';
import { getDraftMarkdownFileName } from '../draft-file-name';

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
