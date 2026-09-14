import { describe, expect, it, vi } from 'vitest';
import { IndexService } from '../IndexService';
import { MockFSService } from '../MockFSService';

describe('IndexService notebook traversal', () => {
  it('does not index generated dependency directories', async () => {
    const fs = new MockFSService(0, { persist: false });
    await fs.createDirectory('/node_modules');
    await fs.writeFile('/node_modules/README.md', '# Generated dependency documentation');
    await fs.createDirectory('/project-notes');
    await fs.writeFile('/project-notes/decision.md', '# Project decision');

    const service = new IndexService(fs);
    const index = await service.buildFullIndex();

    expect(index.documents['/project-notes/decision.md']?.title).toBe('Project decision');
    expect(index.documents['/node_modules/README.md']).toBeUndefined();
  });

  it('indexes block-list frontmatter tags for real regex + multi-tag search', async () => {
    const fs = new MockFSService(0, { persist: false });
    const service = new IndexService(fs);
    const index = await service.buildFullIndex();

    expect(index.documents['/快速入门.md']?.tags).toEqual(['入门', 'markdown']);
    const results = service.getEngine().search({
      text: '',
      regex: '欢迎使用',
      tags: ['入门', 'markdown'],
    });
    expect(results.map((result) => result.notePath)).toEqual(['/快速入门.md']);
  });
});

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

describe('IndexService per-path mutation ordering', () => {
  it('does not let a slower first update overwrite a newer update', async () => {
    const fs = new MockFSService(0, { persist: false });
    const firstRead = deferred<string>();
    const secondRead = deferred<string>();
    vi.spyOn(fs, 'readFile')
      .mockImplementationOnce(() => firstRead.promise)
      .mockImplementationOnce(() => secondRead.promise);
    const service = new IndexService(fs);

    const firstUpdate = service.updateDocument('/race.md');
    const secondUpdate = service.updateDocument('/race.md');
    secondRead.resolve('# New title\n\ncurrentuniquetoken');
    await secondUpdate;
    firstRead.resolve('# Old title\n\nlegacyuniquetoken');
    await firstUpdate;

    expect(service.getAllDocuments()['/race.md']?.title).toBe('New title');
    expect(service.getEngine().search({ text: 'currentuniquetoken' })[0]?.notePath).toBe(
      '/race.md',
    );
    expect(service.getEngine().search({ text: 'legacyuniquetoken' })).toEqual([]);
  });

  it('does not resurrect a document when remove wins over an in-flight update', async () => {
    const fs = new MockFSService(0, { persist: false });
    const pendingRead = deferred<string>();
    vi.spyOn(fs, 'readFile').mockReturnValueOnce(pendingRead.promise);
    const service = new IndexService(fs);

    const update = service.updateDocument('/removed.md');
    service.removeDocument('/removed.md');
    pendingRead.resolve('# Removed but late');
    await update;

    expect(service.getAllDocuments()['/removed.md']).toBeUndefined();
    expect(service.getEngine().search({ text: 'Removed but late' })).toEqual([]);
  });

  it('keeps the final update across update, remove, update reordering', async () => {
    const fs = new MockFSService(0, { persist: false });
    const staleRead = deferred<string>();
    const currentRead = deferred<string>();
    vi.spyOn(fs, 'readFile')
      .mockImplementationOnce(() => staleRead.promise)
      .mockImplementationOnce(() => currentRead.promise);
    const service = new IndexService(fs);

    const staleUpdate = service.updateDocument('/recreated.md');
    service.removeDocument('/recreated.md');
    const currentUpdate = service.updateDocument('/recreated.md');
    currentRead.resolve('# Recreated current\n\ncurrentrecreatedtoken');
    await currentUpdate;
    staleRead.resolve('# Recreated stale\n\nstalerecreatedtoken');
    await staleUpdate;

    expect(service.getAllDocuments()['/recreated.md']?.title).toBe('Recreated current');
    expect(service.getEngine().search({ text: 'stalerecreatedtoken' })).toEqual([]);
  });
});

describe('IndexService unified-AST index extraction', () => {
  it('indexes inline #tag from text but skips fenced and inline code spans', async () => {
    const fs = new MockFSService(0, { persist: false });
    await fs.writeFile(
      '/tags.md',
      [
        '# Note',
        '',
        'This paragraph mentions #realtag in flowing text.',
        '',
        '```',
        '#fencetag inside a fence must not be indexed',
        '```',
        '',
        'And an inline span `#inlinetag` is also skipped.',
        '',
      ].join('\n'),
    );

    const service = new IndexService(fs);
    const index = await service.buildFullIndex();

    const entry = index.documents['/tags.md'];
    expect(entry?.tags ?? []).toContain('realtag');
    expect(entry?.tags ?? []).not.toContain('fencetag');
    expect(entry?.tags ?? []).not.toContain('inlinetag');
  });

  it('builds backlinks keyed by note name, stripping #anchor from [[note#anchor]]', async () => {
    const fs = new MockFSService(0, { persist: false });
    await fs.writeFile(
      '/source.md',
      '# Source\n\nLinking to [[note#section]] and [[note|with alias]] in body.\n',
    );

    const service = new IndexService(fs);
    await service.buildFullIndex();

    // 明示收紧：wiki-link 目标按 note 名入反链图（不再带锚点）。
    const graph = service.getWikiLinkGraph();
    expect(graph.outgoing['/source.md']).toEqual(['note', 'note']);

    const backlinks = service.getBacklinks('/note.md');
    expect(backlinks.map((b) => b.notePath)).toEqual(['/source.md']);
  });
});
