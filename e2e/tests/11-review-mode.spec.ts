/**
 * 11-review-mode.spec.ts — 改稿（审批/批注）模式 E2E 验收
 *
 * 覆盖：进入/退出改稿工作台、右栏编辑自动生成批注、源码态红/绿马克笔、
 *       渲染态内嵌标记（含 08 词级绿马克笔投影：改写词 + 列表标记不进马克笔）、
 *       批注面板定位与批准/丢弃、版本化导出 V1 递进、设置面板 Reink 区块存在性。
 *
 * 基于 V1-V6 测试规则：
 *   V1 交互正确性 — 验证交互后的结果
 *   V6 用户旅程 — 编辑→批注→批准/丢弃→导出完整闭环
 */
import { test, expect, type Page } from '@playwright/test';

import {
  waitForAppReady,
  typeInEditor,
  waitForAutoSave,
  switchToNote,
} from '../helpers/test-utils';

const REVIEW_NOTE = [
  '# 改稿验收笔记',
  '',
  '第一段原始内容，讨论今天的会议安排。',
  '',
  '第二段保持不变的内容。',
].join('\n');

/** 改稿右栏（工作稿）编辑器内容区 */
function rightEditor(page: Page) {
  return page.locator('.review-workbench .split-right .cm-content');
}

async function enterReviewMode(page: Page): Promise<void> {
  const reviewBtn = page.locator('.topbar-btn--review, .shell-action--review').first();
  await expect(reviewBtn).toBeVisible();
  await reviewBtn.click();
  await expect(page.locator('.review-workbench')).toBeVisible({ timeout: 5000 });
}

async function exitReviewMode(page: Page): Promise<void> {
  await page
    .locator('.review-workbench .review-topbar-button', { hasText: '退出' })
    .first()
    .click();
  const confirmLeave = page.locator('.review-confirm-card .review-confirm-actions button', {
    hasText: '仍要退出',
  });
  if (await confirmLeave.isVisible({ timeout: 1500 }).catch(() => false)) {
    await confirmLeave.click();
  }
  await expect(page.locator('.review-workbench')).toHaveCount(0, { timeout: 5000 });
}

/** 切到指定显示模式（即时渲染 / 源码） */
async function switchReviewMode(page: Page, label: string): Promise<void> {
  await page.locator('.review-workbench .review-mode-option', { hasText: label }).first().click();
  await page.waitForTimeout(250);
}

/** 在右栏末尾追加文本（经真实键盘路径） */
async function appendInRightEditor(page: Page, text: string): Promise<void> {
  const editor = rightEditor(page);
  await editor.click();
  await page.keyboard.press('Control+End');
  await page.keyboard.insertText(text);
  // 等待 400ms 防抖 diff 重算
  await page.waitForTimeout(900);
}

/** 批注面板条目数 */
async function panelCount(page: Page): Promise<number> {
  return page.locator('.review-panel-item').count();
}

