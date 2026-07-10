import { describe, expect, it } from 'vitest';
import {
  applyParagraphPreset,
  clearMarkdownFormatting,
  detectParagraphPreset,
  toggleInlineFormat,
} from '../markdown-formatting';
import { normalizeFullwidthMarkdownSyntax, renderMarkdown } from '@jotluck/renderer';

describe('markdown formatting', () => {
  it('重复加粗会移除选区外围定界符', () => {
    const edit = toggleInlineFormat('**中文**', 2, 4, 'bold');
    expect(edit.changes).toEqual({ from: 0, to: 6, insert: '中文' });
    expect(edit.selection).toEqual({ anchor: 0, head: 2 });
  });

  it('选区包含加粗定界符时会解包', () => {
    const edit = toggleInlineFormat('**中文**', 0, 6, 'bold');
    expect(edit.changes.insert).toBe('中文');
  });

  it('清除格式会移除嵌套定界符并保留文本', () => {
    const doc = '***中文***';
    const edit = clearMarkdownFormatting(doc, 3, 5);
    expect(edit.changes).toEqual({ from: 0, to: doc.length, insert: '中文' });
  });

  it('标题预设替换原有段落前缀', () => {
    const edit = applyParagraphPreset('> 中文段落', 2, 6, 'heading2');
    expect(edit.changes.insert).toBe('## 中文段落');
    expect(detectParagraphPreset(edit.changes.insert, 3)).toBe('heading2');
  });

  it('正文预设清除标题前缀', () => {
    const edit = applyParagraphPreset('### 中文标题', 4, 8, 'paragraph');
    expect(edit.changes.insert).toBe('中文标题');
  });

  it('折叠选区应用预设后保持光标在正文相对位置', () => {
    const edit = applyParagraphPreset('正文内容', 2, 2, 'heading1');
    expect(edit.changes.insert).toBe('# 正文内容');
    expect(edit.selection).toEqual({ anchor: 4, head: 4 });
  });

  it('预选格式允许在空行预插入标题前缀', () => {
    const edit = applyParagraphPreset('', 0, 0, 'heading2', true);
    expect(edit.changes.insert).toBe('## ');
    expect(edit.selection).toEqual({ anchor: 3, head: 3 });
  });

  it('识别全角标题与行内格式定界符', () => {
    expect(normalizeFullwidthMarkdownSyntax('＃　标题\n＊＊粗体＊＊')).toBe('# 标题\n**粗体**');
    expect(renderMarkdown('＃　标题\n\n＊＊粗体＊＊')).toContain('<h1>标题</h1>');
    expect(renderMarkdown('＊＊粗体＊＊')).toContain('<strong>粗体</strong>');
    expect(detectParagraphPreset('＃　标题', 2)).toBe('heading1');
  });

  it('全角归一化不会改写普通中文标点', () => {
    expect(normalizeFullwidthMarkdownSyntax('中文（说明）很好～')).toBe('中文（说明）很好～');
    expect(normalizeFullwidthMarkdownSyntax('［链接］（https://example.com）')).toBe(
      '[链接](https://example.com)',
    );
  });
  it('renders bare JSON blocks as code blocks without flattening line breaks', () => {
    const html = renderMarkdown('Before\n\n{\n  "done": [\n    "A",\n    "B"\n  ]\n}\n\nAfter');
    expect(html).toContain('<pre><code class="language-json">');
    expect(html).toContain('"done"');
    expect(html).toContain('    "A"');
    expect(html).toContain('<p>Before</p>');
    expect(html).toContain('<p>After</p>');
  });
});
