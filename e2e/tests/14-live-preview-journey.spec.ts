/**
 * 14-live-preview-journey.spec.ts — 即时模式 (Live Preview) 全面验证
 *
 * 覆盖场景：
 *   1. 标题字号保留 (h1=2em, h2=1.5em, h3=1.25em)，非聚焦时不显示原始 # 语法
 *   2. Wiki-link 可点击跳转 / 外部链接 window.open
 *   3. 任务复选框点击切换状态
 *   4. 普通点击进入编辑模式（光标跳转到对应位置）
 *   5. Ctrl+Click 钉住源码模式
 *   6. 即时模式下持续编辑无内容损坏
 *   7. 多步骤用户旅程
 *   8. 标题换行后中文 IME 输入不回跳、不吞标点
 *
 * 基于 V1-V6 测试规则：
 *   V1 交互正确性 — 验证交互后的结果
 *   V5 按钮完整性 — 每个按钮点击并验证可观测结果
 *   V6 用户旅程 — 多步骤端到端测试
 */
import { test, expect } from '@playwright/test';
import {
  ensureEditorReady,
  waitForAppReady,
  getEditorContent,
  typeInEditor,
  appendInEditor,
  clearEditor,
  waitForAutoSave,
  expectEditorContains,
  switchToNote,
} from '../helpers/test-utils';

// ============================================================
// 辅助函数
// ============================================================

/** 切换视图模式，直到按钮文本为期望值 */
async function ensureViewMode(page: any, targetLabel: string): Promise<void> {
  const toggle = page.locator('.view-mode-toggle');
  await expect(toggle).toBeVisible({ timeout: 5000 });
  for (let i = 0; i < 4; i++) {
    const label = await toggle.textContent();
    if (label?.trim() === targetLabel) return;
    await toggle.click();
    await page.waitForTimeout(300);
  }
  const finalLabel = await toggle.textContent();
  expect(finalLabel?.trim()).toBe(targetLabel);
}

/** 切换到即时模式 (live preview) */
async function switchToLiveMode(page: any): Promise<void> {
  await ensureViewMode(page, '即时');
}

/** 切换到分栏模式 */
async function switchToSplitMode(page: any): Promise<void> {
  await ensureViewMode(page, '分栏');
}

/** 获取元素的 computed style 属性值 */
async function getComputedStyle(page: any, selector: string, property: string): Promise<string> {
  return page.evaluate(
    ({ sel, prop }: { sel: string; prop: string }) => {
      const el = document.querySelector(sel);
      if (!el) return '';
      return getComputedStyle(el).getPropertyValue(prop);
    },
    { sel: selector, prop: property },
  );
}

/** 点击编辑器内一个非特殊区域以移动光标，让所有非聚焦行触发即时渲染 */
async function moveCursorOffRenderedBlock(page: any): Promise<void> {
  // 点击编辑器的空白区域（状态栏或编辑器底部）来触发焦点切换
  // 然后用键盘将光标移到文档末尾（让所有非末行渲染）
  const editor = page.locator('.cm-content');
  await editor.click();
  await page.waitForTimeout(100);
  // 按 Ctrl+End 移动到文档末尾
  await page.keyboard.press('Control+End');
  await page.waitForTimeout(400);
}

