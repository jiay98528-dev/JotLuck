import { describe, expect, it } from 'vitest';
import { renderMarkdown } from '@jotluck/renderer';

function countPreBlocks(html: string): number {
  return html.match(/<pre>/g)?.length ?? 0;
}

describe('@jotluck/renderer markdown boundaries', () => {
  it('renders setext headings as headings', () => {
    const html = renderMarkdown('Release Notes\n---\n\nBody');

    expect(html).toContain('<h2 id="heading-release-notes">Release Notes</h2>');
    expect(html).toContain('<p>Body</p>');
  });

  it('keeps heading anchors stable for duplicate and Setext headings', () => {
    const html = renderMarkdown(['Title', '===', '', '# Title'].join('\n'));

    expect(html).toContain('<h1 id="heading-title">Title</h1>');
    expect(html).toContain('<h1 id="heading-title-2">Title</h1>');
  });

  it('protects bare JSON-like blocks as JSON code blocks', () => {
    const html = renderMarkdown(['{', '  "status": "ok",', '  "count": 2', '}'].join('\n'));

    expect(html).toContain('language-json');
    expect(html).toContain('"status"');
    expect(html).toContain('"count"');
  });

  it('does not wrap fenced code blocks again', () => {
    const html = renderMarkdown(['```json', '{ "status": "ok" }', '```'].join('\n'));

    expect(countPreBlocks(html)).toBe(1);
    expect(html).toContain('language-json');
  });

  it('renders tables and lists through normal markdown semantics', () => {
    const html = renderMarkdown(
      ['| Name | Score |', '| :--- | ---: |', '| JotLuck | 95 |', '', '1. Alpha', '2. Beta'].join(
        '\n',
      ),
    );

    expect(html).toContain('<table>');
    expect(html).toContain('<th');
    expect(html).toContain('<ol>');
    expect(html).toContain('<li>Alpha</li>');
  });

  it('renders a GFM table without outer pipes', () => {
    const html = renderMarkdown(['Name | Score', '--- | ---:', 'JotLuck | 95'].join('\n'));

    expect(html).toContain('<table>');
    expect(html).toContain('<th>Name</th>');
    expect(html).toContain('<td align="right">95</td>');
  });

  it('rewrites local image sources through the host resolver before sanitizing', () => {
    const html = renderMarkdown('![pixel](./assets/pixel.png)', {
      resolveImageSrc: (source) =>
        source === './assets/pixel.png' ? 'data:image/png;base64,aGVsbG8=' : null,
    });

    expect(html).toContain('src="data:image/png;base64,aGVsbG8="');
    expect(html).not.toContain('./assets/pixel.png');
  });

  it('still sanitizes a malicious URL returned by the image resolver', () => {
    const html = renderMarkdown('![unsafe](safe.png)', {
      resolveImageSrc: () => 'javascript:alert(1)',
    });

    expect(html).toContain('alt="unsafe"');
    expect(html).not.toContain('javascript:');
  });

  it('does not leak a rejected local image path into rendered HTML', () => {
    const html = renderMarkdown('![blocked](../../outside.png)', {
      resolveImageSrc: () => null,
    });

    expect(html).toContain('alt="blocked"');
    expect(html).not.toContain('outside.png');
    expect(html).not.toContain('src=');
  });
});
