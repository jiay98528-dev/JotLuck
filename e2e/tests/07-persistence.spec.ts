import { expect, test } from '@playwright/test';
import {
  getEditorContent,
  typeInEditor,
  waitForAppReady,
  waitForAutoSave,
  waitForMockFileContent,
} from '../helpers/test-utils';

const MOCKFS_KEY = 'markluck-mockfs';
const SEARCH_HISTORY_KEY = 'markluck-search-history';

test.describe('Persistence', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);
  });

  test('V3: 笔记内容在刷新后保持', async ({ page }) => {
    const content = `# Persistence\n\n${Date.now()}`;

    await typeInEditor(page, content);
    await waitForAutoSave(page);
    await waitForMockFileContent(page, '/welcome.md', content);

    await page.reload();
    await waitForAppReady(page);

    const restored = await getEditorContent(page);
    expect(restored).toContain(content);
  });

  test('V3: 切换到其他笔记再切回后内容保持', async ({ page }) => {
    const content = `# Switch Back\n\n${Date.now()}`;

    await typeInEditor(page, content);
    await waitForAutoSave(page);

    await page.locator('.wing-bookmark-dot').nth(1).click();
    await page.waitForTimeout(250);
    await page.locator('.wing-bookmark-dot').first().click();
    await waitForAutoSave(page);

    const restored = await getEditorContent(page);
    expect(restored).toContain(content);
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
