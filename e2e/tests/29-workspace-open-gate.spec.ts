import { expect, test, type Page } from '@playwright/test';

type MockNotebookConfig = NonNullable<Window['__jotluck_e2e']>['mockNotebook'];

async function openWithMockNotebook(page: Page, config: MockNotebookConfig): Promise<void> {
  await page.addInitScript((mockNotebook) => {
    localStorage.setItem('jotluck:welcome:completed', '1');
    localStorage.setItem('jotluck:locale:v1', 'zh-CN');
    window.__jotluck_e2e = { mockNotebook };
  }, config);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
}

async function selectFirstNote(page: Page): Promise<string> {
  await expect
    .poll(() => page.evaluate(() => window.__jotluck_e2e?.listNotePaths?.().length ?? 0))
    .toBeGreaterThan(0);
  const path = await page.evaluate(() => window.__jotluck_e2e?.listNotePaths?.()[0] ?? '');
  await page.evaluate((notePath) => window.__jotluck_e2e?.selectNote?.(notePath), path);
  await expect
    .poll(() => page.evaluate(() => window.__jotluck_e2e?.debugState?.().activePath))
    .toBe(path);
  return path;
}

test.describe('workspace open gate', () => {
  test('fresh start exposes one focused picker action and no writable editor', async ({ page }) => {
    await openWithMockNotebook(page, {
      forceGate: true,
      recentRoots: [],
      pickerOutcome: 'cancel',
    });

    const gate = page.getByTestId('notebook-open-gate');
    const openButton = page.getByTestId('open-notebook-button');
    await expect(gate).toBeVisible();
    await expect(openButton).toBeFocused();
    await expect(page.locator('.cm-content')).toHaveCount(0);
    await expect(page.getByRole('button', { name: '新建笔记' }).first()).toBeDisabled();
    await expect(page.getByRole('button', { name: /搜索 Ctrl\+K/ }).first()).toBeDisabled();

    await openButton.click();
    await expect(gate).toBeVisible();
    await expect(gate.locator('[role="alert"]')).toHaveCount(0);
    await expect(openButton).toBeFocused();
  });

  test('picker errors remain inline and retryable', async ({ page }) => {
    await openWithMockNotebook(page, {
      forceGate: true,
      recentRoots: [],
      pickerOutcome: 'error',
      pickerError: '该文件夹不可读',
    });

    await page.getByTestId('open-notebook-button').click();
    const alert = page.getByTestId('notebook-open-gate').getByRole('alert');
    await expect(alert).toContainText('没有访问权限');
    await expect(alert).not.toContainText('该文件夹不可读');
    await expect(page.getByTestId('open-notebook-button')).toBeEnabled();
  });

  test('a selected Unicode root commits the workspace and rebuilds the shell', async ({ page }) => {
    await openWithMockNotebook(page, {
      forceGate: true,
      recentRoots: [],
      pickerOutcome: 'success',
      pickerRoot: 'D:/审计夹具/中文 笔记本',
      pickerName: '中文 笔记本',
    });

    await page.getByTestId('open-notebook-button').click();
    await expect(page.getByTestId('notebook-open-gate')).toHaveCount(0);
    await expect(page.locator('.cm-content')).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => window.__jotluck_e2e?.debugState?.().activeNotebookRoot))
      .toBe('D:/审计夹具/中文 笔记本');
    await expect
      .poll(() => page.evaluate(() => window.__jotluck_e2e?.listNotePaths?.().length ?? 0))
      .toBeGreaterThan(0);
  });

  test('Ctrl/Cmd+O cancellation preserves the bound workspace and editor content', async ({
    page,
  }) => {
    await openWithMockNotebook(page, {
      pickerOutcome: 'cancel',
    });
    await expect(page.locator('.cm-content')).toBeVisible();

    await selectFirstNote(page);

    await page.evaluate(() => window.__jotluck_e2e?.editor?.setContent('# 取消切换仍保留'));
    await page.keyboard.press('Control+o');
    await expect
      .poll(() => page.evaluate(() => window.__jotluck_e2e?.debugState?.().activeNotebookRoot))
      .toBe('/');
    await expect
      .poll(() => page.evaluate(() => window.__jotluck_e2e?.editor?.getContent()))
      .toContain('取消切换仍保留');
  });

  test('late split-editor updates cannot cross a workspace switch', async ({ page }) => {
    const lateMarker = 'LATE_SPLIT_UPDATE_MUST_NOT_PERSIST';
    await openWithMockNotebook(page, {
      pickerOutcome: 'success',
      pickerRoot: 'D:/e2e-second-notebook',
      pickerName: 'Second Notebook',
    });
    await expect(page.locator('.cm-content')).toBeVisible();

    const oldPath = await selectFirstNote(page);
    const storedBefore = await page.evaluate((path) => {
      const raw = localStorage.getItem('jotluck-mockfs');
      if (!raw) return '';
      const data = JSON.parse(raw) as { files?: Record<string, { content?: string }> };
      return data.files?.[path]?.content ?? '';
    }, oldPath);

    await page.locator('.shell-action--view-toggle').click();
    await expect(page.locator('.split-pane .cm-content')).toBeVisible();
    await page.keyboard.press('Control+o');
    await expect
      .poll(() => page.evaluate(() => window.__jotluck_e2e?.debugState?.().isNotebookOpening), {
        intervals: [10, 10, 20],
        timeout: 2000,
      })
      .toBe(true);
    await page.evaluate((content) => window.__jotluck_e2e?.editor?.setContent(content), lateMarker);

    await expect
      .poll(() => page.evaluate(() => window.__jotluck_e2e?.debugState?.().activeNotebookRoot))
      .toBe('D:/e2e-second-notebook');
    await expect
      .poll(() => page.evaluate(() => window.__jotluck_e2e?.debugState?.().isNotebookOpening))
      .toBe(false);
    await expect
      .poll(() => page.evaluate(() => window.__jotluck_e2e?.debugState?.().currentContent))
      .toBe('');

    const storedAfter = await page.evaluate((path) => {
      const raw = localStorage.getItem('jotluck-mockfs');
      if (!raw) return '';
      const data = JSON.parse(raw) as { files?: Record<string, { content?: string }> };
      return data.files?.[path]?.content ?? '';
    }, oldPath);
    expect(storedAfter).toBe(storedBefore);
    expect(storedAfter).not.toContain(lateMarker);
  });

  test('a pending save failure blocks the picker and preserves the old root', async ({ page }) => {
    await openWithMockNotebook(page, {
      pickerOutcome: 'success',
      pickerRoot: 'D:/should-not-open',
      pickerName: 'Should Not Open',
    });
    await expect(page.locator('.cm-content')).toBeVisible();

    await selectFirstNote(page);

    await page.evaluate(() => {
      const originalSetItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function setItem(key: string, value: string): void {
        if (key === 'jotluck-mockfs') throw new Error('模拟磁盘写入失败');
        originalSetItem.call(this, key, value);
      };
      window.__jotluck_e2e?.editor?.setContent('# 尚未保存，不能切换');
    });
    await page.keyboard.press('Control+o');

    await expect(page.locator('.toast', { hasText: '切换笔记本失败' })).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => window.__jotluck_e2e?.debugState?.().activeNotebookRoot))
      .toBe('/');
    await expect
      .poll(() => page.evaluate(() => window.__jotluck_e2e?.editor?.getContent()))
      .toContain('尚未保存，不能切换');
  });

  test('an unavailable recent root is rejected and explained by the gate', async ({ page }) => {
    await openWithMockNotebook(page, {
      forceGate: true,
      recentRoots: ['Z:/missing-notebook'],
      unavailableRoots: ['Z:/missing-notebook'],
      pickerOutcome: 'cancel',
    });

    await expect(page.getByTestId('notebook-open-gate').getByRole('alert')).toContainText(
      '最近使用的笔记本不可用',
    );
    await expect(page.locator('.cm-content')).toHaveCount(0);
  });
});
