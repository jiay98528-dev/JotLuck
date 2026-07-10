import { describe, expect, it } from 'vitest';
import { renderMarkdown } from '@jotluck/renderer';

function countPreBlocks(html: string): number {
  return html.match(/<pre>/g)?.length ?? 0;
}

describe('@jotluck/renderer markdown boundaries', () => {
  it('renders setext headings as headings', () => {
    const html = renderMarkdown('Release Notes\n---\n\nBody');

    expect(html).toContain('<h2>Release Notes</h2>');
    expect(html).toContain('<p>Body</p>');
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
});
