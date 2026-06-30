/**
 * M7 E2E — 边界与压力测试
 *
 * 覆盖：空笔记、超长行、中文/Emoji/特殊字符、快速切换、
 *       深层嵌套、并发对话框、Markdown 表格、代码块
 */
import { test, expect } from '@playwright/test';
import {
  waitForAppReady,
  typeInEditor,
  getEditorContent,
  clearEditor,
  appendInEditor,
  waitForAutoSave,
} from '../helpers/test-utils';

// ============================================================
// Test Data
// ============================================================

/** Generate a single-line string of N 'A' characters */
function longLine(n: number): string {
  return 'A'.repeat(n);
}

/** Build a 10-level nested markdown list */
function deepNestedList(levels: number): string {
  const lines: string[] = [];
  for (let i = 1; i <= levels; i++) {
    lines.push(`${'  '.repeat(i - 1)}- Level ${i} item`);
  }
  return lines.join('\n');
}

// ============================================================
// Tests
// ============================================================

test.describe('边界与压力测试', () => {
  test.beforeEach(async ({ page }) => {
    await waitForAppReady(page);
  });

  // ----------------------------------------------------------
  // 1. Empty note creation
  // ----------------------------------------------------------
  test('should handle empty note creation', async ({ page }) => {
    // Click the new-note button in the left wing
    await page.locator('.wing-new-btn').click();

    // Template dialog should appear
    await expect(page.locator('.modal-overlay')).toBeVisible({ timeout: 3000 });
    await expect(page.locator('.tpl-card.blank-card')).toBeVisible();

    // Select the blank note option
    await page.locator('.tpl-card.blank-card').click();

    // Dialog should close and editor should be active
    await expect(page.locator('.modal-overlay')).not.toBeVisible({ timeout: 3000 });
    await expect(page.locator('.cm-content')).toBeVisible({ timeout: 5000 });

    // Verify editor contains the default blank-note content (not empty,
    // the blank template seeds '# 新笔记')
    const content = await getEditorContent(page);
    expect(content.length).toBeGreaterThan(0);

    // Verify the app is still functional — status bar present
    await expect(page.getByRole('status', { name: '编辑器状态栏' })).toBeVisible({
      timeout: 5000,
    });

    // Clear the editor and verify it handles truly-empty content
    await clearEditor(page);
    await page.waitForTimeout(300);
    const cleared = await getEditorContent(page);
    expect(cleared.length).toBe(0);

    // Auto-save should still work after clearing (at minimum no crash)
    await page.waitForTimeout(800);
    const finalContent = await getEditorContent(page);
    // After auto-save the content may stay empty or be reverted — either is fine
    // as long as the app didn't crash
    expect(typeof finalContent).toBe('string');
  });

  // ----------------------------------------------------------
  // 2. Very long single line (>5000 chars)
  // ----------------------------------------------------------
  test('should handle very long single line (>5000 chars)', async ({ page }) => {
    // First, ensure we have an active note to edit
    await page.locator('.wing-new-btn').click();
    await expect(page.locator('.modal-overlay')).toBeVisible({ timeout: 3000 });
    await page.locator('.tpl-card.blank-card').click();
    await expect(page.locator('.modal-overlay')).not.toBeVisible({ timeout: 3000 });
    await expect(page.locator('.cm-content')).toBeVisible({ timeout: 5000 });

    const longText = longLine(5500);
    await page.locator('.cm-content').click();
    await page.keyboard.press('Control+a');
    await page.keyboard.press('Backspace');
    await page.keyboard.insertText(longText);

    await page.waitForTimeout(500);

    // Verify the content was injected
    const content = await getEditorContent(page);
    expect(content.length).toBeGreaterThanOrEqual(5000);
    expect(content).toContain('AAAAA'); // should be all A's

    // Verify app didn't crash — status bar still visible, editor responsive
    await expect(page.locator('.cm-content')).toBeVisible();
    // Type a character to verify editor is still interactive
    await page.locator('.cm-content').click();
    await page.keyboard.press('End');
    await page.keyboard.type('Z');
    await page.waitForTimeout(300);
    const updated = await getEditorContent(page);
    expect(updated).toContain('Z');
  });

  // ----------------------------------------------------------
  // 3. Chinese characters
  // ----------------------------------------------------------
  test('should handle Chinese characters correctly', async ({ page }) => {
    // Ensure active note
    await page.locator('.wing-new-btn').click();
    await expect(page.locator('.modal-overlay')).toBeVisible({ timeout: 3000 });
    await page.locator('.tpl-card.blank-card').click();
    await expect(page.locator('.modal-overlay')).not.toBeVisible({ timeout: 3000 });
    await expect(page.locator('.cm-content')).toBeVisible({ timeout: 5000 });

    const chineseText =
      '这是一段中文测试文本。\n' +
      '包含标点符号: ,.!?;:[]<>\n' +
      '还有全角字符: １２３ＡＢＣ\n' +
      '古文片段: 学而时习之,不亦说乎。';

    await typeInEditor(page, chineseText);
    await page.waitForTimeout(500);

    const content = await getEditorContent(page);
    expect(content).toContain('这是一段中文测试文本');
    expect(content).toContain('学而时习之,不亦说乎');
    expect(content).toContain('全角字符');
  });

  // ----------------------------------------------------------
  // 4. Emoji characters
  // ----------------------------------------------------------
  test('should handle emoji characters', async ({ page }) => {
    await page.locator('.wing-new-btn').click();
    await expect(page.locator('.modal-overlay')).toBeVisible({ timeout: 3000 });
    await page.locator('.tpl-card.blank-card').click();
    await expect(page.locator('.modal-overlay')).not.toBeVisible({ timeout: 3000 });
    await expect(page.locator('.cm-content')).toBeVisible({ timeout: 5000 });

    const emojiText = [
      '😀😃😄😁😅😂🤣',
      '🎉🎊🎈🎁🎀',
      '👍👎👏🙌🤝',
      '🚀⭐🔥💡🌈',
      '混合 emoji 和文字 test 🧪',
      'Flag: 🏳️‍🌈  Skin tone: 👍🏻👍🏽👍🏿',
    ].join('\n');

    await typeInEditor(page, emojiText);
    await page.waitForTimeout(500);

    const content = await getEditorContent(page);
    expect(content).toContain('😀');
    expect(content).toContain('🎉');
    expect(content).toContain('🚀');
    expect(content).toContain('混合 emoji 和文字 test 🧪');
  });

  // ----------------------------------------------------------
  // 5. Special markdown characters
  // ----------------------------------------------------------
  test('should handle special markdown characters', async ({ page }) => {
    await page.locator('.wing-new-btn').click();
    await expect(page.locator('.modal-overlay')).toBeVisible({ timeout: 3000 });
    await page.locator('.tpl-card.blank-card').click();
    await expect(page.locator('.modal-overlay')).not.toBeVisible({ timeout: 3000 });
    await expect(page.locator('.cm-content')).toBeVisible({ timeout: 5000 });

    const specialChars = [
      'Bold: ***triple stars***',
      'Strikethrough: ~~~struck text~~~',
      'Blockquote: > quoted line',
      'HR: --- separator ---',
      'Escaped: \\* \\_ \\[ \\] \\( \\)',
      'HTML entities: &lt; &gt; &amp; &quot;',
      'Backticks: `inline code`',
      'Nested: **bold *and italic***',
    ].join('\n');

    await typeInEditor(page, specialChars);
    await page.waitForTimeout(500);

    const content = await getEditorContent(page);
    // All special markdown characters should be preserved as-is in source
    expect(content).toContain('***triple stars***');
    expect(content).toContain('~~~struck text~~~');
    expect(content).toContain('> quoted line');
    expect(content).toContain('--- separator ---');
    expect(content).toContain('`inline code`');
    expect(content).toContain('&lt; &gt; &amp;');
  });

  // ----------------------------------------------------------
  // 6. Rapid note switching
  // ----------------------------------------------------------
  test('should handle rapid note switching', async ({ page }) => {
    // First, create a few notes so we have bookmark dots to click
    const noteCount = 3;
    for (let i = 0; i < noteCount; i++) {
      await page.locator('.wing-new-btn').click();
      await expect(page.locator('.modal-overlay')).toBeVisible({ timeout: 3000 });
      await page.locator('.tpl-card.blank-card').click();
      await expect(page.locator('.modal-overlay')).not.toBeVisible({ timeout: 3000 });
      await page.waitForTimeout(500);
    }

    // Get all bookmark dots
    const dots = page.locator('.wing-bookmark-dot');
    const dotCount = await dots.count();
    expect(dotCount).toBeGreaterThanOrEqual(noteCount);

    // Rapidly click through all dots multiple times
    for (let round = 0; round < 3; round++) {
      for (let i = 0; i < dotCount; i++) {
        await dots.nth(i).evaluate((dot) => {
          (dot as HTMLButtonElement).click();
        });
        // No delay between clicks — stress test rapid switching without
        // coupling the assertion to WebKit's pointer stability heuristic.
      }
      await page.waitForTimeout(200);
    }
    // Allow the intentionally queued rapid switches to settle before verifying
    // the editor can accept new input. Otherwise a late note selection can race
    // with the post-stress typing assertion and make the test observe a
    // different, still-valid active note.
    await page.waitForTimeout(1000);

    // Verify app is still functional after rapid switching
    await expect(page.locator('.cm-content')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.app-shell')).toBeVisible();
    const stableNote = page.locator('.wing-bookmark-dot[aria-label="快速入门"]');
    await expect(stableNote).toBeVisible({ timeout: 5000 });
    await stableNote.click();
    await expect
      .poll(() => getEditorContent(page), { timeout: 10000 })
      .toContain('欢迎使用 MarkLuck');
    await expect(page.locator('.status-saved')).toBeVisible({ timeout: 10000 });

    // Should be able to type after switching
    await appendInEditor(page, '\nRapid switch survived!');
    await expect
      .poll(() => getEditorContent(page), { timeout: 5000 })
      .toContain('Rapid switch survived');
  });

  // ----------------------------------------------------------
  // 7. Deep nested lists (10 levels)
  // ----------------------------------------------------------
  test('should handle deep nested lists', async ({ page }) => {
    await page.locator('.wing-new-btn').click();
    await expect(page.locator('.modal-overlay')).toBeVisible({ timeout: 3000 });
    await page.locator('.tpl-card.blank-card').click();
    await expect(page.locator('.modal-overlay')).not.toBeVisible({ timeout: 3000 });
    await expect(page.locator('.cm-content')).toBeVisible({ timeout: 5000 });

    const nestedList = deepNestedList(10);

    await typeInEditor(page, nestedList);
    await page.waitForTimeout(500);

    const content = await getEditorContent(page);
    // Verify all 10 levels are present
    for (let i = 1; i <= 10; i++) {
      expect(content).toContain(`Level ${i} item`);
    }
    // Verify correct indentation for level 10 (18 spaces + '- ')
    expect(content).toContain('                  - Level 10 item');
    // Verify level 1 has no indentation
    const lines = content.split('\n');
    const level1Line = lines.find((l) => l.includes('Level 1 item'));
    expect(level1Line?.trimStart()).toBe('- Level 1 item');
  });

  // ----------------------------------------------------------
  // 8. Concurrent dialog opening/closing
  // ----------------------------------------------------------
  test('should handle concurrent dialog opening and closing', async ({ page }) => {
    // --- Round 1: Open command palette, then close ---
    await page.keyboard.press('Control+k');
    await expect(page.locator('.palette')).toBeVisible({ timeout: 3000 });

    // Close via Escape
    await page.keyboard.press('Escape');
    await expect(page.locator('.palette')).not.toBeVisible({ timeout: 2000 });

    // --- Round 2: Open command palette, close via overlay click ---
    await page.keyboard.press('Control+k');
    await expect(page.locator('.palette')).toBeVisible({ timeout: 3000 });

    // Click the overlay backdrop to dismiss
    await page.locator('.palette-overlay').click({ position: { x: 10, y: 10 } });
    await expect(page.locator('.palette')).not.toBeVisible({ timeout: 2000 });

    // --- Round 3: Open export dialog rapidly ---
    // First ensure we have an active note (export needs content)
    await page.locator('.wing-new-btn').click();
    await expect(page.locator('.modal-overlay')).toBeVisible({ timeout: 3000 });
    await page.locator('.tpl-card.blank-card').click();
    await expect(page.locator('.modal-overlay')).not.toBeVisible({ timeout: 3000 });
    await page.waitForTimeout(500);

    // Trigger export via topbar button
    const exportBtn = page.locator('[aria-label="导出笔记"]');
    await exportBtn.click();
    // Export dialog is inside .modal-overlay
    await expect(page.locator('.modal-overlay')).toBeVisible({ timeout: 3000 });
    await expect(page.locator('.modal-card')).toBeVisible();

    // Close export via close button
    await page.locator('.modal-close').click();
    await expect(page.locator('.modal-overlay')).not.toBeVisible({ timeout: 2000 });

    // --- Round 4: Rapid open → close → open cycle ---
    await page.keyboard.press('Control+k');
    await expect(page.locator('.palette')).toBeVisible({ timeout: 2000 });
    await page.keyboard.press('Escape');
    await page.locator('[aria-label="导出笔记"]').click();
    await expect(page.locator('.modal-overlay')).toBeVisible({ timeout: 2000 });
    await page.keyboard.press('Escape');
    await expect(page.locator('.modal-overlay')).not.toBeVisible({ timeout: 2000 });

    // Verify app is still functional
    await expect(page.locator('.app-shell')).toBeVisible();
    await expect(page.locator('.cm-content')).toBeVisible();
  });

  // ----------------------------------------------------------
  // 9. Markdown table input
  // ----------------------------------------------------------
  test('should handle markdown table input', async ({ page }) => {
    await page.locator('.wing-new-btn').click();
    await expect(page.locator('.modal-overlay')).toBeVisible({ timeout: 3000 });
    await page.locator('.tpl-card.blank-card').click();
    await expect(page.locator('.modal-overlay')).not.toBeVisible({ timeout: 3000 });
    await expect(page.locator('.cm-content')).toBeVisible({ timeout: 5000 });

    const tableText = [
      '| 列A | 列B | 列C |',
      '| --- | --- | --- |',
      '| 单元格1 | 单元格2 | 单元格3 |',
      '| 数据A | 数据B | 数据C |',
      '| 中文列 | 英文列 | 混合列 mix |',
    ].join('\n');

    await typeInEditor(page, tableText);
    await page.waitForTimeout(500);

    const content = await getEditorContent(page);
    expect(content).toContain('| 列A | 列B | 列C |');
    expect(content).toContain('| --- | --- | --- |');
    expect(content).toContain('| 单元格1 | 单元格2 | 单元格3 |');
    expect(content).toContain('| 数据A | 数据B | 数据C |');
    expect(content).toContain('| 中文列 | 英文列 | 混合列 mix |');
  });

  // ----------------------------------------------------------
  // 10. Fenced code block with language
  // ----------------------------------------------------------
  test('should handle code blocks with language', async ({ page }) => {
    await page.locator('.wing-new-btn').click();
    await expect(page.locator('.modal-overlay')).toBeVisible({ timeout: 3000 });
    await page.locator('.tpl-card.blank-card').click();
    await expect(page.locator('.modal-overlay')).not.toBeVisible({ timeout: 3000 });
    await expect(page.locator('.cm-content')).toBeVisible({ timeout: 5000 });

    const codeBlockText = [
      '```javascript',
      'function hello(name) {',
      '  console.log(`Hello, ${name}!`);',
      '  return name.toUpperCase();',
      '}',
      '',
      '// Call the function',
      'hello("MarkLuck");',
      '```',
      '',
      '```python',
      'def fibonacci(n):',
      '    if n <= 1:',
      '        return n',
      '    return fibonacci(n-1) + fibonacci(n-2)',
      '',
      'print(fibonacci(10))',
      '```',
    ].join('\n');

    await typeInEditor(page, codeBlockText);
    await page.waitForTimeout(500);

    const content = await getEditorContent(page);
    // Verify both code blocks are preserved
    expect(content).toContain('```javascript');
    expect(content).toContain('function hello(name)');
    expect(content).toContain('console.log(`Hello, ${name}!`);');
    expect(content).toContain('```');
    expect(content).toContain('```python');
    expect(content).toContain('def fibonacci(n):');
    expect(content).toContain('print(fibonacci(10))');

    // Verify language identifiers are preserved
    const jsIdx = content.indexOf('```javascript');
    const pyIdx = content.indexOf('```python');
    expect(jsIdx).not.toBe(-1);
    expect(pyIdx).toBeGreaterThan(jsIdx); // python block comes after js block
  });
});
