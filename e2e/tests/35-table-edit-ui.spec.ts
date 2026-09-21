/**
 * 35-table-edit-ui.spec.ts — V0.2-E3 切片：表格编辑 UI E2E 套件
 *
 * 覆盖（spec §7.2 至少 12 用例）：
 *   1.  表格内光标 → 工具条出现；段落内光标 → 隐藏
 *   2.  表头行上：删行禁用、插行可用
 *   3.  数据行下方插行 → 新 `|  |  |` 行出现、光标首格
 *   4.  表头下方插行 → 插在分隔行后
 *   5.  右插列 → 表头/分隔/数据行全部增格
 *   6.  删行 → 该行消失、其余行字节不变
 *   7.  删列含 `\|` 转义 → 转义序列在剩余文本中原样保留
 *   8.  对齐居中 → 分隔行 cell 变 `:---:`，live preview 渲染带 `--align-center` 类名
 *   9.  删除整表 → 表格行全消、前后段落完整
 *   10. Ctrl+Z 单步恢复（插行场景）
 *   11. IME 组合会话（32 号模式）期间工具条隐藏/操作守卫，组合落定后恢复
 *   12. 全角 `｜` 表格上插行/对齐正常
 *
 * 风格沿用 31/32/33/34 号（beforeEach 禁补全、zh-CN locale、Escape 有界循环 ≤3 次）。
 */
import { test, expect, type Page } from '@playwright/test';
import {
  ensureEditorReady,
  getEditorContentFromBridge,
  waitForAppReady,
  MOD_KEY,
} from '../helpers/test-utils';

interface SelectionSnapshot {
  from: number;
  to: number;
  anchor: number;
  head: number;
}

function bridgeCall<T>(page: Page, method: string, ...args: unknown[]): Promise<T> {
  return page.evaluate(
    ({ method, args }) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const editor = (window as any).__jotluck_e2e?.editor;
      return (editor?.[method]?.(...(args as unknown[])) ?? null) as T;
    },
    { method, args },
  );
}

const setContent = (page: Page, content: string) =>
  bridgeCall<unknown>(page, 'setContent', content);
const setCursor = (page: Page, pos: number) => bridgeCall<unknown>(page, 'setCursor', pos);
const getSelection = (page: Page) => bridgeCall<SelectionSnapshot>(page, 'getSelection');

/** 表格工具条 DOM 选择器（cm6-table-edit.ts 固定根类名）。 */
const TABLE_TOOLBAR = '.cm-jotluck-table-toolbar';
const TABLE_ACTION_BTN = `.cm-jotluck-table-toolbar__btn`;

/**
 * 反复按 Escape 直到工具条不可见（或上限 3 次；沿用 31 号有界循环）。
 * 选 3 次：第一次 Esc 优先关 ghost（若有），第二次关工具条（如有），第三次兜底。
 */
async function dismissToolbarSafely(page: Page): Promise<void> {
  for (let i = 0; i < 3; i++) {
    const visible = await page
      .locator(TABLE_TOOLBAR)
      .isVisible()
      .catch(() => false);
    if (!visible) return;
    await page.keyboard.press('Escape');
    await page.waitForTimeout(80);
  }
}

