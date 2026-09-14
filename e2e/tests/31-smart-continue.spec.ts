/**
 * 31-smart-continue.spec.ts — V0.2-A「智能续格式」E2E 套件
 *
 * 覆盖（10 个 journey）：
 *   J1  无序列表 Enter 延续、空 `- ` 项 Enter 退出结构
 *   J2  有序列表 Enter 递增编号（1. → 2.）
 *   J3  任务列表 Enter 延续为未选 `- [ ] `
 *   J4  引用 Enter 延续同深度 `> `
 *   J5  Backspace / Escape 取消空格式块预填
 *   J6  表格行 Enter 新增同列数空行；空行 Escape 删除
 *   J7  全角归一（＃ 渲染为 heading；－ 行尾 Enter → 新行半角 `- `）
 *   J8  撤销原子（Ctrl+Z 一次整体回退）
 *   J9  IME 等价（insertText 单笔注入中文后立刻 Enter，不双重延续）
 *   J10 fence 内 Enter 不拦截（无标记延续）
 *
 * 风格约定：与 01-editor-core.spec.ts 同风格；测试标题用英文（既有套件惯例）。
 *
 * 重要：装配后 Leader 修复四处测试侧缺陷（2026-09-13）——J5/J6 的 Escape 改
 * 有界循环兼容「ghost 优先」仲裁（PRD-v0.2 §6）、J6 末尾换行容差、J7/J9 裸
 * insertText 未聚焦丢输入改走 typeInEditor、J7 视图循环 split→read→live 两次点击。
 */
import { test, expect } from '@playwright/test';
import {
  waitForCleanAppReady,
  createBlankNote,
  getEditorContentFromBridge,
  typeInEditor,
  MOD_KEY,
} from '../helpers/test-utils';

