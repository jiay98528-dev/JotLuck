import { describe, expect, it } from 'vitest';
import { renderMarkdown, type RemoteImageLabels } from '@jotluck/renderer';

const remoteLabels: RemoteImageLabels = {
  blocked: 'blocked',
  source: 'source',
  loadAll: 'load all',
  loading: 'loading',
  failed: 'failed',
  retry: 'retry',
  insecure: 'insecure',
  unnamed: 'image',
};

const remoteScope = 'test-scope';

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

  it('blocks Markdown and raw HTML HTTPS images without leaving a requestable src', () => {
    const html = renderMarkdown(
      '![markdown](https://cdn.example.com/a.png)\n\n<img src="https://raw.example.com/b.png" alt="raw">',
      { remoteImages: { labels: remoteLabels, scopeId: remoteScope, decide: () => 'blocked' } },
    );

    expect(html).toContain('data-remote-image-action="load-all"');
    expect(html).toContain('cdn.example.com');
    expect(html).toContain('raw.example.com');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('src="https:');
  });

  it('allows only authorized HTTPS images with a no-referrer policy', () => {
    const html = renderMarkdown('![remote](https://cdn.example.com/a.png)', {
      remoteImages: { labels: remoteLabels, scopeId: remoteScope, decide: () => 'allowed' },
    });

    expect(html).toContain('<img');
    expect(html).toContain('src="https://cdn.example.com/a.png"');
    expect(html).toContain('referrerpolicy="no-referrer"');
    expect(html).toContain('data-remote-image-source="https://cdn.example.com/a.png"');
  });

  it('never offers an action for HTTP images and renders failures as retry controls', () => {
    const insecure = renderMarkdown('![insecure](http://cdn.example.com/a.png)', {
      remoteImages: { labels: remoteLabels, scopeId: remoteScope, decide: () => 'allowed' },
    });
    const failed = renderMarkdown('![failed](https://cdn.example.com/a.png)', {
      remoteImages: { labels: remoteLabels, scopeId: remoteScope, decide: () => 'failed' },
    });

    expect(insecure).toContain('remote-image-placeholder--insecure');
    expect(insecure).not.toContain('data-remote-image-action');
    expect(insecure).not.toContain('<img');
    expect(failed).toContain('data-remote-image-action="retry"');
    expect(failed).not.toContain('<img');
  });

  it('blocks credentialed and unsupported absolute image protocols', () => {
    const html = renderMarkdown(
      '<img src="https://user:secret@cdn.example.com/a.png" alt="credentials"><img src="ftp://cdn.example.com/a.png" alt="ftp">',
      { remoteImages: { labels: remoteLabels, scopeId: remoteScope, decide: () => 'allowed' } },
    );

    expect(html).not.toContain('<img');
    expect(html).not.toContain('data-remote-image-action');
    expect(html).not.toContain('secret');
  });

  it('does not let raw Markdown HTML opt into renderer-owned controls', () => {
    const html = renderMarkdown(
      '<button data-remote-image-action="load-all">spoof</button><a href="#" class="remote-image-placeholder__action" data-remote-image-control="v1" data-remote-image-action="load-all" data-remote-image-source="https://cdn.example.com/a.png" data-remote-image-scope="remote-image-scope-1">forged link</a><span data-remote-image-action="retry">forged span</span>',
    );

    expect(html).not.toContain('<button');
    expect(html).not.toMatch(/data-remote-image-(?:action|control|source|scope)/);
    expect(html).toContain('forged link');
  });
});
