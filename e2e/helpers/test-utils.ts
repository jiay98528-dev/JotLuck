/**
 * E2E 测试辅助工具
 *
 * 提供可靠的 CodeMirror 6 编辑器内容获取、等待保存等常用操作。
 */
import { type Page, expect } from '@playwright/test';

/** Window extension exposed by MarkdownEditor.vue for E2E tests */
interface MarkluckWindow {
  __markluck_getEditorContent?: () => string;
}

/** Vue component instance with optional exposed API */
interface CodeMirrorView {
  state: { doc: { toString(): string } };
  dispatch: (tr: { selection: { anchor: number; head: number } }) => void;
}

interface VueComponentRef {
  exposed?: {
    getEditorView?: () => CodeMirrorView;
  };
}

function getMarkluckWindow(): MarkluckWindow {
  return window as unknown as MarkluckWindow;
}

/**
 * 通过 window.__markluck_getEditorContent() 获取编辑器原始 Markdown 内容。
 */
export async function getEditorContent(page: Page): Promise<string> {
  return page.evaluate(() => {
    if (getMarkluckWindow().__markluck_getEditorContent) {
      return getMarkluckWindow().__markluck_getEditorContent()!;
    }
    // Fallback: 读取 .cm-line 元素的 textContent
    const lines = document.querySelectorAll('.cm-line');
    if (lines.length > 0) {
      return Array.from(lines)
        .map((line) => line.textContent || '')
        .join('\n');
    }
    // Last resort
    const cmContent = document.querySelector('.cm-content');
    return (cmContent as HTMLElement)?.innerText ?? '';
  });
}

/**
 * 等待编辑器内容加载完成。
 */
export async function waitForEditorReady(
  page: Page,
  options?: { timeout?: number; minLength?: number },
): Promise<void> {
  const timeout = options?.timeout ?? 8000;
  const minLength = options?.minLength ?? 1;

  await expect(page.locator('.cm-content')).toBeVisible({ timeout });

  await page.waitForFunction(
    ({ minLen }: { minLen: number }) => {
      const content =
        getMarkluckWindow().__markluck_getEditorContent?.() ??
        document.querySelector('.cm-content')?.textContent ??
        '';
      return content.length >= minLen;
    },
    { minLen: minLength },
    { timeout },
  );
}

/**
 * 在编辑器中打开指定笔记。
 */
export async function openNote(page: Page, noteName: string): Promise<void> {
  await page.locator('.node-name', { hasText: noteName }).click();
  await waitForEditorReady(page);
}

/**
 * 等待保存状态变为"已保存"。
 */
export async function waitForSaved(page: Page, timeout = 8000): Promise<void> {
  await expect(page.locator('.status-saved')).toBeVisible({ timeout });
}

/**
 * 在编辑器末尾输入文本。
 */
export async function typeAtEnd(page: Page, text: string): Promise<void> {
  await page.locator('.cm-content').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type(text);
}

/**
 * 在 CM6 编辑器中选中指定文本。
 */
export async function selectTextInEditor(page: Page, text: string): Promise<boolean> {
  return page.evaluate((searchText: string) => {
    const cmEditor = document.querySelector('.cm-editor');
    if (!cmEditor) return false;

    // 尝试通过 Vue 组件实例获取 CM6 EditorView
    const markdownEditor = document.querySelector('.markdown-editor');
    if (markdownEditor) {
      const vueInstance = (markdownEditor as unknown as { __vueParentComponent?: VueComponentRef })
        .__vueParentComponent;
      const view = vueInstance?.exposed?.getEditorView?.();
      if (view) {
        const doc = view.state.doc.toString();
        const start = doc.indexOf(searchText);
        if (start < 0) return false;
        const end = start + searchText.length;
        view.dispatch({ selection: { anchor: start, head: end } });
        return true;
      }
    }

    return false;
  }, text);
}
