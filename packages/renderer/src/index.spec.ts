import { describe, it, expect } from 'vitest';
import { renderMarkdown } from './index';

describe('renderMarkdown', () => {
  // --- M1-01: 基础渲染 ---

  it('renders headings', () => {
    const result = renderMarkdown('# Hello World');
    expect(result).toContain('<h1');
    expect(result).toContain('Hello World');
  });

  it('renders bold and italic', () => {
    const result = renderMarkdown('**bold** and *italic*');
    expect(result).toContain('<strong>bold</strong>');
    expect(result).toContain('<em>italic</em>');
  });

  it('renders code blocks', () => {
    const result = renderMarkdown('```js\nconst x = 1;\n```');
    expect(result).toContain('<code');
    expect(result).toContain('const x');
  });

  it('renders tables', () => {
    const result = renderMarkdown('| A | B |\n|---|---|\n| 1 | 2 |');
    expect(result).toContain('<table');
    expect(result).toContain('<td>1</td>');
  });

  it('renders task lists', () => {
    const result = renderMarkdown('- [x] Done\n- [ ] Todo');
    expect(result).toContain('checked');
  });

  // --- M1-02: Wiki-link [[...]] ---

  it('renders wiki-links as anchor tags', () => {
    const result = renderMarkdown('See [[Other Note]] for details');
    expect(result).toContain('wikilink');
    expect(result).toContain('data-note="Other Note"');
    expect(result).toContain('Other Note');
  });

  it('renders wiki-links with alias', () => {
    const result = renderMarkdown('See [[Other Note|My Alias]]');
    expect(result).toContain('data-note="Other Note"');
    expect(result).toContain('My Alias');
  });

  it('renders wiki-links with anchor', () => {
    const result = renderMarkdown('See [[Note#section]]');
    expect(result).toContain('data-note="Note"');
    expect(result).toContain('data-anchor="section"');
  });

  it('renders dead wiki-links with dead class', () => {
    const result = renderMarkdown('[[NonExistent]]');
    expect(result).toContain('wikilink--dead');
  });

  // --- M1-03: 行内 #tag ---

  it('renders inline tags', () => {
    const result = renderMarkdown('This is a #javascript note');
    expect(result).toContain('class="md-tag"');
    expect(result).toContain('data-tag="javascript"');
    expect(result).toContain('#javascript');
  });

  it('does not render # in headings as tags', () => {
    const result = renderMarkdown('# Heading');
    // Should be rendered as h1, not a tag
    expect(result).toContain('<h1');
    expect(result).not.toContain('data-tag="Heading"');
  });

  // --- M1-04: XSS 防护 ---

  it('strips script tags', () => {
    const result = renderMarkdown('<script>alert("xss")</script>');
    expect(result).not.toContain('<script>');
    expect(result).not.toContain('alert');
  });

  it('strips event handlers', () => {
    const result = renderMarkdown('<img src=x onerror="alert(1)">');
    expect(result).not.toContain('onerror');
  });

  it('strips iframe', () => {
    const result = renderMarkdown('<iframe src="evil.com"></iframe>');
    expect(result).not.toContain('<iframe');
  });

  it('preserves safe HTML from markdown', () => {
    const result = renderMarkdown('Hello **World**');
    expect(result).toContain('<strong>World</strong>');
  });

  // --- 边界情况 ---

  it('handles empty input', () => {
    const result = renderMarkdown('');
    expect(result).toBe('');
  });

  it('handles plain text', () => {
    const result = renderMarkdown('Hello World');
    expect(result).toContain('Hello World');
  });

  it('handles Chinese text', () => {
    const result = renderMarkdown('你好世界 **粗体**');
    expect(result).toContain('你好世界');
    expect(result).toContain('<strong>粗体</strong>');
  });
});
