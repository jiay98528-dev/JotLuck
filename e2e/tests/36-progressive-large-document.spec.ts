import { expect, test, type Page } from '@playwright/test';
import { waitForAppReady, waitForMockFileContent } from '../helpers/test-utils';

async function openBook(page: Page, characters: number, variant = 'book') {
  await page.addInitScript(
    ({ size, variant }) => {
      const unit =
        '这是整本资料中的连续正文，用于检查输入与滚动。This is ordinary book prose with **emphasis** and a [reference][ref]. '.repeat(
          2,
        );
      const lines = ['# E4 Book'];
      let length = 10;
      let chapter = 0;
      while (length < size) {
        const block =
          `\n\n## Chapter ${chapter++}\n\n` + Array.from({ length: 20 }, () => unit).join('\n\n');
        lines.push(block);
        length += block.length;
      }
      lines.push('\n\n[ref]: https://example.com\n\nE4-END');
      let content = lines.join('');
      if (variant === 'paragraph')
        content =
          '# E4 Book\n\n**' + 'Long paragraph 中英混合 '.repeat(5000).trimEnd() + '**\n\nE4-END';
      if (variant === 'code' || variant === 'unclosed')
        content =
          '# E4 Book\n\n```ts\n' +
          Array.from({ length: 10000 }, (_, i) => `const value${i} = ${i};`).join('\n') +
          (variant === 'code' ? '\n```' : '') +
          '\n\nE4-END';
      if (variant === 'table')
        content =
          '# E4 Book\n\n| Name | Value |\n| --- | ---: |\n' +
          Array.from({ length: 10000 }, (_, i) => `| row-${i} | ${i} |`).join('\n') +
          '\n\nE4-END';
      if (variant === 'technical')
        content = content.replaceAll(
          '## Chapter',
          '| Key | Value |\n| --- | ---: |\n| a\\|b | 42 |\n\n~~~ts\nconst sample = 42;\n~~~\n\n## Chapter',
        );
      const files = {
        '/book.md': { content, size: content.length, mtime: Date.now() },
        '/small.md': {
          content: '# E4 Small\n\nsmall-document-marker',
          size: 40,
          mtime: Date.now() - 1,
        },
      };
      window.__jotluck_e2e = {
        mockNotebook: {
          persist: false,
          initialFiles: Object.fromEntries(
            Object.entries(files).map(([path, file]) => [path, file.content]),
          ),
        },
      };
      localStorage.setItem('jotluck:welcome:completed', '1');
    },
    { size: characters, variant },
  );
  await waitForAppReady(page);
  await page.locator('.topbar-btn--menu').click();
  await expect(page.locator('.tree-item').filter({ hasText: 'book.md' }).first()).toBeVisible();
  const started = Date.now();
  await page.locator('.tree-item').filter({ hasText: 'book.md' }).first().click();
  await page.keyboard.press('Escape');
  await expect(page.locator('.cm-content')).toContainText('E4 Book');
  await expect(page.locator('.cm-content')).toHaveAttribute('contenteditable', 'true');
  await expect(page.locator('.workspace-opening-overlay')).toHaveCount(0);
  return Date.now() - started;
}

for (const variant of ['paragraph', 'code', 'table', 'unclosed', 'technical']) {
  test(`large ${variant}: full-text search reaches the last chunk and source remains editable`, async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium');
    test.setTimeout(90_000);
    await openBook(page, variant === 'technical' ? 1_000_000 : 0, variant);
    await page.locator('.view-mode-toggle').click();
    await expect(page.locator('.progressive-preview')).toBeVisible();
    await page.locator('.view-mode-toggle').click();
    const preview = page.locator('.progressive-preview');
    await expect(preview).toHaveAttribute('data-preview-complete', 'true', { timeout: 20000 });
    await preview.focus();
    await page.keyboard.press('Control+f');
    const query = variant === 'table' ? 'row-9999' : variant === 'code' ? 'value9999' : 'E4-END';
    await page.locator('.preview-find input').fill(query);
    await expect(preview).toContainText(query, { timeout: 5000 });
    await page.keyboard.press('Escape');
    await page.locator('.view-mode-toggle').click();
    await expect(page.locator('.cm-content')).toHaveAttribute('contenteditable', 'true');
    await page.locator('.cm-content').focus();
    await page.keyboard.press('Control+End');
    await page.keyboard.insertText(' 尾部编辑');
    await expect(page.locator('.cm-content')).toContainText('尾部编辑');
    await waitForMockFileContent(page, '/book.md', '尾部编辑');
  });
}

