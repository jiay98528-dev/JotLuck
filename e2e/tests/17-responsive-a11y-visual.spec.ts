import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import { ensureEditorReady, waitForAppReady } from '../helpers/test-utils';

const VIEWPORTS = [
  { name: 'mobile-360', width: 360, height: 740 },
  { name: 'tablet-768', width: 768, height: 1024 },
  { name: 'desktop-1280', width: 1280, height: 800 },
  { name: 'desktop-1440', width: 1440, height: 900 },
] as const;

async function bootAt(page: Page, viewport: (typeof VIEWPORTS)[number]): Promise<void> {
  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  await waitForAppReady(page);
}

async function assertNoPageHorizontalOverflow(page: Page): Promise<void> {
  const metrics = await page.evaluate(() => ({
    innerWidth: window.innerWidth,
    docScrollWidth: document.documentElement.scrollWidth,
    bodyScrollWidth: document.body.scrollWidth,
  }));
  expect(Math.max(metrics.docScrollWidth, metrics.bodyScrollWidth)).toBeLessThanOrEqual(
    metrics.innerWidth + 2,
  );
}

async function assertVisibleSurfacesInsideViewport(page: Page): Promise<void> {
  const leaks = await page.evaluate(() => {
    const selectors = [
      '.app-shell',
      '.editor-area',
      '.topbar',
      '.status-bar',
      '.modal-card',
      '.palette',
      '.file-drawer',
      '.context-menu',
    ];
    return selectors.flatMap((selector) =>
      Array.from(document.querySelectorAll<HTMLElement>(selector))
        .filter((element) => {
          const style = window.getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0;
        })
        .map((element) => {
          const rect = element.getBoundingClientRect();
          return {
            selector,
            className: element.className,
            left: rect.left,
            right: rect.right,
            width: rect.width,
            viewport: window.innerWidth,
          };
        })
        .filter((box) => box.left < -2 || box.right > box.viewport + 2),
    );
  });
  expect(leaks).toEqual([]);
}

async function captureCheckpoint(
  page: Page,
  testInfo: TestInfo,
  viewportName: string,
  checkpoint: string,
): Promise<void> {
  await page.waitForTimeout(350);
  await page.screenshot({
    path: testInfo.outputPath(`m-r3-${viewportName}-${checkpoint}.png`),
    fullPage: false,
  });
}

async function waitForSurfaceInsideViewport(page: Page, selector: string): Promise<void> {
  await expect
    .poll(async () =>
      page.locator(selector).evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return {
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          viewport: window.innerWidth,
        };
      }),
    )
    .toMatchObject({ left: 0 });
}

async function assertFocusTrapAndEscapeRestore(
  page: Page,
  surface: Locator,
  trigger: Locator,
): Promise<void> {
  await expect
    .poll(() => surface.evaluate((dialog) => dialog.contains(document.activeElement)))
    .toBe(true);
  await trigger.focus();
  await expect
    .poll(() => surface.evaluate((dialog) => dialog.contains(document.activeElement)))
    .toBe(true);
  await page.keyboard.press('Escape');
  await expect(surface).toHaveCount(0);
  await expect(trigger).toBeFocused();
}

async function assertCloseTouchTarget(surface: Locator): Promise<void> {
  const close = surface.locator('.modal-close').first();
  await expect(close).toBeVisible();
  await expect
    .poll(() => close.evaluate((button) => button.getBoundingClientRect().width))
    .toBeGreaterThanOrEqual(44);
  await expect
    .poll(() => close.evaluate((button) => button.getBoundingClientRect().height))
    .toBeGreaterThanOrEqual(44);
}

async function assertMinimumTouchTargets(controls: Locator): Promise<void> {
  await expect
    .poll(async () => {
      const boxes = await controls.evaluateAll((elements) =>
        elements.map((element) => {
          const rect = element.getBoundingClientRect();
          return { width: rect.width, height: rect.height };
        }),
      );
      return boxes.length > 0 && boxes.every((box) => box.width >= 44 && box.height >= 44);
    })
    .toBe(true);
}

