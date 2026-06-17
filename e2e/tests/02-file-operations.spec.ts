/**
 * M7 E2E — 文件操作测试
 *
 * 覆盖：书签圆点切换、文件抽屉、新建笔记（空白/模板）、
 * 右键菜单重命名/删除、Toast 通知
 *
 * V1: 交互正确性 — 每个操作至少验证两个结果指标
 * V5: 按钮完整性 — 每个按钮点击并验证可观测结果
 * V6: 用户旅程完整性 — 新建→编辑→保存→删除完整闭环
 */
import { test, expect } from '@playwright/test';
import {
  waitForAppReady,
  getEditorContent,
  typeInEditor,
  waitForAutoSave,
  expectEditorContains,
  expectToast,
} from '../../e2e/helpers/test-utils';

test.describe('文件操作', () => {
  test.beforeEach(async ({ page }) => {
    await waitForAppReady(page);
  });

  // ──────────────────────────────────────────────────────────────
  // 1. 书签圆点切换笔记 → "设计笔记"
  // ──────────────────────────────────────────────────────────────

  test('should switch between notes via bookmark dots', async ({ page }) => {
    // V1: 指标1 — 书签圆点应存在
    const dot = page.locator('.wing-bookmark-dot[aria-label="设计笔记"]');
    await expect(dot).toBeVisible({ timeout: 5000 });

    // 点击 "设计笔记" 圆点
    await dot.click();
    await page.waitForTimeout(500);

    // V1: 指标2 — 编辑器应加载内容
    await expect(page.locator('.cm-content')).toBeVisible({ timeout: 5000 });
    const content = await getEditorContent(page);
    expect(content.length).toBeGreaterThan(0);

    // V1: 指标3 — 圆点应显示为 active 状态
    await expect(page.locator('.wing-bookmark-dot[aria-label="设计笔记"].active')).toBeVisible();
  });

  // ──────────────────────────────────────────────────────────────
  // 2. 书签圆点切换笔记 → "项目规划"
  // ──────────────────────────────────────────────────────────────

  test('should switch between notes via bookmark dots - another note', async ({ page }) => {
    const dot = page.locator('.wing-bookmark-dot[aria-label="项目规划"]');
    await expect(dot).toBeVisible({ timeout: 5000 });

    // 点击 "项目规划" 圆点
    await dot.click();
    await page.waitForTimeout(500);

    // V1: 指标1 — 编辑器应加载内容
    await expect(page.locator('.cm-content')).toBeVisible({ timeout: 5000 });
    const content = await getEditorContent(page);
    expect(content.length).toBeGreaterThan(0);

    // V1: 指标2 — 圆点应处于 active 状态
    await expect(page.locator('.wing-bookmark-dot[aria-label="项目规划"].active')).toBeVisible();
  });

  // ──────────────────────────────────────────────────────────────
  // 3. 打开文件抽屉
  // ──────────────────────────────────────────────────────────────

  test('should open file drawer', async ({ page }) => {
    // V1: 指标1 — 点击前抽屉不可见
    await expect(page.locator('.file-drawer')).not.toBeVisible();

    // 点击汉堡菜单按钮
    await page.locator('.topbar-btn--menu').click();

    // V1: 指标2 — 文件抽屉应出现
    await expect(page.locator('.file-drawer')).toBeVisible({ timeout: 3000 });

    // V1: 指标3 — 抽屉应包含文件树
    await expect(page.locator('.drawer-tree')).toBeVisible();
  });

  // ──────────────────────────────────────────────────────────────
  // 4. 创建空白笔记
  // ──────────────────────────────────────────────────────────────

  test('should create new blank note', async ({ page }) => {
    // V5: 点击新建笔记按钮
    await page.locator('.wing-new-btn').click();

    // V1: 指标1 — 模板对话框应出现
    await expect(page.locator('.modal-overlay')).toBeVisible({ timeout: 3000 });
    await expect(page.locator('.blank-card')).toBeVisible();

    // 选择空白笔记 → 触发 createBlank
    await page.locator('.blank-card').click();

    // V1: 指标2 — 编辑器应加载新笔记
    await expect(page.locator('.cm-content')).toBeVisible({ timeout: 5000 });

    // 输入内容
    await typeInEditor(page, '# 空白笔记测试\n\n这是一篇 E2E 测试创建的笔记。');

    // V1: 指标3 — 等待自动保存完成
    await waitForAutoSave(page);

    // V1: 指标4 — 内容应持久化在编辑器中
    await expectEditorContains(page, '空白笔记测试');
  });

  // ──────────────────────────────────────────────────────────────
  // 5. 使用模板创建笔记
  // ──────────────────────────────────────────────────────────────

  test('should create note from template', async ({ page }) => {
    // 打开模板对话框
    await page.locator('.wing-new-btn').click();
    await expect(page.locator('.modal-overlay')).toBeVisible({ timeout: 3000 });

    // V1: 指标1 — 选择第一个内置模板（非空白卡片）
    const templateCard = page.locator('.tpl-card:not(.blank-card)').first();
    await expect(templateCard).toBeVisible();
    await templateCard.click();
    await page.waitForTimeout(300);

    // 确认"使用此模板"按钮可见
    await expect(page.getByRole('button', { name: '使用此模板' })).toBeVisible();

    // 点击使用模板
    await page.getByRole('button', { name: '使用此模板' }).click();

    // V1: 指标2 — 编辑器应加载模板内容（非空）
    await expect(page.locator('.cm-content')).toBeVisible({ timeout: 5000 });
    await page.waitForTimeout(500);
    const content = await getEditorContent(page);
    expect(content.length).toBeGreaterThan(10);

    // V1: 指标3 — 模板占位符 {{date}} 应已被替换
    const hasUnreplacedPlaceholder =
      content.includes('{{date}}') ||
      content.includes('{{year}}') ||
      content.includes('{{month}}') ||
      content.includes('{{day}}');
    expect(hasUnreplacedPlaceholder).toBe(false);

    // V1: 指标4 — 状态栏显示已保存
    await waitForAutoSave(page);
  });

  // ──────────────────────────────────────────────────────────────
  // 6. 通过右键菜单重命名笔记
  // ──────────────────────────────────────────────────────────────

  test('should rename a note via context menu', async ({ page }) => {
    // Step 1: 先创建一篇待重命名的空白笔记
    await page.locator('.wing-new-btn').click();
    await expect(page.locator('.modal-overlay')).toBeVisible({ timeout: 3000 });
    await page.locator('.blank-card').click();
    await expect(page.locator('.cm-content')).toBeVisible({ timeout: 5000 });
    await typeInEditor(page, '# 待重命名笔记\n');
    await waitForAutoSave(page);

    // Step 2: 打开文件抽屉
    await page.locator('.topbar-btn--menu').click();
    await expect(page.locator('.file-drawer')).toBeVisible({ timeout: 3000 });

    // Step 3: 找到刚创建的笔记（onCreateBlank 生成的路径包含"笔记-"）
    const createdItem = page.locator('.tree-item:has-text("笔记-")').first();
    await expect(createdItem).toBeVisible({ timeout: 3000 });

    // Step 4: 右键点击打开上下文菜单
    await createdItem.click({ button: 'right' });
    await expect(page.locator('.context-menu')).toBeVisible({ timeout: 2000 });

    // Step 5: 点击"重命名"
    await page.locator('.context-menu-item:has-text("重命名")').click();

    // V1: 指标1 — 内联重命名输入框应出现
    await expect(page.locator('.tree-rename-input')).toBeVisible({ timeout: 2000 });

    // Step 6: 输入新名称并按 Enter 确认
    await page.locator('.tree-rename-input').fill('已重命名笔记.md');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(600);

    // V1: 指标2 — 重命名后的条目应出现在文件树中
    await expect(page.locator('.tree-item:has-text("已重命名笔记")')).toBeVisible({
      timeout: 3000,
    });

    // V1: 指标3 — 旧名称不应再出现
    const oldItems = page.locator('.tree-item:has-text("待重命名笔记")');
    await expect(oldItems).toHaveCount(0);
  });

  // ──────────────────────────────────────────────────────────────
  // 7. 删除笔记并确认移除 (V6 用户旅程)
  // ──────────────────────────────────────────────────────────────

  test('should delete a note and confirm removal', async ({ page }) => {
    // V6: Step 1 — 创建一篇待删除的空白笔记
    await page.locator('.wing-new-btn').click();
    await expect(page.locator('.modal-overlay')).toBeVisible({ timeout: 3000 });
    await page.locator('.blank-card').click();
    await expect(page.locator('.cm-content')).toBeVisible({ timeout: 5000 });
    await typeInEditor(page, '# 待删除笔记\n');
    await waitForAutoSave(page);

    // V6: Step 2 — 打开文件抽屉
    await page.locator('.topbar-btn--menu').click();
    await expect(page.locator('.file-drawer')).toBeVisible({ timeout: 3000 });

    // V6: Step 3 — 找到刚创建的笔记
    const createdItem = page.locator('.tree-item:has-text("笔记-")').first();
    await expect(createdItem).toBeVisible({ timeout: 3000 });

    // V1: 指标1 — 记录删除前的文件树条目数
    const countBefore = await page.locator('.tree-item').count();

    // V6: Step 4 — 右键 → 删除
    await createdItem.click({ button: 'right' });
    await expect(page.locator('.context-menu')).toBeVisible({ timeout: 2000 });
    await page.locator('.context-menu-item--danger').click();
    await page.waitForTimeout(600);

    // V1: 指标2 — 文件树条目数应减少
    const countAfter = await page.locator('.tree-item').count();
    expect(countAfter).toBeLessThan(countBefore);

    // V1: 指标3 — 已删除的条目不再出现
    await expect(page.locator('.tree-item:has-text("笔记-")').first()).not.toBeVisible({
      timeout: 3000,
    });
  });

  // ──────────────────────────────────────────────────────────────
  // 8. Toast 通知
  // ──────────────────────────────────────────────────────────────

  test('should show toast notification on operations', async ({ page }) => {
    // 清除格式提示标记——让首次选中文字时触发 Toast
    await page.evaluate(() => localStorage.removeItem('markluck:formatBubble:hintShown'));

    // 先切换到一篇笔记
    await page.locator('.wing-bookmark-dot[aria-label="快速入门"]').click();
    await expect(page.locator('.cm-content')).toBeVisible({ timeout: 5000 });
    await page.waitForTimeout(500);

    // V1: 指标1 — 选中编辑器内文字，触发格式气泡提示 Toast
    await page.locator('.cm-content').click();
    await page.keyboard.press('Control+a');

    // V1: 指标2 — 格式气泡提示 Toast 应出现
    await expectToast(page, '选中文字后使用格式气泡');

    // V1: 指标3 — Toast 容器存在且具有正确的 position 类
    await expect(page.locator('.toast-container--top-center')).toBeVisible();
  });
});