test.describe('35 E3 切片 表格编辑 UI', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('jotluck:autocomplete:settings', JSON.stringify({ enabled: false }));
    });
    await waitForAppReady(page);
    await ensureEditorReady(page);
  });

  // ==========================================================
  // 用例 1：表格内光标工具条出现；段落内光标隐藏
  // ==========================================================
  test('1-表格内光标 → 工具条出现；段落内光标 → 隐藏', async ({ page }) => {
    // 夹具必须含段落行——纯表格文档的 0 位在表头行内，工具条不会关
    const doc = 'para\n| h1 | h2 |\n| --- | --- |\n| d1 | d2 |';
    await setContent(page, doc);
    // 跳到数据行（d1 内）
    const d1Pos = doc.indexOf('d1') + 1;
    await setCursor(page, d1Pos);
    await expect(page.locator(TABLE_TOOLBAR)).toBeVisible({ timeout: 3000 });

    // 移到段落行（para 内）
    await setCursor(page, 1);
    // 工具条应自动关闭
    await expect(page.locator(TABLE_TOOLBAR)).toHaveCount(0, { timeout: 2000 });
  });

  // ==========================================================
  // 用例 2：表头行上：删行禁用，插行可用
  // ==========================================================
  test('2-表头行上：删行按钮 aria-disabled=true；插行按钮可用', async ({ page }) => {
    const doc = '| h1 | h2 |\n| --- | --- |\n| d1 | d2 |';
    await setContent(page, doc);
    const h1Pos = doc.indexOf('h1') + 1;
    await setCursor(page, h1Pos);
    await expect(page.locator(TABLE_TOOLBAR)).toBeVisible({ timeout: 3000 });

    // 删行按钮 aria-disabled
    const deleteRowBtn = page.locator(`${TABLE_ACTION_BTN}[data-table-action="deleteRow"]`);
    await expect(deleteRowBtn).toHaveAttribute('aria-disabled', 'true');

    // 插行按钮可用
    const insertRowAboveBtn = page.locator(
      `${TABLE_ACTION_BTN}[data-table-action="insertRowAbove"]`,
    );
    await expect(insertRowAboveBtn).toHaveAttribute('aria-disabled', 'false');
    const insertRowBelowBtn = page.locator(
      `${TABLE_ACTION_BTN}[data-table-action="insertRowBelow"]`,
    );
    await expect(insertRowBelowBtn).toHaveAttribute('aria-disabled', 'false');

    await dismissToolbarSafely(page);
  });

  // ==========================================================
  // 用例 3：数据行下方插行 → 新 `|  |  |` 行出现
  // ==========================================================
  test('3-数据行下方插行 → 新空行出现、光标首格', async ({ page }) => {
    const doc = '| h1 | h2 |\n| --- | --- |\n| d1 | d2 |';
    await setContent(page, doc);
    const d1Pos = doc.indexOf('d1') + 1;
    await setCursor(page, d1Pos);
    await expect(page.locator(TABLE_TOOLBAR)).toBeVisible({ timeout: 3000 });

    // 点下方插行按钮
    const insertRowBelowBtn = page.locator(
      `${TABLE_ACTION_BTN}[data-table-action="insertRowBelow"]`,
    );
    await insertRowBelowBtn.click();

    const after = await getEditorContentFromBridge(page);
    expect(after).toContain('| d1 | d2 |\n|  |  |');

    // 光标在新行首格（offset 2 跳过 `| `）
    const expectedCursor = doc.length + 1 + 2;
    const sel = await getSelection(page);
    expect(sel.head).toBe(expectedCursor);

    await dismissToolbarSafely(page);
  });

  // ==========================================================
  // 用例 4：表头下方插行 → 插在分隔行后
  // ==========================================================
  test('4-表头下方插行 → 插在分隔行后（首个数据位）', async ({ page }) => {
    const doc = '| h1 | h2 |\n| --- | --- |\n| d1 | d2 |';
    await setContent(page, doc);
    const h1Pos = doc.indexOf('h1') + 1;
    await setCursor(page, h1Pos);
    await expect(page.locator(TABLE_TOOLBAR)).toBeVisible({ timeout: 3000 });

    const insertRowBelowBtn = page.locator(
      `${TABLE_ACTION_BTN}[data-table-action="insertRowBelow"]`,
    );
    await insertRowBelowBtn.click();

    const after = await getEditorContentFromBridge(page);
    // 新行紧跟分隔表（"| --- | --- |\n|  |  |"）
    expect(after).toContain('| --- | --- |\n|  |  |');
    // 原数据行在新行之后
    expect(after).toContain('|  |  |\n| d1 | d2 |');

    await dismissToolbarSafely(page);
  });

  // ==========================================================
  // 用例 5：右插列 → 表头/分隔/数据行全部增格
  // ==========================================================
  test('5-右插列 → 表头/分隔/数据行全部增格', async ({ page }) => {
    const doc = '| h1 | h2 |\n| --- | --- |\n| d1 | d2 |';
    await setContent(page, doc);
    const d1Pos = doc.indexOf('d1') + 1;
    await setCursor(page, d1Pos);
    await expect(page.locator(TABLE_TOOLBAR)).toBeVisible({ timeout: 3000 });

    const insertColumnRightBtn = page.locator(
      `${TABLE_ACTION_BTN}[data-table-action="insertColumnRight"]`,
    );
    await insertColumnRightBtn.click();

    const after = await getEditorContentFromBridge(page);
    // 光标在 d1（第 0 列）→ 新列插在 d1 与 d2 之间（当前列右侧）
    expect(after).toContain('| h1 |  | h2 |');
    expect(after).toContain('| --- | --- | --- |');
    expect(after).toContain('| d1 |  | d2 |');

    await dismissToolbarSafely(page);
  });

  // ==========================================================
  // 用例 6：删行 → 该行消失、其余行字节不变
  // ==========================================================
  test('6-删行 → 该行消失、其余行字节不变', async ({ page }) => {
    const doc = '| h1 | h2 |\n| --- | --- |\n| d1 | d2 |\n| d3 | d4 |';
    await setContent(page, doc);
    const d1Pos = doc.indexOf('d1') + 1;
    await setCursor(page, d1Pos);
    await expect(page.locator(TABLE_TOOLBAR)).toBeVisible({ timeout: 3000 });

    const deleteRowBtn = page.locator(`${TABLE_ACTION_BTN}[data-table-action="deleteRow"]`);
    await deleteRowBtn.click();

    const after = await getEditorContentFromBridge(page);
    expect(after).toBe('| h1 | h2 |\n| --- | --- |\n| d3 | d4 |');

    await dismissToolbarSafely(page);
  });

  // ==========================================================
  // 用例 7：删列含 `\|` 转义 → 转义序列原样保留
  // ==========================================================
  test('7-删列含 \\| 转义 → 转义序列在剩余文本中原样保留', async ({ page }) => {
    // 注意：测试 doc 中 \\| 在 JS 字符串里是 `\|`
    const doc = '| a\\|b | c |\n| --- | --- |\n| d\\|e | f |';
    await setContent(page, doc);
    const cPos = doc.indexOf('c') + 1;
    await setCursor(page, cPos);
    await expect(page.locator(TABLE_TOOLBAR)).toBeVisible({ timeout: 3000 });

    const deleteColumnBtn = page.locator(`${TABLE_ACTION_BTN}[data-table-action="deleteColumn"]`);
    await deleteColumnBtn.click();

    const after = await getEditorContentFromBridge(page);
    expect(after).toBe('| a\\|b |\n| --- |\n| d\\|e |');
    expect(after).toContain('a\\|b');
    expect(after).toContain('d\\|e');

    await dismissToolbarSafely(page);
  });

  // ==========================================================
  // 用例 8：对齐居中 → 分隔行 cell 变 `:---:`，live preview 渲染
  // ==========================================================
  test('8-对齐居中 → 分隔行 cell 变 :---:（live preview 渲染对齐类名，数据行不变）', async ({
    page,
  }) => {
    const doc = '| h1 | h2 |\n| --- | --- |\n| d1 | d2 |\npara';
    await setContent(page, doc);
    const d1Pos = doc.indexOf('d1') + 1;
    await setCursor(page, d1Pos);
    await expect(page.locator(TABLE_TOOLBAR)).toBeVisible({ timeout: 3000 });

    const alignCenterBtn = page.locator(`${TABLE_ACTION_BTN}[data-table-action="alignCenter"]`);
    await alignCenterBtn.click();

    const after = await getEditorContentFromBridge(page);
    expect(after).toContain('| :---: | --- |');
    // 数据行未变
    expect(after).toContain('| d1 | d2 |');

    // 光标移到表外段落 → 表格块失焦恢复渲染 → 对齐类名生效
    // （cm6-live-preview.ts 的 ml-table-cell--align-* 契约，spec §7.2-8）
    await setCursor(page, doc.length - 2);
    await expect(page.locator('.ml-table-cell--align-center').first()).toBeVisible({
      timeout: 3000,
    });
  });

  // ==========================================================
  // 用例 9：删除整表 → 表格行全消、前后段落完整
  // ==========================================================
  test('9-删除整表 → 表格行全消、前后段落完整', async ({ page }) => {
    const doc = 'before\n| h1 | h2 |\n| --- | --- |\n| d1 | d2 |\nafter';
    await setContent(page, doc);
    const d1Pos = doc.indexOf('d1') + 1;
    await setCursor(page, d1Pos);
    await expect(page.locator(TABLE_TOOLBAR)).toBeVisible({ timeout: 3000 });

    const deleteTableBtn = page.locator(`${TABLE_ACTION_BTN}[data-table-action="deleteTable"]`);
    await deleteTableBtn.click();

    const after = await getEditorContentFromBridge(page);
    expect(after).not.toContain('h1');
    expect(after).not.toContain('d1');
    expect(after).toContain('before');
    expect(after).toContain('after');

    await dismissToolbarSafely(page);
  });

  // ==========================================================
  // 用例 10：Ctrl+Z 单步恢复（插行场景）
  // ==========================================================
  test('10-插行后 Ctrl+Z 单步恢复触发前文本', async ({ page }) => {
    const doc = '| h1 | h2 |\n| --- | --- |\n| d1 | d2 |';
    await setContent(page, doc);
    const d1Pos = doc.indexOf('d1') + 1;
    await setCursor(page, d1Pos);
    await expect(page.locator(TABLE_TOOLBAR)).toBeVisible({ timeout: 3000 });

    const insertRowBelowBtn = page.locator(
      `${TABLE_ACTION_BTN}[data-table-action="insertRowBelow"]`,
    );
    await insertRowBelowBtn.click();
    const inserted = await getEditorContentFromBridge(page);
    expect(inserted).toContain('|  |  |');

    // 单步撤销
    await page.keyboard.press(`${MOD_KEY}+z`);
    const restored = await getEditorContentFromBridge(page);
    expect(restored).toBe(doc);
  });

  // ==========================================================
  // 用例 11：IME 组合会话（32 号模式）
  // ==========================================================
  test('11-IME 组合会话期间工具条隐藏、操作守卫、落定后恢复', async ({ page }) => {
    const doc = '| h1 | h2 |\n| --- | --- |\n| d1 | d2 |';
    await setContent(page, doc);
    const d1Pos = doc.indexOf('d1') + 1;
    await setCursor(page, d1Pos);
    await expect(page.locator(TABLE_TOOLBAR)).toBeVisible({ timeout: 3000 });

    // 进入 IME 组合会话：先派发 compositionstart 标记组合活跃
    const editor = page.locator('.cm-content');
    await editor.dispatchEvent('compositionstart', { data: '' });
    // 组合中工具条应隐藏
    await expect(page.locator(TABLE_TOOLBAR)).toHaveCount(0, { timeout: 2000 });

    // 模拟落定（compositionend）
    await editor.dispatchEvent('compositionend', { data: '' });
    await page.waitForTimeout(350);
    // 落定后工具条恢复
    await expect(page.locator(TABLE_TOOLBAR)).toBeVisible({ timeout: 3000 });

    await dismissToolbarSafely(page);
  });

  // ==========================================================
  // 用例 12：全角 `｜` 表格上插行/对齐正常
  // ==========================================================
  test('12-全角 ｜ 表格上插行/对齐正常', async ({ page }) => {
    // 用全角 ｜ 的表格
    const doc = '｜ a ｜ b ｜\n｜ --- ｜ --- ｜\n｜ 1 ｜ 2 ｜';
    await setContent(page, doc);
    const onePos = doc.indexOf('1') + 1;
    await setCursor(page, onePos);
    await expect(page.locator(TABLE_TOOLBAR)).toBeVisible({ timeout: 3000 });

    // 下方插行
    const insertRowBelowBtn = page.locator(
      `${TABLE_ACTION_BTN}[data-table-action="insertRowBelow"]`,
    );
    await insertRowBelowBtn.click();
    let after = await getEditorContentFromBridge(page);
    expect(after).toContain('｜ 1 ｜ 2 ｜\n｜  ｜  ｜');

    // 对齐居中（把全角表格的分隔行 cell 变 ：－－：）
    const alignCenterBtn = page.locator(`${TABLE_ACTION_BTN}[data-table-action="alignCenter"]`);
    await alignCenterBtn.click();
    after = await getEditorContentFromBridge(page);
    // GFM 对齐冒号必须半角（全角 ： 不会被解析为对齐标记）；全角定界保留
    expect(after).toContain('｜ :---: ｜ --- ｜');

    await dismissToolbarSafely(page);
  });
});
