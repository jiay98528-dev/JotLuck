import { expect, test, type Page } from '@playwright/test';
import { waitForAppReady } from '../helpers/test-utils';

/**
 * 43 号：统一验收视觉证据采集（非断言测试，Chromium only）。
 *
 * 对应人工验收用例中「要看图判断」的部分：
 *   - C-01 聚焦行幽灵符号（弱化可见、真实占宽）
 *   - E2-01 斜杠菜单浮现外观
 *   - E3-01 表格工具条位置
 *   - B-01/A-01 阅读与分栏整体渲染协调
 *
 * 本文件只负责把页面状态推到位并截图到 e2e/screenshots/acceptance-visual/，
 * 逐项判 PASS/FAIL 由视觉审计席按清单完成，主线程汇总。
 */

const BASE_CONTENT = [
  '# 第一章',
  '',
  '普通中文与 emoji 👩‍💻，**加粗**、_斜体_、~~删除~~、`代码`、[链接](https://example.com)。',
  '',
  '- 普通项',
  '- [x] 已完成',
  '',
  '| 名称   | 数量 |',
  '| ------ | ---: |',
  '| 甲\\|乙 |    2 |',
  '',
  '## 小节',
  '',
  '末尾一段正文。',
  '',
].join('\n');

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

async function openNote(page: Page): Promise<void> {
  await page.locator('.topbar-btn--menu').click();
  await page.locator('.tree-item').filter({ hasText: '基础' }).first().click();
  await page.keyboard.press('Escape');
  await expect(page.locator('.workspace-opening-overlay')).toHaveCount(0);
}

async function switchMode(page: Page, target: 'split' | 'read'): Promise<void> {
  for (let i = 0; i < 3; i++) {
    if (target === 'read' && (await page.locator('.reader-workbench').count()) > 0) return;
    if (target === 'split' && (await page.locator('.split-pane').count()) > 0) return;
    await page.locator('.view-mode-toggle').click();
    await page.waitForTimeout(400);
  }
}

test.describe('43 统一验收视觉证据', () => {
  test.beforeEach(async ({ page }) => {
    test.skip(test.info().project.name !== 'chromium', '视觉证据只需 Chromium 采集');
    await page.addInitScript((content) => {
      window.__jotluck_e2e = {
        mockNotebook: { initialFiles: { '/基础.md': content }, persist: false },
      };
      localStorage.setItem('jotluck:welcome:completed', '1');
      localStorage.setItem('jotluck:autocomplete:settings', JSON.stringify({ enabled: false }));
    }, BASE_CONTENT);
    await waitForAppReady(page);
    await openNote(page);
    await expect(page.locator('.cm-content')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('.cm-content')).toContainText('第一章');
  });

  test('v1-聚焦加粗行幽灵符号可见', async ({ page }) => {
    // 光标落进含 **加粗** 的段落行：聚焦行显示弱化的 ** 符号
    const content = await bridgeCall<string>(page, 'getContent');
    await bridgeCall(page, 'setCursor', content.indexOf('加粗'));
    await page.waitForTimeout(500);
    await expect(page.locator('.cm-content')).toContainText('加粗');
    await page.screenshot({
      path: '../../e2e/screenshots/acceptance-visual/v1-focused-bold-ghost.png',
    });
  });

  test('v2-聚焦表格行幽灵管道可见', async ({ page }) => {
    const content = await bridgeCall<string>(page, 'getContent');
    await bridgeCall(page, 'setCursor', content.indexOf('甲'));
    await page.waitForTimeout(500);
    await expect(page.locator('.cm-content')).toContainText('甲');
    await page.screenshot({
      path: '../../e2e/screenshots/acceptance-visual/v2-focused-table-pipes.png',
    });
  });

  test('v3-斜杠菜单浮现', async ({ page }) => {
    const content = await bridgeCall<string>(page, 'getContent');
    await bridgeCall(page, 'setCursor', content.length);
    await page.keyboard.press('Enter');
    await page.keyboard.type('/');
    await expect(page.locator('.cm-jotluck-slash-menu')).toBeVisible({ timeout: 3000 });
    await page.waitForTimeout(300);
    await page.screenshot({ path: '../../e2e/screenshots/acceptance-visual/v3-slash-menu.png' });
    await page.keyboard.press('Escape');
  });

  test('v4-表格工具条浮现', async ({ page }) => {
    const content = await bridgeCall<string>(page, 'getContent');
    await bridgeCall(page, 'setCursor', content.indexOf('甲') + 1);
    await expect(page.locator('[data-table-action="insertRowBelow"]').first()).toBeVisible({
      timeout: 3000,
    });
    await page.waitForTimeout(300);
    await page.screenshot({ path: '../../e2e/screenshots/acceptance-visual/v4-table-toolbar.png' });
  });

  test('v5-阅读模式整体渲染', async ({ page }) => {
    await switchMode(page, 'read');
    await expect(page.locator('.reader-workbench')).toBeVisible({ timeout: 5000 });
    await page.waitForTimeout(800);
    await page.screenshot({
      path: '../../e2e/screenshots/acceptance-visual/v5-reading-render.png',
    });
  });

  test('v6-分栏模式整体渲染', async ({ page }) => {
    await switchMode(page, 'split');
    await expect(page.locator('.split-pane').first()).toBeVisible({ timeout: 5000 });
    await page.waitForTimeout(800);
    await page.screenshot({ path: '../../e2e/screenshots/acceptance-visual/v6-split-render.png' });
  });
});
