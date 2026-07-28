/**
 * 11-onboarding.spec.ts — 启动体验契约
 *
 * 当前产品流不再展示首次使用向导、主题宣传页或默认主题选择。
 * 未绑定本地文件夹时必须停在打开闸门，不能提前暴露可写编辑器。
 */
import { expect, test, type Page } from '@playwright/test';

async function clearStartupFlags(page: Page) {
  await page.addInitScript(() => {
    for (let i = localStorage.length - 1; i >= 0; i -= 1) {
      const key = localStorage.key(i);
      if (key?.startsWith('jotluck:welcome')) localStorage.removeItem(key);
    }

    window.__jotluck_e2e = {
      mockNotebook: {
        forceGate: true,
        recentRoots: [],
        pickerOutcome: 'cancel',
      },
    };
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
}

test.describe('启动体验', () => {
  test.beforeEach(async ({ page }) => {
    await clearStartupFlags(page);
  });

  test('01-首次访问不再显示欢迎向导', async ({ page }) => {
    await expect(page.locator('.welcome-overlay')).toHaveCount(0);
    await expect(page.locator('#jotluck-app')).toBeVisible({ timeout: 5000 });
  });

  test('02-首次访问停在文件夹打开闸门', async ({ page }) => {
    await expect(page.getByTestId('notebook-open-gate')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('open-notebook-button')).toBeFocused();
    await expect(page.locator('.cm-content')).toHaveCount(0);
    await expect(page.locator('.topbar')).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole('button', { name: '新建笔记' }).first()).toBeDisabled();
  });

  test('03-不显示旧首页宣传区或默认主题选择', async ({ page }) => {
    await expect(page.locator('.home-shell-welcome')).toHaveCount(0);
    await expect(page.locator('.home-theme-showcase')).toHaveCount(0);
    await expect(page.locator('.theme-showcase')).toHaveCount(0);
  });

  test('04-刷新后仍保持未绑定工作区闸门', async ({ page }) => {
    await expect(page.getByTestId('notebook-open-gate')).toBeVisible({ timeout: 10000 });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('.welcome-overlay')).toHaveCount(0);
    await expect(page.getByTestId('notebook-open-gate')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.cm-content')).toHaveCount(0);
  });
});
