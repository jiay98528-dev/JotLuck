/**
 * 40-acceptance-unified.spec.ts — V0.2 统一人工验收 E2E 自动化版
 *
 * 把 doc/editor-increment-acceptance.md 中的 5 条人工验收用例翻译为自动化用例：
 *   - B-01  全角一致与代码伪引用
 *   - E1-02 只读门
 *   - E2-01c 斜杠菜单点击插入（鼠标路径）
 *   - E3-01c 表格左插列与重做
 *   - X-01  跨特性组合链
 *
 * 材料 S 来源：doc/editor-increment-acceptance.md 第 27-67 行（基础.md）；
 * 目标.md 来源：第 29 行（`# 章节` + 一段正文）。
 *
 * 多笔记 fixture 沿用 38 号（38-outline-backlinks.spec.ts）的 mockNotebook.initialFiles
 * 注入模式（addInitScript 在路由解析前写入 window.__jotluck_e2e.mockNotebook）。
 * 文件树导航沿用 38 号的 .topbar-btn--menu → .tree-item → Escape 链路。
 *
 * 反链面板断言沿用 38 号的 .section-header（text=/反链|Backlink/） +
 * .section-body--backlinks + .backlink-item 组合。
 *
 * 风格沿用 33/34/35 号（beforeEach 禁补全、zh-CN locale、CM6 bridge 调用）。
 *
 * 开放问题见文件末尾「开放问题」章节：
 *   1. 应用暂无"以只读打开内部笔记"的 UI 入口——E1-02 用 test.fixme 标记，
 *      说明当前只能通过 ExternalReaderPage 触发 readonly 会话，不在本工单范围。
 */
import { test, expect, type Page } from '@playwright/test';
import {
  ensureEditorReady,
  getEditorContentFromBridge,
  MOD_KEY,
  REDO_KEY,
  waitForAppReady,
} from '../helpers/test-utils';

// ============================================================
// Bridge Helpers
// ============================================================

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

// ============================================================
// Material S (基础.md) — doc/editor-increment-acceptance.md L27-L67
// ============================================================

/**
 * 材料 S 基础笔记 原文（逐字照抄 doc/editor-increment-acceptance.md 第 31-67 行）。
 * 注意：分隔行为 `| ------ | ---: |`（右对齐）；表格内转义为 `\|`。
 * 源 markdown 的对齐空格（`| 甲\|乙 |    2 |`、`| 丙     |    3 |`）逐字保留，
 * 验证写入/读取字节一致时不再被规整。
 */
const BASE_CONTENT = [
  '# 第一章',
  '',
  '普通中文与 emoji 👩‍💻，**加粗**、_斜体_、~~删除~~、`代码`、[链接](https://example.com)。',
  '',
  '- 普通项',
  '- [x] 已完成',
  '',
  '1. 第一项',
  '',
  '> 引用',
  '>',
  '> - 引用里的项目',
  '',
  '| 名称   | 数量 |',
  '| ------ | ---: |',
  '| 甲\\|乙 |    2 |',
  '| 丙     |    3 |',
  '',
  '## 重复标题',
  '',
  '首处 [[目标]]，同一行第二处 [[目标#章节|别名]]。',
  '',
  '＃ 全角标题',
  '',
  '－ 全角项目',
  '',
  '# 下划线标题',
  '',
  '## 重复标题',
  '',
  '末处 [[目标]]。',
  '',
  '```text',
  '[[目标]] 只是一段代码',
  '- 不应自动续为列表',
  '```',
  '',
].join('\n');

/** 材料 S 的 目标.md 原文：验收手册第 29 行 `# 章节` + 一段正文。 */
const TARGET_CONTENT = '# 章节\n\n目标正文段落，反链测试用。\n';

// ============================================================
// Fixture Setup (38号 mockNotebook.initialFiles 模式)
// ============================================================

/**
 * 通过 addInitScript 注入多笔记 fixture。
 * - mockNotebook.initialFiles: 基础.md + 目标.md
 * - persist=false: 不写入 localStorage，避免跨用例污染
 * - jotluck:welcome:completed=1: 跳过欢迎页
 * - jotluck:autocomplete:settings.enabled=false: 禁用 ghost 补全（沿用 33/34/35 号）
 */
