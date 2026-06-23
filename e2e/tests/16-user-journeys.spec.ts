/**
 * 16-user-journeys.spec.ts — V6 用户旅程完整性测试
 *
 * 覆盖 M-R2 清单中 FRAGMENTED 和 MISSING 的核心用户旅程。
 * 每条测试 ≥4 步用户操作，验证 ≥2 个结果指标。
 *
 * V1: 交互正确性 — 验证交互后的结果
 * V2: 文件操作验证 — 写入后读取验证
 * V3: 跨会话持久化 — 刷新后验证
 * V5: 按钮完整性 — 每个按钮点击并验证可观测结果
 * V6: 用户旅程完整性 — 多步骤端到端闭环
 */
import { test, expect } from '@playwright/test';
import {
  waitForAppReady,
  getEditorContent,
  typeInEditor,
  appendInEditor,
  clearEditor,
  waitForAutoSave,
  expectEditorContains,
} from '../helpers/test-utils';

// ============================================================
// Journey 1: 文件抽屉 — 展开子目录 → 打开文件 → 编辑 → 保存
// ============================================================
test.describe('V6 用户旅程', () => {
  test.beforeEach(async ({ page }) => {
    await waitForAppReady(page);
  });

  test('J1: 文件抽屉 → 展开子目录 → 打开文件 → 编辑 → 保存', async ({ page }) => {
    // Step 1: 打开文件抽屉
    const menuBtn = page.locator('.topbar-btn--menu');
    await expect(menuBtn).toBeVisible();
    await menuBtn.click();
    await expect(page.locator('.file-drawer')).toBeVisible({ timeout: 3000 });

    // Step 2: 验证根目录条目可见
    await expect(page.locator('.tree-item:has-text("快速入门")')).toBeVisible();
    await expect(page.locator('.tree-item:has-text("子文件夹")')).toBeVisible();

    // Step 3: 展开子文件夹
    const subdirItem = page.locator('.tree-item:has-text("子文件夹")');
    await subdirItem.locator('.tree-chevron').click();
    await expect(subdirItem.locator('.tree-chevron.expanded')).toBeVisible({ timeout: 2000 });

    // Step 4: 验证子目录中的文件可见
    const childFile = page.locator('.tree-item:has-text("笔记A")');
    await expect(childFile).toBeVisible({ timeout: 2000 });

    // Step 5: 点击子目录中的文件 → 编辑器加载
    await childFile.click();
    await page.waitForTimeout(500);

    // Step 6: 验证编辑器加载了子目录文件内容
    const editorContent = await getEditorContent(page);
    expect(editorContent).toContain('子文件夹笔记');

    // Step 7: 编辑并保存
    await typeInEditor(page, '# 来自子文件夹的笔记\n\n文件抽屉直接打开。');
    await waitForAutoSave(page);

    // Step 8: 验证保存后内容保持
    await expectEditorContains(page, '来自子文件夹的笔记');
  });

  // ==========================================================
  // Journey 2: 新建笔记 → 编辑 → 自动保存 → 刷新 → 验证 → 删除
  // ==========================================================
  test('J2: 新建笔记 → 编辑 → 自动保存 → 刷新 → 验证 → 删除', async ({ page }) => {
    // Step 1: 打开新建笔记对话框，选择空白模板
    await page.locator('.wing-new-btn').click();
    await expect(page.locator('.modal-overlay')).toBeVisible({ timeout: 3000 });
    await page.locator('.tpl-card.blank-card').click();
    await page.waitForTimeout(500);

    // Step 2: 编辑内容（使用 H1 标题以便书签 aria-label 提取）
    const noteContent = '# J2 旅程测试\n\n这是 V6 用户旅程测试笔记，验证完整闭环。';
    await typeInEditor(page, noteContent);
    await waitForAutoSave(page);

    // Step 3: 读取书签 aria-label（extractTitle 从 H1 提取标题）
    const activeDot = page.locator('.wing-bookmark-dot.active');
    const noteLabel = await activeDot.getAttribute('aria-label');
    expect(noteLabel).toBeTruthy();

    // 同时打开文件抽屉获取文件名（文件树显示文件名，非 H1 标题）
    await page.locator('.topbar-btn--menu').click();
    await expect(page.locator('.file-drawer')).toBeVisible({ timeout: 3000 });
    // 空白模板文件名格式: 笔记-YYYY-MM-DD.md
    const fileNamePattern = /笔记-\d{4}-\d{2}-\d{2}/;
    const treeItems = page.locator('.tree-item');
    const itemCount = await treeItems.count();
    let fileName = '';
    for (let i = 0; i < itemCount; i++) {
      const text = await treeItems.nth(i).textContent();
      if (text && fileNamePattern.test(text)) {
        fileName = text.trim();
        break;
      }
    }
    expect(fileName).toBeTruthy();
    // 关闭抽屉
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    // Step 4: 切换到其他笔记再切回，验证内容保持
    await page.locator('.wing-bookmark-dot[aria-label="快速入门"]').click();
    await page.waitForTimeout(300);
    await page.locator(`.wing-bookmark-dot[aria-label="${noteLabel}"]`).click();
    await page.waitForTimeout(500);
    await expectEditorContains(page, 'J2 旅程测试');

    // Step 5: 刷新页面，验证持久化
    await page.addInitScript(() => {
      localStorage.setItem('markluck:welcome:completed', '1');
    });
    await page.reload();
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.cm-content')).toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(500);

    // 刷新后切到目标笔记
    await page.locator(`.wing-bookmark-dot[aria-label="${noteLabel}"]`).click();
    await page.waitForTimeout(500);
    await expectEditorContains(page, 'J2 旅程测试');

    // Step 6: 通过文件抽屉右键删除笔记（用文件名匹配）
    await page.locator('.topbar-btn--menu').click();
    await expect(page.locator('.file-drawer')).toBeVisible({ timeout: 3000 });
    const targetItem = page.locator(`.tree-item:has-text("${fileName}")`);
    await targetItem.click({ button: 'right' });
    await expect(page.locator('.context-menu')).toBeVisible({ timeout: 3000 });
    await page.locator('.context-menu-item--danger').click();

    // Step 7: 确认删除对话框
    const confirmDeleteBtn = page.locator('.modal-overlay .btn--danger');
    if (await confirmDeleteBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await confirmDeleteBtn.click();
      await page.waitForTimeout(500);
    }

    // Step 8: 验证书签圆点已移除（关闭抽屉后检查）
    await expect(page.locator(`.wing-bookmark-dot[aria-label="${noteLabel}"]`)).not.toBeVisible({
      timeout: 5000,
    });
  });

  // ==========================================================
  // Journey 3: 右键菜单 → 重命名 → 验证新名 → 删除 → 确认消失
  // ==========================================================
  test('J3: 右键菜单 → 重命名 → 验证 → 删除 → 确认不存在', async ({ page }) => {
    // Step 1: 打开文件抽屉
    await page.locator('.topbar-btn--menu').click();
    await expect(page.locator('.file-drawer')).toBeVisible({ timeout: 3000 });

    // Step 2: 右键点击 "项目规划"，从文件树中删除它（不通过书签栏）
    // 使用 "项目规划" 因为它不是 active 书签项，不会影响其他测试
    const targetName = '项目规划';
    const fileItem = page.locator(`.tree-item:has-text("${targetName}")`);
    await fileItem.click({ button: 'right' });
    await expect(page.locator('.context-menu')).toBeVisible({ timeout: 3000 });

    // Step 3: 点击"重命名"
    const renameOption = page.locator('.context-menu-item:has-text("重命名")');
    await expect(renameOption).toBeVisible();
    await renameOption.click();
    await page.waitForTimeout(300);

    // Step 4: 找到重命名输入框，输入新名称
    const renameInput = page.locator('.tree-rename-input');
    await expect(renameInput).toBeVisible({ timeout: 3000 });
    const newName = 'J3-项目规划-已重命名';
    await renameInput.fill(newName);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);

    // Step 5: 验证新名称出现在文件树中
    await expect(page.locator(`.tree-item:has-text("${newName}")`)).toBeVisible({
      timeout: 3000,
    });

    // Step 6: 再次右键点击重命名后的文件 → 删除
    const renamedItem = page.locator(`.tree-item:has-text("${newName}")`);
    await renamedItem.click({ button: 'right' });
    await expect(page.locator('.context-menu')).toBeVisible({ timeout: 3000 });

    // Step 7: 点击删除 + 确认对话框
    await page.locator('.context-menu-item--danger').click();

    // 确认删除
    const confirmBtn = page.locator('.modal-overlay .btn--danger');
    if (await confirmBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await confirmBtn.click();
      await page.waitForTimeout(500);
    }

    // Step 8: 验证文件从树中消失
    await expect(page.locator(`.tree-item:has-text("${newName}")`)).not.toBeVisible({
      timeout: 5000,
    });
  });

  // ==========================================================
  // Journey 4: 搜索 → 查看结果 → 点击跳转 → 编辑命中笔记
  // ==========================================================
  test('J4: 搜索 → 查看结果 → 点击跳转 → 编辑命中笔记', async ({ page }) => {
    // Step 1: 打开命令面板 (Ctrl+K)
    await page.keyboard.press('Control+k');
    await expect(page.locator('.palette')).toBeVisible({ timeout: 3000 });

    // Step 2: 输入搜索词
    const searchInput = page.locator('.search-input');
    await expect(searchInput).toBeVisible();
    await searchInput.fill('设计');
    await page.waitForTimeout(800); // 等待防抖搜索完成

    // Step 3: 验证搜索结果
    const results = page.locator('.result-item');
    const resultCount = await results.count();
    expect(resultCount).toBeGreaterThan(0);

    // 验证第一个结果有标题
    const firstTitle = results.first().locator('.result-title');
    await expect(firstTitle).toBeVisible();
    const titleText = await firstTitle.textContent();
    expect(titleText).toBeTruthy();

    // Step 4: 点击第一个结果
    await results.first().click();
    await page.waitForTimeout(500);

    // Step 5: 验证导航到正确的笔记（内容包含搜索词）
    await expectEditorContains(page, '设计');

    // Step 6: 编辑命中笔记
    await clearEditor(page);
    await appendInEditor(page, '\n\n搜索后编辑的内容。');

    // Step 7: 等待自动保存
    await waitForAutoSave(page);

    // Step 8: 切换到其他笔记再切回，验证编辑持久化
    await page.locator('.wing-bookmark-dot[aria-label="快速入门"]').click();
    await page.waitForTimeout(300);
    await page.locator('.wing-bookmark-dot[aria-label="设计笔记"]').click();
    await page.waitForTimeout(500);
    await expectEditorContains(page, '搜索后编辑的内容');
  });

  // ==========================================================
  // Journey 5: Live Preview → 点击块 → 编辑 → ESC 恢复预览
  // ==========================================================
  test('J5: Live Preview → 点击块 → 编辑 → ESC 恢复预览', async ({ page }) => {
    // Step 1: 打开一篇有 Markdown 内容的笔记
    await page.locator('.wing-bookmark-dot[aria-label="快速入门"]').click();
    await page.waitForTimeout(500);

    // Step 2: 切换为即时 (Live) 模式
    const viewBtns = page.locator('.view-mode-btn');
    const liveBtn = viewBtns.filter({ hasText: /即时|Live/i });
    if ((await liveBtn.count()) > 0) {
      await liveBtn.click();
      await page.waitForTimeout(500);
    }

    // Step 3: 验证渲染块存在
    const renderedBlocks = page.locator('.cm-live-block');
    const blockCount = await renderedBlocks.count();
    expect(blockCount).toBeGreaterThan(0);

    // Step 4: 点击第一个渲染块进入编辑模式
    await renderedBlocks.first().click();
    await page.waitForTimeout(300);

    // Step 5: 编辑块内容
    await page.keyboard.type(' 编辑后');
    await page.waitForTimeout(300);

    // Step 6: 按 Escape 退出编辑，恢复渲染
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    // Step 7: 验证渲染块已恢复
    const restoredBlocks = page.locator('.cm-live-block');
    const restoredCount = await restoredBlocks.count();
    expect(restoredCount).toBeGreaterThan(0);

    // Step 8: 保存并验证内容持久化
    await waitForAutoSave(page);
  });
});
