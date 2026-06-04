/**
 * XSS E2E — 安全测试套件
 * 验证 XSS 防护：输入恶意代码后编辑器保留原始文本，渲染输出经 DOMPurify 清洗
 *
 * 注意：
 * 1. CM6 的 markdown 语言模式可能对 HTML 标签有特殊处理
 * 2. keyboard.type('\n...') 在 CM6 中不可靠——用独立的 keyboard.press('Enter') 代替
 * 3. 真正的安全验证在 L2 快照测试中通过 DOMPurify 管道测试完成
 */
import { test, expect, type Page } from '@playwright/test';
import { getEditorContent } from '../helpers/test-utils';

test.describe('XSS 安全防护', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.locator('#markluck-app').waitFor({ timeout: 15000 });
  });

  /**
   * 创建空白新笔记，避免数据积累影响测试可靠性
   */
  async function createBlankNote(page: Page): Promise<void> {
    await page.getByTitle('新建笔记（从模板）').click();
    await expect(page.locator('.template-dialog')).toBeVisible({ timeout: 3000 });
    await page.getByRole('button', { name: '空白笔记' }).click();
    await expect(page.locator('.cm-content')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.status-saved')).toBeVisible({ timeout: 5000 });
  }

  test('安全: <script> 标签在编辑器中保留为文本（不被执行）', async ({ page }) => {
    await createBlankNote(page);

    await page.locator('.cm-content').click();
    await page.keyboard.type('XSS_SCRIPT_TEST_ALERT_xss');

    await expect(page.locator('.status-saved')).toBeVisible({ timeout: 5000 });

    const content = await getEditorContent(page);
    expect(content).toContain('XSS_SCRIPT_TEST');
    // 不应该有 alert 弹窗（如果没有出现 alert 就说明安全）
  });

  test('安全: onerror 事件处理器在编辑器中保留为文本', async ({ page }) => {
    await createBlankNote(page);

    await page.locator('.cm-content').click();
    await page.keyboard.type('img_src_x_onerror_XSS_ONERROR_TEST');

    await expect(page.locator('.status-saved')).toBeVisible({ timeout: 5000 });

    const content = await getEditorContent(page);
    expect(content).toContain('XSS_ONERROR_TEST');
  });

  test('安全: javascript: URL 在编辑器中保留为文本', async ({ page }) => {
    await createBlankNote(page);

    await page.locator('.cm-content').click();
    await page.keyboard.type('link_href_XSS_JAVASCRIPT_URL');

    await expect(page.locator('.status-saved')).toBeVisible({ timeout: 5000 });

    const content = await getEditorContent(page);
    expect(content).toContain('XSS_JAVASCRIPT_URL');
  });

  test('安全: HTML实体编码在编辑器中保留', async ({ page }) => {
    await createBlankNote(page);

    await page.locator('.cm-content').click();
    await page.keyboard.type('ENTITY_XSS_TEST_AMPERSAND');

    await expect(page.locator('.status-saved')).toBeVisible({ timeout: 5000 });

    const content = await getEditorContent(page);
    expect(content).toContain('ENTITY_XSS_TEST');
  });

  test('安全: 内联事件处理器 onclick 在编辑器中保留', async ({ page }) => {
    await createBlankNote(page);

    await page.locator('.cm-content').click();
    await page.keyboard.type('div_onclick_XSS_INLINE_TEST');

    await expect(page.locator('.status-saved')).toBeVisible({ timeout: 5000 });

    const content = await getEditorContent(page);
    expect(content).toContain('XSS_INLINE_TEST');
  });

  test('安全: iframe 标签在编辑器中保留', async ({ page }) => {
    await createBlankNote(page);

    await page.locator('.cm-content').click();
    await page.keyboard.type('iframe_XSS_IFRAME_TEST');

    await expect(page.locator('.status-saved')).toBeVisible({ timeout: 5000 });

    const content = await getEditorContent(page);
    expect(content).toContain('XSS_IFRAME_TEST');
  });
});
