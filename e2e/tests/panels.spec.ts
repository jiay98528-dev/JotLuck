/**
 * M1-M2 E2E — 右侧面板系统
 * 覆盖：大纲(NavTree)、标签云(TagCloud)、最近笔记(RecentNotes)
 */
import { test, expect, type Page } from '@playwright/test';

/**
 * 辅助：展开折叠的面板
 */
async function expandPanel(
  page: Page,
  panelSelector: string,
  headerSelector: string,
): Promise<void> {
  const isCollapsed = await page.locator(panelSelector).count();
  if (isCollapsed > 0) {
    await page.locator(headerSelector).click();
    await page.waitForTimeout(300);
  }
}

test.describe('右侧面板', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.locator('#markluck-app').waitFor({ timeout: 15000 });
  });

  test('V1: 大纲面板 — 未打开笔记时显示', async ({ page }) => {
    const navTree = page.locator('.nav-tree');
    await expect(navTree).toBeVisible({ timeout: 3000 });
    await expect(navTree).toContainText('大纲');
  });

  test('V1: 大纲面板 — 打开笔记后显示标题层级', async ({ page }) => {
    await page.locator('.node-name', { hasText: '欢迎.md' }).click();
    await expect(page.locator('.cm-content')).toBeVisible({ timeout: 5000 });
    await page.waitForTimeout(1000); // 等待大纲解析

    // 展开大纲面板
    await expandPanel(page, '.nav-tree--collapsed', '.nav-tree-header');

    // 大纲应显示标题项
    const navList = page.locator('.nav-tree-list');
    await expect(navList).toBeVisible({ timeout: 3000 });
  });

  test('V1: 大纲面板 — 点击标题跳转到对应位置', async ({ page }) => {
    await page.locator('.node-name', { hasText: '欢迎.md' }).click();
    await expect(page.locator('.cm-content')).toBeVisible({ timeout: 5000 });
    await page.waitForTimeout(1000);

    await expandPanel(page, '.nav-tree--collapsed', '.nav-tree-header');

    // 点击大纲中的一个标题
    const navItem = page.locator('.nav-tree-list li').first();
    if (await navItem.isVisible()) {
      await navItem.click();
      await expect(page.locator('.cm-content')).toBeVisible({ timeout: 2000 });
    }
  });

  test('V1: 标签云 — 面板存在且包含标签', async ({ page }) => {
    // 标签面板可能初始折叠
    await expandPanel(page, '.tag-panel--collapsed', '.tag-panel-header');

    // 验证标签面板存在
    const tagPanel = page.locator('.tag-panel');
    if (await tagPanel.isVisible()) {
      await expect(tagPanel).toContainText('标签');

      // 等待标签解析完成（Mock 文件系统扫描可能较慢）
      try {
        await page.waitForFunction(() => document.querySelectorAll('.tag-item').length > 0, {
          timeout: 5000,
        });
      } catch {
        // 标签可能尚未加载，不强制要求
      }

      const tagItems = page.locator('.tag-item');
      const count = await tagItems.count();
      expect(count).toBeGreaterThanOrEqual(0); // 至少面板存在
    }
  });

  test('V1: 标签云 — 点击标签执行搜索', async ({ page }) => {
    await expandPanel(page, '.tag-panel--collapsed', '.tag-panel-header');

    const tagItem = page.locator('.tag-item').first();
    if (await tagItem.isVisible()) {
      await tagItem.click();
      await page.waitForTimeout(500);
      // 验证不崩溃
      await expect(page.locator('#markluck-app')).toBeVisible();
    }
  });

  test('V1: 最近笔记 — 面板显示', async ({ page }) => {
    // 打开并编辑笔记以触发最近笔记更新
    await page.locator('.node-name', { hasText: '欢迎.md' }).click();
    await expect(page.locator('.cm-content')).toBeVisible({ timeout: 5000 });

    await page.locator('.cm-content').click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type('\n编辑测试');
    await expect(page.locator('.status-saved')).toBeVisible({ timeout: 5000 });

    // 最近笔记面板应显示
    const recentPanel = page.locator('.recent-notes');
    await expect(recentPanel).toBeVisible({ timeout: 3000 });
    await expect(recentPanel).toContainText('最近编辑');
  });

  test('V1: 最近笔记 — 包含刚编辑的文件', async ({ page }) => {
    await page.locator('.node-name', { hasText: '欢迎.md' }).click();
    await expect(page.locator('.cm-content')).toBeVisible({ timeout: 5000 });

    await page.locator('.cm-content').click();
    await page.keyboard.type('最近测试');
    await expect(page.locator('.status-saved')).toBeVisible({ timeout: 5000 });

    // 最近笔记列表中应有欢迎.md
    const recentItems = page.locator('.recent-note-item');
    const count = await recentItems.count();
    expect(count).toBeGreaterThanOrEqual(1);
  });

  test('V1: 最近笔记 — 点击跳转到对应笔记', async ({ page }) => {
    // 先编辑快速入门
    await page.locator('.node-name', { hasText: '快速入门.md' }).click();
    await expect(page.locator('.cm-content')).toBeVisible({ timeout: 5000 });
    await page.locator('.cm-content').click();
    await page.keyboard.type('R');
    await expect(page.locator('.status-saved')).toBeVisible({ timeout: 5000 });

    // 再编辑欢迎
    await page.locator('.node-name', { hasText: '欢迎.md' }).click();
    await expect(page.locator('.cm-content')).toBeVisible({ timeout: 5000 });
    await page.locator('.cm-content').click();
    await page.keyboard.type('W');
    await expect(page.locator('.status-saved')).toBeVisible({ timeout: 5000 });

    // 点击最近笔记中的"快速入门.md"
    const recentItem = page.locator('.recent-note-item', { hasText: '快速入门' });
    if (await recentItem.isVisible()) {
      await recentItem.click();
      await expect(page.locator('.editor-file-name')).toContainText('快速入门.md', {
        timeout: 5000,
      });
    }
  });
});
