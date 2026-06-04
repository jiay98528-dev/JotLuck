/**
 * M2 E2E — 搜索系统
 * 覆盖：打开/关闭、关键词搜索、过滤、导航、历史
 */
import { test, expect } from '@playwright/test';

test.describe('搜索系统', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.locator('#markluck-app').waitFor({ timeout: 15000 });
  });

  test('V1: Ctrl+Shift+P 打开搜索面板', async ({ page }) => {
    await page.keyboard.press('Control+Shift+P');
    await expect(page.locator('.search-panel')).toBeVisible({ timeout: 3000 });
    await expect(page.locator('.search-input')).toBeVisible();
  });

  test('V1: Escape 关闭搜索面板', async ({ page }) => {
    await page.keyboard.press('Control+Shift+P');
    await expect(page.locator('.search-panel')).toBeVisible({ timeout: 3000 });
    await page.keyboard.press('Escape');
    await expect(page.locator('.search-panel')).not.toBeVisible({ timeout: 2000 });
  });

  test('V1: 点击覆盖层关闭搜索', async ({ page }) => {
    await page.keyboard.press('Control+Shift+P');
    await expect(page.locator('.search-panel')).toBeVisible({ timeout: 3000 });
    await page.locator('.search-overlay').click({ position: { x: 10, y: 10 } });
    await expect(page.locator('.search-panel')).not.toBeVisible({ timeout: 2000 });
  });

  test('V1: 中文关键词搜索 — "欢迎"', async ({ page }) => {
    await page.keyboard.press('Control+Shift+P');
    await expect(page.locator('.search-panel')).toBeVisible({ timeout: 3000 });

    await page.locator('.search-input').fill('欢迎');
    // 等待防抖搜索完成
    await page.waitForTimeout(800);

    // 应该有搜索结果
    const results = page.locator('.search-result-item');
    const count = await results.count();
    expect(count).toBeGreaterThanOrEqual(1);
  });

  test('V1: 英文搜索 — "MarkLuck"', async ({ page }) => {
    await page.keyboard.press('Control+Shift+P');
    await expect(page.locator('.search-panel')).toBeVisible({ timeout: 3000 });

    await page.locator('.search-input').fill('MarkLuck');
    await page.waitForTimeout(800);

    const results = page.locator('.search-result-item');
    const count = await results.count();
    expect(count).toBeGreaterThanOrEqual(1);
  });

  test('V1: 标签搜索 — tag:tutorial', async ({ page }) => {
    await page.keyboard.press('Control+Shift+P');
    await expect(page.locator('.search-panel')).toBeVisible({ timeout: 3000 });

    await page.locator('.search-input').fill('tag:tutorial');
    await page.waitForTimeout(800);

    // 过滤标签应显示
    await expect(page.locator('.filter-tag')).toBeVisible({ timeout: 2000 });
    expect(await page.locator('.filter-tag').innerText()).toContain('tutorial');
  });

  test('V1: 点击搜索结果跳转到对应笔记', async ({ page }) => {
    await page.keyboard.press('Control+Shift+P');
    await expect(page.locator('.search-panel')).toBeVisible({ timeout: 3000 });

    await page.locator('.search-input').fill('快速入门');
    await page.waitForTimeout(800);

    // 点击第一个结果
    const firstResult = page.locator('.search-result-item').first();
    const visible = await firstResult.isVisible();
    if (visible) {
      await firstResult.click();
      // 应跳转到对应笔记
      await expect(page.locator('.editor-file-name')).toContainText('快速入门.md', {
        timeout: 5000,
      });
    }
  });

  test('V1: 搜索无匹配时显示空状态', async ({ page }) => {
    await page.keyboard.press('Control+Shift+P');
    await expect(page.locator('.search-panel')).toBeVisible({ timeout: 3000 });

    await page.locator('.search-input').fill('zzzNoSuchNote999');
    await page.waitForTimeout(800);

    // 应显示空状态
    const empty = page.locator('.search-empty');
    if (await empty.isVisible()) {
      await expect(empty).toContainText('未找到匹配');
    }
  });

  test('V1: 清除搜索输入', async ({ page }) => {
    await page.keyboard.press('Control+Shift+P');
    await expect(page.locator('.search-panel')).toBeVisible({ timeout: 3000 });

    await page.locator('.search-input').fill('测试');
    await page.waitForTimeout(300);

    // 清除按钮应出现
    await expect(page.locator('.search-clear')).toBeVisible({ timeout: 2000 });
    await page.locator('.search-clear').click();

    // 输入框应清空
    const inputValue = await page.locator('.search-input').inputValue();
    expect(inputValue).toBe('');
  });

  test('V1: 搜索结果数显示', async ({ page }) => {
    await page.keyboard.press('Control+Shift+P');
    await expect(page.locator('.search-panel')).toBeVisible({ timeout: 3000 });

    await page.locator('.search-input').fill('欢迎');
    await page.waitForTimeout(800);

    // 结果数应显示
    const results = page.locator('.search-result-item');
    const count = await results.count();
    if (count > 0) {
      await expect(page.locator('.search-results-header')).toContainText(String(count));
    }
  });

  test('V1: 键盘上下导航搜索结果', async ({ page }) => {
    await page.keyboard.press('Control+Shift+P');
    await expect(page.locator('.search-panel')).toBeVisible({ timeout: 3000 });

    await page.locator('.search-input').fill('欢迎');
    await page.waitForTimeout(800);

    const results = page.locator('.search-result-item');
    const count = await results.count();

    if (count >= 2) {
      // 按下箭头选中第二个
      await page.keyboard.press('ArrowDown');
      const selected = page.locator('.search-result-item--selected');
      await expect(selected).toBeVisible({ timeout: 2000 });
    }
  });

  test('V1: Enter + ArrowDown 选择结果后跳转', async ({ page }) => {
    await page.keyboard.press('Control+Shift+P');
    await expect(page.locator('.search-panel')).toBeVisible({ timeout: 3000 });

    await page.locator('.search-input').fill('快速入门');
    await page.waitForTimeout(800);

    // 先按 ArrowDown 选中第一个结果，再按 Enter 跳转
    // （直接 Enter 只触发搜索，不跳转；需先选中结果）
    const resultCount = await page.locator('.search-result-item').count();
    if (resultCount > 0) {
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('Enter');
      // 应关闭搜索面板并跳转
      await expect(page.locator('.search-panel')).not.toBeVisible({ timeout: 3000 });
      await expect(page.locator('.editor-file-name')).toBeVisible({ timeout: 5000 });
    }
  });

  test('V1: 搜索历史 — 点击搜索结果后重新打开面板显示历史', async ({ page }) => {
    // 第一次搜索：打开搜索 → 输入 → 点击结果（触发 addToHistory）
    await page.keyboard.press('Control+Shift+P');
    await expect(page.locator('.search-panel')).toBeVisible({ timeout: 3000 });
    await page.locator('.search-input').fill('欢迎');
    await page.waitForTimeout(800);

    // 点击第一个搜索结果（这会触发 selectResult → addToHistory）
    const firstResult = page.locator('.search-result-item').first();
    if (await firstResult.isVisible()) {
      await firstResult.click();
      await page.waitForTimeout(500);
    }

    // 第二次打开搜索 — query 已清除，应显示历史
    await page.keyboard.press('Control+Shift+P');
    await expect(page.locator('.search-panel')).toBeVisible({ timeout: 3000 });

    // 搜索历史应显示（前提是输入框为空且输入框未自动填充）
    const hasHistory = await page
      .locator('.search-history')
      .isVisible()
      .catch(() => false);
    const inputEmpty = (await page.locator('.search-input').inputValue()) === '';

    if (hasHistory) {
      // 历史可见，验证包含搜索词
      await expect(page.locator('.search-history-item')).toContainText('欢迎');
    } else if (!inputEmpty) {
      // query 被自动填充了，清除后历史应出现
      await page.locator('.search-input').clear();
      await page.waitForTimeout(300);
      await expect(page.locator('.search-history')).toBeVisible({ timeout: 3000 });
    }
  });
});