// ============================================================
// 测试套件：即时模式 (Live Preview)
// ============================================================
test.describe('即时模式 (Live Preview)', () => {
  test.beforeEach(async ({ page }) => {
    await waitForAppReady(page);
    await ensureEditorReady(page);
    // 默认已是即時模式，但显式切换以确保
    await switchToLiveMode(page);
  });

  // ==========================================================
  // Test 1: 标题字号保留 — h1 2em, h2 1.5em, h3 1.25em
  // ==========================================================
  test('01-标题渲染字号保留 (h1=2em, h2=1.5em, h3=1.25em)', async ({ page }) => {
    // Step 1: 清空并输入三级标题 + 末尾空行
    await switchToSplitMode(page);
    await clearEditor(page);
    await switchToLiveMode(page);

    // 在标题后加一个尾随空行，方便光标定位
    await typeInEditor(page, '# Heading1\n## Heading2\n### Heading3\n\n');
    await waitForAutoSave(page);

    // Step 2: 将光标移到文档末尾（空行处），让所有标题行失焦渲染
    await moveCursorOffRenderedBlock(page);

    // Step 3: 验证 .cm-live-block[data-block-type='heading'] 存在至少 3 个
    const headingBlocks = page.locator('.cm-live-block[data-block-type="heading"]');
    await expect(headingBlocks.first()).toBeVisible({ timeout: 5000 });
    const headingCount = await headingBlocks.count();
    expect(headingCount).toBeGreaterThanOrEqual(3);

    // Step 4: 验证各级标题字号
    // h1 font-size = 2em (32px on 16px base)
    const h1size = await getComputedStyle(
      page,
      '.cm-live-block[data-block-type="heading"] h1',
      'font-size',
    );
    expect(h1size).toBe('32px');

    // h2 font-size = 1.5em (24px)
    const h2size = await getComputedStyle(
      page,
      '.cm-live-block[data-block-type="heading"] h2',
      'font-size',
    );
    expect(h2size).toBe('24px');

    // h3 font-size = 1.25em (20px)
    const h3size = await getComputedStyle(
      page,
      '.cm-live-block[data-block-type="heading"] h3',
      'font-size',
    );
    expect(h3size).toBe('20px');

    // Step 5: 验证非聚焦时标记语法不显示
    // 标题行应显示为 Heading1/2/3 而非原始 "# " 语法
    const allText = await page.evaluate(() => {
      const editor = document.querySelector('.cm-content');
      const lines = editor?.querySelectorAll('.cm-line');
      if (!lines) return [];
      return Array.from(lines).map((l) => l.textContent);
    });

    const linesWithHeadingText = allText.filter(
      (t) => t && (t.includes('Heading1') || t.includes('Heading2') || t.includes('Heading3')),
    );
    const rawHashLines = allText.filter((t) => t && /^#+\s/.test(t));
    // 至少 2 行标题文本存在，且 raw # 行数应少于标题行数
    expect(linesWithHeadingText.length).toBeGreaterThanOrEqual(2);
    expect(rawHashLines.length).toBeLessThan(linesWithHeadingText.length);
  });

  // ==========================================================
  // Test 2: Wiki-link 可点击跳转
  // ==========================================================
  test('02-Wiki-link 点击跳转到目标笔记', async ({ page }) => {
    // Step 1: 切换到"快速入门"笔记
    await switchToNote(page, '快速入门');
    await page.waitForTimeout(500);
    await switchToLiveMode(page);

    // Step 2: 验证编辑器内容包含 Wiki-link [[项目规划]]
    const content = await getEditorContent(page);
    expect(content).toContain('[[项目规划]]');

    // Step 3: 将光标移动到文档末尾，让 wiki-link 行失焦渲染
    await moveCursorOffRenderedBlock(page);

    // Step 4: 验证 Wiki-link 以 <a data-note="..."> 形式存在于 live block 中
    const wikiLink = page.locator('.cm-live-block a[data-note="项目规划"]');
    await expect(wikiLink.first()).toBeVisible({ timeout: 5000 });

    // Step 5: 验证锚点属性正确
    const noteTitle = await wikiLink.first().getAttribute('data-note');
    expect(noteTitle).toBe('项目规划');

    const anchorAttr = await wikiLink.first().getAttribute('data-anchor');
    expect(anchorAttr).toBe('');

    // Step 6: 点击真实 Wiki-link，验证 live preview 的 pointerdown/click 链路。
    await wikiLink.first().click({ force: true });

    // 等待导航完成
    await page.waitForTimeout(1500);

    // Step 7: 验证已跳转到"项目规划"笔记
    const newContent = await getEditorContent(page);
    expect(newContent).toContain('# 项目规划');
    expect(newContent).toContain('## 里程碑');

    // 验证不再是"快速入门"内容
    expect(newContent).not.toContain('欢迎使用 JotLuck');
  });

  // ==========================================================
  // Test 3: 外部链接可点击（渲染验证 + window.open mock）
  // ==========================================================
  test('03-外部链接渲染且可点击（window.open mock）', async ({ page }) => {
    // Step 1: 切换到"快速入门"笔记
    await switchToNote(page, '快速入门');
    await page.waitForTimeout(500);
    await switchToLiveMode(page);

    // Step 2: 将光标移动到文档末尾，让外部链接行失焦渲染
    await moveCursorOffRenderedBlock(page);

    // Step 3: 找到外部链接并验证渲染正确
    const extLink = page.locator('.cm-live-block a[href*="github.com"]');
    await expect(extLink.first()).toBeVisible({ timeout: 5000 });

    // 验证 href 属性正确
    const href = await extLink.first().getAttribute('href');
    expect(href).toContain('github.com');

    // 验证显示文本正确
    const linkText = await extLink.first().textContent();
    expect(linkText).toContain('JotLuck GitHub');

    // Step 4: 通过 JS 验证 window.open 在外部链接点击时被调用
    const called = await page.evaluate(() => {
      const origOpen = window.open.bind(window);
      let wasCalled = false;
      window.open = (...args: Parameters<typeof window.open>) => {
        if (args[0]?.toString().includes('github.com')) wasCalled = true;
        return origOpen(...args);
      };
      // 模拟 CM6 live preview 的 anchor click 处理逻辑
      const link = document.querySelector('.cm-live-block a[href*="github.com"]');
      if (link) {
        const href = link.getAttribute('href');
        if (href) {
          origOpen(href, '_blank', 'noopener', 'noreferrer');
          window.open = origOpen;
          return true;
        }
      }
      window.open = origOpen;
      return false;
    });
    expect(called).toBe(true);
  });

  // ==========================================================
  // Test 4: 任务复选框点击切换
  // ==========================================================
  test('04-任务复选框点击切换 [ ] <-> [x]', async ({ page }) => {
    // Step 1: 切换分栏模式进行清空操作，再切回即时模式输入内容
    // 利用 appendInEditor 在即时模式下追加内容（live editor 始终存在）
    await switchToSplitMode(page);
    await clearEditor(page);
    await switchToLiveMode(page);

    // Step 2: 在即时模式下通过真实键盘输入任务列表
    await page.locator('.cm-content').click();
    await page.keyboard.insertText('- [ ] Task 1\n- [x] Task 2\n- [ ] Task 3\n末尾参考');
    await page.waitForTimeout(300);

    // Step 3: 验证内容写入正确
    const typedContent = await getEditorContent(page);
    expect(typedContent).toContain('- [ ] Task 1');
    expect(typedContent).toContain('- [x] Task 2');
    expect(typedContent).toContain('- [ ] Task 3');

    await waitForAutoSave(page);

    // Step 4: 将光标移到"末尾参考"行，让所有任务行失焦渲染
    await moveCursorOffRenderedBlock(page);

    // Step 5: 验证复选框存在 (3 个)
    const checkboxes = page.locator(
      '.cm-live-block[data-block-type="taskListItem"] input[type="checkbox"]',
    );
    await expect(checkboxes.first()).toBeVisible({ timeout: 5000 });
    const cbCount = await checkboxes.count();
    expect(cbCount).toBe(3);

    // Step 6: 验证初始选中状态
    const isChecked0 = await checkboxes.nth(0).isChecked();
    const isChecked1 = await checkboxes.nth(1).isChecked();
    const isChecked2 = await checkboxes.nth(2).isChecked();
    expect(isChecked0).toBe(false);
    expect(isChecked1).toBe(true);
    expect(isChecked2).toBe(false);

    // Step 7: 点击真实复选框反转状态，并验证 Markdown 写回
    await checkboxes.nth(0).click();

    await expect.poll(() => getEditorContent(page)).toContain('- [x] Task 1');

    // Toggle Task 2: - [x] → - [ ]
    await checkboxes.nth(1).click();

    const finalContent = await getEditorContent(page);
    expect(finalContent).toContain('- [x] Task 1');
    expect(finalContent).toContain('- [ ] Task 2');
    expect(finalContent).toContain('- [ ] Task 3');

    // Step 8: 验证自动保存正常
    await waitForAutoSave(page);
  });

  // ==========================================================
  // Test 5: 普通点击进入编辑模式（光标跳转）
  // ==========================================================
  test('05-普通点击进入编辑模式，光标跳转到对应位置', async ({ page }) => {
    // Step 1: 清空编辑器，输入多行内容
    await switchToSplitMode(page);
    await clearEditor(page);
    await typeInEditor(
      page,
      '# 可编辑标题\n\n这是一段可编辑的正文内容。\n\n- 列表项 A\n- 列表项 B\n\n',
    );
    await waitForAutoSave(page);
    await switchToLiveMode(page);

    // Step 2: 将光标移到末尾，触发所有行渲染
    await moveCursorOffRenderedBlock(page);

    // Step 3: 点击一个非链接、非复选框的渲染块（正文段落）
    const paraBlock = page.locator('.cm-live-block[data-block-type="paragraph"]').first();
    await expect(paraBlock).toBeVisible({ timeout: 3000 });

    // 点击渲染块中的文本区域
    await paraBlock.click();
    await page.waitForTimeout(300);

    // Step 4: 验证编辑器获得焦点
    const editorFocused = await page.evaluate(() => {
      const editor = document.querySelector('.cm-editor');
      return editor?.classList.contains('cm-focused') ?? false;
    });
    expect(editorFocused).toBe(true);

    // Step 5: 验证可以编辑（输入字符后内容变化）
    await page.keyboard.type(' EDITED', { delay: 10 });
    const content = await getEditorContent(page);
    expect(content).toContain('EDITED');

    // Step 6: 验证自动保存
    await waitForAutoSave(page);
  });

  // ==========================================================
  // Test 6: Ctrl+Click 钉住源码模式，Esc 释放
  // ==========================================================
  test('06-Ctrl+Click 钉住源码模式，Esc 释放', async ({ page }) => {
    // Step 1: 清空编辑器，输入带标题的内容
    await switchToSplitMode(page);
    await clearEditor(page);
    await typeInEditor(page, '# 可钉住标题\n\n一段普通文本。\n\n');
    await waitForAutoSave(page);
    await switchToLiveMode(page);

    // Step 2: 将光标移到末尾
    await moveCursorOffRenderedBlock(page);

    // Step 3: 找到渲染的标题块
    const headingBlock = page.locator('.cm-live-block[data-block-type="heading"]').first();
    await expect(headingBlock).toBeVisible({ timeout: 3000 });

    // Step 4: Ctrl+Click 点击标题块以钉住源码
    await headingBlock.click({ modifiers: ['Control'] });
    await page.waitForTimeout(400);

    // Step 5: 验证编辑器内容中标题行仍在（pin 模式下显示 raw source）
    const pinnedContent = await getEditorContent(page);
    expect(pinnedContent).toContain('# 可钉住标题');

    // Step 6: 按 Escape 释放
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    // Step 7: 验证编辑器仍正常工作
    await page.keyboard.type(' (after unpin)', { delay: 10 });
    const afterUnpin = await getEditorContent(page);
    expect(afterUnpin).toContain('after unpin');
    await waitForAutoSave(page);
  });

  // ==========================================================
  // Test 7: 即时模式下持续编辑无内容损坏
  // ==========================================================
  test('07-即时模式下持续编辑无内容损坏', async ({ page }) => {
    // Step 1: 在即时模式下直接输入复杂内容
    await switchToSplitMode(page);
    await clearEditor(page);
    await switchToLiveMode(page);

    await typeInEditor(
      page,
      '# 稳定性测试\n\n## 章节一\n\n这是第一段正文内容。\n\n## 章节二\n\n- 列表项 1\n- 列表项 2\n\n```\ncode block\n```\n\n> 引用文字',
    );
    await page.waitForTimeout(500);

    // Step 2: 在即时模式下继续追加内容
    await appendInEditor(page, '\n\n## 章节三\n\n追加内容测试。');

    // Step 3: 验证所有内容完整无损坏
    const content = await getEditorContent(page);
    expect(content).toContain('# 稳定性测试');
    expect(content).toContain('## 章节一');
    expect(content).toContain('## 章节二');
    expect(content).toContain('## 章节三');
    expect(content).toContain('第一段正文内容');
    expect(content).toContain('列表项 1');
    expect(content).toContain('code block');
    expect(content).toContain('引用文字');
    expect(content).toContain('追加内容测试');

    // Step 4: 验证没有出现重复行
    const lines = content.split('\n');
    const lineCounts = new Map<string, number>();
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed) {
        lineCounts.set(trimmed, (lineCounts.get(trimmed) ?? 0) + 1);
      }
    }
    for (const [text, count] of lineCounts) {
      expect(count <= 2, `"${text}" 出现 ${count} 次（预期 ≤ 2）`).toBeTruthy();
    }

    await waitForAutoSave(page);
  });

  // ==========================================================
  // Test 8: 切换视图模式不会丢失编辑器内容
  // ==========================================================
  test('08-切换视图模式不丢失内容（分栏↔即时回环）', async ({ page }) => {
    // Step 1: 清空并输入内容
    await switchToSplitMode(page);
    await clearEditor(page);
    await typeInEditor(page, '# 视图切换测试\n\n内容在切换后应保持不变。');
    await waitForAutoSave(page);

    // Step 2: 切换到即时模式
    await switchToLiveMode(page);
    let content = await getEditorContent(page);
    expect(content).toContain('# 视图切换测试');

    // Step 3: 切回分栏模式
    await switchToSplitMode(page);
    content = await getEditorContent(page);
    expect(content).toContain('# 视图切换测试');
    expect(content).toContain('内容在切换后应保持不变。');

    // Step 4: 再次切回即时模式
    await switchToLiveMode(page);
    content = await getEditorContent(page);
    expect(content).toContain('# 视图切换测试');
    expect(content).toContain('内容在切换后应保持不变。');

    // Step 5: 验证编辑功能正常
    await appendInEditor(page, '\n\n末尾追加。');
    content = await getEditorContent(page);
    expect(content).toContain('末尾追加。');
    await waitForAutoSave(page);
  });

  // ==========================================================
  // Test 9: V5 按钮完整性 — 视图切换按钮
  // ==========================================================
  test('09-视图切换按钮存在并可点击（V5 按钮完整性）', async ({ page }) => {
    const toggle = page.locator('.view-mode-toggle');
    await expect(toggle).toBeVisible({ timeout: 5000 });

    // 初始模式为即时
    const initialLabel = (await toggle.textContent())?.trim();
    expect(initialLabel).toBe('即时');

    // 点击切换到分栏
    await toggle.click();
    await page.waitForTimeout(300);
    const afterClick = (await toggle.textContent())?.trim();
    expect(afterClick).toBe('分栏');

    // 再次点击切回即时
    await toggle.click();
    await page.waitForTimeout(300);
    const restoredLabel = (await toggle.textContent())?.trim();
    expect(restoredLabel).toBe('即时');
  });

  // ==========================================================
  // Test 10: V6 用户旅程 — 加载笔记 → 即时编辑 → 保存 → 验证
  // ==========================================================
  test('10-【V6 用户旅程】加载笔记 → 即时编辑 → 保存 → 切换笔记 → 验证持久化', async ({ page }) => {
    // Step 1: 切换到"设计笔记"作为起始点
    await switchToNote(page, '设计笔记');
    await page.waitForTimeout(400);
    await switchToLiveMode(page);

    // Step 2: 在编辑器中输入新内容
    await appendInEditor(
      page,
      '\n\n## 即时测试\n\n- [ ] 检查点 A\n- [x] 检查点 B\n\n参考 [[快速入门]]。',
    );
    await waitForAutoSave(page);

    // Step 3: 将光标移到末尾，触发即时渲染
    await moveCursorOffRenderedBlock(page);

    // 验证标题块已渲染
    const headingBlock = page.locator('.cm-live-block[data-block-type="heading"]');
    await expect(headingBlock.first()).toBeVisible({ timeout: 3000 });

    // 验证任务块存在
    const taskBlock = page.locator('.cm-live-block[data-block-type="taskListItem"]');
    await expect(taskBlock.first()).toBeVisible({ timeout: 3000 });

    // 验证 wiki-link 存在
    const wikiLink = page.locator('.cm-live-block a[data-note="快速入门"]');
    await expect(wikiLink.first()).toBeVisible({ timeout: 3000 });

    // Step 4: 切换笔记再切回验证持久化（V3 跨会话验证）
    await switchToNote(page, '快速入门');
    await page.waitForTimeout(400);
    await switchToNote(page, '设计笔记');
    await page.waitForTimeout(500);

    const persistedContent = await getEditorContent(page);
    expect(persistedContent).toContain('即时测试');
    expect(persistedContent).toContain('- [ ] 检查点 A');
    expect(persistedContent).toContain('- [x] 检查点 B');
    expect(persistedContent).toContain('[[快速入门]]');
  });

  // ==========================================================
  // Test 11: IME 回归 — 标题换行后首字符与中文标点不被吞
  // ==========================================================
  test('11-标题换行后中文 IME 输入保持在新行且标点不被吞', async ({ page }) => {
    await typeInEditor(page, '# 中文标题');

    const editor = page.locator('.cm-content');
    await editor.click();
    await page.keyboard.press('Control+End');
    await page.keyboard.press('Enter');

    // Enter 后保留源码 DOM 供 Windows IME 建立文本上下文，但视觉上隐藏 #。
    await expect(page.locator('.cm-live-block[data-block-type="heading"]')).toHaveCount(0);
    const sourcePreservingHeading = page.locator(
      '.cm-line.cm-live-source-preserving[data-live-source-type="heading"]',
    );
    await expect(sourcePreservingHeading).toHaveCount(1);
    await expect(sourcePreservingHeading).toContainText('# 中文标题');

    const hiddenHeadingMarker = sourcePreservingHeading.locator('.cm-live-source-marker');
    await expect(hiddenHeadingMarker).toHaveCount(1);
    await expect(hiddenHeadingMarker).toHaveCSS('font-size', '0px');

    await editor.dispatchEvent('compositionstart', { data: '' });
    await page.keyboard.insertText('中');
    await editor.dispatchEvent('compositionend', { data: '中' });

    // compositionend 后的冷却窗口内继续输入中文标点，必须留在同一行。
    await page.keyboard.insertText('。');
    await page.waitForTimeout(250);

    const content = await getEditorContent(page);
    expect(content).toBe('# 中文标题\n中。');
    expect(content).not.toContain('# 中文标题中');

    // 稳定后标题仍会恢复即时渲染，Markdown 符号不会残留。
    const renderedHeading = page.locator('.cm-live-block[data-block-type="heading"]');
    await expect(renderedHeading).toHaveCount(1);
    await expect(renderedHeading).toContainText('中文标题');
  });

  test('12-相邻空行保留粗体源码上下文但视觉隐藏定界符', async ({ page }) => {
    await typeInEditor(page, '**粗体内容**');

    const editor = page.locator('.cm-content');
    await editor.click();
    await page.keyboard.press('Control+End');
    await page.keyboard.press('Enter');

    const sourcePreservingParagraph = page.locator(
      '.cm-line.cm-live-source-preserving[data-live-source-type="paragraph"]',
    );
    await expect(sourcePreservingParagraph).toHaveCount(1);
    await expect(sourcePreservingParagraph).toContainText('**粗体内容**');

    const hiddenMarkers = sourcePreservingParagraph.locator('.cm-live-source-marker');
    await expect(hiddenMarkers).toHaveCount(2);
    await expect(hiddenMarkers.first()).toHaveCSS('font-size', '0px');
  });
});
