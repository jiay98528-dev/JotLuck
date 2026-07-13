import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import {
  ensureEditorReady,
  expectEditorContains,
  getEditorContent,
  resetAppState,
  typeInEditor,
  waitForAppReady,
  waitForAutoSave,
} from '../helpers/test-utils';

const HALO_THEME_ID = 'jotluck.halo-canvas';
const HALO_TITLE = 'Halo Canvas 主题旅程';
const HALO_VIEWPORTS = [
  { name: 'mobile-360', width: 360, height: 740 },
  { name: 'tablet-768', width: 768, height: 1024 },
  { name: 'desktop-1280', width: 1280, height: 800 },
  { name: 'desktop-1440', width: 1440, height: 900 },
] as const;
const HALO_SNAPSHOT_VIEWPORTS = HALO_VIEWPORTS;

async function clickThemeJourneyControl(locator: Locator, testInfo: TestInfo): Promise<void> {
  // WebKit can falsely report moving glass descendants and discard a forced pointer click.
  // Keyboard activation follows the same native button/action route while also covering its
  // semantic control contract. Chromium and Firefox retain normal pointer hit testing.
  if (testInfo.project.name === 'webkit') {
    await locator.focus();
    await locator.press('Enter');
    return;
  }
  await locator.click();
}

async function activateHaloCanvas(page: Page, testInfo: TestInfo): Promise<void> {
  await ensureEditorReady(page);

  const themeTrigger = page.getByRole('button', { name: '主题', exact: true });
  await expect(themeTrigger).toHaveCount(1);
  await clickThemeJourneyControl(themeTrigger, testInfo);

  const center = page.locator('[role="dialog"][aria-labelledby="theme-center-title"]');
  await expect(center).toHaveCount(1);
  const haloCard = center.locator('.theme-card').filter({ hasText: '光环画布（Halo Canvas）' });
  await expect(haloCard).toHaveCount(1);
  const haloPreview = haloCard.locator('img');
  await expect(haloPreview).toHaveCount(1);
  await expect
    .poll(() => haloPreview.evaluate((image) => (image as HTMLImageElement).naturalWidth), {
      timeout: 10_000,
    })
    .toBeGreaterThan(0);

  const activate = haloCard.getByRole('button', { name: '使用', exact: true });
  await expect(activate).toHaveCount(1);
  await clickThemeJourneyControl(activate, testInfo);
  await expect(page.locator('html')).toHaveAttribute('data-theme-id', HALO_THEME_ID);

  await clickThemeJourneyControl(
    center.getByRole('button', { name: '关闭主题中心', exact: true }),
    testInfo,
  );
  await expect(center).toHaveCount(0);
}

async function switchToPaper(page: Page, testInfo: TestInfo): Promise<void> {
  const themeTrigger = page.getByRole('button', { name: '主题', exact: true });
  await expect(themeTrigger).toHaveCount(1);
  await clickThemeJourneyControl(themeTrigger, testInfo);

  const center = page.locator('[role="dialog"][aria-labelledby="theme-center-title"]');
  const paperCard = center.locator('.theme-card').filter({ hasText: '羽翼布局' });
  await expect(paperCard).toHaveCount(1);
  const activate = paperCard.getByRole('button', { name: '使用', exact: true });
  await expect(activate).toHaveCount(1);
  await clickThemeJourneyControl(activate, testInfo);
  await expect(page.locator('html')).toHaveAttribute('data-theme-id', 'paper');
}

async function waitForPersistedMockFile(page: Page, expectedText: string): Promise<string> {
  const findPath = () =>
    page.evaluate((content) => {
      const raw = localStorage.getItem('jotluck-mockfs');
      if (!raw) return null;
      const files = (JSON.parse(raw) as { files?: Record<string, { content?: string }> }).files;
      return (
        Object.entries(files ?? {}).find(([, file]) => file.content?.includes(content))?.[0] ?? null
      );
    }, expectedText);

  await expect.poll(findPath, { timeout: 10_000 }).not.toBeNull();
  const path = await findPath();
  if (!path) throw new Error('Expected the note content to be written to MockFS.');
  return path;
}