// ============================================================
// Test Suite
// ============================================================
test.describe('智能续格式', () => {
  // 每个用例独立空白笔记，避免互相污染。补全保持默认开启（真实用户态）：
  // 涉及 Escape 的用例用有界循环兼容「ghost 优先」仲裁（PRD-v0.2 §6）。
  // 注：waitForCleanAppReady 会清空 jotluck:* localStorage，addInitScript
  // 预设补全开关会被清掉，勿依赖。
  test.beforeEach(async ({ page }) => {
    await waitForCleanAppReady(page);
    await createBlankNote(page);
  });

  // ──────────────────────────────────────────────────────────────
  // J1 — 无序列表 Enter 延续；空 `- ` 项 Enter 退出
  // ──────────────────────────────────────────────────────────────
  test('J1: unordered list Enter continues marker; empty item Enter exits structure', async ({
    page,
  }) => {
    // 第 1 步：`- 甲` Enter → 出现新行 `- `
    await typeInEditor(page, '- 甲');
    await page.keyboard.press('Enter');
    expect(await getEditorContentFromBridge(page)).toBe('- 甲\n- ');

    // 第 2 步：续行输入 `乙` 再 Enter → 出现第三个 `- `
    await page.keyboard.insertText('乙');
    await page.keyboard.press('Enter');
    expect(await getEditorContentFromBridge(page)).toBe('- 甲\n- 乙\n- ');

    // 第 3 步：空 `- ` 项 Enter → 退出结构，得到普通空行（无第三个 `- `）
    await page.keyboard.press('Enter');
    expect(await getEditorContentFromBridge(page)).toBe('- 甲\n- 乙\n');
  });

  // ──────────────────────────────────────────────────────────────
  // J2 — 有序列表 Enter 递增编号
  // ──────────────────────────────────────────────────────────────
  test('J2: ordered list Enter increments marker number', async ({ page }) => {
    await typeInEditor(page, '1. 一');
    await page.keyboard.press('Enter');
    expect(await getEditorContentFromBridge(page)).toBe('1. 一\n2. ');
  });

  // ──────────────────────────────────────────────────────────────
  // J3 — 任务列表 Enter 延续为未选
  // ──────────────────────────────────────────────────────────────
  test('J3: completed task item Enter continues as unchecked', async ({ page }) => {
    await typeInEditor(page, '- [x] 做完');
    await page.keyboard.press('Enter');
    expect(await getEditorContentFromBridge(page)).toBe('- [x] 做完\n- [ ] ');
  });

  // ──────────────────────────────────────────────────────────────
  // J4 — 引用 Enter 延续同深度
  // ──────────────────────────────────────────────────────────────
  test('J4: blockquote Enter continues same depth marker', async ({ page }) => {
    await typeInEditor(page, '> 引');
    await page.keyboard.press('Enter');
    expect(await getEditorContentFromBridge(page)).toBe('> 引\n> ');
  });

  // ──────────────────────────────────────────────────────────────
  // J5 — Backspace / Escape 取消空格式块预填
  // ──────────────────────────────────────────────────────────────
  test('J5: Backspace and Escape on empty format block cancel prefilled marker', async ({
    page,
  }) => {
    // Sequence A：空 `- ` 项 Backspace → 普通段落（标记消失）
    await typeInEditor(page, '- ');
    await page.keyboard.press('Backspace');
    const afterBackspace = await getEditorContentFromBridge(page);
    expect(afterBackspace).not.toContain('- ');

    // Sequence B：重新制造空 `- ` 项 Escape → 普通段落（同效）。
    // 补全默认开启：`- ` 可能触发结构化 ghost（如 `[ ] `）；ESC 优先级为
    // ghost > 预填取消（PRD-v0.2 §6），用有界循环先拒 ghost 再取消预填，
    // 普通空行上的额外 ESC 是无害 no-op。
    await typeInEditor(page, '- ');
    let afterEscape = '';
    for (let i = 0; i < 3; i++) {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(80);
      afterEscape = await getEditorContentFromBridge(page);
      if (!afterEscape.includes('- ')) break;
    }
    expect(afterEscape).not.toContain('- ');
  });

  // ──────────────────────────────────────────────────────────────
  // J6 — 表格行 Enter 新增同列数；空行 Escape 删除
  // ──────────────────────────────────────────────────────────────
  test('J6: table data row Enter adds new row of same column count; Escape on empty row removes it', async ({
    page,
  }) => {
    const tableText = ['| 列A | 列B | 列C |', '| --- | --- | --- |', '| 1 | 2 | 3 |'].join('\n');
    // 整表用 insertText 单笔注入，避免多行字符逐键时序干扰。
    await typeInEditor(page, tableText, { insertText: true });

    // 光标自动落在数据行末尾；Enter → 在数据行下方新增同列数空行。
    await page.keyboard.press('Enter');
    const afterEnter = await getEditorContentFromBridge(page);
    // 文档可能带文件末尾换行（尾部空段），先归一再断言结构
    const enterLines = afterEnter.replace(/\n$/u, '').split('\n');
    expect(enterLines).toHaveLength(4);
    expect(afterEnter).toContain('| 列A | 列B | 列C |');
    expect(afterEnter).toContain('| 1 | 2 | 3 |');

    // 新行列数与上行一致（3 列 → 4 个 `|`，且均为边界，无内容）。
    const newRow = afterEnter.split('\n')[3] ?? '';
    const pipeCount = (newRow.match(/\|/gu) ?? []).length;
    expect(pipeCount).toBe(4);
    expect(newRow.replace(/[^\|]/gu, '')).toBe('||||');

    // Escape 删除空表格行；光标落到表后的普通段落（文档末尾保留空行）。
    // 同 J5：若 ghost 可见，ESC 先归 ghost，用有界循环兜底。
    await page.waitForTimeout(100);
    let afterEscape = '';
    const emptyRowPattern = /\|[\s　]*\|[\s　]*\|[\s　]*\|/u;
    for (let i = 0; i < 3; i++) {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(80);
      afterEscape = await getEditorContentFromBridge(page);
      if (!emptyRowPattern.test(afterEscape)) break;
    }
    const escLines = afterEscape.replace(/\n$/u, '').split('\n');
    expect(escLines).toHaveLength(3);
    expect(afterEscape).not.toMatch(emptyRowPattern);
    expect(afterEscape.endsWith('\n')).toBe(true);
  });

  // ──────────────────────────────────────────────────────────────
  // J7 — 全角归一（＃ 渲染为 heading；－ 行尾 Enter → 半角 `- `）
  // ──────────────────────────────────────────────────────────────
  test('J7: full-width hash renders as heading; full-width dash continues as half-width', async ({
    page,
  }) => {
    // Part A：`＃ 标题` → 切到分栏视图断言渲染为 heading（避免聚焦态抑制渲染）。
    // 必须经 typeInEditor（聚焦 + 清空）；裸 insertText 会因编辑器未聚焦而丢输入。
    await typeInEditor(page, '＃ 标题', { insertText: true });
    // 等 CM6 调和 + 渲染管线归一
    await page.waitForTimeout(200);
    const viewToggle = page.locator('.view-mode-toggle');
    await viewToggle.click();
    const previewPane = page.locator('.split-preview');
    await expect(previewPane).toBeVisible({ timeout: 5000 });
    // heading 标签可能为 h1~h6（源文本 `#` 一级）；任一 heading 含「标题」
    const previewHeading = previewPane.locator('h1, h2, h3, h4, h5, h6');
    await expect(previewHeading.first()).toContainText('标题');

    // 切回即时编辑视图，继续 Part B。视图循环为 live → split → read → live，
    // 分栏后需点两次才回到即时编辑。
    await viewToggle.click();
    await viewToggle.click();
    await expect(page.locator('.cm-content')).toBeVisible();

    // Part B：`－ 项` 行尾 Enter → 新行半角 `- `（typeInEditor 负责聚焦 + 清空）
    // 契约：原行全角符号不改写（诚实到字节）；仅新插入的标记写半角。
    await typeInEditor(page, '－ 项', { insertText: true });
    await page.keyboard.press('Enter');
    expect(await getEditorContentFromBridge(page)).toBe('－ 项\n- ');
  });

  // ──────────────────────────────────────────────────────────────
  // J8 — 撤销原子
  // ──────────────────────────────────────────────────────────────
  test('J8: single Ctrl+Z undoes entire continuation transaction', async ({ page }) => {
    await typeInEditor(page, '- 甲');
    await page.keyboard.press('Enter');
    expect(await getEditorContentFromBridge(page)).toBe('- 甲\n- ');

    // 单次 Ctrl+Z → 预填完整消失，原行完好
    await page.keyboard.press(`${MOD_KEY}+z`);
    expect(await getEditorContentFromBridge(page)).toBe('- 甲');
  });

  // ──────────────────────────────────────────────────────────────
  // J9 — IME 等价（单笔注入中文后立刻 Enter）
  // ──────────────────────────────────────────────────────────────
  test('J9: single insertText of CJK then Enter does not double-continue', async ({ page }) => {
    // 用 insertText 单笔注入，等价 IME 提交整段（无 composition 链）。
    // 经 typeInEditor 确保编辑器已聚焦（裸 insertText 会因未聚焦而丢输入）。
    await typeInEditor(page, '- 一笔注入中文', { insertText: true });
    await page.keyboard.press('Enter');
    // 仅续一行，不应双重 / 多次延续
    expect(await getEditorContentFromBridge(page)).toBe('- 一笔注入中文\n- ');
  });

  // ──────────────────────────────────────────────────────────────
  // J10 — fence 内 Enter 不拦截（无标记延续）
  // ──────────────────────────────────────────────────────────────
  test('J10: code fence Enter does not continue list/quote markers', async ({ page }) => {
    await typeInEditor(page, '```js');
    await page.keyboard.press('Enter');
    const afterEnter = await getEditorContentFromBridge(page);

    // fence 开闭占两行：首行 `\`\`\`js`，第二行为新插入的普通空行
    expect(afterEnter.startsWith('```js\n')).toBe(true);
    // 第二行不应被错误注入列表 / 引用标记
    expect(afterEnter).not.toMatch(/^```js\n[-*+] /u);
    expect(afterEnter).not.toMatch(/^```js\n>/u);
    // 也应保持非列表项（不触发任务列表 / 编号列表）
    expect(afterEnter).not.toMatch(/^```js\n\d+\. /u);
  });
});
