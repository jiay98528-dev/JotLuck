import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLocale } from '@/i18n';
import { MockFSService } from '../MockFSService';
import {
  CUSTOM_TEMPLATE_DIR,
  deleteCustomTemplateFile,
  loadCustomTemplatesFromFiles,
  migrateLegacyCustomTemplates,
  renderTemplate,
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

describe('TemplateEngine renderTemplate 时区口径（E1）', () => {
  it('全部日期时间占位符统一本地口径：注入本地分量构造的固定 Date，断言不依赖 UTC', () => {
    // 本地 2026-06-03 23:30（周三）：东八区下 UTC 已是 06-03 15:30（同日），
    // 西五区下 UTC 为 06-04 02:30（次日）——本地口径断言与运行时区无关恒绿，
    // 旧 toISOString 实现在西五区会把 {{date}}/{{datetime}} 推到 06-04 而红。
    // 注：{{week}} 等本地化占位符在 renderTemplate 内被急切求值，非 zh-CN
    // 语言的懒加载消息未就绪时 missing 处理器会抛错——默认 zh-CN 已由
    // setup-i18n 注册，本用例不传 locale。
    const date = new Date(2026, 5, 3, 23, 30, 8);

    const rendered = renderTemplate(
      '{{date}}|{{time}}|{{datetime}}|{{year}}|{{month}}|{{day}}|{{weekRange}}',
      date,
    );

    expect(rendered).toBe(
      '2026-06-03|23:30|2026-06-03 23:30:08|2026|06|03|2026-05-31 ~ 2026-06-06',
    );
  });

  it('weekRange 界随本地周历：周日为一周之始（含跨月），结束为周六', () => {
    // 本地 2026-07-01（周三）：周起点 06-28（周日，跨月），终点 07-04（周六）
    const date = new Date(2026, 6, 1, 12, 0, 0);

    const rendered = renderTemplate('{{weekRange}}', date);

    expect(rendered).toBe('2026-06-28 ~ 2026-07-04');
  });

  it('{{time}}/{{weekday}} 等本地 getter 占位符不受影响（回归钉）', async () => {
    // 星期文案断言需要 en 消息：setLocale 先行加载（与 i18n.test.ts 同口径）
    await setLocale('en', { persist: false });
    const date = new Date(2026, 5, 3, 9, 7, 8);

    const rendered = renderTemplate('{{time}}|{{weekday}}', date, 'en');

    expect(rendered).toBe('09:07|Wednesday');
  });
});

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

  it('同名模板不再静默覆盖：另存冲突报 fileExists 且旧内容保持原样（L14）', async () => {
    const fs = new MockFSService(0, { persist: false });

    await saveCustomTemplateToFiles(fs, '周会', '第一版', '# 第一版内容\n');
    await expect(saveCustomTemplateToFiles(fs, '周会', '第二版', '# 第二版内容\n')).rejects.toThrow(
      '同名模板已存在：周会',
    );

    // 旧模板内容未被覆盖；改名后可正常另存
    const kept = await fs.readFile(`${CUSTOM_TEMPLATE_DIR}/周会.md`);
    expect(kept).toContain('# 第一版内容');
    const renamed = await saveCustomTemplateToFiles(fs, '周会-新', '第二版', '# 第二版内容\n');
    expect(renamed.id).toBe(`${CUSTOM_TEMPLATE_DIR}/周会-新.md`);
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
