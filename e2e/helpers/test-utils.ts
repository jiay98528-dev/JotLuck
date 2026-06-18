/**
 * MarkLuck E2E Test Utilities
 *
 * 共享辅助函数，用于 Playwright E2E 测试。
 * 提供编辑器操作、等待策略等常用封装。
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
  // 使用 Ctrl+A+Backspace 清除内容（经 CM6 key handler，避免 fill() 的 MutationObserver 竞态）
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(200); // 等待 CM6 调和状态
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

// ============================================================
// Export Helpers
// ============================================================

/** 打开导出对话框 */
export async function openExportDialog(page: Page): Promise<void> {
  // Open command palette and click export, or use shortcut
  await page.keyboard.press('Control+Shift+P');
  await expect(page.locator('.palette')).toBeVisible({ timeout: 2000 });
  await page.locator('.quick-action-btn:has-text("导出")').click();
  await expect(page.locator('.modal-overlay')).toBeVisible({ timeout: 3000 });
}

// ============================================================
// Page Lifecycle
// ============================================================

/** 等待应用初始化完成 (跳过欢迎页) */
export async function waitForAppReady(page: Page): Promise<void> {
  const APP_URL = 'http://localhost:5173';
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
