import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import JSZip from 'jszip';
import { resetAppState, waitForAppReady } from '../helpers/test-utils';

test.describe('Theme Pack v1', () => {
  test.beforeEach(async ({ page }) => {
    await waitForAppReady(page);
    await resetAppState(page);
  });

  test('import, enable, persist, restore and uninstall a local theme pack', async ({
    page,
  }, testInfo) => {
    const themePath = await createLocalThemePack(testInfo.outputPath('local-theme.markluck-theme'));

    await page.locator('.wing-settings-btn').click();
    await expect(page.locator('.modal-card')).toBeVisible();
    await page.locator('.settings-nav').getByRole('button', { name: '主题' }).click();
    await expect(page.locator('.theme-market-panel')).toBeVisible();

    await page.locator('.theme-market-panel input[type="file"]').setInputFiles(themePath);

    await expect(page.locator('.theme-message')).toContainText('已安装并启用 Local Market');
    await expect(page.locator('.theme-pack-row').filter({ hasText: 'Local Market' })).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.getAttribute('data-theme-id')))
      .toBe('local.market');
    await expect
      .poll(() => page.evaluate(() => document.documentElement.getAttribute('data-layout-preset')))
      .toBe('focus');

    await page.reload();
    await waitForAppReady(page);
    await expect
      .poll(() => page.evaluate(() => document.documentElement.getAttribute('data-theme-id')))
      .toBe('local.market');

    await page.locator('.wing-settings-btn').click();
    await page.locator('.settings-nav').getByRole('button', { name: '主题' }).click();
    await page.locator('.theme-market-panel').getByRole('button', { name: '恢复 Paper' }).click();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.getAttribute('data-theme-id')))
      .toBe('paper');

    const localThemeRow = page.locator('.theme-pack-row').filter({ hasText: 'Local Market' });
    await localThemeRow.getByRole('button', { name: '启用' }).click();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.getAttribute('data-theme-id')))
      .toBe('local.market');
    await localThemeRow.getByRole('button', { name: '卸载' }).click();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.getAttribute('data-theme-id')))
      .toBe('paper');
    await expect(localThemeRow).toHaveCount(0);
  });
});

async function createLocalThemePack(path: string): Promise<string> {
  const css = `
[data-theme-id='local.market'] {
  --accent: oklch(0.55 0.13 145);
  --accent-soft: oklch(0.91 0.04 145 / 0.58);
  --theme-bg-image: url("./assets/paper.png");
  --theme-bg-opacity: 0.2;
  --editor-max-width: 720px;
}
`;
  const asset = new Uint8Array([137, 80, 78, 71, 13, 10]);
  const zip = new JSZip();
  zip.file('theme.css', css);
  zip.file('assets/paper.png', asset);
  zip.file(
    'manifest.json',
    JSON.stringify({
      id: 'local.market',
      version: '1.0.0',
      themeApi: 1,
      runtime: 'css-v1',
      minAppVersion: '0.15.0',
      name: 'Local Market',
      author: 'E2E',
      description: 'Local import test theme',
      capabilities: ['tokens', 'assets', 'layout-preset'],
      layoutPreset: 'focus',
      checksums: {
        'theme.css': checksum(css),
        'assets/paper.png': checksum(asset),
      },
    }),
  );
  const buffer = await zip.generateAsync({ type: 'nodebuffer' });
  await writeFile(path, buffer);
  return path;
}

function checksum(input: string | Uint8Array): string {
  return `sha256-${createHash('sha256').update(input).digest('base64')}`;
}
