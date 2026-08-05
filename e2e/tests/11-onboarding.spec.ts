/**
 * 11-onboarding.spec.ts — 启动体验契约
 *
 * 首次进入正常工作区时展示可跳过的欢迎引导。
 * 引导结束后，未绑定本地文件夹时必须停在打开闸门，不能提前暴露可写编辑器。
 */
import { expect, test, type Page } from '@playwright/test';

async function clearStartupFlags(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('jotluck:locale:v1', 'zh-CN');
    const cleanBootMarker = 'jotluck:e2e:onboarding-clean-boot';
    if (sessionStorage.getItem(cleanBootMarker) !== '1') {
      for (let i = localStorage.length - 1; i >= 0; i -= 1) {
        const key = localStorage.key(i);
        if (key?.startsWith('jotluck:welcome')) localStorage.removeItem(key);
      }
      sessionStorage.setItem(cleanBootMarker, '1');
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

async function skipWelcome(page: Page) {
  await expect(page.locator('.welcome-overlay')).toBeVisible({ timeout: 10000 });
  await page.getByRole('button', { name: '跳过' }).click();
  await expect(page.locator('.welcome-overlay')).toHaveCount(0);
}

test.describe('启动体验', () => {
  test.beforeEach(async ({ page }) => {
    await clearStartupFlags(page);
  });

  test('01-首次访问显示欢迎向导，跳过后记录完成状态', async ({ page }) => {
    await expect(page.getByRole('dialog', { name: 'JotLuck' })).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('你的笔记就是纯文本文件')).toBeVisible();
    await skipWelcome(page);
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem('jotluck:welcome:completed')))
      .toBe('1');
  });

  test('02-跳过欢迎引导后停在文件夹打开闸门', async ({ page }) => {
    await skipWelcome(page);
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
    await skipWelcome(page);
    await expect(page.getByTestId('notebook-open-gate')).toBeVisible({ timeout: 10000 });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('.welcome-overlay')).toHaveCount(0);
    await expect(page.getByTestId('notebook-open-gate')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.cm-content')).toHaveCount(0);
  });

  test('05-默认应用步骤逐项显示五类格式且仅预选 Markdown', async ({ page }) => {
    const next = page.locator('.welcome-next-btn');
    await next.click();
    await next.click();
    await next.click();

    await expect(page.getByRole('heading', { name: '选择用 JotLuck 打开的文件' })).toBeVisible();
    const choices = page.locator('.welcome-association-checkbox');
    await expect(choices).toHaveCount(5);
    await expect(choices.nth(0)).toHaveAttribute('data-association-id', 'markdown');
    await expect(choices.nth(0)).toBeChecked();
    for (let index = 1; index < 5; index += 1) {
      await expect(choices.nth(index)).not.toBeChecked();
    }

    for (const label of ['Markdown', '纯文本', 'Word', 'PDF', 'Excel']) {
      await expect(page.locator('.welcome-association-row', { hasText: label })).toBeVisible();
    }
    await expect(page.locator('.welcome-association-row', { hasText: 'Excel' })).toContainText(
      '.xlsx, .xls',
    );

    const textChoice = page.locator('[data-association-id="text"]');
    await textChoice.check();
    await expect(textChoice).toBeChecked();
    await expect(textChoice.locator('xpath=..')).toContainText('当前平台不支持');
  });
});
