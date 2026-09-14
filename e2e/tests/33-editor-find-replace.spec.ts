/**
 * 33-editor-find-replace.spec.ts — E1 切片：编辑器内查找替换 + 三 BUG 回归
 *
 * find-replace 组（8 用例）覆盖 PRD-v0.2 §E1 验收口径：
 *   ① Mod+f 开面板 → .cm-panel.cm-search 可见
 *   ② 输入关键词 → .cm-searchMatch 命中数正确
 *   ③ Enter / Shift+Enter → 光标移动到下一/上一命中
 *   ④ 单次替换（仅替换第一处）
 *   ⑤ 全部替换
 *   ⑥ 正则开关
 *   ⑦ 大小写开关
 *   ⑧ Esc 关闭面板后 .cm-searchMatch 清除 + 内容无损
 *   ⑨ 中文查询（insertText 直接注入）
 *
 * bug-regressions 组（3 用例）—— 锁定口径只断言，不修：
 *   - BUG-050: FormatToolbar 加粗二次点击幂等（不叠加 `**`）
 *   - BUG-051: 编辑区固定格式栏可见
 *   - BUG-058: live preview 复选框点击翻转 `- [ ]` ↔ `- [x]`
 */
import { test, expect, type Page } from '@playwright/test';
import {
  createBlankNote,
  ensureEditorReady,
  MOD_KEY,
  waitForAppReady,
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

/** 切换到即时模式（live preview），.cm-task-toggle 仅在该模式下渲染。 */
async function ensureLivePreviewMode(page: Page): Promise<void> {
  const toggle = page.locator('.view-mode-toggle');
  if (!(await toggle.isVisible().catch(() => false))) return;
  for (let i = 0; i < 3; i++) {
    const inSplit = await page
      .locator('.split-pane')
      .isVisible()
      .catch(() => false);
    if (!inSplit) return;
    await toggle.click();
    await page.waitForTimeout(250);
  }
}

test.describe('33 E1 切片 查找替换', () => {
  test.beforeEach(async ({ page }) => {
    // 沿用 32 号 beforeEach：禁用 ghost 补全，避免坐标/选区/文本计数被预测串混入。
    await page.addInitScript(() => {
      localStorage.setItem('jotluck:autocomplete:settings', JSON.stringify({ enabled: false }));
    });
    await waitForAppReady(page);
    await ensureEditorReady(page);
  });

  // ==========================================================
  // find-replace 组
  // ==========================================================

  test('1-Mod+f 打开搜索面板（顶部）+ 默认文案注入', async ({ page }) => {
    const content = 'first alpha line\nsecond alpha line\nthird beta line';
    await setContent(page, content);
    await setCursor(page, 0);

    await page.keyboard.press(`${MOD_KEY}+f`);
    const panel = page.locator('.cm-panel.cm-search');
    await expect(panel).toBeVisible({ timeout: 3000 });

    // 验证 5 语文案注入（CM6 默认英文被覆盖为中文）
    await expect(panel.locator('input[placeholder="查找"]')).toHaveCount(1);
    // next/prev/replace 按钮文本来自 phrases；至少 next 按钮存在
    await expect(panel.locator('button[name="next"]')).toBeVisible();
    await expect(panel.locator('button[name="prev"]')).toBeVisible();
    // 关闭按钮存在
    await expect(panel.locator('button[name="close"]')).toBeVisible();
  });

  test('2-输入关键词后 .cm-searchMatch 命中数与文本一致', async ({ page }) => {
    const content = 'alpha here\nbeta alpha again\nmore alpha';
    await setContent(page, content);
    await setCursor(page, 0);

    await page.keyboard.press(`${MOD_KEY}+f`);
    const findInput = page.locator('.cm-panel.cm-search input[placeholder="查找"]');
    await expect(findInput).toBeVisible();
    await findInput.pressSequentially('alpha');

    // .cm-searchMatch 由 Decoration.mark 渲染，命中 3 处
    await expect(page.locator('.cm-searchMatch')).toHaveCount(3, { timeout: 2000 });
  });

  test('3-Enter / Shift+Enter 移动光标到下一/上一命中', async ({ page }) => {
    const content = 'first alpha\nsecond alpha\nthird alpha';
    await setContent(page, content);
    await setCursor(page, 0);

    await page.keyboard.press(`${MOD_KEY}+f`);
    const findInput = page.locator('.cm-panel.cm-search input[placeholder="查找"]');
    await findInput.pressSequentially('alpha');

    // 第一处 alpha 在 line 1 offset 6→11
    await expect(page.locator('.cm-searchMatch')).toHaveCount(3);

    // Enter → 选中匹配区段，head 落在匹配尾部
    await findInput.press('Enter');
    let sel = await getSelection(page);
    expect(sel.from).toBe(6);
    expect(sel.to).toBe(11);

    // 再 Enter → 下一处：line 2 "second alpha" 中 alpha 在 offset 19→23
    await findInput.press('Enter');
    sel = await getSelection(page);
    expect(sel.from).toBe(19);
    expect(sel.to).toBe(24);

    // Shift+Enter → 上一处，回到 6→11
    await findInput.press('Shift+Enter');
    sel = await getSelection(page);
    expect(sel.from).toBe(6);
    expect(sel.to).toBe(11);
  });

  test('4-替换单个（仅替换第一处匹配）', async ({ page }) => {
    const content = 'alpha\nalpha\nalpha';
    await setContent(page, content);
    await setCursor(page, 0);

    await page.keyboard.press(`${MOD_KEY}+f`);
    const panel = page.locator('.cm-panel.cm-search');
    const findInput = panel.locator('input[placeholder="查找"]');
    const replaceInput = panel.locator('input[placeholder="替换"]');
    await findInput.pressSequentially('alpha');
    await replaceInput.pressSequentially('BETA');

    // CM6 语义：replaceNext 只替换「选区恰好压住的当前匹配」——
    // 先 Enter（findNext）把选区定位到第一处，再点替换
    await findInput.press('Enter');
    await panel.locator('button[name="replace"]').click();
    await page.waitForTimeout(80);

    const after = await page.evaluate(
      () =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ((window as any).__jotluck_e2e?.editor?.getContent?.() as string | undefined) ?? '',
    );
    expect(after).toBe('BETA\nalpha\nalpha');
  });

  test('5-全部替换 replaceAll', async ({ page }) => {
    const content = 'alpha beta alpha\nbeta alpha';
    await setContent(page, content);
    await setCursor(page, 0);

    await page.keyboard.press(`${MOD_KEY}+f`);
    const panel = page.locator('.cm-panel.cm-search');
    await panel.locator('input[placeholder="查找"]').pressSequentially('alpha');
    await panel.locator('input[placeholder="替换"]').pressSequentially('X');

    // 点 replace all → 所有 alpha 被替换，beta 保留
    await panel.locator('button[name="replaceAll"]').click();
    await page.waitForTimeout(80);

    const after = await page.evaluate(
      () =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ((window as any).__jotluck_e2e?.editor?.getContent?.() as string | undefined) ?? '',
    );
    expect(after).toBe('X beta X\nbeta X');
  });

  test('6-正则开关：h[ea]llo 匹配 hello/​hallo', async ({ page }) => {
    const content = 'hello world\nhallo again\nother text\nhello last';
    await setContent(page, content);
    await setCursor(page, 0);

    await page.keyboard.press(`${MOD_KEY}+f`);
    const panel = page.locator('.cm-panel.cm-search');
    await panel.locator('input[placeholder="查找"]').pressSequentially('h[ea]llo');

    // 勾选 regexp（label 文本"正则表达式"），首次开启命中 3（hello/hallo/hello）
    const regexpCheckbox = panel.locator('label:has-text("正则表达式") input[type="checkbox"]');
    await regexpCheckbox.check();
    await expect(page.locator('.cm-searchMatch')).toHaveCount(3, { timeout: 2000 });
  });

  test('7-大小写开关：大小写敏感关闭默认命中 "Apple"/"apple"', async ({ page }) => {
    const content = 'Apple pie\napple juice\nbanana';
    await setContent(page, content);
    await setCursor(page, 0);

    await page.keyboard.press(`${MOD_KEY}+f`);
    const panel = page.locator('.cm-panel.cm-search');
    await panel.locator('input[placeholder="查找"]').pressSequentially('apple');
    // 大小写敏感默认关闭 → 命中 Apple + apple = 2
    await expect(page.locator('.cm-searchMatch')).toHaveCount(2, { timeout: 2000 });

    // 勾选区分大小写 → 仅小写 apple 命中 = 1
    const caseCheckbox = panel.locator('label:has-text("区分大小写") input[type="checkbox"]');
    await caseCheckbox.check();
    await expect(page.locator('.cm-searchMatch')).toHaveCount(1, { timeout: 2000 });
  });

  test('8-Esc 关闭面板后命中高亮清除 + 揭示恢复 + 内容无损', async ({ page }) => {
    // 光标落在不含命中词的 banana 行：面板开启期 = 两个 apple 块被揭示为源码
    // （cm-live-focused-source 行类 ×2）；Esc 关面板后 CM6 不清查询，但
    // searchPanelOpen 门归 false → 揭示恢复，仅剩光标所在 banana 块 ×1。
    const content = 'banana\napple\napple';
    await setContent(page, content);
    await setCursor(page, 0);

    await page.keyboard.press(`${MOD_KEY}+f`);
    const panel = page.locator('.cm-panel.cm-search');
    await panel.locator('input[placeholder="查找"]').pressSequentially('apple');
    await expect(page.locator('.cm-searchMatch')).toHaveCount(2);
    await expect(page.locator('.cm-line.cm-live-focused-source')).toHaveCount(2);

    // Esc 关闭面板
    await page.keyboard.press('Escape');
    await expect(panel).toHaveCount(0, { timeout: 2000 });
    // .cm-searchMatch 装饰应随面板关闭清除
    await expect(page.locator('.cm-searchMatch')).toHaveCount(0);
    // 按块揭示恢复：仅剩光标所在 banana 块为源码形态（apple 块回到渲染态）
    await expect(page.locator('.cm-line.cm-live-focused-source')).toHaveCount(1);

    // 内容无损（关闭面板/搜索不会修改文档）
    const after = await page.evaluate(
      () =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ((window as any).__jotluck_e2e?.editor?.getContent?.() as string | undefined) ?? '',
    );
    expect(after).toBe(content);
  });

  test('9-中文查询命中中文内容', async ({ page }) => {
    const content = '今天天气很好\n明天天气也很好\n昨天天气一般';
    await setContent(page, content);
    await setCursor(page, 0);

    await page.keyboard.press(`${MOD_KEY}+f`);
    const findInput = page.locator('.cm-panel.cm-search input[placeholder="查找"]');
    await findInput.pressSequentially('天气');
    // CJK 经 insertText 注入不产生 keyup——面板只在 onchange/onkeyup 提交查询，
    // 补一记方向键（移动光标、不改文本）触发 keyup 提交
    await findInput.press('ArrowRight');
    // 3 行都含"天气" → 3 个命中
    await expect(page.locator('.cm-searchMatch')).toHaveCount(3, { timeout: 2000 });
  });

  // ==========================================================
  // bug-regressions 组
  // ==========================================================

  test('10-BUG-050 加粗二次点击幂等（不叠加 **）', async ({ page }) => {
    await createBlankNote(page);
    const content = 'word';
    await setContent(page, content);
    // 光标移到内容末尾 → 全选
    await setCursor(page, 0);
    await page.keyboard.press(`${MOD_KEY}+a`);

    // 点格式栏加粗按钮（两次）—— BUG-050 修复后第二次不应叠加为 ****word****
    const boldButton = page.locator('.format-toolbar__button.is-bold');
    await expect(boldButton).toBeVisible();
    await boldButton.click();
    await page.waitForTimeout(80);
    // 第二次点击（toggle off / 取消 pending）
    await boldButton.click();
    await page.waitForTimeout(80);

    const after = await page.evaluate(
      () =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ((window as any).__jotluck_e2e?.editor?.getContent?.() as string | undefined) ?? '',
    );
    // 不允许 ****word**** 这种叠加
    expect(after).not.toMatch(/^\*{3,}.+\*{3,}$/u);
    // 允许 **word**（一次加粗）或 word（二次 toggle off），但绝不允许叠加
    expect([`**${content}**`, content]).toContain(after);
  });

  test('11-BUG-051 编辑区固定格式栏可见', async ({ page }) => {
    // 至少有一个 .format-toolbar 在编辑器上方/周围可见
    const toolbar = page.locator('.format-toolbar').first();
    await expect(toolbar).toBeVisible({ timeout: 3000 });
    // 含 5 个行内格式按钮 + 1 清除按钮（粗/斜/删/code/link/clear）
    await expect(toolbar.locator('.format-toolbar__button.is-bold')).toBeVisible();
    await expect(toolbar.locator('.format-toolbar__button.is-italic')).toBeVisible();
    await expect(toolbar.locator('.format-toolbar__clear')).toBeVisible();
  });

  test('12-BUG-058 live preview 复选框点击翻转 - [ ] ↔ - [x]', async ({ page }) => {
    const content = '- [ ] 任务一\n- [ ] 任务二';
    await setContent(page, content);

    // .cm-task-toggle 仅在 live preview 渲染态存在；切到 live 模式。
    await ensureLivePreviewMode(page);

    // 渲染态点击第一个 checkbox（光标需在别处，使本行进入渲染态）
    await setCursor(page, 0);
    await page.keyboard.press('Control+End');
    await page.waitForTimeout(200);

    const toggle = page.locator('.cm-task-toggle').first();
    await expect(toggle).toBeVisible({ timeout: 2000 });
    await toggle.click();
    await page.waitForTimeout(150);

    const after = await page.evaluate(
      () =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ((window as any).__jotluck_e2e?.editor?.getContent?.() as string | undefined) ?? '',
    );
    // 翻转后第一行变成 - [x] 任务一，第二行保持
    expect(after).toBe('- [x] 任务一\n- [ ] 任务二');
  });
});