async function setup(page: Page): Promise<void> {
  await page.addInitScript(
    (contents) => {
      window.__jotluck_e2e = {
        mockNotebook: { initialFiles: contents, persist: false },
      };
      localStorage.setItem('jotluck:welcome:completed', '1');
      localStorage.setItem('jotluck:autocomplete:settings', JSON.stringify({ enabled: false }));
    },
    { '/基础.md': BASE_CONTENT, '/目标.md': TARGET_CONTENT },
  );
  await waitForAppReady(page);
}

/**
 * 打开文件抽屉 → 点 tree-item → Esc 关闭抽屉 → 等待 workspace-opening-overlay 消散。
 * 沿用 38号 open() 模式。
 */
async function openNote(page: Page, name: string): Promise<void> {
  await page.locator('.topbar-btn--menu').click();
  await page.locator('.tree-item').filter({ hasText: name }).first().click();
  await page.keyboard.press('Escape');
  await expect(page.locator('.workspace-opening-overlay')).toHaveCount(0);
}

/**
 * 切换视图模式（live/split/read），最多点 3 次 .view-mode-toggle。
 * live=默认，split=.split-pane 可见，read=.reader-workbench 可见。
 */
async function switchMode(page: Page, target: 'live' | 'split' | 'read'): Promise<void> {
  const current = async (): Promise<'live' | 'split' | 'read'> => {
    if (
      await page
        .locator('.reader-workbench[data-view-mode="read"]')
        .isVisible()
        .catch(() => false)
    ) {
      return 'read';
    }
    if (
      await page
        .locator('.split-pane')
        .isVisible()
        .catch(() => false)
    ) {
      return 'split';
    }
    return 'live';
  };
  for (let i = 0; i < 3 && (await current()) !== target; i++) {
    await page.locator('.view-mode-toggle').click();
    await page.waitForTimeout(250);
  }
  expect(await current()).toBe(target);
}

/**
 * 打开反链面板（默认折叠），返回 .backlink-item 定位器。
 * 沿用 38号 backlinks() 模式。
 */
async function openBacklinks(page: Page): Promise<ReturnType<Page['locator']>> {
  const header = page.locator('.section-header').filter({ hasText: /反链|Backlink/i });
  if (
    !(await page
      .locator('.section-body--backlinks')
      .isVisible()
      .catch(() => false))
  ) {
    await header.click();
  }
  return page.locator('.backlink-item');
}

// ============================================================
// Selectors
// ============================================================

const SLASH_MENU = '.cm-jotluck-slash-menu';
const SLASH_ITEM = '.cm-jotluck-slash-menu__item';
const TABLE_TOOLBAR = '.cm-jotluck-table-toolbar';
const TABLE_ACTION_BTN = `.cm-jotluck-table-toolbar__btn`;

// ============================================================
// describe
// ============================================================