async function bootPersistedHaloCanvas(page: Page): Promise<void> {
  await page.evaluate((themeId) => {
    localStorage.setItem('jotluck:theme-state:v2', JSON.stringify({ activeThemeId: themeId }));
  }, HALO_THEME_ID);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForAppReady(page);
  await expect(page.locator('html')).toHaveAttribute('data-theme-id', HALO_THEME_ID);
  await expect(page.locator('.halo-frame--topbar')).toBeVisible();
}

async function assertHaloSurfacesFitViewport(page: Page): Promise<void> {
  const layout = await page.evaluate(() => {
    const viewport = window.innerWidth;
    const overflow = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth);
    const surfaces = [
      '.app-shell',
      '.halo-frame--topbar',
      '.halo-frame--left-wing',
      '.halo-frame--right-wing',
      '.editor-area',
      '.halo-command-deck',
      '.halo-frame--status-bar',
    ];
    const leaks = surfaces.flatMap((selector) =>
      Array.from(document.querySelectorAll<HTMLElement>(selector))
        .filter((element) => {
          const style = window.getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0;
        })
        .map((element) => {
          const rect = element.getBoundingClientRect();
          return { selector, left: rect.left, right: rect.right };
        })
        .filter((rect) => rect.left < -2 || rect.right > viewport + 2),
    );
    return { overflow, viewport, leaks };
  });

  expect(layout.overflow).toBeLessThanOrEqual(layout.viewport + 2);
  expect(layout.leaks).toEqual([]);
}

async function waitForHaloPaint(page: Page): Promise<void> {
  await page.mouse.move(0, 0);
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)),
    );
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
}

async function dismissTransientOverlay(
  page: Page,
  testInfo: TestInfo,
  overlaySelector: string,
): Promise<void> {
  if (testInfo.project.name !== 'webkit') {
    await page.keyboard.press('Escape');
    return;
  }

  const overlay = page.locator(overlaySelector);
  await expect(overlay).toBeVisible();
  const box = await overlay.boundingBox();
  if (!box) throw new Error(`Expected visible overlay bounds for ${overlaySelector}.`);
  await page.mouse.click(box.x + box.width - 6, box.y + 6);
}

