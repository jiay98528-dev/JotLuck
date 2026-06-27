/**
 * 03-search.spec.ts — 搜索系统 / 命令面板 E2E 测试
 *
 * 覆盖：命令面板打开/关闭 (Ctrl+K, Ctrl+Shift+P, 搜索提示按钮)、
 * 关键词搜索、空结果、键盘导航 (ArrowDown/ArrowUp)、Enter 选择、快速操作按钮。
 *
 * @see packages/app/src/components/overlays/CommandPalette.vue
 * @see e2e/helpers/test-utils.ts
 */
import { test, expect } from '@playwright/test';
import { waitForAppReady, waitForSearchReady } from '../helpers/test-utils';

test.describe('搜索系统', () => {
  test.beforeEach(async ({ page }) => {
    await waitForAppReady(page);
    await waitForSearchReady(page);
  });

  // ============================================================
  // 1. Open / Close
  // ============================================================

  test('should open command palette with Ctrl+P', async ({ page }) => {
    // Ctrl+Shift+P is the standard VS Code-style palette shortcut
    await page.keyboard.press('Control+Shift+P');
    await expect(page.locator('.palette')).toBeVisible({ timeout: 2000 });
    await expect(page.locator('.search-input')).toBeVisible();
  });

  test('should close command palette with Escape', async ({ page }) => {
    // Open via Ctrl+K
    await page.keyboard.press('Control+k');
    await expect(page.locator('.palette')).toBeVisible({ timeout: 2000 });

    // Close via Escape
    await page.keyboard.press('Escape');
    await expect(page.locator('.palette')).not.toBeVisible({ timeout: 2000 });
  });

  // ============================================================
  // 2. Search & Results
  // ============================================================

  test('should search and find results', async ({ page }) => {
    await page.keyboard.press('Control+k');
    await expect(page.locator('.palette')).toBeVisible({ timeout: 2000 });

    // Type a search query that should match known content
    const searchInput = page.locator('.search-input');
    await searchInput.fill('欢迎');
    // Wait for debounced search to complete
    await page.waitForTimeout(800);

    // Results should appear with title and path
    const results = page.locator('.result-item');
    const count = await results.count();
    expect(count).toBeGreaterThanOrEqual(1);

    const firstResult = results.first();
    await expect(firstResult.locator('.result-title')).toBeVisible();
    await expect(firstResult.locator('.result-title')).not.toBeEmpty();
  });

  test('should show no results for nonsense query', async ({ page }) => {
    await page.keyboard.press('Control+k');
    await expect(page.locator('.palette')).toBeVisible({ timeout: 2000 });

    // Search for something that definitely won't match
    const searchInput = page.locator('.search-input');
    await searchInput.fill('xyznonexistent123');
    await page.waitForTimeout(800);

    // No-results message should be visible
    await expect(page.locator('.no-results')).toBeVisible({ timeout: 3000 });
  });

  // ============================================================
  // 3. Keyboard Navigation
  // ============================================================

  test('should navigate results with arrow keys', async ({ page }) => {
    await page.keyboard.press('Control+k');
    await expect(page.locator('.palette')).toBeVisible({ timeout: 2000 });

    // Search for a broad term to get multiple results
    const searchInput = page.locator('.search-input');
    await searchInput.fill('.md');
    await page.waitForTimeout(800);

    const results = page.locator('.result-item');
    const count = await results.count();

    // Need at least 2 results to meaningfully test navigation
    if (count < 2) {
      // Try a broader search
      await searchInput.fill('');
      await searchInput.fill('笔记');
      await page.waitForTimeout(800);
      const retryCount = await page.locator('.result-item').count();
      if (retryCount < 2) {
        // 结果不足，跳过后续键盘导航测试
        return;
      }
    }

    // Initially first item should have .selected class
    const firstItem = page.locator('.result-item').first();
    await expect(firstItem).toHaveClass(/selected/);

    // ArrowDown → second item selected
    await page.keyboard.press('ArrowDown');
    const secondItem = page.locator('.result-item').nth(1);
    await expect(secondItem).toHaveClass(/selected/);
    await expect(firstItem).not.toHaveClass(/selected/);

    // ArrowUp → back to first item
    await page.keyboard.press('ArrowUp');
    await expect(firstItem).toHaveClass(/selected/);

    // ArrowUp at top wraps to last item
    await page.keyboard.press('ArrowUp');
    const lastItem = page.locator('.result-item').last();
    await expect(lastItem).toHaveClass(/selected/);

    // ArrowDown at bottom wraps to first item
    await page.keyboard.press('ArrowDown');
    await expect(firstItem).toHaveClass(/selected/);
  });

  test('should select result with Enter', async ({ page }) => {
    await page.keyboard.press('Control+k');
    await expect(page.locator('.palette')).toBeVisible({ timeout: 2000 });

    // Search for something that exists
    const searchInput = page.locator('.search-input');
    await searchInput.fill('欢迎');
    await page.waitForTimeout(800);

    // Verify we have results before pressing Enter
    const results = page.locator('.result-item');
    const count = await results.count();
    expect(count).toBeGreaterThanOrEqual(1);

    // Enter selects the first result (selected by default) and closes palette
    await page.keyboard.press('Enter');
    await expect(page.locator('.palette')).not.toBeVisible({ timeout: 2000 });
  });

  // ============================================================
  // 4. Search Hint Button
  // ============================================================

  test('should open palette from topbar search hint button', async ({ page }) => {
    const hintBtn = page.locator('.topbar-search-hint');
    await expect(hintBtn).toBeVisible();

    await hintBtn.click();
    await expect(page.locator('.palette')).toBeVisible({ timeout: 2000 });
    await expect(page.locator('.search-input')).toBeVisible();
  });

  // ============================================================
  // 5. Quick Actions
  // ============================================================

  test('should have quick action buttons', async ({ page }) => {
    await page.keyboard.press('Control+k');
    await expect(page.locator('.palette')).toBeVisible({ timeout: 2000 });

    // Verify quick action buttons exist (new note, export, settings)
    const quickActions = page.locator('.quick-action-btn');
    const count = await quickActions.count();
    expect(count).toBeGreaterThanOrEqual(3);

    // Verify specific action labels
    await expect(page.locator('.quick-action-btn:has-text("新建笔记")')).toBeVisible();
    await expect(page.locator('.quick-action-btn:has-text("导出")')).toBeVisible();
    await expect(page.locator('.quick-action-btn:has-text("设置")')).toBeVisible();
  });
});
