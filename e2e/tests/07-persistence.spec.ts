import { expect, test, type Page } from '@playwright/test';
import {
  createBlankNote,
  getEditorContent,
  typeInEditor,
  waitForAppReady,
  waitForAutoSave,
} from '../helpers/test-utils';

const MOCKFS_KEY = 'markluck-mockfs';
const SEARCH_HISTORY_KEY = 'markluck-search-history';

async function waitForAnyMockFileContent(page: Page, expected: string) {
  await expect
    .poll(
      () =>
        page.evaluate((text) => {
          const raw = localStorage.getItem('markluck-mockfs');
          if (!raw) return false;
          const data = JSON.parse(raw) as { files?: Record<string, { content?: string }> };
          return Object.values(data.files ?? {}).some((file) => file.content?.includes(text));
        }, expected),
      { timeout: 10000 },
    )
    .toBe(true);
}

test.describe('Persistence', () => {
  test.beforeEach(async ({ page }) => {
    await waitForAppReady(page);
  });

  test('V3: 笔记内容在刷新后保持', async ({ page }) => {
    const content = `# Persistence\n\n${Date.now()}`;

    await createBlankNote(page);
    await typeInEditor(page, content);
    await waitForAutoSave(page);
    await waitForAnyMockFileContent(page, content);

    await page.reload();
    await waitForAppReady(page);

    await page.locator('.wing-bookmark-dot[aria-label="Persistence"]').click();
    await expect.poll(() => getEditorContent(page), { timeout: 10000 }).toContain(content);
  });

  test('V3: 切换到其他笔记再切回后内容保持', async ({ page }) => {
    const content = `# Switch Back\n\n${Date.now()}`;

    await createBlankNote(page);
    await typeInEditor(page, content);
    await waitForAutoSave(page);
    await waitForAnyMockFileContent(page, content);

    await page.locator('.wing-bookmark-dot[aria-label="快速入门"]').click();
    await expect.poll(() => getEditorContent(page), { timeout: 5000 }).not.toContain(content);
    await page.locator('.wing-bookmark-dot[aria-label="Switch Back"]').click();

    await expect.poll(() => getEditorContent(page), { timeout: 10000 }).toContain(content);
  });

  test('V1: MockFS 数据存在于 localStorage', async ({ page }) => {
    const hasMockFs = await page.evaluate((key) => {
      const raw = localStorage.getItem(key);
      if (!raw) return false;
      try {
        return typeof JSON.parse(raw) === 'object';
      } catch {
        return false;
      }
    }, MOCKFS_KEY);

    expect(hasMockFs).toBe(true);
  });

  test('V1: 核心 localStorage key 可见', async ({ page }) => {
    await page.waitForTimeout(1000);

    const keys = await page.evaluate(() => {
      const result: string[] = [];
      for (let i = 0; i < localStorage.length; i += 1) {
        result.push(localStorage.key(i) ?? '');
      }
      return result.filter((key) => key.startsWith('markluck'));
    });

    expect(keys).toContain(MOCKFS_KEY);
    expect(keys.length).toBeGreaterThanOrEqual(1);
    expect(
      keys.includes(SEARCH_HISTORY_KEY) || keys.some((key) => key.startsWith('markluck:ngram:')),
    ).toBeTruthy();
  });
});
