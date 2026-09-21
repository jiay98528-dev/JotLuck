/**
 * 34-slash-commands.spec.ts — V0.2-E2 切片：斜杠命令（Slash Commands）E2E 套件
 *
 * 覆盖（spec §10.2 至少 12 用例）：
 *   1.  空行输入 `/` 弹菜单（listbox 可见、10 option）
 *   2.  `/标题` 过滤出标题类
 *   3.  `/h1` 别名命中 heading1
 *   4.  ArrowDown/ArrowUp 循环移动 aria-selected
 *   5.  Enter 插入一级标题（`# ` 前缀、触发文本已替换、光标在 `# ` 后）
 *   6.  Tab 插入选中项
 *   7.  参数化逐类插入断言（table/codeBlock/divider/taskList 至少各一）
 *   8.  Escape 关菜单、行文本不变、无预填副作用
 *   9.  删除 `/` 菜单自动关闭；点击其他行菜单关闭
 *   10. ghost 优先级：Tab 插入不受 ghost 空态影响 + 单测结构性断言
 *   11. IME 组合会话：compositionstart → compositionupdate+insertText → compositionend
 *       → 菜单保持 → 落定后过滤正确、文档无损坏
 *   12. 插入后 Ctrl+Z 单步恢复；a11y role 断言；live preview 默认模式下菜单可用
 *
 * 风格沿用 31/32/33 号（beforeEach 禁补全、zh-CN locale、Escape 有界循环 ≤3 次）。
 * 用例 9 涉及点击其他行——光标不在编辑器内时菜单应关闭，行为由 CM6 update 链路保证。
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

/** 菜单 DOM 选择器（cm6-slash-commands.ts 固定根类名）。 */
const SLASH_MENU = '.cm-jotluck-slash-menu';
const SLASH_ITEM = '.cm-jotluck-slash-menu__item';
const SLASH_EMPTY = '.cm-jotluck-slash-menu__empty';

/**
 * 反复按 Escape 直到菜单不可见（或上限 3 次；沿用 31 号有界循环）。
 * 选 3 次：第一次 Esc 优先关 ghost（若有），第二次关菜单，第三次兜底。
 */
async function dismissMenuSafely(page: Page): Promise<void> {
  for (let i = 0; i < 3; i++) {
    const visible = await page
      .locator(SLASH_MENU)
      .isVisible()
      .catch(() => false);
    if (!visible) return;
    await page.keyboard.press('Escape');
    await page.waitForTimeout(80);
  }
}

