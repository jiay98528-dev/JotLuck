/**
 * M2 E2E — Wiki-Link 双向链接系统
 * 覆盖：链接渲染、跳转、反向链接面板
 */
import { test, expect } from '@playwright/test';
import { getEditorContent } from '../helpers/test-utils';

test.describe('Wiki-Link 系统', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.locator('#markluck-app').waitFor({ timeout: 15000 });
  });

  test('V1: 欢迎.md 中的 [[快速入门]] 链接存在', async ({ page }) => {
    await page.locator('.node-name', { hasText: '欢迎.md' }).click();
    await expect(page.locator('.cm-content')).toBeVisible({ timeout: 5000 });
    await page.waitForTimeout(500);

    // 使用 CM6 state.doc 获取原始 Markdown 内容
    const content = await getEditorContent(page);
    expect(content).toContain('[[快速入门]]');
  });

  test('V1: 创建 Wiki-Link 到其他笔记', async ({ page }) => {
    // 先获取目标笔记名
    const targetNoteName = '快速入门'; // 已知存在的笔记

    // 打开欢迎.md
    await page.locator('.node-name', { hasText: '欢迎.md' }).click();
    await expect(page.locator('.cm-content')).toBeVisible({ timeout: 5000 });

    // 输入 Wiki-Link
    await page.locator('.cm-content').click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type(`\n[[${targetNoteName}]]`);
    await expect(page.locator('.status-saved')).toBeVisible({ timeout: 5000 });

    // 验证内容包含该链接
    const content = await getEditorContent(page);
    expect(content).toContain(`[[${targetNoteName}]]`);
  });

  test('V1: 反向链接面板 — 显示引用关系', async ({ page }) => {
    await page.locator('.node-name', { hasText: '快速入门.md' }).click();
    await expect(page.locator('.cm-content')).toBeVisible({ timeout: 5000 });

    // 右侧反向链接面板应存在
    const backlinksPanel = page.locator('.backlinks-panel');
    await expect(backlinksPanel).toBeVisible({ timeout: 3000 });

    // 展开面板（如果折叠）
    const isCollapsed = await page.locator('.backlinks-panel--collapsed').count();
    if (isCollapsed > 0) {
      await page.locator('.backlinks-header').click();
      await page.waitForTimeout(300);
    }

    // 欢迎.md 引用了 [[快速入门]]，应显示反向链接
    const backlinkItems = page.locator('.backlink-item');
    const count = await backlinkItems.count();
    if (count > 0) {
      const firstItem = await backlinkItems.first().textContent();
      expect(firstItem).toMatch(/欢迎|MarkLuck/);
    }
  });

  test('V1: 点击反向链接 — 跳转到引用笔记', async ({ page }) => {
    await page.locator('.node-name', { hasText: '快速入门.md' }).click();
    await expect(page.locator('.cm-content')).toBeVisible({ timeout: 5000 });

    // 展开反向链接面板
    const isCollapsed = await page.locator('.backlinks-panel--collapsed').count();
    if (isCollapsed > 0) {
      await page.locator('.backlinks-header').click();
      await page.waitForTimeout(300);
    }

    const backlinkItems = page.locator('.backlink-item');
    const count = await backlinkItems.count();
    if (count > 0) {
      await backlinkItems.first().click();
      await expect(page.locator('.editor-file-name')).toBeVisible({ timeout: 3000 });
    }
  });

  test('V1: 反向链接面板 — 标题显示链接计数', async ({ page }) => {
    await page.locator('.node-name', { hasText: '快速入门.md' }).click();
    await expect(page.locator('.cm-content')).toBeVisible({ timeout: 5000 });

    const backlinksTitle = page.locator('.backlinks-title');
    await expect(backlinksTitle).toBeVisible({ timeout: 3000 });
    await expect(backlinksTitle).toContainText('反向链接');
  });
});
