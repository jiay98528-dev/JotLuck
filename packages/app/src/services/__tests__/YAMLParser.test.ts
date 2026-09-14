import { describe, expect, it } from 'vitest';
import { extractTitle, parseFrontmatter, stripFrontmatter } from '../YAMLParser';

describe('parseFrontmatter', () => {
  it('parses a properly closed frontmatter block', () => {
    const content = '---\nfoo: bar\ntitle: Hello\n---\n# Body';
    const result = parseFrontmatter(content);
    expect(result.hasFrontmatter).toBe(true);
    expect(result.raw).toBe('foo: bar\ntitle: Hello');
    expect(result.data).toEqual({ foo: 'bar', title: 'Hello' });
    expect(content.slice(result.contentStart)).toBe('# Body');
  });

  it('returns hasFrontmatter=false when the closing fence is missing', () => {
    const result = parseFrontmatter('---\nfoo: bar');
    expect(result.hasFrontmatter).toBe(false);
    expect(result.data).toEqual({});
    expect(result.raw).toBe('');
    expect(result.contentStart).toBe(0);
  });

  it('returns hasFrontmatter=false when the closing fence has no trailing newline', () => {
    // 等价于旧正则 `^---\s*\n[\s\S]*?\n---\s*\n` 缺失末尾换行的情形。
    const result = parseFrontmatter('---\nfoo: bar\n---');
    expect(result.hasFrontmatter).toBe(false);
  });

  it('parses inline-array tags', () => {
    const result = parseFrontmatter('---\ntags: [foo, bar, baz]\n---\nbody');
    expect(result.data.tags).toEqual(['foo', 'bar', 'baz']);
  });

  it('parses block-list tags', () => {
    const result = parseFrontmatter('---\ntags:\n  - foo\n  - bar\n---\nbody');
    expect(result.data.tags).toEqual(['foo', 'bar']);
  });

  it('keeps string tags as-is when not array-form and not empty', () => {
    const result = parseFrontmatter('---\ntags: foo, bar, baz\n---\nbody');
    expect(result.data.tags).toBe('foo, bar, baz');
  });
});

describe('stripFrontmatter', () => {
  it('drops a present frontmatter block', () => {
    expect(stripFrontmatter('---\nfoo: bar\n---\nbody')).toBe('body');
  });

  it('returns the content unchanged when no frontmatter is present', () => {
    expect(stripFrontmatter('# Heading\nbody')).toBe('# Heading\nbody');
  });
});

describe('extractTitle', () => {
  it('extracts the first h1 from a plain document', () => {
    expect(extractTitle('# My Title\n\nbody')).toBe('My Title');
  });

  it('extracts h1 even when frontmatter is present', () => {
    expect(extractTitle('---\ntitle: FrontmatterTitle\n---\n# RealHeading\nbody')).toBe(
      'RealHeading',
    );
  });

  it('does not treat a `# x` line inside a fenced code block as a heading', () => {
    // 收紧锁定：统一 AST 把围栏内容视为 code fence 块，旧的 `/^#\s+(.+)$/m`
    // 误判此处的 `# notheading` 为标题，新实现应只认真实 h1。
    const content = '# realheading\n\n```\n# notheading\n```\n';
    expect(extractTitle(content)).toBe('realheading');
  });
});