test.describe('Halo Canvas official theme', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    const chromiumOnly =
      testInfo.title.includes('approved real-runtime visual baselines') ||
      testInfo.title.includes('topbar and empty inspector glass details') ||
      testInfo.title.includes('read-only rendering visually unambiguous') ||
      testInfo.title.includes('forced colors, and keyboard focus in Chromium');
    test.skip(
      testInfo.project.name !== 'chromium' && chromiumOnly,
      'Chromium owns deterministic Halo visual and forced-color checks.',
    );
    if (testInfo.project.name === 'webkit') {
      await page.emulateMedia({ reducedMotion: 'reduce' });
    }
    await waitForAppReady(page);
    await resetAppState(page);
  });

  test('enables through Theme Center and preserves the core writing workflow', async ({
    page,
  }, testInfo: TestInfo) => {
    test.setTimeout(60_000);
    await activateHaloCanvas(page, testInfo);

    for (const slot of [
      'topbar',
      'left-wing',
      'right-wing',
      'editor-control',
      'status-bar',
      'workflow-canvas',
      'editor-surface',
    ]) {
      await expect(page.locator(`[data-theme-plugin-slot="${slot}"]`)).toHaveCount(1);
    }
    await expect(page.locator('[data-theme-part="topbar"]')).toHaveCount(1);
    await expect(page.locator('[data-theme-part="navigator"]')).toHaveCount(1);
    await expect(page.locator('[data-theme-part="inspector"]')).toHaveCount(1);
    await expect(page.locator('[data-theme-part="editor-control"]')).toHaveCount(1);

    const newNote = page.getByRole('button', { name: '新建笔记', exact: true });
    await expect(newNote).toHaveCount(1);
    await clickThemeJourneyControl(newNote, testInfo);
    await expect(page.locator('.tpl-card.blank-card')).toBeVisible();
    await clickThemeJourneyControl(page.locator('.tpl-card.blank-card'), testInfo);

    await typeInEditor(page, `# ${HALO_TITLE}\n\n亮色液态玻璃中的可保存内容。`);
    await waitForAutoSave(page);
    await expectEditorContains(page, '亮色液态玻璃中的可保存内容。');
    const persistedPath = await waitForPersistedMockFile(page, '亮色液态玻璃中的可保存内容。');

    const liveToggle = page.getByRole('button', { name: '切换到分栏视图', exact: true });
    await expect(liveToggle).toHaveCount(1);
    await clickThemeJourneyControl(liveToggle, testInfo);
    await expect(page.locator('.split-pane')).toBeVisible();
    const splitToggle = page.getByRole('button', { name: '切换到只读渲染', exact: true });
    await expect(splitToggle).toHaveCount(1);
    await clickThemeJourneyControl(splitToggle, testInfo);
    await expect(page.locator('.reader-workbench[data-view-mode="read"]')).toBeVisible();
    await expect(page.locator('[data-theme-part="format-toolbar"]')).toHaveCount(0);
    const readToggle = page.getByRole('button', { name: '返回即时编辑', exact: true });
    await expect(readToggle).toHaveCount(1);
    await expect(readToggle).not.toHaveAttribute('aria-pressed');
    await expect(readToggle.locator('svg path[d="M8 5v14l11-7z"]')).toHaveCount(0);
    await clickThemeJourneyControl(readToggle, testInfo);
    await expect(page.locator('.cm-editor')).toBeVisible();

    const fileDrawer = page.getByRole('button', { name: '切换左侧书签栏', exact: true });
    await expect(fileDrawer).toHaveCount(1);
    await clickThemeJourneyControl(fileDrawer, testInfo);
    const drawer = page.getByRole('dialog', { name: '文件浏览器', exact: true });
    await expect(drawer).toBeVisible();
    await expect(drawer.getByRole('treeitem').filter({ hasText: '快速入门.md' })).toBeVisible();
    await dismissTransientOverlay(page, testInfo, '.drawer-overlay');
    await expect(drawer).toHaveCount(0);

    const search = page.getByRole('button', { name: '搜索 Ctrl+K', exact: true });
    await expect(search).toHaveCount(1);
    if (testInfo.project.name === 'webkit') {
      await page.keyboard.press('Control+K');
    } else {
      await clickThemeJourneyControl(search, testInfo);
    }
    const palette = page.getByRole('dialog', { name: '命令面板', exact: true });
    await expect(palette).toBeVisible();
    await palette.getByRole('textbox', { name: '搜索笔记', exact: true }).fill(HALO_TITLE);
    await expect(palette.locator('.result-item').filter({ hasText: HALO_TITLE })).toBeVisible();
    await dismissTransientOverlay(page, testInfo, '.palette-overlay');
    await expect(palette).toHaveCount(0);

    const settings = page.getByRole('button', { name: '设置', exact: true });
    await expect(settings).toHaveCount(1);
    await clickThemeJourneyControl(settings, testInfo);
    const settingsDialog = page.getByRole('dialog', { name: '设置', exact: true });
    await expect(settingsDialog).toBeVisible();
    await dismissTransientOverlay(page, testInfo, '.modal-overlay');
    await expect(settingsDialog).toHaveCount(0);

    const exportAction = page.getByRole('button', { name: '导出笔记', exact: true });
    await expect(exportAction).toHaveCount(1);
    await clickThemeJourneyControl(exportAction, testInfo);
    const exportDialog = page.getByRole('dialog', { name: '导出笔记', exact: true });
    await expect(exportDialog).toBeVisible();
    await clickThemeJourneyControl(
      exportDialog.locator('.format-card', { hasText: 'TXT' }),
      testInfo,
    );
    const downloadPromise = page.waitForEvent('download');
    await clickThemeJourneyControl(
      exportDialog.locator('.modal-footer button', { hasText: '导出' }),
      testInfo,
    );
    const download = await downloadPromise;
    const downloadPath = await download.path();
    expect(downloadPath).toBeTruthy();
    const exported = await readFile(downloadPath!, 'utf8');
    expect(exported).toContain(HALO_TITLE);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForAppReady(page);
    await expect(page.locator('html')).toHaveAttribute('data-theme-id', HALO_THEME_ID);
    await clickThemeJourneyControl(fileDrawer, testInfo);
    await expect(drawer).toBeVisible();
    const persistedFile = drawer
      .getByRole('treeitem')
      .filter({ hasText: persistedPath.split('/').pop() ?? persistedPath });
    await expect(persistedFile).toBeVisible();
    await clickThemeJourneyControl(persistedFile, testInfo);
    await expect
      .poll(() => getEditorContent(page), { timeout: 10_000 })
      .toContain('亮色液态玻璃中的可保存内容。');

    await switchToPaper(page, testInfo);
    await expect(page.locator('[data-theme-plugin-slot]')).toHaveCount(0);
    await expect(page.locator('.halo-frame, .halo-command-deck')).toHaveCount(0);
    const activeThemeCss = await page
      .locator('#jotluck-active-theme')
      .evaluate((element) => element.textContent ?? '');
    expect(activeThemeCss).not.toContain('halo-canvas');
  });

  test('keeps the repaired spacing contract and cockpit layers observable at runtime', async ({
    page,
  }, testInfo: TestInfo) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await activateHaloCanvas(page, testInfo);
    await clickThemeJourneyControl(
      page.getByRole('button', { name: '快速入门', exact: true }),
      testInfo,
    );
    await waitForHaloPaint(page);

    const metrics = await page.evaluate(() => {
      const get = <T extends HTMLElement>(selector: string): T => {
        const element = document.querySelector<T>(selector);
        if (!element) throw new Error(`Missing expected Halo element: ${selector}`);
        return element;
      };
      const number = (value: string) => Number.parseFloat(value) || 0;
      const style = (selector: string) => window.getComputedStyle(get(selector));
      const workflow = get('.workflow-canvas');
      const canvas = get('.workflow-canvas__main');
      const workflowRect = workflow.getBoundingClientRect();
      const canvasRect = canvas.getBoundingClientRect();
      const rootStyle = window.getComputedStyle(document.documentElement);
      const glass = style('.halo-frame--topbar');
      const glassRefraction = window.getComputedStyle(get('.halo-frame--topbar'), '::before');
      const search = style('.halo-frame--topbar .shell-action--search');
      const iconButtonElement = get('.halo-frame--topbar .shell-action--settings');
      const iconButton = window.getComputedStyle(iconButtonElement);
      const iconButtonRect = iconButtonElement.getBoundingClientRect();
      const navigator = style('.halo-frame--left-wing .wing-bookmarks');
      const navigatorName = style('.halo-frame--left-wing .wing-bookmark-name');
      const dock = style('.halo-command-deck');
      const toolbar = style('.halo-command-deck .format-toolbar');
      const canvasStyle = style('.workflow-canvas__main');
      const emptyHint = style('.halo-frame--right-wing .empty-hint');
      const rightWingRect = get('.right-wing').getBoundingClientRect();

      return {
        supportsBackdropFilter: CSS.supports('backdrop-filter: blur(1px)'),
        glassBackdropFilter: glass.backdropFilter,
        glassBackground: glass.backgroundColor,
        glassShadow: glass.boxShadow,
        glassRefractionBackground: glassRefraction.backgroundImage,
        glassRefractionOpacity: number(glassRefraction.opacity),
        glassRadius: number(glass.borderRadius),
        searchPaddingLeft: number(search.paddingLeft),
        searchPaddingRight: number(search.paddingRight),
        iconButtonWidth: iconButtonRect.width,
        iconButtonHeight: iconButtonRect.height,
        iconButtonBorderStyle: iconButton.borderStyle,
        iconButtonShadow: iconButton.boxShadow,
        navigatorGap: number(navigator.rowGap || navigator.gap),
        dockPaddingTop: number(dock.paddingTop),
        dockPaddingInline: number(dock.paddingLeft),
        dockShadow: dock.boxShadow,
        toolbarGap: number(toolbar.gap),
        toolbarPaddingTop: number(toolbar.paddingTop),
        toolbarShadow: toolbar.boxShadow,
        canvasInset: canvasRect.left - workflowRect.left,
        canvasShadow: canvasStyle.boxShadow,
        canvasBackground: canvasStyle.backgroundColor,
        editorTopPad: number(rootStyle.getPropertyValue('--editor-top-pad')),
        canvasWidth: canvasRect.width,
        canvasHeight: canvasRect.height,
        navigatorFontSize: number(navigatorName.fontSize),
        navigatorLineHeight: number(navigatorName.lineHeight),
        emptyHintFontStyle: emptyHint.fontStyle,
        emptyHintTextAlign: emptyHint.textAlign,
        rightWingWidth: rightWingRect.width,
      };
    });

    expect(metrics.searchPaddingLeft).toBeGreaterThanOrEqual(8);
    expect(metrics.searchPaddingRight).toBeGreaterThanOrEqual(8);
    expect(metrics.navigatorGap).toBeGreaterThan(0);
    expect(metrics.dockPaddingTop).toBeGreaterThan(0);
    expect(metrics.dockPaddingInline).toBeGreaterThan(0);
    expect(metrics.toolbarGap).toBeGreaterThan(0);
    expect(metrics.toolbarPaddingTop).toBeGreaterThan(0);
    expect(metrics.canvasInset).toBeGreaterThanOrEqual(12);
    expect(metrics.canvasShadow).not.toBe('none');
    expect(metrics.canvasShadow).not.toBe(metrics.glassShadow);
    expect(metrics.canvasBackground).not.toBe('rgba(0, 0, 0, 0)');
    expect(metrics.canvasBackground).not.toBe(metrics.glassBackground);
    expect(metrics.glassShadow).toContain('inset');
    expect(metrics.dockShadow).toContain('inset');
    expect(metrics.dockShadow).not.toBe(metrics.glassShadow);
    expect(metrics.toolbarShadow).toBe('none');
    expect(metrics.glassRefractionBackground).not.toBe('none');
    expect(metrics.glassRefractionOpacity).toBeGreaterThan(0);
    expect(metrics.glassRefractionOpacity).toBeLessThanOrEqual(0.35);
    expect(metrics.iconButtonWidth).toBe(32);
    expect(metrics.iconButtonHeight).toBe(32);
    expect(metrics.iconButtonBorderStyle).toBe('solid');
    expect(metrics.iconButtonShadow).toBe('none');
    expect(metrics.glassRadius).toBe(12);
    expect(metrics.editorTopPad).toBe(56);
    expect(metrics.canvasWidth).toBeGreaterThan(640);
    expect(metrics.canvasHeight).toBeGreaterThan(480);
    expect(metrics.navigatorFontSize).toBeGreaterThanOrEqual(14);
    expect(metrics.navigatorLineHeight).toBeGreaterThanOrEqual(20);
    expect(metrics.emptyHintFontStyle).toBe('normal');
    expect(metrics.emptyHintTextAlign).toBe('left');
    expect(metrics.rightWingWidth).toBe(240);
    if (metrics.supportsBackdropFilter) {
      expect(metrics.glassBackdropFilter).toContain('blur(16px)');
    }
  });

  test('keeps desktop inspector resize ownership and exposes the 768px rail on demand', async ({
    page,
  }, testInfo: TestInfo) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await activateHaloCanvas(page, testInfo);

    const resizeHandle = page.locator('[data-theme-part="inspector-resize"]');
    const desktopWidthBefore = await page
      .locator('.right-wing')
      .evaluate((element) => Math.round(element.getBoundingClientRect().width));
    await resizeHandle.focus();
    await page.keyboard.press('ArrowLeft');
    await expect
      .poll(() =>
        page
          .locator('.right-wing')
          .evaluate((element) => Math.round(element.getBoundingClientRect().width)),
      )
      .toBeGreaterThan(desktopWidthBefore);

    await page.setViewportSize({ width: 768, height: 1024 });
    const railToggle = page.locator('[data-theme-part="inspector-rail-toggle"]');
    await expect(railToggle).toBeVisible();
    await expect(railToggle).toHaveAttribute('aria-expanded', 'false');
    await expect
      .poll(() =>
        page
          .locator('.right-wing')
          .evaluate((element) => Math.round(element.getBoundingClientRect().width)),
      )
      .toBe(56);
    await expect(page.locator('[data-theme-part="inspector-content"]')).toBeHidden();

    await railToggle.focus();
    await expect(railToggle).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(railToggle).toHaveAttribute('aria-expanded', 'true');
    await expect
      .poll(() =>
        page
          .locator('.right-wing')
          .evaluate((element) => Math.round(element.getBoundingClientRect().width)),
      )
      .toBe(264);
    await expect(page.locator('[data-theme-part="inspector-content"]')).toBeVisible();
  });

  test('prioritizes prose and a horizontally reachable dock at 360px', async ({
    page,
  }, testInfo: TestInfo) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await activateHaloCanvas(page, testInfo);

    await expect(page.locator('.halo-frame--left-wing')).toBeHidden();
    await expect(page.locator('.halo-frame--right-wing')).toBeHidden();
    await expect(page.getByRole('button', { name: '切换左侧书签栏', exact: true })).toBeVisible();

    const geometry = await page.evaluate(() => {
      const dock = document.querySelector<HTMLElement>('.halo-command-deck');
      const toolbar = document.querySelector<HTMLElement>('.halo-command-deck .format-toolbar');
      const canvas = document.querySelector<HTMLElement>('.workflow-canvas__main');
      const editorSurface = document.querySelector<HTMLElement>('.halo-frame--editor-surface');
      if (!dock || !toolbar || !canvas || !editorSurface) {
        throw new Error('Missing expected Halo mobile surface.');
      }
      return {
        dockHeight: dock.getBoundingClientRect().height,
        toolbarScrollWidth: toolbar.scrollWidth,
        toolbarClientWidth: toolbar.clientWidth,
        editorTopPad: Number.parseFloat(
          window.getComputedStyle(document.documentElement).getPropertyValue('--editor-top-pad'),
        ),
        canvasWidth: canvas.getBoundingClientRect().width,
        canvasHeight: canvas.getBoundingClientRect().height,
        editorSurfaceHeight: editorSurface.getBoundingClientRect().height,
      };
    });

    expect(geometry.dockHeight).toBeLessThanOrEqual(120);
    expect(geometry.toolbarScrollWidth).toBeGreaterThan(geometry.toolbarClientWidth);
    expect(geometry.editorTopPad).toBe(32);
    expect(geometry.canvasWidth).toBeGreaterThan(280);
    expect(geometry.editorSurfaceHeight).toBeGreaterThan(300);
    expect(geometry.canvasHeight - geometry.editorSurfaceHeight).toBeLessThan(140);
    await page.getByRole('button', { name: '行内代码', exact: true }).focus();
    await expect(page.getByRole('button', { name: '行内代码', exact: true })).toBeFocused();
  });

  test('matches approved real-runtime visual baselines at 1440, 1280, 768, and 360 @windows-visual', async ({
    page,
  }, testInfo: TestInfo) => {
    test.skip(
      testInfo.project.name !== 'chromium',
      'Halo visual baselines are captured in Chromium.',
    );

    for (const viewport of HALO_SNAPSHOT_VIEWPORTS) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await resetAppState(page);
      await activateHaloCanvas(page, testInfo);
      if (viewport.width > 480) {
        await clickThemeJourneyControl(
          page.getByRole('button', { name: '快速入门', exact: true }),
          testInfo,
        );
        await expect(page.locator('.topbar-title--workbench')).toHaveText('快速入门');
        await expect(page.locator('.cm-content')).toContainText('欢迎使用 JotLuck');
      } else {
        await expect(page.locator('.cm-content')).toBeVisible();
      }
      await waitForHaloPaint(page);
      await expect(page).toHaveScreenshot(`halo-canvas-${viewport.name}.png`, {
        animations: 'disabled',
        caret: 'hide',
        fullPage: false,
        maxDiffPixelRatio: 0.01,
        scale: 'css',
      });
    }
  });

  test('locks topbar and empty inspector glass details at shipping scale @windows-visual', async ({
    page,
  }, testInfo: TestInfo) => {
    test.skip(
      testInfo.project.name !== 'chromium',
      'Halo detail baselines are captured in Chromium.',
    );
    await page.setViewportSize({ width: 1280, height: 800 });
    await resetAppState(page);
    await activateHaloCanvas(page, testInfo);
    await waitForHaloPaint(page);

    await expect(page.locator('.halo-frame--topbar')).toHaveScreenshot(
      'halo-canvas-topbar-detail.png',
      {
        animations: 'disabled',
        caret: 'hide',
        maxDiffPixelRatio: 0.005,
        scale: 'css',
      },
    );
    await expect(page.locator('.halo-frame--right-wing')).toHaveScreenshot(
      'halo-canvas-inspector-empty-detail.png',
      {
        animations: 'disabled',
        caret: 'hide',
        maxDiffPixelRatio: 0.005,
        scale: 'css',
      },
    );
  });

  test('makes read-only rendering visually unambiguous @windows-visual', async ({
    page,
  }, testInfo: TestInfo) => {
    test.skip(
      testInfo.project.name !== 'chromium',
      'Halo read-mode detail is captured in Chromium.',
    );
    await page.setViewportSize({ width: 1280, height: 800 });
    await resetAppState(page);
    await activateHaloCanvas(page, testInfo);
    await clickThemeJourneyControl(
      page.getByRole('button', { name: '快速入门', exact: true }),
      testInfo,
    );

    await clickThemeJourneyControl(
      page.getByRole('button', { name: '切换到分栏视图', exact: true }),
      testInfo,
    );
    await clickThemeJourneyControl(
      page.getByRole('button', { name: '切换到只读渲染', exact: true }),
      testInfo,
    );

    await expect(page.locator('.halo-command-deck')).toBeHidden();
    await expect(page.locator('[data-theme-part="format-toolbar"]')).toHaveCount(0);
    const readerBar = page.locator('.reader-workbench__bar');
    await expect(readerBar).toContainText('只读渲染');
    const editButton = readerBar.getByRole('button', { name: '返回即时编辑', exact: true });
    await expect(editButton).toBeVisible();
    await expect(editButton).not.toHaveAttribute('aria-pressed');
    await expect(editButton).toHaveAttribute('title', /当前为只读渲染/);
    await expect(readerBar).toHaveScreenshot('halo-canvas-read-mode-bar.png', {
      animations: 'disabled',
      caret: 'hide',
      maxDiffPixelRatio: 0.005,
      scale: 'css',
    });
  });

  test('keeps Halo Canvas usable at the documented responsive breakpoints', async ({
    page,
  }, testInfo: TestInfo) => {
    test.setTimeout(60_000);

    for (const viewport of HALO_VIEWPORTS) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await resetAppState(page);
      if (viewport.width === 360) {
        await activateHaloCanvas(page, testInfo);
      } else {
        await bootPersistedHaloCanvas(page);
      }
      await assertHaloSurfacesFitViewport(page);

      if (viewport.width <= 720) {
        await expect(page.locator('.halo-frame--right-wing')).toBeHidden();
      } else {
        await expect(page.locator('.halo-frame--right-wing')).toBeVisible();
        const themeTrigger = page.getByRole('button', { name: '主题', exact: true });
        await clickThemeJourneyControl(themeTrigger, testInfo);
        const center = page.locator('[role="dialog"][aria-labelledby="theme-center-title"]');
        await expect(center).toBeVisible();
        await clickThemeJourneyControl(
          center.getByRole('button', { name: '关闭主题中心', exact: true }),
          testInfo,
        );
      }
    }
  });

  test('honors reduced motion, forced colors, and keyboard focus in Chromium', async ({
    page,
  }, testInfo: TestInfo) => {
    test.skip(
      testInfo.project.name !== 'chromium',
      'Chromium provides deterministic forced-colors emulation.',
    );
    await page.emulateMedia({ reducedMotion: 'reduce', forcedColors: 'active' });
    await activateHaloCanvas(page, testInfo);

    const visualFallback = await page.locator('.halo-frame--topbar').evaluate((element) => ({
      backdropFilter: window.getComputedStyle(element).backdropFilter,
      animationName: window.getComputedStyle(document.querySelector('.app-shell')!, '::before')
        .animationName,
      transitionDuration: window.getComputedStyle(document.querySelector('.halo-command-deck')!)
        .transitionDuration,
    }));
    expect(visualFallback.backdropFilter).toBe('none');
    expect(visualFallback.animationName).toBe('none');
    expect(Number.parseFloat(visualFallback.transitionDuration)).toBeLessThanOrEqual(0.01);

    const themeTrigger = page.getByRole('button', { name: '主题', exact: true });
    await themeTrigger.focus();
    await expect(themeTrigger).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(
      page.locator('[role="dialog"][aria-labelledby="theme-center-title"]'),
    ).toBeVisible();
  });
});
