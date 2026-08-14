import { describe, expect, it } from 'vitest';
import {
  applyGuidedSampleEdit,
  createGuidedSampleSession,
  decideEmptyWorkspaceFallback,
  findGuidedSampleNote,
  findGuidedSampleNoteByTitle,
  guidedNotesAsDirEntries,
  guidedSampleWikiLinkExists,
  isGuidedSampleDirty,
  nextAvailableNotePath,
} from '../GuidedSampleSession';

describe('decideEmptyWorkspaceFallback', () => {
  it('opens an in-memory guided session on an empty desktop launch', () => {
    expect(
      decideEmptyWorkspaceFallback({ isDesktop: true, forceGate: false, recentCount: 0 }),
    ).toBe('guided-sample');
  });

  it('keeps the web MockFS default and the explicit gate paths', () => {
    expect(
      decideEmptyWorkspaceFallback({ isDesktop: false, forceGate: false, recentCount: 0 }),
    ).toBe('web-default');
    expect(
      decideEmptyWorkspaceFallback({ isDesktop: false, forceGate: true, recentCount: 0 }),
    ).toBe('gate');
    expect(
      decideEmptyWorkspaceFallback({ isDesktop: true, forceGate: false, recentCount: 2 }),
    ).toBe('gate');
  });
});

describe('createGuidedSampleSession', () => {
  it('materializes every seed note in memory without a filesystem', () => {
    const session = createGuidedSampleSession('zh-CN');

    expect(session.notebookName).toBe('示例笔记本');
    expect(session.notes.map((note) => note.path)).toEqual([
      '/快速入门.md',
      '/格式示例.md',
      '/项目规划.md',
      '/设计笔记.md',
      '/子文件夹/笔记A.md',
    ]);
    expect(session.notes[0]?.title).toBe('快速入门');
    expect(session.notes.every((note) => note.content === note.originalContent)).toBe(true);
    expect(guidedNotesAsDirEntries(session)).toHaveLength(5);
  });

  it('keeps edits in memory and leaves the original seed intact', () => {
    const session = createGuidedSampleSession('zh-CN');
    const first = session.notes[0];
    if (!first) throw new Error('expected a first guided note');

    const edited = applyGuidedSampleEdit(session, first.path, `${first.content}\nextra`);
    const editedNote = findGuidedSampleNote(edited, first.path);
    if (!editedNote) throw new Error('expected the edited guided note');

    expect(edited).not.toBe(session);
    expect(isGuidedSampleDirty(editedNote)).toBe(true);
    expect(findGuidedSampleNote(session, first.path)?.content).toBe(first.originalContent);
    expect(applyGuidedSampleEdit(edited, first.path, editedNote.content)).toBe(edited);
  });

  it('resolves wiki-link titles against the in-memory set only', () => {
    const session = createGuidedSampleSession('zh-CN');

    expect(guidedSampleWikiLinkExists(session, '格式示例')).toBe(true);
    expect(findGuidedSampleNoteByTitle(session, '笔记A')?.path).toBe('/子文件夹/笔记A.md');
    expect(guidedSampleWikiLinkExists(session, '用户自己的笔记')).toBe(false);
  });

  it('avoids colliding with an existing path when carrying one note', () => {
    expect(nextAvailableNotePath(['/快速入门.md'], '/快速入门.md')).toBe('/快速入门-2.md');
    expect(nextAvailableNotePath(['/快速入门.md', '/快速入门-2.md'], '/快速入门.md')).toBe(
      '/快速入门-3.md',
    );
  });
});
