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

  test('preview drawer gates official themes and local imports stay css-only', async ({
    page,
  }, testInfo) => {
    const themePath = await createLocalThemePack(testInfo.outputPath('local-theme.markluck-theme'));

    await page.locator('.wing-settings-btn').click();
    await expect(page.locator('.modal-card')).toBeVisible();
    await page.locator('.settings-nav').getByRole('button', { name: '主题' }).click();
    const themePanel = page.locator('.modal-card .theme-market-panel');
    await expect(themePanel).toBeVisible();

    await expect(themePanel.getByRole('button', { name: /羽翼布局/ })).toBeVisible();
    const inkStudyCard = themePanel.getByRole('button', { name: /墨线书房/ });
    await expect(inkStudyCard).toBeVisible();

    await inkStudyCard.click();
    await expect(page.locator('.theme-drawer')).toBeVisible();
    await expect(page.locator('.theme-drawer')).toContainText('性能压力 3/5');
    await expect
      .poll(() => page.evaluate(() => document.documentElement.getAttribute('data-theme-id')))
      .toBe('paper');

    await page.locator('.theme-drawer').getByRole('button', { name: '启用主题' }).click();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.getAttribute('data-theme-id')))
      .toBe('markluck.ink-study');
    await expect
      .poll(() => page.evaluate(() => document.documentElement.getAttribute('data-layout-preset')))
      .toBe('focus');
    await expect
      .poll(() => page.evaluate(() => document.documentElement.getAttribute('data-theme-role')))
      .toBe('collectible');
    await expect
      .poll(() => page.evaluate(() => document.documentElement.getAttribute('data-effect-profile')))
      .toBe('ambient');
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.getAttribute('data-workspace-intent')),
      )
      .toBe('writing');
    await expect
      .poll(() => page.evaluate(() => document.documentElement.getAttribute('data-topbar-layout')))
      .toBe('title-first');
    await expect(page.locator('.app-shell[data-left-wing-layout="quiet-bookmarks"]')).toBeVisible();
    await expect(
      page.locator('.app-shell[data-editor-control-layout="writing-strip"]'),
    ).toBeVisible();
    await expect(page.locator('.topbar[data-layout="title-first"]')).toBeVisible();
    await expect(page.locator('.theme-effect-layer[data-effect-profile="ambient"]')).toBeVisible();

    await page.reload();
    await waitForAppReady(page);
    await expect
      .poll(() => page.evaluate(() => document.documentElement.getAttribute('data-theme-id')))
      .toBe('markluck.ink-study');

    await page.locator('.wing-settings-btn').click();
    await page.locator('.settings-nav').getByRole('button', { name: '主题' }).click();
    await themePanel.getByRole('button', { name: '恢复默认主题' }).click();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.getAttribute('data-theme-id')))
      .toBe('paper');

    await themePanel.locator('input[type="file"]').setInputFiles(themePath);

    await expect(page.locator('.theme-message')).toContainText('已安装并启用 Local Market');
    await expect(themePanel.getByRole('button', { name: /Local Market/ })).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.getAttribute('data-theme-id')))
      .toBe('local.market');
    await expect
      .poll(() => page.evaluate(() => document.documentElement.getAttribute('data-layout-preset')))
      .toBe('winged');
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.getAttribute('data-workspace-intent')),
      )
      .toBe('baseline');
    await expect
      .poll(() => page.evaluate(() => document.documentElement.getAttribute('data-topbar-layout')))
      .toBe('classic');
    await expect
      .poll(() => page.evaluate(() => document.documentElement.hasAttribute('data-theme-role')))
      .toBe(false);
    await expect
      .poll(() => page.evaluate(() => document.documentElement.hasAttribute('data-effect-profile')))
      .toBe(false);
    await expect(page.locator('.app-shell[data-chrome-official="false"]')).toBeVisible();
    await expect(page.locator('.app-shell[data-workspace-intent="baseline"]')).toBeVisible();
    await expect(page.locator('.studio-rail')).toHaveCount(0);
    await expect(page.locator('.reader-workbench')).toHaveCount(0);
    await expect(page.locator('.theme-effect-layer')).toHaveCount(0);

    await page.reload();
    await waitForAppReady(page);
    await expect
      .poll(() => page.evaluate(() => document.documentElement.getAttribute('data-theme-id')))
      .toBe('local.market');

    await page.locator('.wing-settings-btn').click();
    await page.locator('.settings-nav').getByRole('button', { name: '主题' }).click();
    await themePanel.getByRole('button', { name: '恢复默认主题' }).click();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.getAttribute('data-theme-id')))
      .toBe('paper');

    const localThemeCard = themePanel.getByRole('button', { name: /Local Market/ });
    await localThemeCard.click();
    await page.locator('.theme-drawer').getByRole('button', { name: '启用主题' }).click();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.getAttribute('data-theme-id')))
      .toBe('local.market');
    await page.locator('.theme-drawer').getByRole('button', { name: '关闭主题预览' }).click();

    await themePanel.locator('.theme-pack-btn--danger', { hasText: '卸载' }).click();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.getAttribute('data-theme-id')))
      .toBe('paper');
    await expect(localThemeCard).toHaveCount(0);
  });

  test('official themes drive workflow chrome, action placements, and reduced-motion safe effects', async ({
    page,
  }) => {
    await page.locator('.wing-new-btn').click();
    await expect(page.locator('.tpl-card.blank-card')).toBeVisible({ timeout: 5000 });
    await page.locator('.tpl-card.blank-card').click();
    await expect(page.locator('.editor-control-strip')).toBeVisible({ timeout: 10000 });

    const cases = [
      {
        name: '羽翼布局',
        id: 'paper',
        workspace: 'baseline',
        viewMode: 'live',
        topbarLayout: 'classic',
        leftLayout: 'bookmarks',
        editorLayout: 'toolbar',
        statusLayout: 'full',
        rightPolicy: 'outline',
        firstSection: 'outline',
        effect: 'none',
        assert: async () => {
          await expect(page.locator('.topbar-right .shell-action--search')).toBeVisible();
          await expect(page.locator('.editor-control-strip[data-layout="toolbar"]')).toBeVisible();
          await expect(page.locator('.studio-rail')).toHaveCount(0);
          await expect(page.locator('.reader-workbench')).toHaveCount(0);
        },
      },
      {
        name: '墨线书房',
        id: 'markluck.ink-study',
        workspace: 'writing',
        viewMode: 'live',
        topbarLayout: 'title-first',
        leftLayout: 'quiet-bookmarks',
        editorLayout: 'writing-strip',
        statusLayout: 'quiet',
        rightPolicy: 'collapsed',
        firstSection: null,
        effect: 'ambient',
        assert: async () => {
          await expect(page.locator('.topbar[data-layout="title-first"]')).toBeVisible();
          await expect(
            page.locator('.editor-control-strip[data-layout="writing-strip"]'),
          ).toBeVisible();
          await expect(page.locator('.topbar-right .shell-action--search')).toBeVisible();
          await expect(page.locator('.topbar-right .shell-action--export')).toBeVisible();
          await expect(page.locator('.right-wing')).toHaveCount(0);
        },
      },
      {
        name: '档案馆',
        id: 'markluck.archive',
        workspace: 'archive',
        viewMode: 'split',
        topbarLayout: 'search-first',
        leftLayout: 'research-stack',
        editorLayout: 'toolbar',
        statusLayout: 'full',
        rightPolicy: 'research',
        firstSection: 'backlinks',
        effect: 'subtle',
        assert: async () => {
          await expect(page.locator('.topbar-command-zone .shell-action--search')).toBeVisible();
          await expect(page.locator('.split-pane')).toBeVisible();
          await expect(page.locator('.right-wing[data-policy="research"]')).toBeVisible();
          await expect(page.locator('.right-wing .wing-section').first()).toHaveAttribute(
            'data-section',
            'backlinks',
          );
        },
      },
      {
        name: '夜读星幕',
        id: 'markluck.reader-nocturne',
        workspace: 'reader',
        viewMode: 'read',
        topbarLayout: 'reader',
        leftLayout: 'quiet-bookmarks',
        editorLayout: 'hidden',
        statusLayout: 'save-only',
        rightPolicy: 'collapsed',
        firstSection: null,
        effect: 'immersive',
        assert: async () => {
          await expect(page.locator('.reader-workbench[data-view-mode="read"]')).toBeVisible();
          await expect(page.locator('.reader-workbench .view-mode-toggle')).toBeVisible();
          await expect(page.locator('.editor-control-strip')).toHaveCount(0);
          await expect(page.locator('.right-wing')).toHaveCount(0);
          await expect(page.locator('.status-bar[data-layout="save-only"]')).toBeVisible();
        },
      },
      {
        name: '工坊轨道',
        id: 'markluck.studio',
        workspace: 'studio',
        viewMode: 'split',
        topbarLayout: 'compact',
        leftLayout: 'studio-rail',
        editorLayout: 'studio-rail',
        statusLayout: 'compact',
        rightPolicy: 'production',
        firstSection: 'outline',
        effect: 'subtle',
        assert: async () => {
          await expect(page.locator('.studio-rail')).toBeVisible();
          await expect(page.locator('.studio-rail .shell-action--template')).toBeVisible();
          await expect(page.locator('.studio-rail .shell-action--export')).toBeVisible();
          await expect(page.locator('.studio-rail .shell-action--share')).toBeVisible();
          await expect(page.locator('.right-wing[data-policy="production"]')).toBeVisible();
          await expect(page.locator('.split-pane')).toBeVisible();
        },
      },
    ];

    for (const item of cases) {
      await page.locator('.wing-settings-btn').click();
      await expect(page.locator('.modal-card')).toBeVisible();
      await page.locator('.settings-nav').getByRole('button', { name: '主题' }).click();
      const themePanel = page.locator('.modal-card .theme-market-panel');

      await themePanel.getByRole('button', { name: new RegExp(item.name) }).click();
      await expect(page.locator('.theme-drawer')).toBeVisible();
      const applyButton = page.locator('.theme-drawer').getByRole('button', {
        name: /启用主题|已启用/,
      });
      if (await applyButton.isEnabled()) {
        await applyButton.click();
      }

      await expect
        .poll(() => page.evaluate(() => document.documentElement.getAttribute('data-theme-id')))
        .toBe(item.id);
      await expect
        .poll(() =>
          page.evaluate(() => document.documentElement.getAttribute('data-workspace-intent')),
        )
        .toBe(item.workspace);
      await expect
        .poll(() =>
          page.evaluate(() => document.documentElement.getAttribute('data-default-view-mode')),
        )
        .toBe(item.viewMode);
      await expect
        .poll(() =>
          page.evaluate(() => document.documentElement.getAttribute('data-topbar-layout')),
        )
        .toBe(item.topbarLayout);
      await expect(
        page.locator(`.app-shell[data-workspace-intent="${item.workspace}"]`),
      ).toBeVisible();
      await expect(
        page.locator(`.app-shell[data-topbar-layout="${item.topbarLayout}"]`),
      ).toBeVisible();
      await expect(
        page.locator(`.app-shell[data-left-wing-layout="${item.leftLayout}"]`),
      ).toBeVisible();
      await expect(
        page.locator(`.app-shell[data-editor-control-layout="${item.editorLayout}"]`),
      ).toBeVisible();
      await expect(
        page.locator(`.app-shell[data-status-layout="${item.statusLayout}"]`),
      ).toBeVisible();
      await expect(
        page.locator(`.app-shell[data-right-wing-policy="${item.rightPolicy}"]`),
      ).toBeVisible();
      await expect(page.locator(`.topbar[data-layout="${item.topbarLayout}"]`)).toBeVisible();
      if (item.firstSection) {
        await expect(page.locator('.right-wing .wing-section').first()).toHaveAttribute(
          'data-section',
          item.firstSection,
        );
      }

      await page.locator('.theme-drawer').getByRole('button', { name: '关闭主题预览' }).click();
      await page.locator('.modal-card .modal-close').click();
      await expect(page.locator('.modal-card')).toHaveCount(0);

      await item.assert();

      if (item.id === 'markluck.reader-nocturne') {
        await page.locator('.reader-workbench .view-mode-toggle').click();
        await expect(page.locator('.split-pane')).toBeVisible();
      }
      if (item.id === 'markluck.studio') {
        await page.locator('.studio-rail .shell-action--template').click();
        await expect(page.locator('.modal-card')).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(page.locator('.modal-card')).toHaveCount(0);

        await page.locator('.studio-rail .shell-action--export').click();
        await expect(page.locator('.modal-card')).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(page.locator('.modal-card')).toHaveCount(0);

        await page.locator('.studio-rail .shell-action--share').click();
        await expect(page.locator('.modal-card')).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(page.locator('.modal-card')).toHaveCount(0);
      }

      if (item.effect === 'none') {
        await expect(page.locator('.theme-effect-layer')).toHaveCount(0);
      } else {
        await expect(
          page.locator(`.theme-effect-layer[data-effect-profile="${item.effect}"]`),
        ).toBeVisible();
      }
    }

    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.locator('.wing-settings-btn').click();
    await expect(page.locator('.modal-card')).toBeVisible();
    await page.locator('.settings-nav').getByRole('button', { name: '主题' }).click();
    const themePanel = page.locator('.modal-card .theme-market-panel');
    await themePanel.getByRole('button', { name: /夜读星幕/ }).click();
    await page
      .locator('.theme-drawer')
      .getByRole('button', { name: /启用主题|已启用/ })
      .click();
    await expect(
      page.locator('.theme-effect-layer[data-effect-profile="immersive"]'),
    ).toBeVisible();
    await expect
      .poll(() =>
        page
          .locator('.theme-effect-layer__pulse')
          .evaluate((node) => getComputedStyle(node).animationName),
      )
      .toBe('none');
  });
});

async function createLocalThemePack(path: string): Promise<string> {
  const css = `
[data-theme-id='local.market'] {
  --accent: oklch(0.55 0.13 145);
  --accent-soft: oklch(0.91 0.04 145 / 0.58);
  --theme-bg-image: url("./assets/paper.png");
  --theme-bg-opacity: 0.2;
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
