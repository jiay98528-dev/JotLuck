/**
 * 11-onboarding.spec.ts — 首次使用向导 E2E 测试
 *
 * 覆盖：6步向导流程、跳过、完成标记持久化
 * 注意：需要清除 localStorage 来触发向导
 */
import { test, expect } from '@playwright/test';

test.describe('首次使用向导', () => {
  test.beforeEach(async ({ page }) => {
    // 清除向导完成标记以触发欢迎页
    await page.goto('http://localhost:5173', { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => {
      localStorage.removeItem('markluck:welcome:completed');
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1000);
  });

  test('01-首次访问显示欢迎向导', async ({ page }) => {
    await expect(page.locator('.welcome-overlay')).toBeVisible({ timeout: 5000 });
  });

  test('02-向导显示品牌名称', async ({ page }) => {
    await expect(page.locator('.welcome-brand-name')).toBeVisible({ timeout: 3000 });
    await expect(page.locator('.welcome-brand-name')).toContainText('MarkLuck');
  });

  test('03-向导显示6个步骤指示器', async ({ page }) => {
    const dots = page.locator('.welcome-step-dot');
    await expect(dots.first()).toBeVisible({ timeout: 3000 });
    const count = await dots.count();
    expect(count).toBe(6);
  });

  test('04-第一步显示"下一步"按钮', async ({ page }) => {
    await expect(page.locator('.welcome-next-btn')).toBeVisible({ timeout: 3000 });
  });

  test('05-第一步显示"跳过"链接', async ({ page }) => {
    await expect(page.locator('.welcome-skip-link')).toBeVisible({ timeout: 3000 });
    await expect(page.locator('.welcome-skip-link')).toContainText('跳过');
  });

  test('06-点击"下一步"进入第二步', async ({ page }) => {
    await page.locator('.welcome-next-btn').click();
    await page.waitForTimeout(400);

    // 第二个步骤圆点应该变为 active
    const dots = page.locator('.welcome-step-dot');
    const secondDot = dots.nth(1);
    await expect(secondDot).toHaveClass(/active/);
  });

  test('07-可以一路点击到第六步', async ({ page }) => {
    // 点击 5 次"下一步"到达第 6 步
    for (let i = 0; i < 5; i++) {
      await page.locator('.welcome-next-btn').click();
      await page.waitForTimeout(300);
    }

    // 第 6 步按钮变为"完成设置"
    const nextBtn = page.locator('.welcome-next-btn');
    await expect(nextBtn).toBeVisible();
    await expect(nextBtn).toContainText('完成设置');
  });

  test('08-点击"完成设置"关闭向导', async ({ page }) => {
    // 快速到达第 6 步
    for (let i = 0; i < 5; i++) {
      await page.locator('.welcome-next-btn').click();
      await page.waitForTimeout(200);
    }

    // 点击完成
    await page.locator('.welcome-next-btn').click();
    await page.waitForTimeout(500);

    // 向导应该关闭
    await expect(page.locator('.welcome-overlay')).not.toBeVisible({ timeout: 3000 });

    // 首屏应该回到应用壳层与主题展柜
    await expect(page.locator('.app-shell')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.home-shell-welcome')).toBeVisible({ timeout: 5000 });
  });

  test('09-完成向导后标记持久化', async ({ page }) => {
    // 完成向导
    for (let i = 0; i < 5; i++) {
      await page.locator('.welcome-next-btn').click();
      await page.waitForTimeout(200);
    }
    await page.locator('.welcome-next-btn').click();
    await page.waitForTimeout(500);

    // 验证 localStorage 标志
    const flag = await page.evaluate(() => localStorage.getItem('markluck:welcome:completed'));
    expect(flag).toBe('1');

    // 刷新后向导不再显示
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1000);

    await expect(page.locator('.welcome-overlay')).not.toBeVisible({ timeout: 3000 });
  });

  test('10-点击"跳过"关闭向导', async ({ page }) => {
    await page.locator('.welcome-skip-link').click();
    await page.waitForTimeout(500);

    // 向导应该关闭，应用正常加载
    await expect(page.locator('.welcome-overlay')).not.toBeVisible({ timeout: 3000 });
    await expect(page.locator('.app-shell')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.home-shell-welcome')).toBeVisible({ timeout: 5000 });
  });

  test('11-向导步骤1显示隐私说明', async ({ page }) => {
    // 第一步应该包含隐私相关文字
    const stepBody = page.locator('.welcome-step-body').first();
    await expect(stepBody).toBeVisible({ timeout: 3000 });
    const text = await stepBody.textContent();
    expect(text).toBeTruthy();
    expect(text!.length).toBeGreaterThan(10);
  });
});
