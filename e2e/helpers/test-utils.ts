/**
 * MarkLuck E2E Test Utilities
 *
 * 共享辅助函数，用于 Playwright E2E 测试。
 * 提供编辑器操作、文件系统模拟、等待策略等常用封装。
 */
import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';

// ============================================================
// Editor Helpers
// ============================================================

/** 获取 CodeMirror 编辑器内容 */
export async function getEditorContent(page: Page): Promise<string> {
  return page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const view = (window as any).__markluck_getEditorView?.();
    if (view) return view.state.doc.toString();
    // fallback: read from .cm-content
    const content = document.querySelector('.cm-content');
    return content?.textContent ?? '';
  });
}

/** 在编辑器中输入文本 (聚焦 .cm-content 后逐字键入) */
export async function typeInEditor(page: Page, text: string): Promise<void> {
  const editor = page.locator('.cm-content');
  await editor.click();
  await editor.fill('');
  await page.keyboard.type(text, { delay: 10 });
}

/** 在编辑器中追加文本 */
export async function appendInEditor(page: Page, text: string): Promise<void> {
  const editor = page.locator('.cm-content');
  await editor.click();
  // Move to end
  await page.keyboard.press('Control+End');
  await page.keyboard.type(text, { delay: 5 });
}

/** 清空编辑器内容 */
export async function clearEditor(page: Page): Promise<void> {
  const editor = page.locator('.cm-content');
  await editor.click();
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Backspace');
}

/** 等待自动保存完成 (状态栏显示"已保存") */
export async function waitForAutoSave(page: Page): Promise<void> {
  await expect(page.locator('.status-saved')).toBeVisible({ timeout: 10000 });
}

// ============================================================
// Navigation Helpers
// ============================================================

/** 通过左侧书签点切换到指定笔记 */
export async function switchToNote(page: Page, noteLabel: string): Promise<void> {
  const dot = page.locator(`.wing-bookmark-dot[aria-label="${noteLabel}"]`);
  await dot.click();
  await page.waitForTimeout(300);
}

/** 打开文件抽屉 */
export async function openFileDrawer(page: Page): Promise<void> {
  await page.locator('.topbar-hamburger, [aria-label="文件浏览"]').click();
  await expect(page.locator('.file-drawer')).toBeVisible({ timeout: 3000 });
}

/** 关闭文件抽屉 */
export async function closeFileDrawer(page: Page): Promise<void> {
  await page.locator('.file-drawer-overlay').click();
  await expect(page.locator('.file-drawer')).not.toBeVisible({ timeout: 2000 });
}

/** 打开命令面板 */
export async function openCommandPalette(page: Page): Promise<void> {
  await page.keyboard.press('Control+p');
  await expect(page.locator('.palette')).toBeVisible({ timeout: 2000 });
}

/** 关闭命令面板 */
export async function closeCommandPalette(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await expect(page.locator('.palette')).not.toBeVisible({ timeout: 2000 });
}

// ============================================================
// File Operation Helpers
// ============================================================

/** 通过文件抽屉创建新笔记 */
export async function createNoteViaDrawer(
  page: Page,
  name: string,
  content?: string,
): Promise<void> {
  await openFileDrawer(page);
  // click new file button in drawer
  await page.locator('.drawer-new-btn, [aria-label="新建文件"]').click();
  // fill name
  await page.locator('.new-file-input, [placeholder*="文件名"]').fill(name);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);

  if (content) {
    await typeInEditor(page, content);
    await waitForAutoSave(page);
  }
}

/** 通过右键菜单删除笔记 */
export async function deleteNoteViaContextMenu(page: Page, noteLabel: string): Promise<void> {
  await openFileDrawer(page);
  const fileItem = page.locator(`.file-item[title="${noteLabel}"], [data-path$="${noteLabel}"]`);
  await fileItem.click({ button: 'right' });
  await page.locator('.context-item--danger, [aria-label="删除"]').click();
  // confirm
  await page.locator('.confirm-btn--danger, button:has-text("删除")').click();
  await page.waitForTimeout(300);
}

// ============================================================
// Assertion Helpers
// ============================================================

/** 验证编辑器包含指定文本 */
export async function expectEditorContains(page: Page, text: string): Promise<void> {
  const content = await getEditorContent(page);
  expect(content).toContain(text);
}

/** 验证 Toast 消息出现 */
export async function expectToast(page: Page, message: string): Promise<void> {
  await expect(page.locator('.toast', { hasText: message })).toBeVisible({ timeout: 5000 });
}

/** 验证元素存在且可见 */
export async function expectVisible(page: Page, selector: string): Promise<void> {
  await expect(page.locator(selector).first()).toBeVisible({ timeout: 5000 });
}

// ============================================================
// View State Helpers
// ============================================================

/** 切换到纯预览模式 */
export async function switchToPreviewMode(page: Page): Promise<void> {
  // click the view mode toggle until preview
  const toggle = page.locator('[aria-label="切换视图模式"], .view-mode-toggle');
  if (await toggle.isVisible()) {
    await toggle.click();
    await page.waitForTimeout(300);
  }
}

/** 切换到分栏模式 */
export async function switchToSplitMode(page: Page): Promise<void> {
  const toggle = page.locator('[aria-label="切换视图模式"], .view-mode-toggle');
  if (await toggle.isVisible()) {
    // May need double-click depending on current state
    await toggle.click();
    await page.waitForTimeout(200);
    const preview = page.locator('.markdown-preview');
    if (!(await preview.isVisible())) {
      await toggle.click();
      await page.waitForTimeout(200);
    }
  }
}

// ============================================================
// Export Helpers
// ============================================================

/** 打开导出对话框 */
export async function openExportDialog(page: Page): Promise<void> {
  // Open command palette and click export, or use shortcut
  await openCommandPalette(page);
  await page.locator('.quick-action-btn:has-text("导出")').click();
  await expect(page.locator('.export-dialog, .modal-overlay')).toBeVisible({ timeout: 3000 });
}

// ============================================================
// Page Lifecycle
// ============================================================

/** 等待应用初始化完成 (跳过欢迎页) */
export async function waitForAppReady(page: Page): Promise<void> {
  const APP_URL = 'http://localhost:5177';
  // CRITICAL: addInitScript runs BEFORE any page JavaScript (including Vue's onMounted).
  // This ensures App.vue reads the flag before deciding to show the welcome overlay.
  // Without this, the welcome overlay intercepts all pointer events in tests.
  await page.addInitScript(() => {
    localStorage.setItem('markluck:welcome:completed', '1');
  });
  await page.goto(APP_URL);
  await page.waitForLoadState('networkidle');
  // Wait for editor to be ready
  await expect(page.locator('.cm-content')).toBeVisible({ timeout: 10000 });
  await page.waitForTimeout(500);
}
