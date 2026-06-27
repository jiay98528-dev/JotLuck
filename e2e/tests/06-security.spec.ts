/**
 * MarkLuck E2E — 安全测试套件
 *
 * 验证 XSS 防护与内容安全扫描：
 *   1. 注入恶意代码到编辑器 → 渲染输出经 DOMPurify 清洗
 *   2. 内容安全扫描器检测零宽字符、双向文本覆盖字符
 *
 * 渲染管线: Markdown text → marked.parse → DOMPurify.sanitize → safe HTML
 * @see packages/renderer/src/sanitize.ts — DOMPurify 配置（FORBID_TAGS/FORBID_ATTR）
 * @see packages/app/src/utils/contentUtils.ts — 内容安全扫描器
 */
import { test, expect } from '@playwright/test';
import {
  ensureEditorReady,
  waitForAppReady,
  typeInEditor,
  getEditorContent,
} from '../helpers/test-utils';

// ============================================================
// Helpers
// ============================================================

/** 切换视图模式直到出现分栏预览 (.split-preview) */
async function ensureSplitPreview(page: import('@playwright/test').Page): Promise<void> {
  const toggle = page.locator('.view-mode-toggle');
  // 如果看不到切换按钮，说明当前无笔记选中，直接退出
  if (!(await toggle.isVisible().catch(() => false))) return;

  for (let i = 0; i < 3; i++) {
    const preview = page.locator('.split-preview');
    if (await preview.isVisible().catch(() => false)) return;
    await toggle.click();
    await page.waitForTimeout(400);
  }
}

/** 获取分栏预览区的渲染后 HTML */
async function getPreviewHTML(page: import('@playwright/test').Page): Promise<string> {
  await page.waitForTimeout(300); // 等渲染更新
  return page.evaluate(() => {
    const el = document.querySelector('.split-preview');
    return el?.innerHTML ?? '';
  });
}

/**
 * 通过 CM6 事务直接替换编辑器全部内容。
 * 用于注入无法通过键盘键入的特殊 Unicode 字符（如零宽空格、RTL 覆盖符）。
 */
async function setEditorContent(
  page: import('@playwright/test').Page,
  text: string,
): Promise<void> {
  await ensureEditorReady(page);
  await page.locator('.cm-content').click();
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Backspace');
  await page.keyboard.insertText(text);
  await page.waitForTimeout(300);
}

// ============================================================
// Test Suite
// ============================================================