test.describe('40 统一验收 A', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('jotluck:autocomplete:settings', JSON.stringify({ enabled: false }));
    });
    // 确保 app 就绪（部分用例不依赖多笔记，也兜底走单笔记路径）
    await waitForAppReady(page);
    await ensureEditorReady(page);
  });

  // ================================================================
  // 用例 B-01：全角一致与代码伪引用（材料 S，三模式）
  // ================================================================

  test('1-B-01 全角一致与代码伪引用：基础.md 三模式下渲染 + 目标.md 反链只计入正文 + 全文搜索命中代码块', async ({
    page,
  }) => {
    await setup(page);
    await openNote(page, '基础.md');

    // ── 即时（live，默认）模式 ──
    await switchMode(page, 'live');
    // 全角标题 `＃` 渲染为标题：outline 解析出 heading-全角标题
    await expect(page.locator('.heading-link[data-heading-id="heading-全角标题"]')).toBeVisible({
      timeout: 5000,
    });
    // 全角项目 `－` 渲染为列表：live preview 渲染为 unorderedListItem 块
    const fullwidthListBlock = page
      .locator('.cm-live-block[data-block-type="unorderedListItem"]')
      .filter({ hasText: '全角项目' });
    await expect(fullwidthListBlock).toBeVisible({ timeout: 5000 });

    // ── 分栏（split）模式 ──
    await switchMode(page, 'split');
    await expect(page.locator('.split-pane')).toBeVisible();
    // outline 仍能识别全角标题（同一解析管线对所有视图模式一致）
    await expect(page.locator('.heading-link[data-heading-id="heading-全角标题"]')).toBeVisible();

    // ── 阅读（read）模式 ──
    await switchMode(page, 'read');
    await expect(page.locator('.reader-workbench')).toBeVisible();
    await expect(page.locator('.heading-link[data-heading-id="heading-全角标题"]')).toBeVisible();

    // ── 打开 目标.md 反链面板：基础.md 的 [[目标]] 在正文里出现 2 处
    //    （首处 + 末处），加上 [[目标#章节|别名]] 同行的另一 wikilink = 3；
    //    代码块内的 [[目标]] 不计入。
    await openNote(page, '目标.md');
    const entries = await openBacklinks(page);
    await expect(entries).toHaveCount(3, { timeout: 5000 });
    // 三条均来自 基础.md
    const contexts = await entries.locator('.backlink-context').allTextContents();
    expect(contexts.length).toBe(3);
    for (const ctx of contexts) {
      expect(ctx).toContain('[[目标');
    }
    // 代码块内引用对应的文本（"只是一段代码"）不应出现在反链上下文中
    for (const ctx of contexts) {
      expect(ctx).not.toContain('只是一段代码');
    }

    // ── 全文搜索仍能命中代码块内原文：命令面板 Ctrl+K ──
    await page.keyboard.press('Control+k');
    await expect(page.locator('.palette')).toBeVisible({ timeout: 3000 });
    const searchInput = page.locator('.search-input');
    await searchInput.fill('只是一段代码');
    // 等待防抖 + 索引检索
    await page.waitForTimeout(800);
    // 命中基础.md（snippet 可能含 hit 上下文）
    const resultItems = page.locator('.result-item');
    const resultCount = await resultItems.count();
    expect(resultCount).toBeGreaterThanOrEqual(1);
    const firstResult = resultItems.first();
    await expect(firstResult).toContainText('基础');
    await page.keyboard.press('Escape');
    await expect(page.locator('.palette')).toHaveCount(0);
  });

  // ================================================================
  // 用例 E1-02：只读门（材料 S，只读打开）
  // ================================================================

  test('2-E1-02 只读门：内部笔记无可用的"只读打开"UI 入口（开放问题 → test.fixme）', async ({
    page,
  }) => {
    // ── 调查结论 ──
    // MarkdownEditor.vue 第 60/87/338/339 行定义了 readOnly prop，并通过
    // EditorState.readOnly + EditorView.editable 门控；
    // cm6-find-replace.ts 第 81-95 行实现了"查找类允许 / 替换类阻断"的 readOnly 门。
    // NotebookHome.vue 第 317/408 行把 readOnly 绑定到 isInteractionLocked；
    // 该 computed（NotebookHome.vue L1168）只在 isNotebookOpening / isNoteSwitching
    // 时为 true，笔记切换结束后即回到 false。
    // 应用内不存在"以只读打开笔记"的 UI 入口（grep -rn "readOnly\|readonly" 仅命中
    // ExternalReaderPage 的外部文件会话路径，依赖 bootstrap.mockOpenedFile）。
    // ── 因此本用例无法在内部笔记上复现验收口径，仅作记录。──
    test.fixme(
      'E1-02 需要"以只读打开内部笔记"的 UI 入口。当前应用仅 ExternalReaderPage ' +
        '提供外部文件 readonly 会话（通过 bootstrap.mockOpenedFile），内部笔记无 readonly 开关。',
    );
  });

  // ================================================================
  // 用例 E2-01c：斜杠菜单点击插入（鼠标路径；34 号补键盘路径）
  // ================================================================

  test('3-E2-01c 斜杠菜单点击插入：鼠标 click 一条目插入正确 + Ctrl+Z 单步恢复', async ({
    page,
  }) => {
    await setContent(page, '');
    await setCursor(page, 0);
    // 输入 `/` 弹菜单
    await page.keyboard.type('/');
    const menu = page.locator(SLASH_MENU);
    await expect(menu).toBeVisible({ timeout: 3000 });
    await expect(page.locator(SLASH_ITEM)).toHaveCount(10);

    // 鼠标 click heading1 条目（与 34 号的 Enter/Tab 键盘路径并列）
    const heading1Item = page.locator(`${SLASH_ITEM}[data-slash-id="heading1"]`);
    await expect(heading1Item).toBeVisible();
    await heading1Item.click();

    // 菜单关闭、触发文本 `/` 被替换为 `# `、光标在 `# ` 末尾
    await expect(page.locator(SLASH_MENU)).toHaveCount(0, { timeout: 2000 });
    expect(await getEditorContentFromBridge(page)).toBe('# ');
    const sel = await getSelection(page);
    expect(sel.head).toBe(2);
    expect(sel.from).toBe(2);

    // Ctrl+Z 单步恢复触发前文本（与 34 号用例 12a 对齐）
    await page.keyboard.press(`${MOD_KEY}+z`);
    expect(await getEditorContentFromBridge(page)).toBe('/');
  });

  // ================================================================
  // 用例 E3-01c：表格左插列与重做（35 号补右插列与插入行）
  // ================================================================

  test('4-E3-01c 表格左插列与重做：所有行左侧增格 + Ctrl+Z 撤销 + REDO_KEY 重做字节一致', async ({
    page,
  }) => {
    const doc = '| h1 | h2 |\n| --- | --- |\n| d1 | d2 |';
    await setContent(page, doc);
    const d1Pos = doc.indexOf('d1') + 1;
    await setCursor(page, d1Pos);
    await expect(page.locator(TABLE_TOOLBAR)).toBeVisible({ timeout: 3000 });

    // 工具条左插列（与 35 号用例 5 的右插列并列）
    const insertColumnLeftBtn = page.locator(
      `${TABLE_ACTION_BTN}[data-table-action="insertColumnLeft"]`,
    );
    await expect(insertColumnLeftBtn).toHaveAttribute('aria-disabled', 'false');
    await insertColumnLeftBtn.click();
    await page.waitForTimeout(80);

    const inserted = await getEditorContentFromBridge(page);
    // 光标在 d1（原 col 0）→ 左插后 d1 右移到 col 1；空新格在 col 0
    expect(inserted).toContain('|  | h1 | h2 |');
    expect(inserted).toContain('| --- | --- | --- |');
    expect(inserted).toContain('|  | d1 | d2 |');

    // Ctrl+Z 单步撤销：表头/分隔/数据行各回退一格
    await page.keyboard.press(`${MOD_KEY}+z`);
    const restored = await getEditorContentFromBridge(page);
    expect(restored).toBe(doc);

    // REDO_KEY 重做：字节与插入后完全一致
    await page.keyboard.press(REDO_KEY);
    await page.waitForTimeout(80);
    const redone = await getEditorContentFromBridge(page);
    expect(redone).toBe(inserted);
  });

  // ================================================================
  // 用例 X-01：跨特性组合链（材料 S + 编辑/查找替换/斜杠/表格/撤销）
  // ================================================================

  test('5-X-01 跨特性组合链：列表续写 → 替换 → 表格插入+删列 → 逐步撤销 → 自动保存', async ({
    page,
  }) => {
    await setup(page);
    await openNote(page, '基础.md');

    // ── (a) 在 `- 普通项` 行尾 Enter 续写一项并输入文字，再 Enter 续写第二项 ──
    const endOfCommon = BASE_CONTENT.indexOf('- 普通项') + '- 普通项'.length;
    await setCursor(page, endOfCommon);
    await page.keyboard.press('Enter');
    // Enter 后 CM6 应延续列表，生成 `- ` 前缀；输入第一项文字
    await page.keyboard.type('新项一', { delay: 10 });
    await page.keyboard.press('Enter');
    await page.keyboard.type('新项二', { delay: 10 });

    const afterA = await getEditorContentFromBridge(page);
    // (a) 阶段状态：基础.md 在 `- 普通项` 后多两行 `- 新项一` / `- 新项二`
    expect(afterA).toContain('- 普通项\n- 新项一\n- 新项二');
    // 其余原始内容未变（精确比对：以原内容替换 `- 普通项` 行为三行的版本）
    const baseWithoutCommon = BASE_CONTENT.replace('- 普通项', '- 普通项\n- 新项一\n- 新项二');
    expect(afterA).toBe(baseWithoutCommon);

    // ── (b) 打开查找替换，把"新项二"全部替换为"新项替换"，关闭面板 ──
    await page.keyboard.press(`${MOD_KEY}+f`);
    const panel = page.locator('.cm-panel.cm-search');
    await expect(panel).toBeVisible({ timeout: 3000 });
    await panel.locator('input[placeholder="查找"]').pressSequentially('新项二');
    await panel.locator('input[placeholder="替换"]').pressSequentially('新项替换');
    await panel.locator('button[name="replaceAll"]').click();
    await page.waitForTimeout(80);
    await page.keyboard.press('Escape');
    await expect(panel).toHaveCount(0, { timeout: 2000 });

    const afterB = await getEditorContentFromBridge(page);
    expect(afterB).toContain('- 新项替换');
    expect(afterB).not.toContain('新项二');
    // 精确比对：把 (a) 状态里的 "新项二" 替换为 "新项替换"
    const expectedB = afterA.replaceAll('新项二', '新项替换');
    expect(afterB).toBe(expectedB);

    // ── (c) 用斜杠菜单插入表格模板，再用表格工具条删一列 ──
    // 跳到文档末尾 + 新行（避开对原表格的干扰）
    await page.keyboard.press('Control+End');
    await page.keyboard.press('Enter');
    await page.keyboard.type('/table');
    await expect(page.locator(SLASH_ITEM)).toHaveCount(1, { timeout: 3000 });
    await page.keyboard.press('Enter');
    // 表格模板：表头 + 分隔 + 1 数据行 × 2 列（与 test 34 用例 7a 一致）
    const afterTableInsert = await getEditorContentFromBridge(page);
    expect(afterTableInsert).toContain('|  |  |\n| --- | --- |\n|  |  |');

    // 工具条删列（光标已在数据行 col 0）
    await expect(page.locator(TABLE_TOOLBAR)).toBeVisible({ timeout: 3000 });
    const deleteColumnBtn = page.locator(`${TABLE_ACTION_BTN}[data-table-action="deleteColumn"]`);
    await deleteColumnBtn.click();
    await page.waitForTimeout(80);
    const afterC = await getEditorContentFromBridge(page);
    // 表格模板 2 列（test 34 用例 7a）→ 删一列 → 1 列：表头/分隔/数据行均退化为单列
    expect(afterC).toContain('|  |\n| --- |\n|  |');
    // 末尾插入的表格片段不应再含 2 列模板的 "| --- | --- |"
    expect(afterC.split('| --- | --- |').length).toBe(1);

    // ── (d) 连续 Ctrl+Z 逐步撤销，至少核对 3 步状态序列 ──
    // 第 1 步：撤销删列 → 末尾表格回到 2 列模板
    await page.keyboard.press(`${MOD_KEY}+z`);
    await page.waitForTimeout(80);
    const undo1 = await getEditorContentFromBridge(page);
    expect(undo1).toContain('|  |  |\n| --- | --- |\n|  |  |');
    expect(undo1).not.toContain('|  |\n| --- |\n|  |');

    // 第 2 步：撤销表格插入 → 末尾不再有刚插入的表格行
    await page.keyboard.press(`${MOD_KEY}+z`);
    await page.waitForTimeout(80);
    const undo2 = await getEditorContentFromBridge(page);
    expect(undo2).not.toContain('|  |  |\n| --- | --- |');
    // 第 2 步结束时，替换操作仍生效（"新项替换" 仍在）
    expect(undo2).toContain('- 新项替换');
    expect(undo2).not.toContain('新项二');

    // 第 3 步：撤销替换 → "新项替换" 回到 "新项二"
    await page.keyboard.press(`${MOD_KEY}+z`);
    await page.waitForTimeout(80);
    const undo3 = await getEditorContentFromBridge(page);
    expect(undo3).toContain('- 新项二');
    expect(undo3).not.toContain('新项替换');
    // 此时仍是 3 行列表（- 新项一 和 - 新项二 都在）
    expect(undo3).toContain('- 普通项\n- 新项一\n- 新项二');

    // ── (e) 等待自动保存后核对 mock 文件内容与最终正文一致 ──
    // 先重做回到 (c) 末尾状态，验证最终落盘
    await page.keyboard.press(REDO_KEY);
    await page.keyboard.press(REDO_KEY);
    await page.keyboard.press(REDO_KEY);
    await page.waitForTimeout(200);
    const finalContent = await getEditorContentFromBridge(page);
    expect(finalContent).toBe(afterC);

    // 等待自动保存：状态栏 .status-saved 出现
    await expect(page.locator('.status-saved')).toBeVisible({ timeout: 10000 });
    // 精确比对 mock 文件内容与最终正文
    await expect
      .poll(
        () =>
          page.evaluate(
            async () => (window as any).__jotluck_e2e?.readNoteFile?.('/基础.md') ?? '',
          ),
        { timeout: 10000 },
      )
      .toBe(finalContent);
  });
});
