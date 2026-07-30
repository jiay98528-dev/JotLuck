import { describe, expect, it } from 'vitest';
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
