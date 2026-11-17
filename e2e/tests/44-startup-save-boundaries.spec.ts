import { expect, test, type Page } from '@playwright/test';

const firstPath = '/第一篇.md';
const initialContent = '# 第一篇\n\n原始内容';
const externalPath = 'D:/外部文档/单篇.md';

async function openNotebook(page: Page, autoSaveEnabled = true): Promise<void> {
  await page.addInitScript(
    ({ path, content, autosave }) => {
      localStorage.setItem('jotluck:welcome:completed', '1');
      localStorage.setItem('jotluck:locale:v1', 'zh-CN');
      localStorage.setItem(
        'jotluck:editor-settings:v1',
        JSON.stringify({
          version: 1,
          settings: { autoSaveEnabled: autosave, autoSaveDelay: 500 },
        }),
      );
      window.__jotluck_e2e = {
        mockNotebook: {
          initialFiles: { [path]: content },
          recentRoots: ['D:/中文 笔记本'],
          pickerOutcome: 'cancel',
        },
      };
    },
    { path: firstPath, content: initialContent, autosave: autoSaveEnabled },
  );
  await page.goto('/');
  await expect(page.getByTestId('notebook-start')).toBeVisible();
}

async function openFirstNote(page: Page): Promise<void> {
  await page.getByTestId('notebook-start').getByRole('button', { name: '打开已有笔记' }).click();
  await page.locator('.file-drawer').getByText('第一篇.md', { exact: true }).click();
  await expect(page.locator('.cm-content')).toBeVisible();
}

async function replaceText(page: Page, text: string): Promise<void> {
  await page.locator('.cm-content').click();
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Backspace');
  if (text) await page.keyboard.type(text);
}

async function readNote(page: Page): Promise<string | undefined> {
  return page.evaluate((path) => window.__jotluck_e2e?.readNoteFile?.(path), firstPath);
}

// Exercise the actual desktop routing branch without forceGate. Only the native
// IPC boundary is stubbed; these cases do not claim native file-dialog coverage.
for (const recent of [null, '{broken-json', '["Z:/missing-notebook"]']) {
  test(`desktop startup requires a folder with recent cache ${recent ?? 'absent'}`, async ({
    page,
  }) => {
    await page.addInitScript((recentCache) => {
      localStorage.setItem('jotluck:welcome:completed', '1');
      localStorage.setItem('jotluck:locale:v1', 'zh-CN');
      if (recentCache !== null) localStorage.setItem('jotluck-recent-notebooks', recentCache);
      const host = window as unknown as {
        isTauri: boolean;
        __TAURI_INTERNALS__: Record<string, unknown>;
        __TAURI_EVENT_PLUGIN_INTERNALS__: Record<string, unknown>;
        startupPicker: { count: number; cancel: (() => void) | null };
      };
      host.isTauri = true;
      host.startupPicker = { count: 0, cancel: null };
      host.__TAURI_INTERNALS__ = {
        metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
        transformCallback: () => 1,
        unregisterCallback: () => undefined,
        invoke: async (command: string) => {
          if (command === 'get_window_bootstrap') return { mode: 'workspace', windowLabel: 'main' };
          if (command === 'plugin:event|listen') return 1;
          if (command === 'plugin:event|unlisten') return;
          if (command === 'plugin:dialog|open') {
            host.startupPicker.count++;
            return new Promise((resolve) => {
              host.startupPicker.cancel = () => resolve(null);
            });
          }
          throw { code: 'not_found', message: `Unavailable test command: ${command}` };
        },
      };
      host.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => undefined };
    }, recent);
    await page.goto('/');
    const gate = page.getByTestId('notebook-open-gate');
    await expect(gate).toBeVisible();
    await expect(page.locator('.cm-content')).toHaveCount(0);
    await expect(page.locator('.status-bar')).not.toContainText('已保存');
    if (recent?.includes('missing')) await expect(gate.getByRole('alert')).toBeVisible();

    await page.getByTestId('open-notebook-button').click();
    await expect(page.getByTestId('open-notebook-button')).toBeDisabled();
    await page.keyboard.press('Control+o');
    await page.keyboard.press('Control+o');
    expect(
      await page.evaluate(
        () => (window as unknown as { startupPicker: { count: number } }).startupPicker.count,
      ),
    ).toBe(1);
    await page.evaluate(() =>
      (window as unknown as { startupPicker: { cancel: () => void } }).startupPicker.cancel(),
    );
    await expect(page.getByTestId('open-notebook-button')).toBeEnabled();
    await expect(page.getByTestId('open-notebook-button')).toBeFocused();
    await expect(page.locator('.cm-content')).toHaveCount(0);
  });
}