test.describe('M-R3 responsive, accessibility, and visual release gates', () => {
  for (const viewport of VIEWPORTS) {
    test(`R1 shell and core overlays stay inside viewport at ${viewport.name}`, async ({
      page,
    }, testInfo) => {
      testInfo.setTimeout(60_000);
      await bootAt(page, viewport);
      await expect(page.locator('.app-shell')).toBeVisible();
      await assertNoPageHorizontalOverflow(page);
      await assertVisibleSurfacesInsideViewport(page);
      await captureCheckpoint(page, testInfo, viewport.name, 'app-shell-initial');

      const settingsTrigger = page.locator('.wing-settings-btn');
      await settingsTrigger.click();
      const settingsDialog = page.locator('.modal-card[role="dialog"]');
      await expect(settingsDialog).toBeVisible();
      await assertNoPageHorizontalOverflow(page);
      await assertVisibleSurfacesInsideViewport(page);
      await assertCloseTouchTarget(settingsDialog);
      await captureCheckpoint(page, testInfo, viewport.name, 'settings-dialog');
      await assertFocusTrapAndEscapeRestore(page, settingsDialog, settingsTrigger);

      const searchTrigger = page.locator('.topbar-search-hint');
      await searchTrigger.click();
      const searchPalette = page.locator('.palette[role="dialog"]');
      await expect(searchPalette).toBeVisible();
      await expect(page.locator('.palette .search-input')).toBeFocused();
      await assertNoPageHorizontalOverflow(page);
      await assertVisibleSurfacesInsideViewport(page);
      await captureCheckpoint(page, testInfo, viewport.name, 'search-palette');
      await assertFocusTrapAndEscapeRestore(page, searchPalette, searchTrigger);

      const templateTrigger = page.locator('.wing-new-btn');
      await templateTrigger.click();
      const templateDialog = page.locator('.modal-card[role="dialog"]');
      await expect(templateDialog).toBeVisible();
      await assertNoPageHorizontalOverflow(page);
      await assertVisibleSurfacesInsideViewport(page);
      await assertCloseTouchTarget(templateDialog);
      await captureCheckpoint(page, testInfo, viewport.name, 'template-dialog');
      await assertFocusTrapAndEscapeRestore(page, templateDialog, templateTrigger);

      const exportTrigger = page.locator('.topbar-btn--export');
      await exportTrigger.click();
      const exportDialog = page.locator('.modal-card[role="dialog"]');
      await expect(exportDialog).toBeVisible();
      await assertNoPageHorizontalOverflow(page);
      await assertVisibleSurfacesInsideViewport(page);
      await assertCloseTouchTarget(exportDialog);
      await captureCheckpoint(page, testInfo, viewport.name, 'export-dialog');
      await assertFocusTrapAndEscapeRestore(page, exportDialog, exportTrigger);

      const drawerTrigger = page.locator('.topbar-btn--menu');
      await drawerTrigger.click();
      const fileDrawer = page.locator('.file-drawer[role="dialog"]');
      await expect(fileDrawer).toBeVisible();
      await waitForSurfaceInsideViewport(page, '.file-drawer[role="dialog"]');
      await assertNoPageHorizontalOverflow(page);
      await assertVisibleSurfacesInsideViewport(page);
      await captureCheckpoint(page, testInfo, viewport.name, 'file-drawer');
      await assertFocusTrapAndEscapeRestore(page, fileDrawer, drawerTrigger);
    });
  }

  test('R2 switches are keyboard reachable and expose switch state', async ({ page }) => {
    await bootAt(page, VIEWPORTS[2]);

    await page.locator('.wing-settings-btn').click();
    const settingsDialog = page.locator('.modal-card[role="dialog"]');
    const settingsSwitches = settingsDialog.getByRole('switch');
    await expect(settingsSwitches.first()).toBeVisible();
    await assertMinimumTouchTargets(settingsSwitches);
    const firstSettingsSwitch = settingsSwitches.first();
    await firstSettingsSwitch.focus();
    await expect(firstSettingsSwitch).toBeFocused();
    const beforeSettings = await firstSettingsSwitch.getAttribute('aria-checked');
    await page.keyboard.press('Space');
    await expect(firstSettingsSwitch).not.toHaveAttribute('aria-checked', beforeSettings ?? '');
    await page.keyboard.press('Escape');
    await expect(settingsDialog).toHaveCount(0);

    await page.locator('.topbar-btn--export').click();
    const exportDialog = page.locator('.modal-card[role="dialog"]');
    const exportSwitches = exportDialog.getByRole('switch');
    await expect(exportSwitches).toHaveCount(3);
    await assertMinimumTouchTargets(exportSwitches);
    const firstExportSwitch = exportSwitches.first();
    await firstExportSwitch.focus();
    await expect(firstExportSwitch).toBeFocused();
    const beforeExport = await firstExportSwitch.getAttribute('aria-checked');
    await page.keyboard.press('Enter');
    await expect(firstExportSwitch).not.toHaveAttribute('aria-checked', beforeExport ?? '');
    await page.keyboard.press('Escape');
    await expect(exportDialog).toHaveCount(0);

    await page.setViewportSize({ width: VIEWPORTS[0].width, height: VIEWPORTS[0].height });
    await page.locator('.wing-settings-btn').click();
    const mobileSettingsDialog = page.locator('.modal-card[role="dialog"]');
    await expect(mobileSettingsDialog).toBeVisible();
    await assertMinimumTouchTargets(mobileSettingsDialog.getByRole('switch'));
    await page.keyboard.press('Escape');
    await expect(mobileSettingsDialog).toHaveCount(0);

    await page.locator('.topbar-btn--export').click();
    const mobileExportDialog = page.locator('.modal-card[role="dialog"]');
    await expect(mobileExportDialog).toBeVisible();
    await assertMinimumTouchTargets(mobileExportDialog.getByRole('switch'));
    await page.keyboard.press('Escape');
    await expect(mobileExportDialog).toHaveCount(0);

    await page.locator('.wing-bookmark-dot[aria-label="快速入门"]').click();
    await expect
      .poll(() => page.evaluate(() => window.__jotluck_e2e?.debugState?.().activePath ?? ''))
      .toBe('/快速入门.md');
    await page.locator('.wing-new-btn').click();
    const templateDialog = page.locator('.modal-card[role="dialog"]');
    const saveToggle = templateDialog.locator('.save-toggle');
    await expect(saveToggle).toBeEnabled();
    await saveToggle.click();
    await templateDialog.getByPlaceholder('模板名称').fill('触控目标模板');
    await templateDialog.getByRole('button', { name: '保存', exact: true }).click();

    const customTemplate = templateDialog.locator('.custom-tpl', { hasText: '触控目标模板' });
    await expect(customTemplate).toBeVisible();
    const deleteButton = customTemplate.getByRole('button', { name: '删除模板' });
    await assertMinimumTouchTargets(deleteButton);
    await deleteButton.click();
    await expect(customTemplate).toHaveCount(0);
  });

  test('R3 editor and settings surfaces stay measurable', async ({ page }, testInfo) => {
    await bootAt(page, VIEWPORTS[2]);
    await ensureEditorReady(page);

    await assertNoPageHorizontalOverflow(page);
    await captureCheckpoint(page, testInfo, 'desktop-1280', 'paper-editor');

    await page.locator('.wing-settings-btn').click();
    await expect(page.locator('.modal-card[role="dialog"]')).toBeVisible();
    await assertVisibleSurfacesInsideViewport(page);
    await captureCheckpoint(page, testInfo, 'desktop-1280', 'paper-settings');
  });
});
