import { expect, test, type Page } from '@playwright/test';
import {
  ensureEditorReady,
  resetAppState,
  typeInEditor,
  waitForAppReady,
} from '../helpers/test-utils';

const CONSTELLATION_THEME_ID = 'jotluck.constellation';

async function activateTheme(page: Page, themeId: string): Promise<void> {
  await ensureEditorReady(page);
  await page.evaluate((nextThemeId) => {
    localStorage.setItem('jotluck:theme-state:v2', JSON.stringify({ activeThemeId: nextThemeId }));
  }, themeId);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForAppReady(page);
  await ensureEditorReady(page);
  await expect(page.locator('html')).toHaveAttribute('data-theme-id', themeId);
}

test.describe('Constellation deck theme', () => {
  test.beforeEach(async ({ page }) => {
    await waitForAppReady(page);
    await resetAppState(page);
  });

  test('mounts the deck layout with full-width bars around the instrument row', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1536, height: 912 });
    await activateTheme(page, CONSTELLATION_THEME_ID);

    await expect(page.locator('html')).toHaveAttribute('data-layout-preset', 'deck');
    await expect(page.locator('.deck-shell')).toBeVisible();
    await expect(page.locator('.constellation-hull')).toBeVisible();

    const deckBox = await page.locator('.deck-shell').boundingBox();
    const topBox = await page.locator('.deck-shell__top').boundingBox();
    const bottomBox = await page.locator('.deck-shell__bottom').boundingBox();
    const leftBox = await page.locator('.deck-shell__left').boundingBox();
    const mainBox = await page.locator('.deck-shell__main').boundingBox();

    // 指挥栏与遥测栏贯通全宽；导航板与屏幕井位于其间的中间行
    expect(deckBox).not.toBeNull();
    expect(topBox?.width).toBe(deckBox?.width);
    expect(bottomBox?.width).toBe(deckBox?.width);
    expect(topBox?.y).toBe(deckBox?.y);
    expect(deckBox && bottomBox && bottomBox.y + bottomBox.height).toBe(
      deckBox!.y + deckBox!.height,
    );
    expect(leftBox && topBox && leftBox.y).toBeGreaterThanOrEqual(topBox!.y + topBox!.height);
    expect(leftBox && bottomBox && leftBox.y + leftBox.height).toBeLessThanOrEqual(bottomBox!.y);
    expect(mainBox && leftBox && mainBox.x).toBeGreaterThanOrEqual(leftBox!.x + leftBox!.width);
  });

  test('keeps long-document scrolling inside the etched screen well', async ({ page }) => {
    await page.setViewportSize({ width: 1536, height: 912 });
    await activateTheme(page, CONSTELLATION_THEME_ID);

    const sections = Array.from(
      { length: 40 },
      (_, index) => `## 第${index + 1}节\n\n这是一段用于验证甲板屏幕井滚动合同的内容。`,
    ).join('\n\n');
    await typeInEditor(page, `# 甲板滚动验收\n\n${sections}`, { insertText: true });

    const screen = page.locator('.constellation-screen');
    await expect(screen).toBeVisible();

    // 屏幕井保持固定高度，内容增长不会撑高甲板
    const screenHeight = await screen.evaluate((element) => element.clientHeight);
    expect(screenHeight).toBeLessThan(760);

    const cmScroller = page.locator('.cm-scroller');
    const cmScrollable = await cmScroller.evaluate(
      (element) => element.scrollHeight > element.clientHeight,
    );
    expect(cmScrollable).toBe(true);

    await cmScroller.evaluate((element) => {
      element.scrollTop = 1200;
    });
    expect(await cmScroller.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);

    // 外层 editor-scroll 不接管滚动
    const editorScroll = page.locator('.deck-shell .editor-scroll');
    await expect(editorScroll).toHaveCSS('overflow-y', 'hidden');
    expect(await editorScroll.evaluate((element) => element.scrollTop)).toBe(0);
  });

  test('read mode lets reader-workbench own scrolling with return-to-edit reachable', async ({
    page,
  }) => {
    await activateTheme(page, CONSTELLATION_THEME_ID);

    const sections = Array.from(
      { length: 24 },
      (_, index) => `## 第${index + 1}节\n\n只读渲染滚动归属验证文本。`,
    ).join('\n\n');
    await typeInEditor(page, `# 甲板只读验收\n\n${sections}`, { insertText: true });

    // 即时 → 分栏 → 只读渲染
    const toggle = page.locator('.view-mode-toggle');
    await toggle.click();
    await expect(page.locator('.split-pane')).toBeVisible();
    await toggle.click();

    const reader = page.locator('.constellation-screen > .reader-workbench[data-view-mode="read"]');
    await expect(reader).toBeVisible();
    await expect(reader).toHaveCSS('overflow-y', 'auto');

    const readerScrollable = await reader.evaluate(
      (element) => element.scrollHeight > element.clientHeight,
    );
    expect(readerScrollable).toBe(true);

    // 阅读模式下控制甲板隐藏，返回编辑入口保留在吸顶栏
    await expect(page.locator('.constellation-control-deck')).toBeHidden();
    const readerBar = reader.locator('.reader-workbench__bar');
    await expect(readerBar.getByRole('button', { name: '返回即时编辑' })).toBeVisible();

    // 长文滚动后吸顶栏仍然可见
    await reader.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await expect(readerBar).toBeVisible();
  });

  test('returns to paper without deck or constellation residue', async ({ page }) => {
    await activateTheme(page, CONSTELLATION_THEME_ID);
    await expect(page.locator('.deck-shell')).toBeVisible();

    await activateTheme(page, 'paper');
    await expect(page.locator('html')).toHaveAttribute('data-layout-preset', 'winged');
    await expect(page.locator('.deck-shell')).toHaveCount(0);
    await expect(page.locator('.constellation-hull')).toHaveCount(0);
    // 星空画布与动画循环随 hull 卸载，无残留
    await expect(page.locator('.constellation-stars')).toHaveCount(0);

    const activeCss = await page.locator('#jotluck-active-theme').textContent();
    expect(activeCss ?? '').not.toContain('constellation');

    // 宿主工作区结构完整恢复
    await expect(page.locator('.app-shell')).toBeVisible();
    await expect(page.locator('.cm-content')).toBeVisible();
  });
});
