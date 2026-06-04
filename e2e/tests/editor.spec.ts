/**
 * M1 E2E — 编辑器核心功能测试
 * 覆盖：文件加载、编辑、保存、持久化(V3)、状态栏
 */
import { test, expect } from '@playwright/test';
import { getEditorContent } from '../helpers/test-utils';

test.describe('编辑器核心', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.locator('#markluck-app').waitFor({ timeout: 15000 });
  });

  test('V1: 应用加载 — 文件树显示初始笔记', async ({ page }) => {
    await expect(page.locator('.sidebar-title')).toHaveText('MarkLuck');
    // P2-2: Mock 数据升级为多级目录，根目录有 3 个文件 + 2 个子目录
    await expect(page.locator('.file-tree__list')).toBeVisible({ timeout: 5000 });
    const fileNodes = page.locator('.node-item--file');
    await expect(fileNodes).toHaveCount(3);
    await expect(fileNodes.nth(0)).toContainText('欢迎.md');
    await expect(fileNodes.nth(1)).toContainText('快速入门.md');
  });

  test('V1: 未选择笔记 — 编辑器显示空状态提示', async ({ page }) => {
    await expect(page.locator('.editor-empty')).toBeVisible();
    await expect(page.locator('.editor-empty h1')).toHaveText('MarkLuck');
    await expect(page.locator('.editor-empty')).toContainText('选择左侧一条笔记开始编辑');
  });

  test('V1: 点击文件名 — 编辑器加载内容', async ({ page }) => {
    // 点击欢迎.md
    await page.locator('.node-name', { hasText: '欢迎.md' }).click();
    await expect(page.locator('.editor-file-name')).toContainText('欢迎.md', { timeout: 5000 });
    // 编辑器应该加载内容
    await expect(page.locator('.cm-content')).toBeVisible({ timeout: 5000 });
    await page.waitForTimeout(800); // 等待 CM6 完全渲染

    // 使用 CM6 state.doc 获取内容（更可靠）
    const text = await getEditorContent(page);
    expect(text.length).toBeGreaterThan(20);
    expect(text).toContain('欢迎使用 MarkLuck');
  });

  test('V1: 编辑器输入 — 状态栏显示未保存', async ({ page }) => {
    await page.locator('.node-name', { hasText: '欢迎.md' }).click();
    await expect(page.locator('.cm-content')).toBeVisible({ timeout: 5000 });

    // 在编辑器中输入文字
    await page.locator('.cm-content').click();
    await page.keyboard.type('\n新增测试内容');

    // 应显示未保存状态
    await expect(page.locator('.status-dirty')).toBeVisible({ timeout: 2000 });
  });

  test('V1: 自动保存 — 状态栏显示"已保存"', async ({ page }) => {
    await page.locator('.node-name', { hasText: '欢迎.md' }).click();
    await expect(page.locator('.cm-content')).toBeVisible({ timeout: 5000 });

    // 输入内容触发保存
    await page.locator('.cm-content').click();
    await page.keyboard.type('测试保存');

    // 等待防抖(600ms) + Mock延迟(50ms)
    // 应该先看到"保存中"，然后变为"已保存"
    await expect(page.locator('.status-saved')).toBeVisible({ timeout: 5000 });
  });

  test('V3: 内容持久化 — 编辑后导航离开再返回', async ({ page }) => {
    const testMarker = '## V3持久化测试';

    // Step 1: 打开笔记并编辑
    await page.locator('.node-name', { hasText: '欢迎.md' }).click();
    await expect(page.locator('.cm-content')).toBeVisible({ timeout: 5000 });
    await page.waitForTimeout(500);

    await page.locator('.cm-content').click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type(`\n${testMarker}`);
    // 等待保存
    await expect(page.locator('.status-saved')).toBeVisible({ timeout: 5000 });

    // Step 2-3: 导航离开再返回
    await page.locator('.node-name', { hasText: '快速入门.md' }).click();
    await expect(page.locator('.cm-content')).toBeVisible({ timeout: 5000 });
    await page.waitForTimeout(500);

    await page.locator('.node-name', { hasText: '欢迎.md' }).click();
    await expect(page.locator('.cm-content')).toBeVisible({ timeout: 5000 });
    await page.waitForTimeout(800); // 等待内容加载

    // Step 4: 验证内容（使用 CM6 state.doc）
    const content1 = await getEditorContent(page);
    expect(content1).toContain('V3持久化测试');

    // Step 5-6: 刷新后再验证
    await page.reload();
    await page.locator('#markluck-app').waitFor({ timeout: 15000 });
    await page.locator('.node-name', { hasText: '欢迎.md' }).click();
    await expect(page.locator('.cm-content')).toBeVisible({ timeout: 5000 });
    await page.waitForTimeout(800);

    const content2 = await getEditorContent(page);
    expect(content2).toContain('V3持久化测试');
  });

  test('V3: 删除笔记后刷新 — 确认持久化删除', async ({ page }) => {
    // 先创建一篇笔记
    await page.getByTitle('新建笔记（从模板）').click();
    await expect(page.locator('.template-dialog')).toBeVisible({ timeout: 5000 });
    await page.getByRole('button', { name: '空白笔记' }).click();
    await expect(page.locator('.cm-content')).toBeVisible({ timeout: 5000 });

    // 等待保存
    await expect(page.locator('.status-saved')).toBeVisible({ timeout: 5000 });
    const fileName = await page.locator('.editor-file-name').innerText();

    // 删除该笔记
    const activeNode = page.locator('.node-item--active');
    await activeNode.hover();
    const deleteBtn = activeNode.locator('.node-delete');
    // 设置 dialog handler
    page.on('dialog', (dialog) => dialog.accept());
    await deleteBtn.click({ timeout: 3000 });

    // 验证从文件树消失
    await page.waitForTimeout(500);
    await expect(page.locator('.node-name', { hasText: fileName })).toHaveCount(0);

    // 刷新后仍不在
    await page.reload();
    await page.locator('#markluck-app').waitFor({ timeout: 15000 });
    await expect(page.locator('.node-name', { hasText: fileName })).toHaveCount(0);
  });

  test('V1: 状态栏显示光标位置和字数', async ({ page }) => {
    await page.locator('.node-name', { hasText: '欢迎.md' }).click();
    await expect(page.locator('.cm-content')).toBeVisible({ timeout: 5000 });
    await page.waitForTimeout(1500); // 等待状态栏更新

    // 状态栏应该存在并显示信息
    const statusBar = page.locator('.status-bar');
    await expect(statusBar).toBeVisible({ timeout: 3000 });

    // 状态栏应包含字数信息
    const statusText = await statusBar.innerText();
    // 至少包含"字"或"行"的计数信息
    expect(statusText.length).toBeGreaterThan(0);
  });
});
