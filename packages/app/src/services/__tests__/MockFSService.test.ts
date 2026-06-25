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

    await expect(fs.readFile('/快速入门.md')).resolves.toContain('欢迎使用 MarkLuck');
    await expect(fs.readFile('/格式示例.md')).resolves.toContain('# 格式示例');
  });

  it('opens the sample notebook through the common file-system contract', async () => {
    const fs = new MockFSService(0);

    await expect(fs.openNotebook()).resolves.toMatchObject({
      rootPath: '/',
      name: '示例笔记本',
    });
    await expect(fs.openNotebookAt('ignored-in-mock')).resolves.toMatchObject({
      rootPath: '/',
      name: '示例笔记本',
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
});
