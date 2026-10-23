import { describe, expect, it } from 'vitest';
import { classifyAnchorHref } from '../preview-links';

describe('classifyAnchorHref 预览锚点五分类', () => {
  it('https/http 绝对外链 → external', () => {
    expect(classifyAnchorHref('https://example.com/a?b=1')).toBe('external');
    expect(classifyAnchorHref('http://example.com')).toBe('external');
    expect(classifyAnchorHref('HTTPS://EXAMPLE.COM')).toBe('external');
  });

  it('mailto/tel/ftp 协议头 → external', () => {
    expect(classifyAnchorHref('mailto:a@b.com')).toBe('external');
    expect(classifyAnchorHref('tel:+123456')).toBe('external');
    expect(classifyAnchorHref('ftp://files.example.com')).toBe('external');
  });

  it('www. 前缀（无协议）→ external', () => {
    expect(classifyAnchorHref('www.bilibili.com')).toBe('external');
    expect(classifyAnchorHref('www.bilibili.com/video/BV1')).toBe('external');
  });

  it('无协议裸域名（含路径/查询/锚点后缀）→ bare-domain', () => {
    expect(classifyAnchorHref('example.com')).toBe('bare-domain');
    expect(classifyAnchorHref('example.com/path')).toBe('bare-domain');
    expect(classifyAnchorHref('sub.deep.example.com?query=1#frag')).toBe('bare-domain');
  });

  it('站内相对路径 → relative（不得外抛）', () => {
    expect(classifyAnchorHref('notes/idea.md')).toBe('relative');
    expect(classifyAnchorHref('./relative.html')).toBe('relative');
    expect(classifyAnchorHref('../up/one.md')).toBe('relative');
    expect(classifyAnchorHref('/rooted/path')).toBe('relative');
    expect(classifyAnchorHref('#anchor')).toBe('relative');
  });
});
