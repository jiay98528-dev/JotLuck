import { expect, test, type Page } from '@playwright/test';
import { ensureEditorReady, resetAppState, waitForAppReady } from '../helpers/test-utils';

async function selectNote(page: Page, path: string): Promise<void> {
  await page.evaluate(async (notePath) => {
    const select = window.__jotluck_e2e?.selectNote;
    if (!select) throw new Error('E2E note selector is unavailable.');
    await select(notePath);
  }, path);
  await expect
    .poll(() => page.evaluate(() => window.__jotluck_e2e?.debugState?.().activePath ?? ''))
    .toBe(path);
}

async function readNote(page: Page, path: string): Promise<string> {
  return page.evaluate(async (notePath) => {
    const read = window.__jotluck_e2e?.readNoteFile;
    if (!read) throw new Error('E2E note reader is unavailable.');
    return read(notePath);
  }, path);
}

async function writeNoteExternally(page: Page, path: string, content: string): Promise<void> {
  await page.evaluate(
    async ({ notePath, nextContent }) => {
      const write = window.__jotluck_e2e?.writeNoteFileExternally;
      if (!write) throw new Error('E2E external note writer is unavailable.');
      await write(notePath, nextContent);
    },
    { notePath: path, nextContent: content },
  );
}

async function openConflictDialog(page: Page) {
  const dialog = page.getByRole('dialog', { name: '原文件和本地草稿不一样' });
  if (!(await dialog.isVisible().catch(() => false))) {
    await page.getByRole('button', { name: '重新保存当前笔记', exact: true }).click();
  }
  await expect(dialog).toBeVisible();
  return dialog;
}