test.describe('改稿（审批/批注）模式', () => {
  test.beforeEach(async ({ page }) => {
    await waitForAppReady(page);
    // 改稿模式要求真实笔记文件（草稿会话无文件路径，按钮按设计禁用）
    await switchToNote(page, '快速入门');
    await typeInEditor(page, REVIEW_NOTE, { insertText: true });
    await waitForAutoSave(page);
  });

  test('01-进入改稿工作台：分栏、面板空态与退出', async ({ page }) => {
    await enterReviewMode(page);
    await expect(page.locator('.review-workbench .review-mode-title')).toHaveText('改稿模式');
    // 两栏 + 可拖动分隔条
    await expect(page.locator('.review-workbench .split-left')).toBeVisible();
    await expect(page.locator('.review-workbench .split-right')).toBeVisible();
    await expect(page.locator('.review-workbench .split-divider')).toBeVisible();
    // 批注面板空态
    await expect(page.locator('.review-panel', { hasText: '暂无批注' })).toBeVisible();
    // 默认即时渲染：左栏渲染视图存在
    await expect(page.locator('.review-workbench .review-left-render')).toBeVisible();
    await page.screenshot({
      path: '../../e2e/screenshots/review-mode/01-workbench-empty.png',
      fullPage: true,
    });
    await exitReviewMode(page);
    // 退出后回主编辑器
    await expect(page.locator('.cm-content').first()).toBeVisible();
  });

  test('02-右栏新增段落 → 批注生成 + 源码态绿马克笔', async ({ page }) => {
    await enterReviewMode(page);
    await switchReviewMode(page, '源码');
    await appendInRightEditor(page, '\n\n这是新增的第三段内容。');
    // 面板出现 1 条「新增」批注
    await expect(page.locator('.review-panel-item')).toHaveCount(1, { timeout: 5000 });
    await expect(page.locator('.review-panel-item .review-badge-insert')).toBeVisible();
    // 右栏源码态：新增文字绿马克笔
    await expect(
      page.locator('.review-workbench .split-right .cm-review-mark-add').first(),
    ).toBeVisible();
    await expect(
      page.locator('.review-workbench .split-right .cm-review-mark-add', {
        hasText: '这是新增的第三段内容',
      }),
    ).toBeVisible();
    await page.screenshot({
      path: '../../e2e/screenshots/review-mode/02-source-mode-green.png',
      fullPage: true,
    });
  });

  test('03-改写既有段落 → 左红右绿 + 渲染态内嵌标记', async ({ page }) => {
    await enterReviewMode(page);
    await switchReviewMode(page, '源码');
    // 三击选中第一段整行 → 键入替换文本（真实编辑路径）
    const firstPara = page
      .locator('.review-workbench .split-right .cm-line', { hasText: '第一段原始内容' })
      .first();
    await firstPara.click({ clickCount: 3 });
    await page.keyboard.insertText('第一段已被审稿人改写的内容。');
    // 追加一处新增，凑成 修改+新增 两类批注
    await appendInRightEditor(page, '\n\n文末补充的新段落。');
    await expect(page.locator('.review-panel-item').first()).toBeVisible({ timeout: 5000 });
    const count = await panelCount(page);
    expect(count).toBeGreaterThanOrEqual(1);
    // 左栏源码态：被改原文红马克笔（词级 diff 只标改动词，「原始内容」起）
    await expect(
      page.locator('.review-workbench .split-left .cm-review-mark-del', {
        hasText: '原始内容',
      }),
    ).toBeVisible();
    await page.screenshot({
      path: '../../e2e/screenshots/review-mode/03-source-mode-red-green.png',
      fullPage: true,
    });
    // 切回即时渲染：左栏改动块源码显形 + 渲染内嵌红马克笔
    await switchReviewMode(page, '即时渲染');
    await expect(
      page.locator('.review-workbench .review-left-render .review-source-reveal').first(),
    ).toBeVisible();
    await expect(
      page.locator('.review-workbench .review-left-render .review-mark-del', {
        hasText: '原始内容',
      }),
    ).toBeVisible();
    await page.screenshot({
      path: '../../e2e/screenshots/review-mode/04-render-mode-embedded.png',
      fullPage: true,
    });
  });

  test('04-批注面板：点击定位 + 丢弃回滚右栏', async ({ page }) => {
    await enterReviewMode(page);
    await switchReviewMode(page, '源码');
    await appendInRightEditor(page, '\n\n这是要被丢弃的新增段落。');
    await expect(page.locator('.review-panel-item')).toHaveCount(1, { timeout: 5000 });
    // 点击条目 → 弹出二元小弹窗
    await page.locator('.review-panel-item').first().click();
    const popup = page.locator('.review-decide-popup');
    await expect(popup).toBeVisible();
    await expect(popup.locator('.review-decide-adopt')).toBeVisible();
    await expect(popup.locator('.review-decide-discard')).toBeVisible();
    // 丢弃 → 右栏回滚、批注消解
    await popup.locator('.review-decide-discard').click();
    await expect(page.locator('.review-panel-item')).toHaveCount(0, { timeout: 5000 });
    await expect(
      page.locator('.review-workbench .split-right .cm-content', {
        hasText: '这是要被丢弃的新增段落',
      }),
    ).toHaveCount(0);
  });

  test('05-批准写入源稿 + 退出后主编辑器可见（V6 闭环）', async ({ page }) => {
    await enterReviewMode(page);
    await switchReviewMode(page, '源码');
    await appendInRightEditor(page, '\n\n这段修改将被批准并入源稿。');
    await expect(page.locator('.review-panel-item')).toHaveCount(1, { timeout: 5000 });
    await page.locator('.review-panel-item').first().click();
    await page.locator('.review-decide-adopt').click();
    // 批注消解（写入 MockFS 源稿后两侧一致）
    await expect(page.locator('.review-panel-item')).toHaveCount(0, { timeout: 8000 });
    await exitReviewMode(page);
    // 主编辑器内容包含被批准的修改
    await expect(
      page.locator('.cm-content', { hasText: '这段修改将被批准并入源稿' }).first(),
    ).toBeVisible({ timeout: 5000 });
  });

  test('06-导出批注版本：预览 V1 递进与成功态', async ({ page }) => {
    await enterReviewMode(page);
    await switchReviewMode(page, '源码');
    await appendInRightEditor(page, '\n\n导出验收用的改动段。');
    await expect(page.locator('.review-panel-item').first()).toBeVisible({ timeout: 5000 });
    // 打开导出卡片
    await page
      .locator('.review-workbench .review-topbar-button', { hasText: '导出批注版本' })
      .first()
      .click();
    const dialog = page.locator('.modal-overlay .modal-card');
    await expect(dialog).toBeVisible({ timeout: 3000 });
    // 预览文件名含版本号
    const previewName = dialog.locator('.rule-preview-name');
    await expect(previewName).toBeVisible();
    await expect(previewName).toContainText(/V\d+\.md/u);
    // 执行导出 → 成功态
    await dialog.locator('.modal-footer button', { hasText: '导出' }).last().click();
    await expect(dialog.locator('.success-text')).toBeVisible({ timeout: 8000 });
    await page.screenshot({
      path: '../../e2e/screenshots/review-mode/05-export-success.png',
      fullPage: false,
    });
  });

  test('07-设置面板：Reink 区块可见（浏览器态 idle）', async ({ page }) => {
    await page.locator('.wing-settings-btn, .shell-action--settings').first().click();
    await expect(page.locator('.modal-overlay .modal-card')).toBeVisible({ timeout: 3000 });
    // 切到「自动补全」tab
    await page.locator('.nav-item', { hasText: '文字补全' }).first().click();
    const reinkBlock = page.locator('.engine-meta', {
      has: page.locator('.engine-meta-title', { hasText: 'Reink' }),
    });
    await expect(reinkBlock).toBeVisible();
    // 状态行与文档指引存在
    await expect(reinkBlock.locator('.meta-row').first()).toBeVisible();
    await expect(reinkBlock.locator('.local-note')).toContainText('reink-runtime-requirements');
    await page.screenshot({
      path: '../../e2e/screenshots/review-mode/06-settings-reink.png',
      fullPage: false,
    });
  });

  // IME 行首直输修复（reconfigure→destroy→重建链切断）无法在 Playwright 可靠
  // 复现 Windows IME 组合窗口，列为手工验收项：Windows 中文 IME 行首直输无需
  // 先打空格（见 PR 验收清单）。
  test('08-渲染态右栏词级绿马克笔：段落改写词 + 列表整行新增（投影非 tint）', async ({ page }) => {
    await enterReviewMode(page);
    await switchReviewMode(page, '源码');
    // 改写第一段（选用 fixture 内高区分度改写词，降低词级 diff 碎片脆性）。
    // 选区用 Home→Shift+End 的行内选区：三击选区含行尾换行符，insertText 会
    // 连换行一起替换，把第一段与第二段粘连成一个段落块、hunk 配对漂移。
    const firstPara = page
      .locator('.review-workbench .split-right .cm-line', { hasText: '第一段原始内容' })
      .first();
    await firstPara.click();
    await page.keyboard.press('Home');
    await page.keyboard.press('Shift+End');
    await page.keyboard.insertText('第一段已被审稿人彻底重写的措辞。');
    // 追加列表行（block-level insert）：钉「列表标记后空白不进马克笔」的
    // contentFrom 契约——mark 文本恰为内容、不含 '- ' 前缀
    await appendInRightEditor(page, '\n\n- 列表项新增内容');
    await expect(page.locator('.review-panel-item').first()).toBeVisible({ timeout: 5000 });

    // 切回即时渲染：右栏渲染 widget 内出现词级绿马克笔
    await switchReviewMode(page, '即时渲染');
    await expect(
      page.locator('.review-workbench .split-right .review-mark-add', { hasText: '措辞' }),
    ).toBeVisible({ timeout: 5000 });
    // 列表整行新增：mark 精确包裹内容文本（不含 '- '）
    const listMark = page.locator('.review-workbench .split-right .review-mark-add', {
      hasText: '列表项新增内容',
    });
    await expect(listMark).toBeVisible();
    await expect(listMark.first()).toHaveText('列表项新增内容');
    // fixture 各 hunk 均走投影路径（词级马克笔），不应出现整块绿底 tint
    await expect(page.locator('.review-workbench .split-right .review-block-add')).toHaveCount(0);
  });
});
