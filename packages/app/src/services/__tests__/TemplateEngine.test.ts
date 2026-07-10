import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MockFSService } from '../MockFSService';
import {
  CUSTOM_TEMPLATE_DIR,
  deleteCustomTemplateFile,
  loadCustomTemplatesFromFiles,
  migrateLegacyCustomTemplates,
  saveCustomTemplateToFiles,
} from '../TemplateEngine';

function setupLocalStorageMock() {
  const store: Record<string, string> = {};
  vi.stubGlobal('localStorage', {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      Object.keys(store).forEach((key) => delete store[key]);
    }),
  });
  return store;
}

describe('TemplateEngine file-backed custom templates', () => {
  beforeEach(() => {
    setupLocalStorageMock();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('saves custom templates as notebook files and hides the controlled directory from root listing', async () => {
    const fs = new MockFSService(0, { persist: false });

    const saved = await saveCustomTemplateToFiles(fs, '复盘模板', '每日复盘', '# 复盘\n\n');
    const templates = await loadCustomTemplatesFromFiles(fs);
    const rootEntries = await fs.listDirectory('/');

    expect(saved.id).toBe(`${CUSTOM_TEMPLATE_DIR}/复盘模板.md`);
    expect(templates).toMatchObject([
      { id: saved.id, name: '复盘模板', description: '每日复盘', content: '# 复盘\n\n' },
    ]);
    expect(rootEntries.some((entry) => entry.name === '.jotluck')).toBe(false);
  });

  it('migrates legacy localStorage templates once and removes the old hidden content key', async () => {
    const fs = new MockFSService(0, { persist: false });
    localStorage.setItem(
      'jotluck-custom-templates',
      JSON.stringify([
        {
          id: 'custom-legacy',
          name: '旧模板',
          description: '旧描述',
          content: '# 旧内容',
          isBuiltin: false,
        },
      ]),
    );

    await migrateLegacyCustomTemplates(fs);

    expect(localStorage.getItem('jotluck-custom-templates')).toBeNull();
    await expect(fs.readFile(`${CUSTOM_TEMPLATE_DIR}/旧模板.md`)).resolves.toContain('# 旧内容');
  });

  it('rejects deleting paths outside the controlled template directory', async () => {
    const fs = new MockFSService(0, { persist: false });

    await expect(deleteCustomTemplateFile(fs, '/普通笔记.md')).rejects.toThrow(
      '模板路径不在受控目录内',
    );
  });
});