test.describe('34 E2 切片 斜杠命令', () => {
  test.beforeEach(async ({ page }) => {
    // 沿用 33 号 beforeEach：禁用 ghost 补全，避免坐标/选区/文本计数被预测串混入。
    await page.addInitScript(() => {
      localStorage.setItem('jotluck:autocomplete:settings', JSON.stringify({ enabled: false }));
    });
    await waitForAppReady(page);
    await ensureEditorReady(page);
  });

  // ==========================================================
  // 用例 1：空行输入 `/` 弹菜单
  // ==========================================================
  test('1-空行输入 / 弹出 listbox + 10 个 option（含 live preview 默认模式可用）', async ({
    page,
  }) => {
    await setContent(page, '');
    await setCursor(page, 0);
    await page.keyboard.type('/');
    const menu = page.locator(SLASH_MENU);
    await expect(menu).toBeVisible({ timeout: 3000 });
    await expect(menu).toHaveAttribute('role', 'listbox');
    // spec §3 钉死 10 个条目
    await expect(page.locator(SLASH_ITEM)).toHaveCount(10);

    // aria-selected 第一项默认选中
    await expect(page.locator(`${SLASH_ITEM}[aria-selected="true"]`)).toHaveCount(1);

    // a11y：listbox 有 aria-label（zh-CN 默认）
    await expect(menu).toHaveAttribute('aria-label', '块插入菜单');

    await dismissMenuSafely(page);
  });

  // ==========================================================
  // 用例 2：中文查询过滤
  // ==========================================================
  test('2-/标题 过滤出标题类（heading1/2/3）', async ({ page }) => {
    await setContent(page, '');
    await setCursor(page, 0);
    await page.keyboard.type('/标题');
    const items = page.locator(SLASH_ITEM);
    await expect(items).toHaveCount(3, { timeout: 3000 });
    const labels = await items.allTextContents();
    // 三个标题都在
    expect(labels.some((t) => t.includes('标题 1'))).toBe(true);
    expect(labels.some((t) => t.includes('标题 2'))).toBe(true);
    expect(labels.some((t) => t.includes('标题 3'))).toBe(true);

    await dismissMenuSafely(page);
  });

  // ==========================================================
  // 用例 3：ASCII 别名
  // ==========================================================
  test('3-/h1 别名命中 heading1', async ({ page }) => {
    await setContent(page, '');
    await setCursor(page, 0);
    await page.keyboard.type('/h1');
    const items = page.locator(SLASH_ITEM);
    await expect(items).toHaveCount(1, { timeout: 3000 });
    await expect(items.first()).toContainText('标题 1');

    await dismissMenuSafely(page);
  });

  // ==========================================================
  // 用例 4：ArrowDown/ArrowUp 循环移动
  // ==========================================================
  test('4-ArrowDown/ArrowUp 循环移动 aria-selected', async ({ page }) => {
    await setContent(page, '');
    await setCursor(page, 0);
    await page.keyboard.type('/');
    await expect(page.locator(SLASH_ITEM)).toHaveCount(10);

    // 默认第一项 selected
    const initiallySelected = page.locator(`${SLASH_ITEM}[aria-selected="true"]`);
    await expect(initiallySelected.first()).toHaveAttribute('data-slash-id', 'heading1');

    // ArrowDown 一次：第二项 selected（heading2）
    await page.keyboard.press('ArrowDown');
    await expect(page.locator(`${SLASH_ITEM}[aria-selected="true"]`)).toHaveAttribute(
      'data-slash-id',
      'heading2',
    );

    // ArrowUp 一次回到 heading1
    await page.keyboard.press('ArrowUp');
    await expect(page.locator(`${SLASH_ITEM}[aria-selected="true"]`)).toHaveAttribute(
      'data-slash-id',
      'heading1',
    );

    // ArrowUp 一次：循环到末项 divider
    await page.keyboard.press('ArrowUp');
    await expect(page.locator(`${SLASH_ITEM}[aria-selected="true"]`)).toHaveAttribute(
      'data-slash-id',
      'divider',
    );

    // ArrowDown 一次：循环回首项 heading1
    await page.keyboard.press('ArrowDown');
    await expect(page.locator(`${SLASH_ITEM}[aria-selected="true"]`)).toHaveAttribute(
      'data-slash-id',
      'heading1',
    );

    await dismissMenuSafely(page);
  });

  // ==========================================================
  // 用例 5：Enter 插入一级标题
  // ==========================================================
  test('5-Enter 插入一级标题（# 前缀、触发文本已替换、光标在 # 后）', async ({ page }) => {
    await setContent(page, '');
    await setCursor(page, 0);
    await page.keyboard.type('/h1');
    await expect(page.locator(SLASH_ITEM)).toHaveCount(1);
    await page.keyboard.press('Enter');
    await expect(page.locator(SLASH_MENU)).toHaveCount(0, { timeout: 2000 });
    expect(await getEditorContentFromBridge(page)).toBe('# ');
    // 光标在 `# ` 末尾（offset 2）
    const sel = await getSelection(page);
    expect(sel.head).toBe(2);
    expect(sel.from).toBe(2);
  });

  // ==========================================================
  // 用例 6：Tab 插入选中项
  // ==========================================================
  test('6-Tab 插入当前选中项（heading1 默认）', async ({ page }) => {
    await setContent(page, '');
    await setCursor(page, 0);
    await page.keyboard.type('/');
    await expect(page.locator(SLASH_ITEM)).toHaveCount(10);
    await page.keyboard.press('Tab');
    await expect(page.locator(SLASH_MENU)).toHaveCount(0, { timeout: 2000 });
    expect(await getEditorContentFromBridge(page)).toBe('# ');
  });

  // ==========================================================
  // 用例 7：参数化逐类插入断言
  // ==========================================================
  test('7a-table 插入三行模板（光标在数据行首格）', async ({ page }) => {
    await setContent(page, '');
    await setCursor(page, 0);
    await page.keyboard.type('/table');
    await expect(page.locator(SLASH_ITEM)).toHaveCount(1);
    await page.keyboard.press('Enter');
    expect(await getEditorContentFromBridge(page)).toBe('|  |  |\n| --- | --- |\n|  |  |');
    const sel = await getSelection(page);
    expect(sel.head).toBe(22 + 2);
  });

  test('7b-codeBlock 插入围栏（光标在中间行）', async ({ page }) => {
    await setContent(page, '');
    await setCursor(page, 0);
    await page.keyboard.type('/code');
    await expect(page.locator(SLASH_ITEM)).toHaveCount(1);
    await page.keyboard.press('Enter');
    expect(await getEditorContentFromBridge(page)).toBe('```\n\n```');
    const sel = await getSelection(page);
    expect(sel.head).toBe(4);
  });

  test('7c-divider 插入 --- + 换行（光标在新行）', async ({ page }) => {
    await setContent(page, '');
    await setCursor(page, 0);
    await page.keyboard.type('/hr');
    await expect(page.locator(SLASH_ITEM)).toHaveCount(1);
    await page.keyboard.press('Enter');
    expect(await getEditorContentFromBridge(page)).toBe('---\n');
    const sel = await getSelection(page);
    expect(sel.head).toBe(4);
  });

  test('7d-taskList 插入 `- [ ] ` 前缀（光标在 ] 后）', async ({ page }) => {
    await setContent(page, '');
    await setCursor(page, 0);
    await page.keyboard.type('/task');
    await expect(page.locator(SLASH_ITEM)).toHaveCount(1);
    await page.keyboard.press('Enter');
    expect(await getEditorContentFromBridge(page)).toBe('- [ ] ');
    const sel = await getSelection(page);
    expect(sel.head).toBe(6);
  });

  // ==========================================================
  // 用例 8：Escape 关菜单
  // ==========================================================
  test('8-Escape 关菜单 + 行文本不变 + 无预填副作用', async ({ page }) => {
    await setContent(page, '');
    await setCursor(page, 0);
    await page.keyboard.type('/h1');
    await expect(page.locator(SLASH_MENU)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator(SLASH_MENU)).toHaveCount(0, { timeout: 2000 });
    // 行内容应保留为 `/h1` —— 没有触发任何插入
    expect(await getEditorContentFromBridge(page)).toBe('/h1');
  });

  // ==========================================================
  // 用例 9：删除 `/` 菜单自动关闭 + 点击其他行菜单关闭
  // ==========================================================
  test('9a-删除 / 菜单自动关闭', async ({ page }) => {
    await setContent(page, '');
    await setCursor(page, 0);
    await page.keyboard.type('/');
    await expect(page.locator(SLASH_MENU)).toBeVisible();
    // 光标在 1，Backspace 删 `/` → 行变空 → trigger 失效 → 菜单自动关
    await page.keyboard.press('Backspace');
    await expect(page.locator(SLASH_MENU)).toHaveCount(0, { timeout: 2000 });
    expect(await getEditorContentFromBridge(page)).toBe('');
  });

  test('9b-点击其他行（光标移走）菜单关闭', async ({ page }) => {
    await setContent(page, 'line0\nline1\nline2');
    await setCursor(page, 0);
    await page.keyboard.type('/');
    await expect(page.locator(SLASH_MENU)).toBeVisible();
    // 真实点击 line2 行首——注意不能用 ArrowDown：菜单打开时 ↑/↓ 按规格
    // §4 归菜单导航消费，光标不会移动
    const line2Pos = 'line0\nline1\n'.length;
    const coords = await bridgeCall<{ left: number; top: number } | null>(
      page,
      'getCoordsAtPos',
      line2Pos,
    );
    expect(coords).not.toBeNull();
    await page.mouse.click((coords?.left ?? 0) + 4, (coords?.top ?? 0) + 6);
    // 光标已在 line2（不在 `/` 行），菜单应关闭
    await expect(page.locator(SLASH_MENU)).toHaveCount(0, { timeout: 2000 });
  });

  // ==========================================================
  // 用例 10：Tab 插入不受 ghost 空态影响 + 单测结构性断言
  // ==========================================================
  test('10-ghost 优先级：补全关闭时 Tab 仍插入 slash 菜单选中项', async ({ page }) => {
    // beforeEach 已禁补全（localStorage settings.enabled=false）
    await setContent(page, '');
    await setCursor(page, 0);
    await page.keyboard.type('/');
    await expect(page.locator(SLASH_ITEM)).toHaveCount(10);
    await page.keyboard.press('Tab');
    // 菜单默认选中 heading1 → Tab 替换为 `# `
    expect(await getEditorContentFromBridge(page)).toBe('# ');
    // 注：ghost Prec.highest 的结构性优先由单测
    // cm6-slash-commands.test.ts「ghost text has strict Tab/Escape priority
    // over the slash menu」组合挂载 ghostTextPlugin + 斜杠扩展锁定（Tab 接受
    // ghost 菜单保持 / Escape #1 拒 ghost / Escape #2 关菜单）；
    // 本 E2E 用例在补全关闭态下断言菜单 Tab 路径不被 defaultKeymap 的 indentWithTab 抢走。
  });

  // ==========================================================
  // 用例 11：IME 组合会话（compositionstart → compositionupdate+insertText → compositionend）
  // ==========================================================
  test('11-IME 组合输入中文查询 → 菜单保持 → 落定后过滤正确', async ({ page }) => {
    await setContent(page, '');
    await setCursor(page, 0);
    // 先键入 `/` 触发菜单
    await page.keyboard.type('/');
    await expect(page.locator(SLASH_MENU)).toBeVisible();

    // 进入 composition 会话：compositionstart → 多次 compositionupdate+insertText → compositionend
    // 沿用 32 号 composition 先例
    const editor = page.locator('.cm-content');
    await editor.dispatchEvent('compositionstart', { data: '' });
    const query = '标题';
    for (let i = 1; i <= query.length; i++) {
      const chunk = query.slice(i - 1, i);
      await editor.dispatchEvent('compositionupdate', { data: query.slice(0, i) });
      await page.keyboard.insertText(chunk);
      await page.waitForTimeout(20);
    }
    // 组合期间菜单应保持（spec §5 「组合期不弹新菜单、不关闭已开菜单」）
    await expect(page.locator(SLASH_MENU)).toBeVisible();
    await editor.dispatchEvent('compositionend', { data: query });
    // 等 350ms 落定（沿用 32 号 compositionend settling）
    await page.waitForTimeout(350);

    // 落定后过滤出三个标题
    const items = page.locator(SLASH_ITEM);
    await expect(items).toHaveCount(3, { timeout: 3000 });
    const labels = await items.allTextContents();
    expect(labels.some((t) => t.includes('标题 1'))).toBe(true);
    expect(labels.some((t) => t.includes('标题 2'))).toBe(true);
    expect(labels.some((t) => t.includes('标题 3'))).toBe(true);

    // 文档内容应包含 `/` + 组合期间的输入（已落定为 `标题`）
    const content = await getEditorContentFromBridge(page);
    expect(content).toContain('/');
    expect(content).toContain('标题');
    // 行结构未损坏（无重复字符、无错位）
    expect(content).toBe('/标题');

    await dismissMenuSafely(page);
  });

  // ==========================================================
  // 用例 12：插入后 Ctrl+Z 单步恢复；a11y role；live preview 模式菜单可用
  // ==========================================================
  test('12a-插入后 Ctrl+Z 单步恢复触发前文本', async ({ page }) => {
    await setContent(page, '');
    await setCursor(page, 0);
    await page.keyboard.type('/h1');
    await expect(page.locator(SLASH_ITEM)).toHaveCount(1);
    await page.keyboard.press('Enter');
    expect(await getEditorContentFromBridge(page)).toBe('# ');
    // 单步撤销
    await page.keyboard.press(`${MOD_KEY}+z`);
    expect(await getEditorContentFromBridge(page)).toBe('/h1');
  });

  test('12b-a11y role 断言（listbox + option + aria-selected 同步）', async ({ page }) => {
    await setContent(page, '');
    await setCursor(page, 0);
    await page.keyboard.type('/');
    const menu = page.locator(SLASH_MENU);
    await expect(menu).toHaveAttribute('role', 'listbox');
    await expect(menu).toHaveAttribute('aria-label', '块插入菜单');
    const items = page.locator(SLASH_ITEM);
    await expect(items.first()).toHaveAttribute('role', 'option');
    // 默认 selected = heading1
    await expect(page.locator(`${SLASH_ITEM}[aria-selected="true"]`)).toHaveAttribute(
      'data-slash-id',
      'heading1',
    );
    // ArrowDown → selected = heading2 → aria-selected 同步翻转
    await page.keyboard.press('ArrowDown');
    await expect(page.locator(`${SLASH_ITEM}[aria-selected="true"]`)).toHaveAttribute(
      'data-slash-id',
      'heading2',
    );
    // 其他项 aria-selected="false"
    const others = await page.locator(`${SLASH_ITEM}[aria-selected="false"]`).count();
    expect(others).toBe(9);
    await dismissMenuSafely(page);
  });

  test('12c-零匹配显示 noMatch 行（i18n 动态键 → 无匹配条目）', async ({ page }) => {
    await setContent(page, '');
    await setCursor(page, 0);
    await page.keyboard.type('/zzzzzz');
    await expect(page.locator(SLASH_MENU)).toBeVisible();
    await expect(page.locator(SLASH_ITEM)).toHaveCount(0);
    await expect(page.locator(SLASH_EMPTY)).toBeVisible();
    await expect(page.locator(SLASH_EMPTY)).toHaveText('无匹配条目');
    await dismissMenuSafely(page);
  });
});
