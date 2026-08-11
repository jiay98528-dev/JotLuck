import { expect, test, type Page } from '@playwright/test';
import {
  ensureEditorReady,
  resetAppState,
  typeInEditor,
  waitForAppReady,
} from '../helpers/test-utils';

const LUMEN_THEME_ID = 'jotluck.lumen-field';

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

test.describe('Official theme scroll ownership', () => {
  test.beforeEach(async ({ page }) => {
    await waitForAppReady(page);
    await resetAppState(page);
  });

  test('keeps Lumen Field return-to-edit visible while its reader scrolls', async ({ page }) => {
    await page.setViewportSize({ width: 1536, height: 912 });
    await activateTheme(page, LUMEN_THEME_ID);

    const sections = Array.from(
      { length: 20 },
      (_, index) => `## 第${index + 1}节\n\n这是一段用于验证暗场阅读滚动所有权的内容。`,
    ).join('\n\n');
    await typeInEditor(page, `# 暗场只读模式验收\n\n${sections}`, { insertText: true });

    const bottomHandle = page.locator('.single-page-drawer-handle--bottom');
    await expect(bottomHandle).toBeVisible();
    await bottomHandle.click();
    const drawerActions = page.locator('.lumen-command-deck__actions');
    await drawerActions.getByRole('button', { name: '切换到分栏视图', exact: true }).click();
    await drawerActions.getByRole('button', { name: '切换到只读渲染', exact: true }).click();
    await page.keyboard.press('Escape');

    const reader = page.locator(
      '.lumen-slot-frame--editor-surface > .reader-workbench[data-view-mode="read"]',
    );
    const readerBar = reader.locator('.reader-workbench__bar');
    const editButton = readerBar.getByRole('button', { name: '返回即时编辑', exact: true });
    await expect(reader).toBeVisible();
    await expect(reader).toHaveCSS('overflow-y', 'auto');
    await expect(page.locator('.editor-area--single-page .editor-scroll')).toHaveCSS(
      'overflow-y',
      'hidden',
    );
    await expect(editButton).toBeVisible();
    await expect(editButton).toBeFocused();

    const barTop = await readerBar.evaluate((element) => element.getBoundingClientRect().top);
    const scrollRange = await reader.evaluate(
      (element) => element.scrollHeight - element.clientHeight,
    );
    expect(scrollRange).toBeGreaterThan(0);
    await reader.evaluate((element) => {
      element.scrollTop = Math.min(700, element.scrollHeight - element.clientHeight);
    });
    await expect.poll(() => reader.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    const barTopAfterScroll = await readerBar.evaluate(
      (element) => element.getBoundingClientRect().top,
    );
    expect(Math.abs(barTopAfterScroll - barTop)).toBeLessThanOrEqual(1);
    await expect(editButton).toBeVisible();

    await editButton.press('Enter');
    await expect(page.locator('.cm-editor')).toBeVisible();
    await expect(page.locator('.cm-content')).toBeFocused();
  });

  test('keeps the Lumen command-deck handle inside an external edit session viewport', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1536, height: 912 });
    const externalPath = 'C:/Users/alice/Desktop/lumen-external.md';
    await page.addInitScript(
      ({ path, themeId }) => {
        localStorage.setItem('jotluck:welcome:completed', '1');
        localStorage.setItem('jotluck:locale:v1', 'zh-CN');
        localStorage.setItem('jotluck:theme-state:v2', JSON.stringify({ activeThemeId: themeId }));
        (
          window as typeof window & {
            __jotluck_e2e?: {
              mockOpenedFile: { absolutePath: string };
              externalFiles: Record<string, string>;
            };
          }
        ).__jotluck_e2e = {
          mockOpenedFile: { absolutePath: path },
          externalFiles: {
            [path]: '# 外部暗场文档\n\n用于验证顶部状态栏不会把底部命令入口挤出视口。',
          },
        };
      },
      { path: externalPath, themeId: LUMEN_THEME_ID },
    );

    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('[data-testid="external-file-session"]')).toBeVisible({
      timeout: 10000,
    });
    await page.getByRole('button', { name: '启用编辑' }).click();
    await expect(page.locator('.external-edit-banner')).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-theme-id', LUMEN_THEME_ID);

    const bottomHandle = page.locator('.single-page-drawer-handle--bottom');
    await expect(bottomHandle).toBeVisible();
    const handleBounds = await bottomHandle.boundingBox();
    expect(handleBounds).not.toBeNull();
    expect((handleBounds?.y ?? 0) + (handleBounds?.height ?? 0)).toBeLessThanOrEqual(912);

    await bottomHandle.click();
    await expect(page.locator('.single-page-drawer--bottom')).toHaveClass(/is-open/u);
    await expect(page.locator('.lumen-command-deck')).toBeVisible();
    await expect(
      page
        .locator('.lumen-command-deck__actions')
        .getByRole('button', { name: '切换到分栏视图', exact: true }),
    ).toBeVisible();
  });

  test('keeps developer theme reader wrappers on the same sticky contract', async ({ page }) => {
    await page.setViewportSize({ width: 1536, height: 912 });
    const sections = Array.from(
      { length: 20 },
      (_, index) => `## 合同段落 ${index + 1}\n\n所有内置主题都必须保留可见的返回编辑入口。`,
    ).join('\n\n');

    for (const themeId of ['jotluck.ability-lab', 'jotluck.super-workbench'] as const) {
      await activateTheme(page, themeId);
      await typeInEditor(page, `# 内置主题滚动合同\n\n${sections}`, { insertText: true });

      const splitAction = page.getByRole('button', { name: /^(切换到分栏视图|分栏)$/ });
      if (await splitAction.first().isVisible()) await splitAction.first().click();
      await page
        .getByRole('button', { name: /^(切换到只读渲染|只读)$/ })
        .first()
        .click();

      const reader = page.locator('.reader-workbench[data-view-mode="read"]');
      const readerBar = reader.locator('.reader-workbench__bar');
      const editButton = readerBar.locator('.shell-action--view-toggle');
      await expect(reader).toHaveCSS('overflow-y', 'auto');
      await expect(editButton).toBeVisible();
      const barTop = await readerBar.evaluate((element) => element.getBoundingClientRect().top);
      await reader.evaluate((element) => {
        element.scrollTop = Math.min(700, element.scrollHeight - element.clientHeight);
      });
      await expect.poll(() => reader.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
      const barTopAfterScroll = await readerBar.evaluate(
        (element) => element.getBoundingClientRect().top,
      );
      expect(Math.abs(barTopAfterScroll - barTop)).toBeLessThanOrEqual(1);
      await expect(editButton).toBeVisible();
      await editButton.press('Enter');
      await expect(page.locator('.cm-content')).toBeFocused();
    }
  });
});