for (const characters of [1_000_000, 3_000_000]) {
  test(`${characters} characters: input, save, three modes, virtual reading and stale-result isolation`, async ({
    page,
    browserName,
  }, testInfo) => {
    test.skip(browserName !== 'chromium');
    test.setTimeout(120_000);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const firstEditableMs = await openBook(page, characters);
    expect(firstEditableMs).toBeLessThan(characters === 1_000_000 ? 2000 : 4000);
    await page.locator('.cm-content').focus();
    await page.keyboard.press('Control+End');
    await expect(page.locator('.cm-content')).toContainText('E4-END');
    await page.evaluate(() => {
      const samples: number[] = [];
      (window as unknown as { e4InputSamples: number[] }).e4InputSamples = samples;
      document.querySelector('.cm-content')!.addEventListener(
        'keydown',
        (event) => {
          if ((event as KeyboardEvent).key.length !== 1) return;
          const started = performance.now();
          requestAnimationFrame(() => samples.push(performance.now() - started));
        },
        true,
      );
    });
    for (const char of ' progressive-input-check') {
      await page.keyboard.type(char);
      await page.evaluate(
        () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
      );
    }
    const timings = await page.evaluate(
      () => (window as unknown as { e4InputSamples: number[] }).e4InputSamples,
    );
    await expect(page.locator('.cm-content')).toContainText('progressive-input-check');
    await waitForMockFileContent(page, '/book.md', 'progressive-input-check');
    const p95 = [...timings].sort((a, b) => a - b)[Math.ceil(timings.length * 0.95) - 1]!;
    await testInfo.attach('input-timings.json', {
      contentType: 'application/json',
      body: JSON.stringify({ characters, firstEditableMs, p95, timings }),
    });
    expect(timings).toHaveLength(' progressive-input-check'.length);
    expect(p95).toBeLessThanOrEqual(100);

    const switches: number[] = [];
    for (const mode of ['split', 'read', 'live']) {
      const start = Date.now();
      await page.locator('.view-mode-toggle').click();
      if (mode === 'live') await expect(page.locator('.cm-content')).toBeVisible();
      else {
        await expect(page.locator('.progressive-preview')).toBeVisible();
        await expect(page.locator('.progressive-preview')).toContainText('E4 Book');
      }
      switches.push(Date.now() - start);
      if (mode === 'read') {
        await expect(page.locator('.preview-fragment h1')).toContainText('E4 Book', {
          timeout: 10000,
        });
        expect(await page.locator('.preview-fragment').count()).toBeLessThan(200);
        await expect(page.locator('.progressive-preview')).toHaveAttribute(
          'data-preview-complete',
          'true',
        );
        await page
          .locator('.preview-fragment')
          .first()
          .dispatchEvent('pointerdown', { pointerType: 'touch', pointerId: 4 });
        await page
          .locator('.progressive-preview')
          .dispatchEvent('pointercancel', { pointerType: 'touch', pointerId: 4 });
        await page.locator('.reader-workbench').evaluate((element) => {
          element.scrollTop = element.scrollHeight;
        });
        await expect(page.locator('.progressive-preview')).toContainText('E4-END', {
          timeout: 5000,
        });
        expect(await page.locator('.preview-fragment').count()).toBeLessThan(200);
      }
    }
    expect(Math.max(...switches)).toBeLessThanOrEqual(1000);
    await page.locator('.topbar-btn--menu').click();
    await page.locator('.tree-item').filter({ hasText: 'small.md' }).first().click();
    await page.keyboard.press('Escape');
    await expect(page.locator('.cm-content')).toContainText('small-document-marker');
    await page.locator('.view-mode-toggle').click();
    await expect(page.locator('.split-preview')).toContainText('E4 Small');
    await expect(page.locator('.split-preview')).not.toContainText('E4 Book');
    expect(errors).toEqual([]);
    console.log(
      '[E4 timings]',
      JSON.stringify({ characters, firstEditableMs, inputP95Ms: p95, switches }),
    );
    await testInfo.attach('large-document-timings.json', {
      contentType: 'application/json',
      body: JSON.stringify({ characters, firstEditableMs, inputP95Ms: p95, switches, timings }),
    });
  });
}
