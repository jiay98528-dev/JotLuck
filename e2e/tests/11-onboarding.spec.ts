/**
 * 11-onboarding.spec.ts — 启动体验契约
 *
 * 当前产品流不再展示首次使用向导、主题宣传页或默认主题选择。
 * 首次访问应直接进入可编辑工作区。
 */
import { expect, test, type Page } from '@playwright/test';

async function clearStartupFlags(page: Page) {
  await page.goto('http://localhost:5173', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    for (let i = localStorage.length - 1; i >= 0; i -= 1) {
      const key = localStorage.key(i);
      if (key?.startsWith('jotluck:welcome')) localStorage.removeItem(key);
    }
  });
}

test.describe('启动体验', () => {
  test.beforeEach(async ({ page }) => {
    await clearStartupFlags(page);
    await page.reload({ waitUntil: 'domcontentloaded' });
  });

  test('01-首次访问不再显示欢迎向导', async ({ page }) => {
    await expect(page.locator('.welcome-overlay')).toHaveCount(0);
    await expect(page.locator('#jotluck-app')).toBeVisible({ timeout: 5000 });
  });

  test('02-首次访问直接进入完整编辑工作区', async ({ page }) => {
    await expect(page.locator('.cm-content')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.topbar')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.editor-control-strip')).toBeVisible({ timeout: 5000 });
  });

  test('03-不显示旧首页宣传区或默认主题选择', async ({ page }) => {
    await expect(page.locator('.home-shell-welcome')).toHaveCount(0);
    await expect(page.locator('.home-theme-showcase')).toHaveCount(0);
    await expect(page.locator('.theme-showcase')).toHaveCount(0);
  });

  test('04-刷新后仍保持直接进入工作区', async ({ page }) => {
    await expect(page.locator('.cm-content')).toBeVisible({ timeout: 10000 });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('.welcome-overlay')).toHaveCount(0);
    await expect(page.locator('.cm-content')).toBeVisible({ timeout: 10000 });
  });
});