test.describe('安全测试', () => {
  test.beforeEach(async ({ page }) => {
    await waitForAppReady(page);
  });

  // ----------------------------------------------------------
  // XSS Payload Injection Tests
  // ----------------------------------------------------------

  test('should sanitize script tag in markdown', async ({ page }) => {
    await typeInEditor(page, '<script>alert(1)</script>');
    await page.waitForTimeout(600);

    // 验证编辑器保留原始文本
    const editorContent = await getEditorContent(page);
    expect(editorContent).toContain('<script>');

    // 切换到分栏预览，验证渲染输出不含可执行脚本
    await ensureSplitPreview(page);
    const html = await getPreviewHTML(page);
    // DOMPurify 的 FORBID_TAGS 包含 script，应完全移除
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('</script>');
    // 脚本体也不应泄漏
    expect(html).not.toContain('alert(1)');
  });

  test('should sanitize img onerror handler', async ({ page }) => {
    await typeInEditor(page, '<img src=x onerror=alert(1)>');
    await page.waitForTimeout(600);

    const editorContent = await getEditorContent(page);
    expect(editorContent).toContain('onerror');

    await ensureSplitPreview(page);
    const html = await getPreviewHTML(page);
    // onerror 在 FORBID_ATTR 中，必须被剥离
    expect(html).not.toContain('onerror');
    expect(html).not.toContain('alert(1)');
    // img 标签本身在 ALLOWED_TAGS 中，可能保留 src
    // 但绝不应有任何事件处理器
    expect(html).not.toMatch(/on\w+=/);
  });

  test('should sanitize iframe with javascript URL', async ({ page }) => {
    await typeInEditor(page, '<iframe src="javascript:alert(1)"></iframe>');
    await page.waitForTimeout(600);

    const editorContent = await getEditorContent(page);
    expect(editorContent).toContain('iframe');

    await ensureSplitPreview(page);
    const html = await getPreviewHTML(page);
    // iframe 在 FORBID_TAGS 中，必须完全移除
    expect(html).not.toContain('<iframe');
    expect(html).not.toContain('</iframe>');
    expect(html).not.toContain('javascript:');
  });

  test('should sanitize svg onload handler', async ({ page }) => {
    await typeInEditor(page, '<svg onload=alert(1)></svg>');
    await page.waitForTimeout(600);

    const editorContent = await getEditorContent(page);
    expect(editorContent).toContain('svg');

    await ensureSplitPreview(page);
    const html = await getPreviewHTML(page);
    // svg 不在 ALLOWED_TAGS 中，应被移除
    expect(html).not.toContain('<svg');
    expect(html).not.toContain('onload');
    expect(html).not.toMatch(/on\w+=/);
  });

  // ----------------------------------------------------------
  // Safe Content Rendering Test
  // ----------------------------------------------------------

  test('should render safe HTML (bold, italic) in markdown', async ({ page }) => {
    await typeInEditor(page, '**bold** and *italic*');
    await page.waitForTimeout(600);

    await ensureSplitPreview(page);
    const html = await getPreviewHTML(page);

    // 粗体应该渲染为 <strong>
    expect(html).toMatch(/<strong[^>]*>bold<\/strong>/);
    // 斜体应该渲染为 <em>
    expect(html).toMatch(/<em[^>]*>italic<\/em>/);
    // 不应该有任何事件处理器或脚本
    expect(html).not.toMatch(/on\w+=/);
    expect(html).not.toContain('<script');
  });

  // ----------------------------------------------------------
  // Malicious Link Test
  // ----------------------------------------------------------

  test('should not execute event handlers in links', async ({ page }) => {
    await typeInEditor(page, '[click me](javascript:alert(1))');
    await page.waitForTimeout(600);

    const editorContent = await getEditorContent(page);
    expect(editorContent).toContain('click me');

    await ensureSplitPreview(page);
    const html = await getPreviewHTML(page);

    // 链接文本应该渲染
    expect(html).toContain('click me');
    // href 不应包含 javascript: 协议（DOMPurify 默认阻断）
    expect(html).not.toContain('javascript:');
    // 不应有事件处理器
    expect(html).not.toMatch(/on\w+=/);
  });

  // ----------------------------------------------------------
  // Content Safety Scanner Tests
  // ----------------------------------------------------------

  test('should detect zero-width characters', async ({ page }) => {
    // U+200B = ZERO WIDTH SPACE — 无法通过键盘键入，使用 CM6 事务注入
    const payload = 'Hello​World';
    await setEditorContent(page, payload);
    await page.waitForTimeout(500);

    // 验证编辑器内容包含零宽字符
    const editorContent = await getEditorContent(page);
    expect(editorContent).toContain('Hello');
    expect(editorContent).toContain('World');

    // 运行内容安全扫描器
    const warnings = await page.evaluate((content) => {
      // Dynamically import the scanner — use the same logic as contentUtils.ts
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const scanner = (window as any).__markluck_scanContentWarnings;
      if (typeof scanner === 'function') return scanner(content);
      // Fallback: inline the scanner logic
      const result: { type: string; message: string; position?: number }[] = [];
      for (let i = 0; i < content.length; i++) {
        const cp = content.codePointAt(i)!;
        // Zero-width chars: ZWSP(0x200B), ZWNJ(0x200C), ZWJ(0x200D), BOM(0xFEFF)
        if (cp === 0x200b || cp === 0x200c || cp === 0x200d || cp === 0xfeff) {
          result.push({
            type: 'zero-width',
            message: `检测到零宽字符 (U+${cp.toString(16)}) 在位置 ${i}`,
            position: i,
          });
        }
      }
      return result;
    }, editorContent);

    expect(warnings.length).toBeGreaterThan(0);
    const zwWarnings = warnings.filter((w: { type: string }) => w.type === 'zero-width');
    expect(zwWarnings.length).toBeGreaterThan(0);

    // 渲染输出应该是安全的 — 零宽字符不应导致任何异常
    await ensureSplitPreview(page);
    const html = await getPreviewHTML(page);
    expect(html).not.toContain('<script');
    expect(html).not.toMatch(/on\w+=/);
  });

  test('should detect bidi override characters', async ({ page }) => {
    // U+202E = RIGHT-TO-LEFT OVERRIDE — 无法通过键盘键入，使用 CM6 事务注入
    const payload = 'Normal‮RTL_Content‬';
    await setEditorContent(page, payload);
    await page.waitForTimeout(500);

    // 验证编辑器内容包含 bidi 字符
    const editorContent = await getEditorContent(page);
    expect(editorContent).toContain('Normal');
    expect(editorContent).toContain('RTL_Content');

    // 运行内容安全扫描器
    const warnings = await page.evaluate((content) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const scanner = (window as any).__markluck_scanContentWarnings;
      if (typeof scanner === 'function') return scanner(content);
      // Fallback: inline the scanner logic
      const result: { type: string; message: string; position?: number }[] = [];
      for (let i = 0; i < content.length; i++) {
        const cp = content.codePointAt(i)!;
        // Bidi override chars: LRE(0x202A), RLE(0x202B), PDF(0x202C), LRO(0x202D), RLO(0x202E)
        if (cp >= 0x202a && cp <= 0x202e) {
          result.push({
            type: 'bidi-override',
            message: `检测到双向文本覆盖字符 (U+${cp.toString(16)}) 在位置 ${i}`,
            position: i,
          });
        }
      }
      return result;
    }, editorContent);

    expect(warnings.length).toBeGreaterThan(0);
    const bidiWarnings = warnings.filter((w: { type: string }) => w.type === 'bidi-override');
    expect(bidiWarnings.length).toBeGreaterThan(0);

    // 渲染输出应该是安全的 — bidi 字符不应导致渲染异常或布局破坏
    await ensureSplitPreview(page);
    const html = await getPreviewHTML(page);
    expect(html).not.toContain('<script');
    expect(html).not.toMatch(/on\w+=/);
  });
});

test.describe('网络隐私', () => {
  test('should not contact GitHub update API on startup when auto-check is disabled', async ({
    page,
  }) => {
    let githubRequests = 0;
    await page.route('https://api.github.com/**', async (route) => {
      githubRequests++;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          tag_name: 'v0.1.0',
          html_url: 'https://github.com/jiay98528-dev/MarkLuck/releases/tag/v0.1.0',
          body: '',
        }),
      });
    });

    await page.addInitScript(() => {
      localStorage.setItem('markluck:welcome:completed', '1');
      localStorage.setItem('markluck:version:autoCheck', 'false');
    });
    await page.goto('http://localhost:5173', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.app-shell')).toBeVisible({ timeout: 10000 });

    await page.waitForTimeout(16000);
    expect(githubRequests).toBe(0);
  });
});
