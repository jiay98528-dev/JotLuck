/**
 * JotLuck E2E Test Utilities
 *
 * 共享辅助函数，用于 Playwright E2E 测试。
 * 提供编辑器操作、等待策略等常用封装。
 */
import type { ConsoleMessage, Page, Request } from '@playwright/test';
import { expect, test } from '@playwright/test';

// ============================================================
// Editor Helpers
// ============================================================

/** 获取 CodeMirror 编辑器内容 */
export async function getEditorContent(page: Page): Promise<string> {
  await ensureEditorReady(page);
  return page.evaluate(() => {
    const lines = Array.from(document.querySelectorAll('.cm-content .cm-line')).map(
      (line) => line.textContent ?? '',
    );
    if (lines.length > 0) return lines.join('\n');

    return document.querySelector('.cm-content')?.textContent ?? '';
  });
}

/** 明确读取 E2E bridge 内容。仅用于诊断 bridge 本身或补全专项测试。 */
export async function getEditorContentFromBridge(page: Page): Promise<string> {
  await ensureEditorReady(page);
  return page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const content = (window as any).__jotluck_e2e?.editor?.getContent?.();
    return typeof content === 'string' ? content : '';
  });
}

/** 在编辑器中输入文本 (聚焦 .cm-content 后逐字键入) */
export async function typeInEditor(page: Page, text: string): Promise<void> {
  await ensureEditorReady(page);
  await focusEditor(page);
  // 使用 Ctrl+A+Backspace 清除内容（经 CM6 key handler，避免 fill() 的 MutationObserver 竞态）
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(200); // 等待 CM6 调和状态
  await page.keyboard.type(text, { delay: 10 });
}

/** 在编辑器中追加文本 */
export async function appendInEditor(page: Page, text: string): Promise<void> {
  await ensureEditorReady(page);
  await focusEditor(page);
  // Move to end
  await page.keyboard.press('Control+End');
  await page.keyboard.type(text, { delay: 5 });
}

/** 清空编辑器内容 */
export async function clearEditor(page: Page): Promise<void> {
  await ensureEditorReady(page);
  await focusEditor(page);
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Backspace');
}

async function focusEditor(page: Page): Promise<void> {
  const editor = page.locator('.cm-content').first();
  await expect(editor).toBeVisible({ timeout: 5000 });
  await editor.click({ timeout: 3000 }).catch(() => undefined);
  await editor.evaluate((node) => {
    (node as HTMLElement).focus();
  });
  await page
    .waitForFunction(() => document.querySelector('.cm-editor')?.classList.contains('cm-focused'), {
      timeout: 3000,
    })
    .catch(() => undefined);
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
          const raw = localStorage.getItem('jotluck-mockfs');
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

/** 创建一篇空白笔记，并等待新文件与编辑器所有权完成切换。 */
export async function createBlankNote(page: Page): Promise<string> {
  const beforePaths = await page.evaluate(() => {
    const raw = localStorage.getItem('jotluck-mockfs');
    if (!raw) return [];
    const data = JSON.parse(raw) as { files?: Record<string, unknown> };
    return Object.keys(data.files ?? {});
  });
  await page.locator('.wing-new-btn').click();
  await expect(page.locator('.tpl-card.blank-card')).toBeVisible({ timeout: 5000 });
  await page.locator('.tpl-card.blank-card').click();
  await expect(page.locator('.tpl-card.blank-card')).toHaveCount(0);
  await expect(page.locator('.cm-editor')).toBeVisible({ timeout: 10000 });
  await expect(page.locator('.cm-content')).toBeVisible({ timeout: 10000 });

  let createdPath = '';
  await expect
    .poll(
      async () => {
        const next = await page.evaluate(() => {
          const raw = localStorage.getItem('jotluck-mockfs');
          if (!raw) return { paths: [], files: {} };
          const data = JSON.parse(raw) as {
            files?: Record<string, { content?: string }>;
          };
          return { paths: Object.keys(data.files ?? {}), files: data.files ?? {} };
        });
        createdPath =
          next.paths.find(
            (path) => !beforePaths.includes(path) && /\.(?:md|markdown|mdx|txt)$/iu.test(path),
          ) ?? '';
        if (!createdPath) return false;
        const state = await page.evaluate(() => window.__jotluck_e2e?.debugState?.());
        const normalize = (path: string): string => path.replace(/\\/gu, '/').toLowerCase();
        return (
          normalize(state?.activePath ?? '') === normalize(createdPath) &&
          state?.isNoteSwitching === false &&
          (state?.currentContent ?? '').trimEnd() ===
            (next.files[createdPath]?.content ?? '').trimEnd()
        );
      },
      { timeout: 10000 },
    )
    .toBe(true);

  return createdPath;
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
  const appURL = process.env.JOTLUCK_E2E_BASE_URL ?? 'http://127.0.0.1:5173';
  const consoleMessages: Array<Record<string, unknown>> = [];
  const pageErrors: Array<Record<string, unknown>> = [];
  const failedRequests: Array<Record<string, unknown>> = [];
  const onConsole = (message: ConsoleMessage) => {
    consoleMessages.push({
      type: message.type(),
      text: message.text(),
      location: message.location(),
    });
  };
  const onPageError = (error: Error) =>
    pageErrors.push({ name: error.name, message: error.message });
  const onRequestFailed = (request: Request) => {
    failedRequests.push({
      url: request.url(),
      method: request.method(),
      failure: request.failure(),
    });
  };

  page.on('console', onConsole);
  page.on('pageerror', onPageError);
  page.on('requestfailed', onRequestFailed);
  // CRITICAL: addInitScript runs BEFORE any page JavaScript (including Vue's onMounted).
  // This ensures App.vue reads the flag before deciding to show the welcome overlay.
  // Without this, the welcome overlay intercepts all pointer events in tests.
  await page.addInitScript(() => {
    localStorage.setItem('jotluck:welcome:completed', '1');
    if (!localStorage.getItem('jotluck:locale:v1')) {
      localStorage.setItem('jotluck:locale:v1', 'zh-CN');
    }
  });
  try {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await waitForShellReady(page);
    await page.waitForTimeout(100);
  } catch (error) {
    const snapshot = await collectAppReadyFailureSnapshot(page);
    await test
      .info()
      .attach('app-ready-diagnostics.json', {
        contentType: 'application/json',
        body: Buffer.from(
          JSON.stringify(
            {
              targetURL: appURL,
              console: consoleMessages,
              pageErrors,
              failedRequests,
              snapshot,
            },
            null,
            2,
          ),
        ),
      })
      .catch(() => undefined);
    throw error;
  } finally {
    page.off('console', onConsole);
    page.off('pageerror', onPageError);
    page.off('requestfailed', onRequestFailed);
  }
}

/** 在首次导航前清空 JotLuck 状态，避免为了隔离而重复启动整套应用。 */
export async function waitForCleanAppReady(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const cleanBootMarker = 'jotluck:e2e:clean-boot-applied';
    if (sessionStorage.getItem(cleanBootMarker) === '1') return;

    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && (key.startsWith('JotLuck') || key.startsWith('jotluck'))) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach((key) => localStorage.removeItem(key));
    sessionStorage.clear();
    sessionStorage.setItem(cleanBootMarker, '1');
    localStorage.setItem('jotluck:welcome:completed', '1');
    localStorage.setItem('jotluck:locale:v1', 'zh-CN');
  });
  await waitForAppReady(page);
}

