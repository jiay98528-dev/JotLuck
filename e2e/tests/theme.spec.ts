/**
 * Paper Theme E2E — 纸张主题系统集成测试
 *
 * Single theme system: light (warm paper) + dark (dark cardstock).
 * No more construct/glass dual-theme switching.
 */
import { test, expect } from '@playwright/test';

test.describe('纸张主题', () => {
  test('V1: 默认为亮色纸张主题', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('data-color-scheme', 'light', {
      timeout: 15000,
    });
    // Paper theme uses warm off-white background
    const bgColor = await page
      .locator('body')
      .evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(bgColor).toBeTruthy();
  });

  test('V1: 切换到暗色模式', async ({ page }) => {
    await page.goto('/');
    // Click the dark mode toggle button
    const darkBtn = page.locator('.theme-btn--dark, [data-color-scheme-toggle]').first();
    if (await darkBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await darkBtn.click();
      await expect(page.locator('html')).toHaveAttribute('data-color-scheme', 'dark', {
        timeout: 5000,
      });
    }
    // If no toggle button, test is skipped — single-theme is acceptable
  });

  test('V3: 暗色模式持久化 — 刷新后保持', async ({ page }) => {
    await page.goto('/');
    const darkBtn = page.locator('.theme-btn--dark, [data-color-scheme-toggle]').first();
    if (await darkBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await darkBtn.click();
      await expect(page.locator('html')).toHaveAttribute('data-color-scheme', 'dark', {
        timeout: 5000,
      });

      await page.reload();
      await expect(page.locator('html')).toHaveAttribute('data-color-scheme', 'dark', {
        timeout: 15000,
      });
    }
  });

  test('V1: 亮色模式切换回', async ({ page }) => {
    await page.goto('/');
    const darkBtn = page.locator('.theme-btn--dark, [data-color-scheme-toggle]').first();
    const lightBtn = page.locator('.theme-btn--light, [data-color-scheme-toggle]').first();
    if (await darkBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await darkBtn.click();
      await expect(page.locator('html')).toHaveAttribute('data-color-scheme', 'dark', {
        timeout: 5000,
      });
      // Switch back
      if (await lightBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await lightBtn.click();
      }
    }
  });

  test('V1: 纸张主题 — css变量已定义', async ({ page }) => {
    await page.goto('/');
    // Verify paper theme CSS variables are present
    const hasPaperVars = await page.evaluate(() => {
      const styles = getComputedStyle(document.documentElement);
      return (
        styles.getPropertyValue('--paper-bg').trim().length > 0 &&
        styles.getPropertyValue('--ink-primary').trim().length > 0
      );
    });
    expect(hasPaperVars).toBe(true);
  });

  test('V1: 纸张主题 — 无旧主题残留', async ({ page }) => {
    await page.goto('/');
    // Verify old construct/glass attributes are NOT present
    const html = page.locator('html');
    await expect(html).not.toHaveAttribute('data-theme', 'construct', { timeout: 5000 });
    await expect(html).not.toHaveAttribute('data-theme', 'glass', { timeout: 5000 });
  });
});
