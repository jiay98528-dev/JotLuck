import { describe, expect, it } from 'vitest';
import { parseDocument, parseDocumentAsync, updateDocumentAsync } from '../ast';
import { preparePreviewFragments } from '../progressive';
import { finalizePreparedHtml, renderMarkdown } from '../index';

const fixture = [
  '---',
  'title: 文档',
  '---',
  '# Same',
  '',
  '正文 **强调** [跨块][ref]',
  '',
  '| 表头 | value |',
  '| --- | ---: |',
  '| a\\|b | 2 |',
  '',
  '~~~ts',
  '# not a heading',
  '~~~',
  '',
  '# Same',
  '',
  '> 引用',
  '> 下一行',
  '',
  '1. first',
  '2. second',
  '',
  '[ref]: https://example.com',
  '',
  '{',
  '"key": true',
  '}',
].join('\n');

describe('cooperative document analysis', () => {
  it('uses the exact same grammar for synchronous and background consumers', async () => {
    expect(await parseDocumentAsync(fixture)).toEqual(parseDocument(fixture));
  });
  it('cancels a superseded scan before returning any stale snapshot', async () => {
    let cancelled = false;
    const task = parseDocumentAsync(fixture.repeat(4000), () => cancelled);
    cancelled = true;
    await expect(task).rejects.toThrow('cancelled');
  });
  it('maps ordinary prose changes without mutating the previous snapshot', async () => {
    const source =
      'prefix ordinary prose suffix\n\n# Heading\n\n| a | b |\n| --- | --- |\n| c | d |';
    const before = parseDocument(source);
    const copy = structuredClone(before);
    const next = source.replace('ordinary', 'updated ordinary');
    expect(await updateDocumentAsync(before, next)).toEqual(parseDocument(next));
    expect(before).toEqual(copy);
  });
  it('reparses structural edits including fences, duplicate headings and fullwidth markers', async () => {
    for (const source of [
      fixture.replace('~~~ts', 'ordinary'),
      fixture.replace('# Same', '＃ New'),
      fixture.replace('---:', ':---:'),
    ]) {
      expect(await updateDocumentAsync(parseDocument(fixture), source)).toEqual(
        parseDocument(source),
      );
    }
  });
});

describe('progressive render semantics', () => {
  it('retains document-wide references, repeated heading IDs and sanitizer policy', async () => {
    const source =
      '# Same\n\n[link][ref]\n\n# Same\n\n[ref]: https://example.com\n\n<script>bad()</script>\n\n![remote](https://example.com/a.png)';
    const parts = await preparePreviewFragments(source);
    const combined = parts.map((part) => finalizePreparedHtml(part.html)).join('');
    const expected = renderMarkdown(source);
    const actualDom = document.createElement('div');
    actualDom.innerHTML = combined;
    const expectedDom = document.createElement('div');
    expectedDom.innerHTML = expected;
    expect([...actualDom.querySelectorAll('h1')].map((el) => el.id)).toEqual(
      [...expectedDom.querySelectorAll('h1')].map((el) => el.id),
    );
    expect(actualDom.querySelector('a')?.href).toBe('https://example.com/');
    expect(actualDom.querySelector('script')).toBeNull();
    expect(actualDom.querySelector('img[src^="https:"]')).toBeNull();
  });

  it('raw HTML headings occupy pairing slots without stealing ids or injecting undefined', async () => {
    // 网页粘贴的 <h2> 在 markdown 标题之前：配对位计数包含 html 标题，
    // markdown 标题 id 不被抢占；html 标题保持原样，任何片段不出现
    // id="undefined"（旧实现 headings[heading++] 越界直取 undefined）。
    const source = '<h2>网页粘贴标题</h2>\n\n## 真标题\n\n> ## 引用内标题';
    const parts = await preparePreviewFragments(source);
    const combined = parts.map((part) => finalizePreparedHtml(part.html)).join('');
    expect(combined).not.toContain('undefined');
    expect(combined).toContain('<h2 id="heading-真标题">真标题</h2>');
    expect(combined).toContain('<h2 id="heading-引用内标题">引用内标题</h2>');
    expect(combined).toContain('<h2>网页粘贴标题</h2>');
    // 与整文渲染的 markdown 标题 id 逐一对齐（渐进/静态双路径一致）
    const expectedDom = document.createElement('div');
    expectedDom.innerHTML = renderMarkdown(source);
    const actualDom = document.createElement('div');
    actualDom.innerHTML = combined;
    expect([...actualDom.querySelectorAll('h2[id]')].map((el) => el.id)).toEqual(
      [...expectedDom.querySelectorAll('h2[id]')].map((el) => el.id),
    );
  });
  it('keeps every large-table row exactly once, without repeated header text', async () => {
    const source =
      '| Header A | Header B |\n| --- | --- |\n' +
      Array.from({ length: 1000 }, (_, i) => `| row-${i} | value |`).join('\n');
    const parts = await preparePreviewFragments(source);
    expect(parts.length).toBeGreaterThan(1);
    const dom = document.createElement('div');
    dom.innerHTML = parts.map((part) => finalizePreparedHtml(part.html)).join('');
    expect(dom.querySelectorAll('tbody tr')).toHaveLength(1000);
    expect(dom.querySelectorAll('th')).toHaveLength(2);
    expect(dom.textContent).toContain('row-999');
    const target = source.indexOf('row-999');
    const targetPart = parts.find((part) => part.from <= target && part.to > target);
    expect(targetPart?.html).toContain('row-999');
    expect(targetPart?.html).not.toContain('row-0<');
  });
  it('preserves long-paragraph inline semantics without manufacturing paragraph breaks', async () => {
    const source = '**' + '长段落 '.repeat(20000).trimEnd() + '**';
    const parts = await preparePreviewFragments(source);
    const dom = document.createElement('div');
    dom.innerHTML = parts.map((part) => finalizePreparedHtml(part.html)).join('');
    expect(dom.querySelectorAll('p')).toHaveLength(1);
    expect(dom.querySelector('strong')?.textContent).toBe('长段落 '.repeat(20000).trimEnd());
  });
});
