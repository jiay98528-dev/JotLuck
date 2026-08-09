import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import {
  ensureEditorReady,
  getEditorContent,
  typeInEditor,
  waitForAppReady,
  waitForAutoSave,
  waitForCleanAppReady,
} from '../helpers/test-utils';

const localeMatrix = [
  { code: 'zh-CN', title: '设置' },
  { code: 'en', title: 'Settings' },
  { code: 'ja', title: '設定' },
  { code: 'ko', title: '설정' },
  { code: 'fr', title: 'Réglages' },
] as const;

async function openSettings(page: Page): Promise<void> {
  await page.locator('.wing-settings-btn').click();
  await expect(page.locator('#settings-dialog-title')).toBeVisible();
}

async function switchLocale(page: Page, locale: string): Promise<void> {
  await openSettings(page);
  const selector = page.locator('#settings-language');
  await selector.focus();
  await selector.selectOption(locale);
  await expect(page.locator('html')).toHaveAttribute('data-locale', locale);
  await expect(selector).toBeFocused();
}

async function completionStorage(page: Page): Promise<Record<string, string | null>> {
  return page.evaluate(() => {
    const entries: Array<[string, string | null]> = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (
        key &&
        (key.startsWith('jotluck:autocomplete') ||
          key.startsWith('jotluck:ngram') ||
          key.startsWith('jotluck:completion') ||
          key.startsWith('jotluck:scope:'))
      ) {
        entries.push([key, localStorage.getItem(key)]);
      }
    }
    return Object.fromEntries(entries.sort(([left], [right]) => left.localeCompare(right)));
  });
}

async function completionSnapshot(page: Page): Promise<unknown> {
  return page.evaluate(async () => {
    const diagnostics = await window.__jotluck_e2e?.editor?.requestCompletionDiagnostics(
      '**bold',
      '**bold'.length,
      1000,
    );
    if (!diagnostics) throw new Error('Completion diagnostics bridge is unavailable.');
    return {
      result: diagnostics.result,
      rankedCandidates: diagnostics.rankedCandidates,
      ranker: diagnostics.ranker,
      publicEngine: {
        attempted: diagnostics.publicEngine.attempted,
        fellBack: diagnostics.publicEngine.fellBack,
        usedEngineId: diagnostics.publicEngine.usedEngineId,
        candidates: diagnostics.publicEngine.candidates,
      },
      resolverTrace: diagnostics.resolverTrace,
      baselineModel: diagnostics.baselineModel,
    };
  });
}

test.describe('five-language localization', () => {
  for (const locale of localeMatrix) {
    test(`${locale.code} switches immediately and persists without disturbing the editor`, async ({
      page,
    }) => {
      await waitForCleanAppReady(page);
      await ensureEditorReady(page);
      const before = await page.evaluate(() => window.__jotluck_e2e?.debugState?.());

      await switchLocale(page, locale.code);
      const selector = page.locator('#settings-language');
      await expect(page.locator('#settings-dialog-title')).toHaveText(locale.title);
      await expect(page.locator('#app')).toHaveAttribute('lang', locale.code);
      await expect(page.locator('#app')).toHaveAttribute('dir', 'ltr');
      await page.waitForTimeout(250);
      // WebKit 原生 <select>（menulist）按当前选中项字体度量决定固有高度，
      // min-height: 44px 不能把它钳到整数边界：实测 en=43.9991、fr=43.9958，
      // 而 zh/ja/ko 的 CJK 字体恰好 ≥44。这是引擎亚像素渲染偏差而非契约失守
      // （--touch-target-min 恒为 44px），故容差 0.5px；真正的塌陷（padding/
      // border 丢失）会差出数像素，仍会被拦截。
      expect(
        await selector.evaluate((element) => element.getBoundingClientRect().height),
      ).toBeGreaterThanOrEqual(43.5);
      expect(await page.evaluate(() => localStorage.getItem('jotluck:locale:v1'))).toBe(
        locale.code,
      );
      expect(await page.evaluate(() => window.__jotluck_e2e?.debugState?.())).toMatchObject({
        activePath: before?.activePath,
        currentContent: before?.currentContent,
        isDirty: before?.isDirty,
      });

      await page.locator('.modal-close').click();
      await page.reload({ waitUntil: 'domcontentloaded' });
      await waitForAppReady(page);
      await expect(page.locator('html')).toHaveAttribute('data-locale', locale.code);
      expect(await page.evaluate(() => localStorage.getItem('jotluck:locale:v1'))).toBe(
        locale.code,
      );
    });
  }

  test('language switching leaves completion settings, providers, candidates and ranking unchanged', async ({
    page,
  }) => {
    await waitForCleanAppReady(page);
    await ensureEditorReady(page);
    await page.evaluate(() => {
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
      localStorage.setItem(
        'jotluck:scope:unscoped:autocomplete:acceptedLexicon:v1',
        '["continuation"]',
      );
      window.__jotluck_e2e?.editor?.seedCompletionCorpus([
        'Alpha beta gamma delta. Alpha beta gamma delta. Alpha beta gamma delta.',
      ]);
    });
    await openSettings(page);
    const editorBefore = await page.evaluate(() => window.__jotluck_e2e?.debugState?.());
    const diagnosticsBefore = await completionSnapshot(page);
    const storageBefore = await completionStorage(page);

    const selector = page.locator('#settings-language');
    await selector.focus();
    await selector.selectOption('fr');
    await expect(page.locator('html')).toHaveAttribute('data-locale', 'fr');

    expect(await completionStorage(page)).toEqual(storageBefore);
    expect(await page.evaluate(() => window.__jotluck_e2e?.debugState?.())).toMatchObject({
      activePath: editorBefore?.activePath,
      currentContent: editorBefore?.currentContent,
    });
    expect(await completionSnapshot(page)).toEqual(diagnosticsBefore);
    await page.locator('.modal-close').click();
  });

  test('English new-note, edit, save, search and TXT export journey preserves Markdown', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await waitForCleanAppReady(page);
    await ensureEditorReady(page);
    await switchLocale(page, 'en');
    await page.locator('.modal-close').click();

    await page.locator('.wing-new-btn').click();
    await expect(page.locator('.tpl-card.blank-card')).toBeVisible();
    await page.locator('.tpl-card.blank-card').click();
    const markdown = '# Locale journey\n\nA uniquely findable localized export sentence.';
    await typeInEditor(page, markdown);
    await waitForAutoSave(page);

    await page.keyboard.press('Control+k');
    const search = page.locator('.search-input');
    await expect(search).toBeVisible();
    await search.fill('uniquely findable');
    await expect(page.locator('.result-item').first()).toBeVisible({ timeout: 10000 });
    await page.locator('.result-item').first().click();
    expect(await getEditorContent(page)).toContain(
      'A uniquely findable localized export sentence.',
    );

    await page.locator('.topbar-btn--export').click();
    await expect(page.locator('#export-dialog-title')).toHaveText('Export note');
    await page.locator('.format-card', { hasText: 'TXT' }).click();
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export', exact: true }).click();
    const download = await downloadPromise;
    const downloadPath = await download.path();
    expect(download.suggestedFilename()).toMatch(/\.txt$/u);
    expect(downloadPath).toBeTruthy();
    const exported = await readFile(downloadPath!, 'utf8');
    expect(exported).toContain('Locale journey');
    expect(exported).toContain('A uniquely findable localized export sentence.');
  });
});