test.describe('race-condition recovery', () => {
  test.beforeEach(async ({ page }) => {
    await waitForAppReady(page);
    await resetAppState(page);
    await ensureEditorReady(page);
  });

  test('an external edit never gets silently overwritten and both recovery choices work', async ({
    page,
  }) => {
    const path = '/快速入门.md';
    const localDraft = '# 本地草稿\n\n这一版只能由用户决定去向。';
    const externalVersion = '# 外部版本\n\n另一个程序先写入了这一版。';
    await selectNote(page, path);

    await page.evaluate((content) => window.__jotluck_e2e?.editor?.setContent(content), localDraft);
    await writeNoteExternally(page, path, externalVersion);
    await page.keyboard.press('Control+s');

    await expect
      .poll(() => page.evaluate(() => window.__jotluck_e2e?.debugState?.().saveIssueKind))
      .toBe('conflict');
    expect(await readNote(page, path)).toBe(externalVersion);
    await expect
      .poll(() => page.evaluate(() => window.__jotluck_e2e?.editor?.getContent() ?? ''))
      .toBe(localDraft);

    const conflictDialog = await openConflictDialog(page);
    const persistedAfterUnloadSignal = await page.evaluate((notePath) => {
      window.dispatchEvent(new Event('beforeunload', { cancelable: true }));
      const raw = localStorage.getItem('jotluck-mockfs');
      const files = raw
        ? (JSON.parse(raw) as { files?: Record<string, { content?: string }> }).files
        : undefined;
      return files?.[notePath]?.content ?? '';
    }, path);
    expect(persistedAfterUnloadSignal).toBe(externalVersion);

    await conflictDialog.getByRole('button', { name: '取消', exact: true }).click();
    const editedDraft = `${localDraft}\n\n取消后仍可继续编辑。`;
    await page.evaluate(
      (content) => window.__jotluck_e2e?.editor?.setContent(content),
      editedDraft,
    );
    await page.waitForTimeout(900);
    await expect(conflictDialog).toHaveCount(0);
    expect(await readNote(page, path)).toBe(externalVersion);
    await expect
      .poll(() => page.evaluate(() => window.__jotluck_e2e?.editor?.getContent() ?? ''))
      .toBe(editedDraft);

    await openConflictDialog(page);
    await expect(
      conflictDialog.getByRole('button', { name: '另存副本', exact: true }),
    ).toBeVisible();
    await conflictDialog.getByRole('button', { name: '采用外部版本', exact: true }).click();

    await expect
      .poll(() => page.evaluate(() => window.__jotluck_e2e?.editor?.getContent() ?? ''))
      .toBe(externalVersion);
    await expect
      .poll(() => page.evaluate(() => window.__jotluck_e2e?.debugState?.().isDirty))
      .toBe(false);

    const chosenLocalVersion = '# 明确覆盖\n\n这是用户明确选择保留的版本。';
    const secondExternalVersion = '# 第二个外部版本';
    await page.evaluate(
      (content) => window.__jotluck_e2e?.editor?.setContent(content),
      chosenLocalVersion,
    );
    await writeNoteExternally(page, path, secondExternalVersion);
    await page.keyboard.press('Control+s');
    await expect
      .poll(() => page.evaluate(() => window.__jotluck_e2e?.debugState?.().saveIssueKind))
      .toBe('conflict');
    await openConflictDialog(page);
    await conflictDialog.getByRole('button', { name: '覆盖原文件', exact: true }).click();

    await expect.poll(() => readNote(page, path)).toBe(chosenLocalVersion);
    await expect
      .poll(() => page.evaluate(() => window.__jotluck_e2e?.debugState?.().saveIssueKind))
      .toBeNull();
  });

  test('switching notes saves the old note first and blocks late keystrokes from crossing over', async ({
    page,
  }) => {
    const sourcePath = '/快速入门.md';
    const targetPath = '/格式示例.md';
    const sourceDraft = '# 切换前的内容\n\n这段必须留在旧文件。';
    const forbiddenMarker = 'LATE_KEYSTROKE_MUST_NOT_CROSS';
    await selectNote(page, sourcePath);
    await page.locator('.cm-content').first().click();
    await page.evaluate(
      (content) => window.__jotluck_e2e?.editor?.setContent(content),
      sourceDraft,
    );

    await page.evaluate((path) => {
      void window.__jotluck_e2e?.selectNote?.(path);
    }, targetPath);
    await expect
      .poll(() => page.evaluate(() => window.__jotluck_e2e?.debugState?.().isNoteSwitching))
      .toBe(true);
    await expect(page.locator('.editor-shell-frame')).toHaveAttribute('aria-busy', 'true');
    await page.keyboard.type(forbiddenMarker);

    await expect
      .poll(() => page.evaluate(() => window.__jotluck_e2e?.debugState?.().activePath ?? ''))
      .toBe(targetPath);
    await expect
      .poll(() => page.evaluate(() => window.__jotluck_e2e?.debugState?.().isNoteSwitching))
      .toBe(false);
    expect(await readNote(page, sourcePath)).toBe(sourceDraft);
    expect(await readNote(page, sourcePath)).not.toContain(forbiddenMarker);
    expect(await readNote(page, targetPath)).not.toContain(forbiddenMarker);
    await expect
      .poll(() => page.evaluate(() => window.__jotluck_e2e?.editor?.getContent() ?? ''))
      .not.toContain(forbiddenMarker);
  });

  test('creating a note waits for the old note save instead of dropping the last edit', async ({
    page,
  }) => {
    const sourcePath = '/快速入门.md';
    const sourceDraft = '# 新建前最后一笔\n\n这段必须先写回旧文件。';
    await selectNote(page, sourcePath);
    await page.evaluate(
      (content) => window.__jotluck_e2e?.editor?.setContent(content),
      sourceDraft,
    );

    await page.locator('.wing-new-btn').click();
    const blankCard = page.locator('.tpl-card.blank-card');
    await expect(blankCard).toBeVisible();
    await blankCard.click();
    await expect
      .poll(() => page.evaluate(() => window.__jotluck_e2e?.debugState?.().isNoteSwitching))
      .toBe(true);
    await expect
      .poll(() => page.evaluate(() => window.__jotluck_e2e?.debugState?.().activePath ?? ''))
      .not.toBe(sourcePath);

    expect(await readNote(page, sourcePath)).toBe(sourceDraft);
    await expect
      .poll(() => page.evaluate(() => window.__jotluck_e2e?.editor?.getContent() ?? ''))
      .toContain('# 新笔记');
  });

  test('two image uploads finish on the owning note before a note switch can commit', async ({
    page,
  }) => {
    const sourcePath = '/快速入门.md';
    const targetPath = '/格式示例.md';
    await selectNote(page, sourcePath);
    await page.evaluate(() => window.__jotluck_e2e?.editor?.setContent('# 双图归属测试\n\n'));

    await page.locator('.markdown-editor').evaluate((host) => {
      const dropImage = (name: string, byte: number): void => {
        const file = new File([new Uint8Array([byte, byte + 1, byte + 2])], name, {
          type: 'image/png',
        });
        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(file);
        host.dispatchEvent(
          new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }),
        );
      };
      dropImage('first.png', 1);
      dropImage('second.png', 4);
    });
    await page.evaluate((path) => {
      void window.__jotluck_e2e?.selectNote?.(path);
    }, targetPath);

    await expect
      .poll(() => page.evaluate(() => window.__jotluck_e2e?.debugState?.().activePath ?? ''), {
        timeout: 10_000,
      })
      .toBe(targetPath);
    const sourceContent = await readNote(page, sourcePath);
    const targetContent = await readNote(page, targetPath);
    expect(
      sourceContent.match(/!\[(?:first|second)\]\(\.\/assets\/img_[^)]+\.png\)/gu),
    ).toHaveLength(2);
    expect(sourceContent.indexOf('![first](')).toBeLessThan(sourceContent.indexOf('![second]('));
    expect(targetContent).not.toContain('./assets/img_');

    const assetPaths = await page.evaluate(() => {
      const raw = localStorage.getItem('jotluck-mockfs');
      const files = raw
        ? ((JSON.parse(raw) as { files?: Record<string, unknown> }).files ?? {})
        : {};
      return Object.keys(files).filter((path) => path.startsWith('/assets/img_'));
    });
    expect(assetPaths).toHaveLength(2);
  });
});
