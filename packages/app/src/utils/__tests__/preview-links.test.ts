import { describe, expect, it } from 'vitest';
import { classifyAnchorHref } from '../preview-links';

describe('classifyAnchorHref 预览锚点三分类', () => {
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

  it('根级裸文件名（已知扩展）→ relative：不得被 BARE_DOMAIN_RE 误判后当域名外抛', () => {
    // notes.md 会被 BARE_DOMAIN_RE 吞成「单 label 域名 + md TLD」，normalizeUrl
    // 补 https:// 后外抛打开 https://notes.md 网站——末段含已知文件扩展的
    // href 是站内文件引用，归 relative。扩展集见 preview-links.ts 注释来源。
    expect(classifyAnchorHref('notes.md')).toBe('relative');
    expect(classifyAnchorHref('img.png')).toBe('relative');
    expect(classifyAnchorHref('report.pdf')).toBe('relative');
    expect(classifyAnchorHref('photo.jpg#x')).toBe('relative');
    // 大写扩展与带查询串形态同口径。
    expect(classifyAnchorHref('Notes.MD')).toBe('relative');
    expect(classifyAnchorHref('img.png?size=large')).toBe('relative');
  });

  it('无扩展或未知扩展的裸 label 形态不因文件名规则放宽', () => {
    // 末段无已知扩展：保持 bare-domain 判定（正常裸域名）。
    expect(classifyAnchorHref('example.com')).toBe('bare-domain');
    expect(classifyAnchorHref('example.com/app.js')).toBe('bare-domain');
    expect(classifyAnchorHref('sub.example.io')).toBe('bare-domain');
  });

  it('站内相对路径 → relative（不得外抛）', () => {
    expect(classifyAnchorHref('notes/idea.md')).toBe('relative');
    expect(classifyAnchorHref('./relative.html')).toBe('relative');
    expect(classifyAnchorHref('../up/one.md')).toBe('relative');
    expect(classifyAnchorHref('/rooted/path')).toBe('relative');
    expect(classifyAnchorHref('#anchor')).toBe('relative');
  });

  it('危险协议 → relative：回归锁定外抛通道拒收（不得随白名单放宽变 external）', () => {
    // 现状两正则均不匹配 → relative（调用方仅 preventDefault 不动作）。
    // 若 ABSOLUTE_URL_RE 将来放宽协议，javascript: 会变 external →
    // openExternalUrl → openWithSystem('javascript:…')，本断言先行钉死。
    expect(classifyAnchorHref('javascript:alert(1)')).toBe('relative');
    expect(classifyAnchorHref('data:text/html,<script>alert(1)</script>')).toBe('relative');
    expect(classifyAnchorHref('vbscript:msgbox(1)')).toBe('relative');
  });
});
