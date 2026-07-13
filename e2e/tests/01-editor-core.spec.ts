/**
 * 01-editor-core.spec.ts — 编辑器核心功能 E2E 测试
 *
 * 覆盖：应用初始化、UI 布局、Markdown 输入、视图切换、
 *       格式气泡、撤销/重做 等核心编辑器交互。
 *
 * 基于 V1-V6 测试规则：
 *   V1 交互正确性 — 验证交互后的结果
 *   V5 按钮完整性 — 每个按钮点击并验证可观测结果
 *   V6 用户旅程 — 多步骤端到端测试
 */
import { test, expect } from '@playwright/test';
import {
  waitForAppReady,
  ensureEditorReady,
  getEditorContent,
  getEditorContentFromBridge,
  typeInEditor,
  appendInEditor,
  waitForAutoSave,
} from '../helpers/test-utils';

// ============================================================
// 测试套件：编辑器核心
// ============================================================
test.describe('编辑器核心', () => {
  // ----------------------------------------------------------
  // Before each: wait for app ready (skip welcome, navigate to /)
  // ----------------------------------------------------------
  test.beforeEach(async ({ page }) => {
    await waitForAppReady(page);
  });

  // ==========================================================
  // Test 1: 应用加载后可进入编辑器
  // ==========================================================
  test('should load app with editor visible', async ({ page }) => {
    // V1: 验证交互结果 — 应用壳层可见，且可进入编辑器
    await expect(page.locator('.app-shell')).toBeVisible({ timeout: 10000 });
    await ensureEditorReady(page);

    const editor = page.locator('.cm-editor');
    await expect(editor).toBeVisible({ timeout: 10000 });

    const content = page.locator('.cm-content');
    await expect(content).toBeVisible();

    // 验证 CM6 内部结构完整
    await expect(page.locator('.cm-scroller')).toBeVisible();
  });

  // ==========================================================
  // Test 2: 左翼书签栏显示书签圆点
  // ==========================================================
  test('should display left wing with bookmark dots', async ({ page }) => {
    // V1: 验证布局存在
    const leftWing = page.locator('.left-wing');
    await expect(leftWing).toBeVisible();

    // 验证至少有书签圆点（预载的 4 篇示例笔记）
    const bookmarkDots = page.locator('.wing-bookmark-dot');
    await expect(bookmarkDots.first()).toBeVisible();
    const count = await bookmarkDots.count();
    expect(count).toBeGreaterThanOrEqual(4);

    // 验证预载笔记的 aria-label 存在
    await expect(page.locator('.wing-bookmark-dot[aria-label="快速入门"]')).toBeVisible();
    await expect(page.locator('.wing-bookmark-dot[aria-label="项目规划"]')).toBeVisible();
  });

  // ==========================================================
  // Test 3: 顶部工具栏显示操作按钮
  // ==========================================================
  test('should display top bar with action buttons', async ({ page }) => {
    // V1: 验证 TopBar 存在
    const topbar = page.locator('.topbar');
    await expect(topbar).toBeVisible();

    // V5: 逐一验证每个操作按钮存在
    // 菜单切换按钮
    await expect(page.locator('.topbar-btn--menu')).toBeVisible();
    // 搜索提示按钮
    await expect(page.locator('.topbar-search-hint')).toBeVisible();
    // 导出按钮
    await expect(page.locator('.topbar-btn--export')).toBeVisible();
    // 分享按钮
    await expect(page.locator('.topbar-btn--share')).toBeVisible();
    // 设置按钮
    await expect(page.locator('.wing-settings-btn')).toBeVisible();

    // 验证笔记本名称显示
    await expect(page.locator('.topbar-notebook')).toBeVisible();
  });

  // ==========================================================
  // Test 4: 状态栏显示已保存状态
  // ==========================================================
  test('should have status bar showing saved state', async ({ page }) => {
    // V1: 验证状态栏存在
    const statusBar = page.locator('.status-bar');
    await expect(statusBar).toBeVisible();

    // 验证已保存状态指示器
    await expect(page.locator('.status-saved')).toBeVisible();
  });

  // ==========================================================
  // Test 5: 输入 Markdown 文本并验证内容
  // ==========================================================
  test('should type markdown text and verify content', async ({ page }) => {
    // V6: 多步骤用户旅程 — 输入 → 验证内容 → 等待自动保存
    const markdownText = '# Hello World\n\nThis is **bold** text';

    // Step 1: 输入 Markdown 文本
    await typeInEditor(page, markdownText);

    // Step 2: 验证编辑器内容包含输入的文本
    const source = await getEditorContentFromBridge(page);
    expect(source).toContain('# Hello World');
    expect(source).toContain('This is **bold** text');

    // Step 3: 等待自动保存完成
    await waitForAutoSave(page);
  });

  // ==========================================================
  // Test 6: 视图模式切换（分栏 / 即时渲染）
  // ==========================================================
  test('should switch view mode between edit/split/preview', async ({ page }) => {
    // V1 + V5: 验证视图切换按钮存在并点击产生可观测结果
    const viewToggle = page.locator('.view-mode-toggle');

    // 确保有活动笔记（点击书签点加载笔记）
    await page.locator('.wing-bookmark-dot[aria-label="快速入门"]').click();
    await page.waitForTimeout(500);
    await expect(page.locator('.cm-content')).toBeVisible();

    // 检查视图切换按钮可见
    await expect(viewToggle).toBeVisible({ timeout: 5000 });

    // Step 1: 即时编辑 → 分栏
    await viewToggle.click();
    await expect(page.locator('.split-pane')).toBeVisible();
    await expect(viewToggle).toHaveAttribute('aria-label', '切换到只读渲染');

    // Step 2: 分栏 → 只读渲染，格式工具栏退出交互层
    await viewToggle.click();
    await expect(page.locator('.reader-workbench[data-view-mode="read"]')).toBeVisible();
    await expect(page.locator('[data-theme-part="format-toolbar"]')).toHaveCount(0);
    await expect(viewToggle).toHaveAttribute('aria-label', '返回即时编辑');

    // Step 3: 只读渲染 → 即时编辑
    await viewToggle.click();
    await expect(page.locator('.cm-editor')).toBeVisible();
    await expect(viewToggle).toHaveAttribute('aria-label', '切换到分栏视图');
  });

  test('分栏模式显示完整标准预览且左侧保持纯源码', async ({ page }) => {
    await typeInEditor(page, '# 第一行\n第二行\n第三行');
    await page.locator('.view-mode-toggle').click();

    const sourcePane = page.locator('.split-left');
    const previewPane = page.locator('.split-preview');
    await expect(sourcePane.locator('.cm-content')).toContainText('# 第一行');
    await expect(sourcePane.locator('.cm-live-block')).toHaveCount(0);

    const firstHeading = previewPane.locator('h1');
    await expect(firstHeading).toHaveText('第一行');
    await expect(previewPane.locator('p')).toHaveCount(1);
    await expect(previewPane.locator('p')).toContainText('第二行\n第三行');
    await expect(previewPane.locator('p:empty')).toHaveCount(0);

    const layout = await page.evaluate(() => {
      const toolbar = document.querySelector('.editor-control-bar')?.getBoundingClientRect();
      const heading = document.querySelector('.split-preview h1')?.getBoundingClientRect();
      const sourceLine = document.querySelector('.split-left .cm-line');
      const sourceNodes = sourceLine ? [sourceLine, ...sourceLine.querySelectorAll('*')] : [];
      const maxSourceFontSize = Math.max(
        0,
        ...sourceNodes.map((node) => Number.parseFloat(getComputedStyle(node).fontSize)),
      );
      return {
        toolbarBottom: toolbar?.bottom ?? 0,
        headingTop: heading?.top ?? 0,
        maxSourceFontSize,
      };
    });
    expect(layout.headingTop).toBeGreaterThanOrEqual(layout.toolbarBottom);
    expect(layout.maxSourceFontSize).toBeLessThanOrEqual(16);
  });

  // ==========================================================
  // Test 7: 文本选中时显示格式气泡
  // ==========================================================
  test('should show format bubble on text selection', async ({ page }) => {
    // V1: 验证格式气泡在选中文本后出现
    // Step 1: 输入测试文本
    await typeInEditor(page, '这是测试文本用于验证格式气泡功能');
    await waitForAutoSave(page);

    // Step 2: 在编辑器中选中文本
    // 使用键盘选择：移动到起始位置，Shift+Arrow 选中部分文本
    const editor = page.locator('.cm-content');
    await editor.click();

    // 将光标定位到编辑器开头
    await page.keyboard.press('Control+Home');
    // 向右移动跳过 "这是测试文本用于验证" (11个字符)
    for (let i = 0; i < 11; i++) {
      await page.keyboard.press('ArrowRight');
    }
    // 按住 Shift 选中 "格式气泡" (4个字符)
    await page.keyboard.down('Shift');
    for (let i = 0; i < 4; i++) {
      await page.keyboard.press('ArrowRight');
    }
    await page.keyboard.up('Shift');

    // Step 3: 等待格式气泡出现（FormatBubble 有 150ms 延迟 + enter 动画）
    const formatBubble = page.locator('.format-bubble');
    await expect(formatBubble).toBeVisible({ timeout: 3000 });

    // 验证气泡内的格式按钮存在
    await expect(page.locator('.bubble-btn--bold')).toBeVisible();
    await expect(page.locator('.bubble-btn--italic')).toBeVisible();
  });

  test('固定格式栏支持先选格式、输入内容并在 Enter 后结束', async ({ page }) => {
    await ensureEditorReady(page);
    const toolbar = page.getByRole('toolbar', { name: '固定格式工具栏' });
    await expect(toolbar).toBeVisible();

    const preset = toolbar.getByLabel('段落样式');
    await expect(preset).toHaveValue('paragraph');
    await typeInEditor(page, '');
    const editor = page.locator('.cm-content');

    const bold = toolbar.getByRole('button', { name: '加粗' });
    await expect(bold).toBeEnabled();
    await bold.click();
    await expect(bold).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.type('中文');
    await page.keyboard.press('Enter');
    await expect(bold).toHaveAttribute('aria-pressed', 'false');
    await page.keyboard.type('普通正文');
    expect(await getEditorContentFromBridge(page)).toBe('**中文**\n普通正文');

    await page.keyboard.press('Enter');
    await preset.selectOption('heading2');
    await page.keyboard.type('预选标题');
    await page.keyboard.press('Enter');
    await page.keyboard.type('恢复正文');
    expect(await getEditorContentFromBridge(page)).toBe(
      '**中文**\n普通正文\n## 预选标题\n恢复正文',
    );
  });

  // ==========================================================
  // Test 8: 撤销/重做 (Ctrl+Z / Ctrl+Shift+Z)
  // ==========================================================
  test('should handle undo/redo (Ctrl+Z / Ctrl+Shift+Z)', async ({ page }) => {
    // V1: 验证撤销/重做正确性
    // Step 1: 输入第一段文本
    await typeInEditor(page, '第一行内容');
    await waitForAutoSave(page);

    const contentAfterFirstType = await getEditorContent(page);
    expect(contentAfterFirstType).toContain('第一行内容');

    // Step 2: 追加第二段文本
    await appendInEditor(page, '\n第二行内容');
    await waitForAutoSave(page);

    const contentAfterSecondType = await getEditorContent(page);
    expect(contentAfterSecondType).toContain('第一行内容');
    expect(contentAfterSecondType).toContain('第二行内容');

    // Step 3: 撤销 (Ctrl+Z) — 应回到只有第一段的状态
    await page.keyboard.press('Control+z');
    // Wait for CM6 to process the undo transaction
    await page.waitForTimeout(500);

    const contentAfterUndo = await getEditorContent(page);
    expect(contentAfterUndo).toContain('第一行内容');
    // 第二行内容应该已被撤销
    expect(contentAfterUndo).not.toContain('第二行内容');

    // Step 4: 重做 — 使用 Ctrl+Y (Windows 标准重做快捷键，CM6 同样绑定)
    await page.keyboard.press('Control+y');
    await page.waitForTimeout(500);

    const contentAfterRedo = await getEditorContent(page);
    expect(contentAfterRedo).toContain('第一行内容');
    expect(contentAfterRedo).toContain('第二行内容');
  });
});
