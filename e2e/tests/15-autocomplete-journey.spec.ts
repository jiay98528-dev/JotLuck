import { test, expect } from '@playwright/test';
import {
  ensureEditorReady,
  getEditorContent,
  waitForAppReady,
  waitForAutoSave,
} from '../helpers/test-utils';

async function replaceEditorText(
  page: import('@playwright/test').Page,
  text: string,
): Promise<void> {
  await ensureEditorReady(page);
  const editor = page.locator('.cm-content');
  await editor.click();
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Backspace');
  await page.keyboard.insertText(text);
}

test.describe('offline autocomplete user journeys', () => {
  async function seedAsciiProbe(page: import('@playwright/test').Page): Promise<void> {
    await page.evaluate(() => {
      window.__markluck_predictor?.ingestExcerpts([
        'Alpha beta gamma delta. Alpha beta gamma delta. Alpha beta gamma delta.',
      ]);
    });
  }

  function probeText(browserName: string): string {
    return browserName === 'firefox' ? '**bold' : '这是';
  }

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem(
        'markluck:autocomplete:settings',
        JSON.stringify({
          enabled: true,
          aggressiveness: 'balanced',
          backgroundTraining: true,
          maxSuggestionLength: 12,
          minConfidence: 0.18,
          showDebugStats: false,
        }),
      );
      localStorage.setItem('markluck:autocomplete:enabled', 'true');
    });
    await waitForAppReady(page);
    await ensureEditorReady(page);
    await seedAsciiProbe(page);
  });

  test('Chinese ghost text can be accepted and remains available after reload', async ({
    page,
    browserName,
  }) => {
    const probe = probeText(browserName);
    await replaceEditorText(page, probe);
    const ghost = page.locator('.cm-ghost-text');
    await expect(ghost).toBeVisible({ timeout: 3000 });
    const suggestion = (await ghost.textContent()) ?? '';
    expect(suggestion.length).toBeGreaterThan(0);

    await page.keyboard.press('Tab');
    await expect.poll(() => getEditorContent(page)).toContain(`${probe}${suggestion}`);
    await waitForAutoSave(page);

    await page.reload();
    await waitForAppReady(page);
    await seedAsciiProbe(page);
    await replaceEditorText(page, probe);
    await expect(page.locator('.cm-ghost-text')).toBeVisible({ timeout: 3000 });
  });

  test('settings toggle disables current editor ghost text immediately', async ({
    page,
    browserName,
  }) => {
    const probe = probeText(browserName);
    await replaceEditorText(page, probe);
    await expect(page.locator('.cm-ghost-text')).toBeVisible({ timeout: 3000 });

    await page.locator('.wing-settings-btn').click();
    await expect(page.locator('.modal-overlay')).toBeVisible({ timeout: 3000 });
    await page.getByRole('button', { name: '文字补全' }).click();
    await expect(page.locator('.section:visible .section-title')).toHaveText('文字补全');
    const completionSwitch = page.getByRole('switch', { name: '启用幽灵文本补全' });
    await expect(completionSwitch).toHaveAttribute('aria-checked', 'true');
    await completionSwitch.focus();
    await page.keyboard.press('Space');
    await expect(completionSwitch).toHaveAttribute('aria-checked', 'false');
    await page.keyboard.press('Enter');
    await expect(completionSwitch).toHaveAttribute('aria-checked', 'true');
    await page.keyboard.press('Space');
    await expect(completionSwitch).toHaveAttribute('aria-checked', 'false');
    await page.keyboard.press('Escape');

    await replaceEditorText(page, probe);
    await expect(page.locator('.cm-ghost-text')).not.toBeVisible({ timeout: 1000 });
  });

  test('Tab keeps native focus navigation outside editor and accepts ghost text inside editor', async ({
    page,
    browserName,
  }) => {
    const probe = probeText(browserName);
    await replaceEditorText(page, probe);
    const ghost = page.locator('.cm-ghost-text');
    await expect(ghost).toBeVisible({ timeout: 3000 });

    await page.locator('.wing-settings-btn').click();
    await expect(page.locator('.modal-overlay')).toBeVisible({ timeout: 3000 });
    await page.getByRole('button', { name: '文字补全' }).click();
    const switchControl = page.getByRole('switch').first();
    await switchControl.focus();
    await expect(switchControl).toBeFocused();

    await page.keyboard.press('Tab');
    const editorCapturedTab = await page.evaluate(() => {
      const active = document.activeElement;
      return active instanceof Element && !!active.closest('.cm-content');
    });
    expect(editorCapturedTab).toBe(false);

    await page.keyboard.press('Escape');
    await replaceEditorText(page, probe);
    await page.locator('.cm-content').click();
    await expect(page.locator('.cm-ghost-text')).toBeVisible({ timeout: 3000 });
    const suggestion = (await page.locator('.cm-ghost-text').textContent()) ?? '';
    await page.locator('.cm-content').press('Tab');
    await expect.poll(() => getEditorContent(page)).toContain(`${probe}${suggestion}`);
  });
});