async function collectAppReadyFailureSnapshot(page: Page): Promise<Record<string, unknown>> {
  try {
    return await page.evaluate(() => ({
      url: location.href,
      readyState: document.readyState,
      e2eState: window.__jotluck_e2e?.debugState?.() ?? null,
      shellReadyMarks: performance
        .getEntriesByName('jotluck:shell-ready')
        .map((entry) => entry.toJSON()),
      appRoot: document.querySelector('#jotluck-app')?.outerHTML.slice(0, 20_000) ?? null,
      document: document.documentElement.outerHTML.slice(0, 20_000),
    }));
  } catch (error) {
    return {
      url: page.url(),
      snapshotError: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * 重置应用状态为初始基线（用于需要干净隔离的测试）。
 *
 * 清除所有 JotLuck 相关的 localStorage 键，重新加载页面，
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
      if (key && (key.startsWith('JotLuck') || key.startsWith('jotluck'))) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach((k) => localStorage.removeItem(k));
    sessionStorage.clear();
    localStorage.setItem('jotluck:welcome:completed', '1');
    localStorage.setItem('jotluck:locale:v1', 'zh-CN');
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForShellReady(page);
  await page.waitForTimeout(100);
}

async function waitForShellReady(page: Page): Promise<void> {
  const startupTimeout = 30000;
  await expect(page.locator('.welcome-overlay')).toHaveCount(0, { timeout: startupTimeout });
  await expect(page.locator('#jotluck-app')).toBeVisible({ timeout: startupTimeout });
  await expect
    .poll(
      () =>
        page.evaluate(() =>
          Boolean(
            (() => {
              const startupReady = performance.getEntriesByName('jotluck:shell-ready').length > 0;
              const terminalRoute = document.querySelector(
                '[data-testid="notebook-open-gate"], [data-testid="external-file-session"]',
              );
              if (terminalRoute) return startupReady;
              const editorSurface = document.querySelector('.cm-content');
              const shellFrame = document.querySelector('.editor-shell-frame');
              const shellSettled =
                editorSurface &&
                shellFrame &&
                !shellFrame.classList.contains('editor-shell-frame--opening') &&
                shellFrame.getAttribute('aria-busy') !== 'true';
              return startupReady && Boolean(shellSettled);
            })(),
          ),
        ),
      { timeout: startupTimeout },
    )
    .toBe(true);
}
