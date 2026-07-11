import { describe, expect, it } from 'vitest';
import { DEFAULT_HYBRID_RETRIEVAL_BUDGET, HybridRetrievalIndex } from '../hybrid-retrieval-core';
import type {
  HybridRetrievalCandidate,
  HybridRetrievalQueryRequest,
} from '../hybrid-retrieval-types';

function replace(
  index: HybridRetrievalIndex,
  workspaceScope: string,
  path: string,
  content: string,
) {
  return index.replace({ operation: 'replace', workspaceScope, path, content });
}

function query(
  index: HybridRetrievalIndex,
  workspaceScope: string,
  contextBeforeCursor: string,
  languageHint: HybridRetrievalQueryRequest['languageHint'] = 'zh',
  maxCandidates = 8,
): HybridRetrievalCandidate[] {
  return index.query({
    operation: 'query',
    workspaceScope,
    contextBeforeCursor,
    languageHint,
    maxCandidates,
  });
}

function utf8Bytes(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

describe('HybridRetrievalIndex', () => {
  it('rejects an oversized batch before any document becomes visible', () => {
    const index = new HybridRetrievalIndex();
    const response = index.execute({
      operation: 'batch',
      workspaceScope: 'workspace-batch-limit',
      mutations: [
        {
          operation: 'replace',
          workspaceScope: 'workspace-batch-limit',
          path: '/small.md',
          content: 'Project plan needs review.',
        },
        {
          operation: 'replace',
          workspaceScope: 'workspace-batch-limit',
          path: '/oversized.md',
          content: 'x'.repeat(2 * 1024 * 1024),
        },
      ],
    });

    expect(response).toMatchObject({ operation: 'batch', changed: false, documentCount: 0 });
    expect(index.getDiagnostics('workspace-batch-limit').documentCount).toBe(0);
  });

  it('exposes a JSON-serializable protocol and isolates workspaces', () => {
    const index = new HybridRetrievalIndex();
    index.execute({
      operation: 'replace',
      workspaceScope: 'workspace-a',
      path: '/a.md',
      content: '项目计划需要复核风险。',
    });
    index.handle({
      operation: 'replace',
      workspaceScope: 'workspace-a',
      path: '/b.md',
      content: '项目计划需要复核风险。',
    });

    const response = index.execute({
      operation: 'query',
      workspaceScope: 'workspace-a',
      contextBeforeCursor: '项目计划',
      languageHint: 'zh',
      maxCandidates: 4,
    });
    const roundTripped = JSON.parse(JSON.stringify(response));

    expect(roundTripped).toEqual(response);
    expect(response).toEqual({
      operation: 'query',
      candidates: [
        expect.objectContaining({
          text: '需要复核风险。',
          support: 2,
          documentSupport: 2,
          providerId: 'hybrid-retrieval-zh',
          sourceLayer: 'notebook',
        }),
      ],
    });
    expect(query(index, 'workspace-b', '项目计划')).toEqual([]);
  });

  it('makes repeated replace idempotent and reverses edited or removed contributions', () => {
    const index = new HybridRetrievalIndex();
    replace(index, 'scope', '/a.md', '项目计划需要复核风险。\n项目计划需要复核风险。');
    replace(index, 'scope', '/b.md', '项目计划需要复核风险。');

    const before = query(index, 'scope', '项目计划')[0];
    expect(before).toMatchObject({ support: 3, documentSupport: 2 });
    expect(
      replace(index, 'scope', '/a.md', '项目计划需要复核风险。\n项目计划需要复核风险。'),
    ).toEqual({ operation: 'replace', changed: false, documentCount: 2 });
    expect(query(index, 'scope', '项目计划')[0]).toMatchObject({
      support: 3,
      documentSupport: 2,
    });

    replace(index, 'scope', '/b.md', '项目计划可以稍后处理。');
    expect(query(index, 'scope', '项目计划')).toEqual([]);

    replace(index, 'scope', '/b.md', '项目计划需要复核风险。');
    expect(index.remove({ operation: 'remove', workspaceScope: 'scope', path: '/a.md' })).toEqual({
      operation: 'remove',
      changed: true,
      documentCount: 1,
    });
    expect(query(index, 'scope', '项目计划')).toEqual([]);
  });

  it('renames a contribution without duplicating counts and deterministically replaces a target', () => {
    const index = new HybridRetrievalIndex();
    replace(index, 'scope', '/a.md', '项目计划需要确认。');
    replace(index, 'scope', '/b.md', '项目计划需要确认。');

    expect(
      index.rename({
        operation: 'rename',
        workspaceScope: 'scope',
        oldPath: '/a.md',
        newPath: '/renamed.md',
      }),
    ).toEqual({ operation: 'rename', changed: true, documentCount: 2 });
    expect(query(index, 'scope', '项目计划')[0]).toMatchObject({
      support: 2,
      documentSupport: 2,
    });

    replace(index, 'scope', '/target.md', '项目计划不会保留。');
    expect(
      index.rename({
        operation: 'rename',
        workspaceScope: 'scope',
        oldPath: '/renamed.md',
        newPath: '/target.md',
      }),
    ).toEqual({ operation: 'rename', changed: true, documentCount: 2 });
    expect(query(index, 'scope', '项目计划')[0]).toMatchObject({
      text: '需要确认。',
      support: 2,
      documentSupport: 2,
    });
  });

  it('clears only the requested workspace', () => {
    const index = new HybridRetrievalIndex();
    for (const scope of ['a', 'b']) {
      replace(index, scope, '/one.md', '项目计划需要确认。');
      replace(index, scope, '/two.md', '项目计划需要确认。');
    }

    expect(index.clear({ operation: 'clear', workspaceScope: 'a' })).toEqual({
      operation: 'clear',
      changed: true,
      documentCount: 0,
    });
    expect(query(index, 'a', '项目计划')).toEqual([]);
    expect(query(index, 'b', '项目计划')).toHaveLength(1);
  });

  it('requires two independent documents even when one document repeats a phrase', () => {
    const index = new HybridRetrievalIndex();
    replace(
      index,
      'scope',
      '/only.md',
      Array.from({ length: 8 }, () => '项目计划需要确认。').join('\n'),
    );

    expect(query(index, 'scope', '项目计划')).toEqual([]);
  });

  it('indexes prose but excludes frontmatter, fenced code, headings, and tables', () => {
    const index = new HybridRetrievalIndex();
    replace(
      index,
      'scope',
      '/a.md',
      [
        '---',
        'title: 项目计划需要泄漏',
        '---',
        '# 项目计划需要泄漏',
        '```md',
        '项目计划需要泄漏',
        '```',
        '| 项目计划 | 需要泄漏 |',
        '| --- | --- |',
        '普通记录各不相同。',
      ].join('\n'),
    );
    replace(
      index,
      'scope',
      '/b.md',
      [
        '文档标题',
        '========',
        '~~~text',
        '项目计划需要泄漏',
        '~~~',
        '| 项目计划 | 需要泄漏 |',
        '| --- | --- |',
        '另一条普通记录。',
      ].join('\n'),
    );

    expect(query(index, 'scope', '项目计划')).toEqual([]);

    replace(index, 'scope', '/a.md', '- 项目计划需要保留。');
    replace(index, 'scope', '/b.md', '> 项目计划需要保留。');
    expect(query(index, 'scope', '项目计划')[0]).toMatchObject({ text: '需要保留。' });
  });

  it('handles CRLF, unclosed frontmatter, hyphen Setext headings, and tables without edge pipes', () => {
    const index = new HybridRetrievalIndex();
    replace(
      index,
      'frontmatter',
      '/a.md',
      ['---', 'title: draft', '项目计划需要泄漏。'].join('\r\n'),
    );
    replace(
      index,
      'frontmatter',
      '/b.md',
      ['---', 'title: draft', '项目计划需要泄漏。'].join('\r\n'),
    );
    expect(query(index, 'frontmatter', '项目计划')).toEqual([]);

    for (const path of ['/a.md', '/b.md']) {
      replace(
        index,
        'blocks',
        path,
        [
          '项目计划需要泄漏。',
          '---',
          '',
          '项目计划 | 需要泄漏',
          '--- | ---',
          '项目计划 | 需要泄漏',
        ].join('\r\n'),
      );
    }
    expect(query(index, 'blocks', '项目计划')).toEqual([]);
  });

  it('uses the longest supported 2-8 code-point Chinese suffix', () => {
    const index = new HybridRetrievalIndex();
    replace(index, 'scope', '/a.md', '今天项目计划需要复核。');
    replace(index, 'scope', '/b.md', '今天项目计划需要复核。');
    replace(index, 'scope', '/c.md', '其他项目计划可以开始。');
    replace(index, 'scope', '/d.md', '其他项目计划可以开始。');

    expect(query(index, 'scope', '今天项目计划')[0]).toMatchObject({ text: '需要复核。' });
    expect(query(index, 'scope', '其他项目计划')[0]).toMatchObject({ text: '可以开始。' });
  });

  it('keeps Unicode code points intact, caps output, and drops mixed-language candidates', () => {
    const index = new HybridRetrievalIndex();
    replace(index, 'unicode', '/a.md', `项目计划🙂${'继续推进'.repeat(10)}。`);
    replace(index, 'unicode', '/b.md', `项目计划🙂${'继续推进'.repeat(10)}。`);

    const unicodeCandidate = query(index, 'unicode', '项目计划')[0];
    expect(unicodeCandidate?.text.startsWith('🙂')).toBe(true);
    expect(Array.from(unicodeCandidate?.text ?? '')).toHaveLength(24);
    expect(unicodeCandidate?.text.includes('\uFFFD')).toBe(false);

    replace(index, 'mixed', '/a.md', '项目计划API评审。');
    replace(index, 'mixed', '/b.md', '项目计划API评审。');
    expect(query(index, 'mixed', '项目计划')).toEqual([]);
    expect(query(index, 'unicode', '项目计划', 'mixed')).toEqual([]);
  });

  it('retrieves English continuations from the longest 1-3 word context', () => {
    const index = new HybridRetrievalIndex();
    replace(index, 'scope', '/a.md', 'Project plan reviews the current risks.');
    replace(index, 'scope', '/b.md', 'Project plan reviews the current risks.');
    replace(index, 'scope', '/c.md', 'The plan starts next week.');
    replace(index, 'scope', '/d.md', 'The plan starts next week.');

    expect(query(index, 'scope', 'Project plan ', 'en')[0]).toMatchObject({
      text: 'reviews the current',
      support: 2,
      documentSupport: 2,
      providerId: 'hybrid-retrieval-en',
    });
    expect(query(index, 'scope', 'Project plan', 'en')[0]?.text).toBe(' reviews the current');
    expect(query(index, 'scope', 'Project plan ', 'en')[0]?.text.trim().split(/\s+/u)).toHaveLength(
      3,
    );
  });

  it('completes an unfinished English word from a matching notebook phrase', () => {
    const index = new HybridRetrievalIndex();
    replace(index, 'scope', '/a.md', 'Project planning reviews the current risks.');
    replace(index, 'scope', '/b.md', 'Project planning reviews the current risks.');

    expect(query(index, 'scope', 'Project plan', 'en')[0]).toMatchObject({
      text: 'ning reviews the',
      providerId: 'hybrid-retrieval-en',
      documentSupport: 2,
    });
  });

  it('normalizes compatibility-width English before tokenization and lookup', () => {
    const index = new HybridRetrievalIndex();
    replace(index, 'scope', '/a.md', 'Ｐｒｏｊｅｃｔ planning reviews the current risks.');
    replace(index, 'scope', '/b.md', 'Project planning reviews the current risks.');

    expect(query(index, 'scope', 'Ｐｒｏｊｅｃｔ plan', 'en')[0]).toMatchObject({
      text: 'ning reviews the',
      providerId: 'hybrid-retrieval-en',
      documentSupport: 2,
    });
  });

  it('deduplicates and sorts tied candidates deterministically while respecting the limit', () => {
    const build = (paths: string[]) => {
      const index = new HybridRetrievalIndex();
      const contentByPath: Record<string, string> = {
        '/a.md': '项目计划需要处理。',
        '/b.md': '项目计划需要处理。',
        '/c.md': '项目计划可以开始。',
        '/d.md': '项目计划可以开始。',
      };
      for (const path of paths) replace(index, 'scope', path, contentByPath[path] ?? '');
      return index;
    };

    const forward = query(build(['/a.md', '/b.md', '/c.md', '/d.md']), 'scope', '项目计划');
    const reverse = query(build(['/d.md', '/c.md', '/b.md', '/a.md']), 'scope', '项目计划');

    expect(reverse).toEqual(forward);
    expect(forward.map(({ text }) => text)).toHaveLength(2);
    expect(
      query(build(['/a.md', '/b.md', '/c.md', '/d.md']), 'scope', '项目计划', 'zh', 1),
    ).toEqual([forward[0]]);
  });

  it('uses language detection for unknown hints and rejects non-positive limits', () => {
    const index = new HybridRetrievalIndex();
    replace(index, 'scope', '/a.md', 'Project plan reviews the current risks.');
    replace(index, 'scope', '/b.md', 'Project plan reviews the current risks.');

    expect(query(index, 'scope', 'Project plan ', 'unknown')).toHaveLength(1);
    expect(query(index, 'scope', 'Project plan ', 'en', 0)).toEqual([]);
  });

  it('uses the Web/Rust parity defaults and retains fingerprints instead of full source text', () => {
    expect(DEFAULT_HYBRID_RETRIEVAL_BUDGET).toEqual({
      maxDocuments: 2_000,
      maxDocumentInputBytes: 512 * 1024,
      maxTotalInputBytes: 16 * 1024 * 1024,
      maxDocumentEntries: 20_000,
      maxTotalDocumentEntries: 300_000,
    });

    const index = new HybridRetrievalIndex();
    const content = '项目计划🙂需要确认。';
    replace(index, 'scope', '/a.md', content);
    const diagnostics = index.getDiagnostics('scope');

    expect(diagnostics).toMatchObject({
      documentCount: 1,
      fingerprintCount: 1,
      inputBytes: utf8Bytes(content),
      retainedContentBytes: 0,
      budgetRejections: 0,
      budget: DEFAULT_HYBRID_RETRIEVAL_BUDGET,
    });
    expect(diagnostics.documentEntries).toBeGreaterThan(0);
  });

  it('enforces document count and UTF-8 per-document input budgets', () => {
    const countLimited = new HybridRetrievalIndex({ maxDocuments: 1 });
    expect(replace(countLimited, 'scope', '/a.md', 'one two').changed).toBe(true);
    expect(replace(countLimited, 'scope', '/b.md', 'cat dog')).toEqual({
      operation: 'replace',
      changed: false,
      documentCount: 1,
    });
    expect(countLimited.getDiagnostics('scope')).toMatchObject({
      documentCount: 1,
      budgetRejections: 1,
    });

    const byteLimited = new HybridRetrievalIndex({ maxDocumentInputBytes: 3 });
    expect(utf8Bytes('🙂')).toBe(4);
    expect(replace(byteLimited, 'unicode', '/emoji.md', '🙂').changed).toBe(false);
    expect(byteLimited.getDiagnostics('unicode')).toMatchObject({
      documentCount: 0,
      inputBytes: 0,
      retainedContentBytes: 0,
      budgetRejections: 1,
    });
  });

  it('computes total input budget against the replacement net value', () => {
    const index = new HybridRetrievalIndex({ maxTotalInputBytes: 8 });
    expect(replace(index, 'scope', '/a.md', '🙂').changed).toBe(true);
    expect(replace(index, 'scope', '/b.md', '🙂').changed).toBe(true);
    expect(index.getDiagnostics('scope').inputBytes).toBe(8);

    expect(replace(index, 'scope', '/c.md', 'a').changed).toBe(false);
    expect(replace(index, 'scope', '/a.md', 'a').changed).toBe(true);
    expect(index.getDiagnostics('scope')).toMatchObject({
      documentCount: 2,
      inputBytes: 5,
      budgetRejections: 1,
    });
  });

  it('stops allocating at the per-document entry cap and preserves an old index on rejection', () => {
    const oldContent = '项目计划需要确认。';
    const index = new HybridRetrievalIndex({ maxDocumentEntries: 40 });
    replace(index, 'scope', '/a.md', oldContent);
    replace(index, 'scope', '/b.md', oldContent);
    const before = index.getDiagnostics('scope');
    expect(query(index, 'scope', '项目计划')[0]?.text).toBe('需要确认。');

    const oversizedEdit = `项目计划${Array.from({ length: 100 }, (_, i) =>
      String.fromCodePoint(0x4e00 + i),
    ).join('')}`;
    expect(replace(index, 'scope', '/a.md', oversizedEdit)).toEqual({
      operation: 'replace',
      changed: false,
      documentCount: 2,
    });

    expect(query(index, 'scope', '项目计划')[0]).toMatchObject({
      text: '需要确认。',
      documentSupport: 2,
    });
    expect(index.getDiagnostics('scope')).toMatchObject({
      inputBytes: before.inputBytes,
      documentEntries: before.documentEntries,
      budgetRejections: 1,
    });
  });

  it('counts distinct surface variants against the entry budget', () => {
    const index = new HybridRetrievalIndex({ maxDocumentEntries: 1 });

    expect(replace(index, 'scope', '/variants.md', 'Project Plan. Project plan.')).toEqual({
      operation: 'replace',
      changed: false,
      documentCount: 0,
    });
    expect(index.getDiagnostics('scope')).toMatchObject({
      documentCount: 0,
      documentEntries: 0,
      budgetRejections: 1,
    });
  });

  it('enforces the total document-entry budget after subtracting replaced contributions', () => {
    const index = new HybridRetrievalIndex({
      maxDocumentEntries: 3,
      maxTotalDocumentEntries: 2,
    });
    expect(replace(index, 'scope', '/a.md', 'one two').changed).toBe(true);
    expect(replace(index, 'scope', '/b.md', 'cat dog').changed).toBe(true);
    expect(index.getDiagnostics('scope').documentEntries).toBe(2);

    expect(replace(index, 'scope', '/c.md', 'red blue').changed).toBe(false);
    expect(replace(index, 'scope', '/a.md', 'one three').changed).toBe(true);
    expect(index.getDiagnostics('scope')).toMatchObject({
      documentCount: 2,
      documentEntries: 2,
      budgetRejections: 1,
    });
  });

  it('updates input and entry accounting across overwrite rename, remove, and clear', () => {
    const index = new HybridRetrievalIndex();
    const moved = 'one two';
    const retained = 'cat dog';
    replace(index, 'scope', '/source.md', moved);
    replace(index, 'scope', '/retained.md', retained);
    replace(index, 'scope', '/target.md', 'old value');

    index.rename({
      operation: 'rename',
      workspaceScope: 'scope',
      oldPath: '/source.md',
      newPath: '/target.md',
    });
    expect(index.getDiagnostics('scope')).toMatchObject({
      documentCount: 2,
      inputBytes: utf8Bytes(moved) + utf8Bytes(retained),
      documentEntries: 2,
    });

    index.remove({ operation: 'remove', workspaceScope: 'scope', path: '/retained.md' });
    expect(index.getDiagnostics('scope')).toMatchObject({
      documentCount: 1,
      inputBytes: utf8Bytes(moved),
      documentEntries: 1,
    });

    index.clear({ operation: 'clear', workspaceScope: 'scope' });
    expect(index.getDiagnostics('scope')).toMatchObject({
      documentCount: 0,
      fingerprintCount: 0,
      inputBytes: 0,
      documentEntries: 0,
      budgetRejections: 0,
    });
  });
});
