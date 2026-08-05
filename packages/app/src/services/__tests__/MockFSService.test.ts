import { describe, expect, it, beforeEach } from 'vitest';
import { MockFSService } from '../MockFSService';

describe('MockFSService sample notebook', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('seeds readable first-run documents', async () => {
    const fs = new MockFSService(0);

    const rootEntries = await fs.listDirectory('/');
    const names = rootEntries.map((entry) => entry.name);

    expect(names).toContain('快速入门.md');
    expect(names).toContain('格式示例.md');

    await expect(fs.readFile('/快速入门.md')).resolves.toContain('欢迎使用 JotLuck');
    await expect(fs.readFile('/格式示例.md')).resolves.toContain('# 格式示例');
  });

  it('opens the sample notebook through the common file-system contract', async () => {
    const fs = new MockFSService(0);

    await expect(fs.openNotebook()).resolves.toMatchObject({
      rootPath: '/',
      name: '示例笔记本',
    });
    await expect(fs.getRecentNotebooks()).resolves.toEqual(['/']);
    await expect(fs.openNotebookAt('ignored-in-mock')).resolves.toMatchObject({
      rootPath: 'ignored-in-mock',
      name: 'ignored-in-mock',
    });
  });

  it('models no recent notebook, picker cancellation, and picker failure independently', async () => {
    const cancelled = new MockFSService(0, {
      recentNotebooks: [],
      pickerResult: null,
    });
    const failed = new MockFSService(0, {
      recentNotebooks: ['missing'],
      pickerError: '没有权限',
      unavailableNotebookPaths: ['missing'],
    });

    await expect(cancelled.getRecentNotebooks()).resolves.toEqual([]);
    await expect(cancelled.openNotebook()).resolves.toBeNull();
    await expect(failed.openNotebookAt('missing')).rejects.toMatchObject({
      payload: { code: 'not_found' },
    });
    await expect(failed.openNotebook()).rejects.toMatchObject({
      payload: { code: 'permission_denied' },
    });
  });

  it('lists only directories and supported editable note files', async () => {
    const fs = new MockFSService(0);

    await fs.createDirectory('/mixed');
    await fs.writeFile('/mixed/readme.md', '# Readme');
    await fs.writeFile('/mixed/long-form.markdown', '# Long form');
    await fs.writeFile('/mixed/component.mdx', '# Component');
    await fs.writeFile('/mixed/plain.txt', 'Plain text');
    await fs.writeFile('/mixed/image.png', 'not listed');
    await fs.writeFile('/mixed/export.pdf', 'not listed');
    await fs.writeFile('/mixed/readme.md.bak', 'not listed');

    const entries = await fs.listDirectory('/mixed');
    const names = entries.map((entry) => entry.name);

    expect(names).toEqual(['component.mdx', 'long-form.markdown', 'plain.txt', 'readme.md']);
  });

  it('keeps browser-preview writes in memory unless persistence is enabled', async () => {
    const memoryFs = new MockFSService(0);

    await memoryFs.writeFile('/draft.md', '# Draft');

    expect(localStorage.getItem('jotluck-mockfs')).toBeNull();
    await expect(new MockFSService(0).readFile('/draft.md')).rejects.toThrow();
  });

  it('persists writes only when explicitly requested', async () => {
    const persistentFs = new MockFSService(0, { persist: true });

    await persistentFs.writeFile('/draft.md', '# Draft');

    await expect(new MockFSService(0, { persist: true }).readFile('/draft.md')).resolves.toBe(
      '# Draft',
    );
  });

  it('rejects a conditional save after an external-style write changed the revision', async () => {
    const fs = new MockFSService(0);
    await fs.writeFile('/draft.md', '# Original');
    const snapshot = await fs.readFileSnapshot('/draft.md');
    expect(snapshot.revision).toMatch(/^sha256:[a-f0-9]{64}$/u);

    await fs.writeFile('/draft.md', '# External');
    await expect(
      fs.writeFileIfUnchanged('/draft.md', '# Local', snapshot.revision),
    ).resolves.toMatchObject({ status: 'conflict' });
    await expect(fs.readFile('/draft.md')).resolves.toBe('# External');
  });

  it('writes on a matching revision and enforces create-only null revisions', async () => {
    const fs = new MockFSService(0);
    await fs.writeFile('/draft.md', '# Original');
    const snapshot = await fs.readFileSnapshot('/draft.md');

    const saved = await fs.writeFileIfUnchanged('/draft.md', '# Local', snapshot.revision);
    expect(saved).toMatchObject({ status: 'saved' });
    await expect(fs.readFile('/draft.md')).resolves.toBe('# Local');
    await expect(fs.writeFileIfUnchanged('/draft.md', '# Replace', null)).resolves.toMatchObject({
      status: 'conflict',
    });
    await expect(fs.writeFileIfUnchanged('/new.md', '# New', null)).resolves.toMatchObject({
      status: 'saved',
    });
  });

  it('rejects rename collisions instead of overwriting the destination', async () => {
    const fs = new MockFSService(0);
    await fs.writeFile('/source.md', '# Source');
    await fs.writeFile('/target.md', '# Target');

    await expect(fs.renameFile('/source.md', '/target.md')).rejects.toMatchObject({
      payload: { code: 'already_exists' },
    });
    await expect(fs.readFile('/source.md')).resolves.toBe('# Source');
    await expect(fs.readFile('/target.md')).resolves.toBe('# Target');
  });

  it('uses path segment boundaries when checking notebook membership', async () => {
    const fs = new MockFSService(0);

    await expect(fs.isPathInNotebook('/notes', '/notes/a.md')).resolves.toBe(true);
    await expect(fs.isPathInNotebook('/notes', '/notes2/a.md')).resolves.toBe(false);
  });
});
