import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { waitForAppReady } from '../helpers/test-utils';

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

test.describe('M-R3 responsive, accessibility, and visual release gates', () => {
  for (const viewport of VIEWPORTS) {
    test(`R1 shell and core overlays stay inside viewport at ${viewport.name}`, async ({
      page,
    }, testInfo) => {
      await bootAt(page, viewport);
      await expect(page.locator('.cm-content')).toBeVisible();
      await assertNoPageHorizontalOverflow(page);
      await assertVisibleSurfacesInsideViewport(page);
      await captureCheckpoint(page, testInfo, viewport.name, 'app-shell-initial');

      await page.locator('.wing-settings-btn').click();
      await expect(page.locator('.modal-card[role="dialog"]')).toBeVisible();
      await assertNoPageHorizontalOverflow(page);
      await assertVisibleSurfacesInsideViewport(page);
      await captureCheckpoint(page, testInfo, viewport.name, 'settings-dialog');
      await page.keyboard.press('Escape');
      await expect(page.locator('.modal-card[role="dialog"]')).toHaveCount(0);

      await page.locator('.topbar-search-hint').click();
      await expect(page.locator('.palette[role="dialog"]')).toBeVisible();
      await expect(page.locator('.palette .search-input')).toBeFocused();
      await assertNoPageHorizontalOverflow(page);
      await assertVisibleSurfacesInsideViewport(page);
      await captureCheckpoint(page, testInfo, viewport.name, 'search-palette');
      await page.keyboard.press('Escape');
      await expect(page.locator('.palette[role="dialog"]')).toHaveCount(0);

      await page.locator('.wing-new-btn').click();
      await expect(page.locator('.modal-card[role="dialog"]')).toBeVisible();
      await assertNoPageHorizontalOverflow(page);
      await assertVisibleSurfacesInsideViewport(page);
      await captureCheckpoint(page, testInfo, viewport.name, 'template-dialog');
      await page.keyboard.press('Escape');
      await expect(page.locator('.modal-card[role="dialog"]')).toHaveCount(0);

      await page.locator('.topbar-btn--export').click();
      await expect(page.locator('.modal-card[role="dialog"]')).toBeVisible();
      await assertNoPageHorizontalOverflow(page);
      await assertVisibleSurfacesInsideViewport(page);
      await captureCheckpoint(page, testInfo, viewport.name, 'export-dialog');
      await page.keyboard.press('Escape');
      await expect(page.locator('.modal-card[role="dialog"]')).toHaveCount(0);

      await page.locator('.topbar-btn--menu').click();
      await expect(page.locator('.file-drawer[role="dialog"]')).toBeVisible();
      await waitForSurfaceInsideViewport(page, '.file-drawer[role="dialog"]');
      await assertNoPageHorizontalOverflow(page);
      await assertVisibleSurfacesInsideViewport(page);
      await captureCheckpoint(page, testInfo, viewport.name, 'file-drawer');
      await page.keyboard.press('Escape');
      await expect(page.locator('.file-drawer[role="dialog"]')).toHaveCount(0);
    });
  }

  test('R2 switches are keyboard reachable and expose switch state', async ({ page }) => {
    await bootAt(page, VIEWPORTS[2]);

    await page.locator('.wing-settings-btn').click();
    const settingsDialog = page.locator('.modal-card[role="dialog"]');
    await expect(settingsDialog.locator('[role="switch"]')).toHaveCount(5);
    const firstSettingsSwitch = settingsDialog.getByRole('switch').first();
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
    const firstExportSwitch = exportSwitches.first();
    await firstExportSwitch.focus();
    await expect(firstExportSwitch).toBeFocused();
    const beforeExport = await firstExportSwitch.getAttribute('aria-checked');
    await page.keyboard.press('Enter');
    await expect(firstExportSwitch).not.toHaveAttribute('aria-checked', beforeExport ?? '');
    await page.keyboard.press('Escape');
    await expect(exportDialog).toHaveCount(0);
  });

  test('R3 dark theme keeps the editor and overlay surfaces measurable', async ({
    page,
  }, testInfo) => {
    await bootAt(page, VIEWPORTS[2]);

    const beforeScheme = await page.evaluate(() =>
      document.documentElement.getAttribute('data-color-scheme'),
    );
    if (beforeScheme !== 'dark') {
      await page.locator('.topbar-btn--theme').click();
    }
    await expect
      .poll(() => page.evaluate(() => document.documentElement.getAttribute('data-color-scheme')))
      .toBe('dark');

    await assertNoPageHorizontalOverflow(page);
    await captureCheckpoint(page, testInfo, 'desktop-1280', 'dark-theme-editor');

    await page.locator('.wing-settings-btn').click();
    await expect(page.locator('.modal-card[role="dialog"]')).toBeVisible();
    await assertVisibleSurfacesInsideViewport(page);
    await captureCheckpoint(page, testInfo, 'desktop-1280', 'dark-theme-settings');
  });
});