test('a restored notebook keeps an honest empty selection through cancelled creation and save', async ({
  page,
}) => {
  await openNotebook(page);
  await expect(page.getByTestId('notebook-start')).toContainText('D:/中文 笔记本');
  await page.keyboard.press('Control+s');
  await expect(page.locator('.status-saved')).toHaveCount(0);
  await page.keyboard.press('Control+n');
  await expect(page.locator('.tpl-card.blank-card')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('notebook-start')).toBeVisible();
  await expect(page.locator('.cm-content')).toHaveCount(0);
  expect(await readNote(page)).toBe(initialContent);
  await openFirstNote(page);
  await expect(page.locator('.cm-content')).toContainText('原始内容');
});

for (const view of ['live', 'split']) {
  test(`manual save remains available with autosave disabled in ${view} mode`, async ({ page }) => {
    await openNotebook(page, false);
    await openFirstNote(page);
    if (view === 'split') {
      await page.locator('.shell-action--view-toggle').click();
      await expect(page.locator('.split-pane .cm-content')).toBeVisible();
    }
    const draft = '中文🙂\n\n未启用自动保存，也要能手动保存。';
    await replaceText(page, draft);
    await page.waitForTimeout(800);
    expect(await readNote(page)).toBe(initialContent);
    await expect(page.locator('.status-saved')).toHaveCount(0);
    await page.keyboard.press('Control+s');
    await page.keyboard.press('Control+s');
    await expect.poll(() => readNote(page)).toBe(draft);
    await expect(page.locator('.status-saved')).toBeVisible();
    // Empty and whitespace-only documents are valid file contents, not "no note".
    for (const content of ['', '  ', '\n\n']) {
      await replaceText(page, content);
      await page.keyboard.press('Control+s');
      await expect.poll(() => readNote(page)).toBe(content);
      await expect(page.locator('.cm-content')).toBeVisible();
    }
  });
}

test('a failed manual write preserves the draft and retry saves it to the same file', async ({
  page,
}) => {
  await openNotebook(page, false);
  await openFirstNote(page);
  const draft = '写入失败后必须保留的文字';
  await replaceText(page, draft);
  await page.evaluate(() => window.__jotluck_e2e?.failNextSave?.());
  await page.keyboard.press('Control+s');
  await expect(page.locator('.status-error')).toBeVisible();
  expect(await readNote(page)).toBe(initialContent);
  await expect(page.locator('.cm-content')).toContainText(draft);
  await page.getByRole('button', { name: '重新保存当前笔记', exact: true }).click();
  await expect.poll(() => readNote(page)).toBe(draft);
  await expect(page.locator('.status-saved')).toBeVisible();
  expect(await page.evaluate(() => window.__jotluck_e2e?.debugState?.().activePath)).toBe(
    firstPath,
  );
});

for (const diskChange of ['modify', 'delete']) {
  test(`external single-file ${diskChange} requires explicit recovery and preserves the local draft`, async ({
    page,
  }) => {
    await page.addInitScript((path) => {
      localStorage.setItem('jotluck:welcome:completed', '1');
      localStorage.setItem('jotluck:locale:v1', 'zh-CN');
      localStorage.setItem(
        'jotluck:editor-settings:v1',
        JSON.stringify({
          version: 1,
          settings: { autoSaveEnabled: false },
        }),
      );
      window.__jotluck_e2e = {
        mockOpenedFile: { absolutePath: path },
        externalFiles: { [path]: '# 外部原文件' },
      };
    }, externalPath);
    await page.goto('/');
    await page.getByRole('button', { name: '启用编辑', exact: true }).click();
    await expect(page.locator('.cm-content')).toBeVisible();
    const draft = '本地完整草稿🙂，不可被静默丢弃';
    await replaceText(page, draft);
    await page.evaluate(
      ({ path, change }) => {
        const files = window.__jotluck_e2e!.externalFiles!;
        if (change === 'delete') delete files[path];
        else files[path] = '# 外部新版本';
      },
      { path: externalPath, change: diskChange },
    );
    await page.keyboard.press('Control+s');
    const dialog = page.getByRole('dialog', {
      name: diskChange === 'delete' ? '原文件已被移动或删除' : '原文件和本地草稿不一样',
    });
    await expect(dialog).toBeVisible();
    expect(
      await page.evaluate((path) => window.__jotluck_e2e?.externalFiles?.[path], externalPath),
    ).toBe(diskChange === 'delete' ? undefined : '# 外部新版本');
    await dialog.getByRole('button', { name: '取消', exact: true }).click();
    await expect(page.locator('.cm-content')).toContainText(draft);
    await page.keyboard.press('Control+s');
    await dialog
      .getByRole('button', {
        name: diskChange === 'delete' ? '在原位置重建' : '覆盖原文件',
        exact: true,
      })
      .click();
    await expect(dialog).toHaveCount(0);
    expect(
      await page.evaluate((path) => window.__jotluck_e2e?.externalFiles?.[path], externalPath),
    ).toBe(draft);
    await expect(page.locator('.status-saved')).toBeVisible();
    await expect(page.getByTestId('notebook-open-gate')).toHaveCount(0);
  });
}
