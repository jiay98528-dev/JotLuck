import { test, expect } from '@playwright/test';
import {
  ensureEditorReady,
  getEditorContent,
  getEditorContentFromBridge,
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

async function replaceEditorTextByTyping(
  page: import('@playwright/test').Page,
  text: string,
): Promise<void> {
  await ensureEditorReady(page);
  const editor = page.locator('.cm-content');
  await editor.click();
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Backspace');
  await page.keyboard.type(text, { delay: 1 });
}

test.describe('offline autocomplete user journeys', () => {
  async function seedAsciiProbe(page: import('@playwright/test').Page): Promise<void> {
    await page.evaluate(() => {
      (window as any).__jotluck_e2e?.editor?.seedCompletionCorpus([
        'Alpha beta gamma delta. Alpha beta gamma delta. Alpha beta gamma delta.',
        '测试文本可以继续。测试文本可以继续。测试文本可以继续。',
      ]);
    });
  }

  function probeText(browserName: string): string {
    if (browserName !== 'firefox') return '测试文本';
    return browserName === 'firefox' ? '**bold' : '这是';
  }

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem(
        'jotluck:autocomplete:settings',
        JSON.stringify({
          enabled: true,
          aggressiveness: 'balanced',
          backgroundTraining: false,
          maxSuggestionLength: 12,
          minConfidence: 0.18,
          showDebugStats: false,
        }),
      );
      localStorage.setItem('jotluck:autocomplete:enabled', 'true');
    });
    await waitForAppReady(page);
    await ensureEditorReady(page);
    await stabilizeNotebookEditor(page);
    await seedAsciiProbe(page);
  });

  async function stabilizeNotebookEditor(page: import('@playwright/test').Page): Promise<void> {
    await expect
      .poll(() => page.evaluate(() => window.__jotluck_e2e?.listNotePaths?.().length ?? 0), {
        timeout: 10000,
      })
      .toBeGreaterThan(0);
    const targetPath = await page.evaluate(() => window.__jotluck_e2e?.listNotePaths?.()[0] ?? '');
    await page.evaluate((path) => window.__jotluck_e2e?.selectNote?.(path), targetPath);
    await expect
      .poll(() => page.evaluate(() => window.__jotluck_e2e?.debugState?.().activePath ?? ''), {
        timeout: 10000,
      })
      .toBe(targetPath);
  }

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
    await ensureEditorReady(page);
    await stabilizeNotebookEditor(page);
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

  test('settings clears local autocomplete learning data', async ({ page }) => {
    await page.evaluate(() => {
      localStorage.setItem('jotluck:ngram:v2', 'cached-model');
      localStorage.setItem('jotluck:ngram:short:v1', 'cached-short-model');
      localStorage.setItem('jotluck:ngram:meta', '{"schemaVersion":3,"docs":1}');
      localStorage.setItem('jotluck:autocomplete:acceptedLexicon:v1', '["转化成本"]');
      localStorage.setItem(
        'jotluck:autocomplete:trainingMeta',
        JSON.stringify({
          version: 2,
          status: 'done',
          trainedPaths: { 'note.md': { mtime: 1, size: 1 } },
          fileCount: 1,
          updatedAt: Date.now(),
          successCount: 1,
          failureCount: 0,
          failedPaths: {},
        }),
      );
    });

    await page.locator('.wing-settings-btn').click();
    await expect(page.locator('.modal-overlay')).toBeVisible({ timeout: 3000 });
    await page.getByRole('button', { name: '文字补全' }).click();
    await page.getByRole('button', { name: '清空本地学习数据' }).click();

    await expect(page.locator('.toast', { hasText: '已清空文字补全的本地学习数据' })).toBeVisible({
      timeout: 3000,
    });
    await expect
      .poll(() =>
        page.evaluate(() => ({
          l2: localStorage.getItem('jotluck:ngram:v2'),
          short: localStorage.getItem('jotluck:ngram:short:v1'),
          meta: localStorage.getItem('jotluck:ngram:meta'),
          lexicon: localStorage.getItem('jotluck:autocomplete:acceptedLexicon:v1'),
          training: Object.keys(localStorage)
            .filter((key) => key.endsWith(':autocomplete:trainingMeta'))
            .map((key) => JSON.parse(localStorage.getItem(key) ?? '{}') as unknown),
        })),
      )
      .toMatchObject({
        l2: null,
        short: null,
        meta: null,
        lexicon: null,
        training: [{ status: 'idle', fileCount: 0 }],
      });
  });

  test('sequence pattern ghost infers the next formatted line', async ({ page }) => {
    const seed = '第一条、第一天\n第二条、第二天\n';
    await replaceEditorText(page, seed);

    await expect
      .poll(() =>
        page.evaluate(() => (window as any).__jotluck_e2e?.editor?.getPrediction?.()?.text ?? ''),
      )
      .toBe('第三条、第三天');

    const ghost = page.locator('.cm-ghost-text');
    await expect(ghost).toBeVisible({ timeout: 3000 });
    await expect(ghost).toHaveText('第三条、第三天');

    await page.keyboard.press('Tab');
    await expect.poll(() => getEditorContentFromBridge(page)).toContain(`${seed}第三条、第三天`);
  });

  test('V2 uses the real Web Worker notebook retrieval path', async ({ page }) => {
    await page.evaluate(() => {
      (window as any).__jotluck_e2e?.editor?.seedCompletionCorpus(['海王星回声需要冻结缓存。']);
    });
    await replaceEditorText(page, '海王星回声');

    await expect(page.locator('.cm-ghost-text')).toBeVisible({ timeout: 3000 });
    await expect
      .poll(() =>
        page.evaluate(() => (window as any).__jotluck_e2e?.editor?.getPrediction?.() ?? null),
      )
      .toMatchObject({
        text: '需要冻结缓存。',
        providerId: 'hybrid-retrieval-zh',
        sourceLayer: 'notebook',
      });
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
    await expect(page.locator('.modal-overlay')).not.toBeVisible({ timeout: 3000 });
    await page.reload();
    await waitForAppReady(page);
    await ensureEditorReady(page);

    const editorProbe =
      'Release risk is configuration drift.\n' +
      'Release risk is configuration drift.\n' +
      'Release risk is configuration';
    await replaceEditorTextByTyping(page, editorProbe);
    await page.locator('.cm-content').click();
    await expect(page.locator('.cm-ghost-text')).toBeVisible({ timeout: 3000 });
    const suggestion = (await page.locator('.cm-ghost-text').textContent()) ?? '';
    // WebKit routes locator.press('Tab') through an element-level synthetic path
    // that can bypass CodeMirror's contenteditable keydown flow. After an
    // explicit editor click, page.keyboard.press mirrors the real user gesture.
    await page.keyboard.press('Tab');
    await expect
      .poll(() => getEditorContentFromBridge(page))
      .toContain(`${editorProbe}${suggestion}`);
  });

  test('blur and Shift+Tab clear ghost text without changing the document', async ({
    page,
    browserName,
  }) => {
    const probe = probeText(browserName);
    await replaceEditorText(page, probe);
    await expect(page.locator('.cm-ghost-text')).toBeVisible({ timeout: 3000 });

    // Programmatic focus reproduces the non-pointer blur path that previously
    // accepted the visible suggestion without an explicit Tab gesture.
    await page.locator('.wing-settings-btn').focus();
    await expect(page.locator('.cm-ghost-text')).not.toBeVisible({ timeout: 1000 });
    await expect.poll(() => getEditorContentFromBridge(page)).toBe(probe);

    await replaceEditorText(page, probe);
    await expect(page.locator('.cm-ghost-text')).toBeVisible({ timeout: 3000 });
    await page.keyboard.press('Shift+Tab');
    await expect.poll(() => getEditorContentFromBridge(page)).toBe(probe);
  });

  test('keyed note switches never revive the ineligible legacy baseline', async ({ page }) => {
    await page.addInitScript(() => {
      const originalFetch = window.fetch.bind(window);
      (window as any).__baselineFetchCount = 0;
      window.fetch = async (...args) => {
        const url = String(args[0] instanceof Request ? args[0].url : args[0]);
        // An ineligible manifest is rejected before its model body is fetched.
        // Count either manifest validation or body loading as a baseline attempt.
        if (/baseline-ngram\..*\.compact\.(?:manifest\.json|txt)(?:\?|$)/.test(url)) {
          (window as any).__baselineFetchCount += 1;
        }
        return originalFetch(...args);
      };
    });
    await page.reload();
    await waitForAppReady(page);
    await ensureEditorReady(page);

    await expect
      .poll(() => page.evaluate(() => (window as any).__baselineFetchCount as number))
      .toBe(0);
    const initialCount = await page.evaluate(() => (window as any).__baselineFetchCount as number);
    const notePaths = await page.evaluate(() => window.__jotluck_e2e?.listNotePaths?.() ?? []);
    expect(notePaths.length).toBeGreaterThanOrEqual(2);

    for (let i = 0; i < 20; i++) {
      await page.evaluate(
        (path) => window.__jotluck_e2e?.selectNote?.(path),
        notePaths[i % Math.min(2, notePaths.length)],
      );
      await expect(page.locator('.cm-content').first()).toBeVisible({ timeout: 3000 });
    }

    await expect
      .poll(() => page.evaluate(() => (window as any).__baselineFetchCount as number))
      .toBe(0);
    expect(initialCount).toBe(0);
  });
});
