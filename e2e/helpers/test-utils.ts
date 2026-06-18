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

/** 在编辑器中输入文本 (使用 CM6 dispatch API 原子替换内容，避免竞态条件) */
export async function typeInEditor(page: Page, text: string): Promise<void> {
  // 使用 CM6 的 dispatch API 原子替换内容，确保同步触发 updateListener
  const dispatched = await page.evaluate((content: string) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const getView = (window as any).__markluck_getEditorView as (() => any) | undefined;
    const view = getView?.();
    if (!view) return false;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: content },
    });
    view.focus();
    return true;
  }, text);

  if (!dispatched) {
    // 回退：view 不可用时使用键盘操作（经 CM6 key handler，不受 fill 竞态影响）
    const editor = page.locator('.cm-content');
    await editor.click();
    await page.keyboard.press('Control+a');
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(200);
    await page.keyboard.type(text, { delay: 10 });
  }
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
  // 使用 .first() 避免分屏模式下多个 .status-saved 元素的严格模式冲突
  await expect(page.locator('.status-saved').first()).toBeVisible({ timeout: 10000 });
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
