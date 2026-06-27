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
  await ensureEditorReady(page);
  return page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const content = (window as any).__markluck_getEditorContent?.();
    if (typeof content === 'string') return content;

    const lines = Array.from(document.querySelectorAll('.cm-content .cm-line')).map(
      (line) => line.textContent ?? '',
    );
    if (lines.length > 0) return lines.join('\n');

    return document.querySelector('.cm-content')?.textContent ?? '';
  });
}

/** 在编辑器中输入文本 (聚焦 .cm-content 后逐字键入) */
export async function typeInEditor(page: Page, text: string): Promise<void> {
  await ensureEditorReady(page);
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
  await ensureEditorReady(page);
  const editor = page.locator('.cm-content');
  await editor.click();
  // Move to end
  await page.keyboard.press('Control+End');
  await page.keyboard.type(text, { delay: 5 });
}

/** 清空编辑器内容 */
export async function clearEditor(page: Page): Promise<void> {
  await ensureEditorReady(page);
  const editor = page.locator('.cm-content');
  await editor.click();
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Backspace');
}

/** 等待自动保存完成 (状态栏显示"已保存") */
export async function waitForAutoSave(page: Page): Promise<void> {
  await expect(page.locator('.status-saved')).toBeVisible({ timeout: 10000 });
}

/** 等待 MockFS 中指定文件内容落盘。 */
export async function waitForMockFileContent(
  page: Page,
  path: string,
  expectedText: string,
): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate((targetPath) => {
          const raw = localStorage.getItem('markluck-mockfs');
          if (!raw) return '';
          const data = JSON.parse(raw) as { files?: Record<string, { content?: string }> };
          return data.files?.[targetPath]?.content ?? '';
        }, path),
      { timeout: 10000 },
    )
    .toContain(expectedText);
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

/** 确保编辑器处于可交互状态；若当前停留在首页主题展柜，则打开一个样例笔记。 */
export async function ensureEditorReady(page: Page, noteLabel: string = '快速入门'): Promise<void> {
  const editor = page.locator('.cm-content');
  if (await editor.isVisible().catch(() => false)) return;

  const bookmark = page.locator(`.wing-bookmark-dot[aria-label="${noteLabel}"]`);
  await expect(bookmark).toBeVisible({ timeout: 5000 });
  await bookmark.click();
  await expect(page.locator('.cm-editor')).toBeVisible({ timeout: 10000 });
  await expect(editor).toBeVisible({ timeout: 10000 });
  await page.waitForTimeout(300);
}

/** 创建一篇空白笔记，并等待编辑器可交互。 */
export async function createBlankNote(page: Page): Promise<void> {
  await page.locator('.wing-new-btn').click();
  await expect(page.locator('.tpl-card.blank-card')).toBeVisible({ timeout: 5000 });
  await page.locator('.tpl-card.blank-card').click();
  await expect(page.locator('.cm-editor')).toBeVisible({ timeout: 10000 });
  await expect(page.locator('.cm-content')).toBeVisible({ timeout: 10000 });
  await page.waitForTimeout(300);
}

/** 等待笔记索引完成，确保搜索结果源已准备好。 */
export async function waitForSearchReady(page: Page): Promise<void> {
  await expect
    .poll(() => page.locator('.wing-bookmark-dot').count(), { timeout: 10000 })
    .toBeGreaterThan(0);
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
  await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
  await waitForShellReady(page);
  await page.waitForTimeout(100);
}

/**
 * 重置应用状态为初始基线（用于需要干净隔离的测试）。
 *
 * 清除所有 MarkLuck 相关的 localStorage 键，重新加载页面，
 * 并重新应用欢迎页跳过标记，确保 MockFS 数据和设置回到默认值。
 *
 * 注意：此操作会清除用户设置/训练数据/笔记内容，
 * 仅应在需要完全隔离的测试文件的 beforeEach 中调用。
 */
export async function resetAppState(page: Page): Promise<void> {
  await page.evaluate(() => {
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('markluck')) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach((k) => localStorage.removeItem(k));
    sessionStorage.clear();
    localStorage.setItem('markluck:welcome:completed', '1');
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForShellReady(page);
  await page.waitForTimeout(100);
}

async function waitForShellReady(page: Page): Promise<void> {
  await expect(page.locator('.welcome-overlay')).toHaveCount(0);
  await expect(page.locator('#markluck-app')).toBeVisible({ timeout: 10000 });
  await expect
    .poll(
      () =>
        page.evaluate(() =>
          Boolean(
            document.querySelector(
              '.home-theme-showcase, .cm-content, [data-testid="external-file-session"]',
            ),
          ),
        ),
      { timeout: 10000 },
    )
    .toBe(true);
}
