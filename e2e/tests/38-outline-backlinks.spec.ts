import { test, expect, type Page } from '@playwright/test';
import { waitForAppReady, getEditorContentFromBridge } from '../helpers/test-utils';

const source =
  '# 来源\n\n开头 [[目标]]，中间 [[目标#章节|别名]]，最后 [[目标]]。\n\n## 重复\n\n' +
  '章节正文。\n\n'.repeat(35) +
  '### 子节\n\n子节内容\n\n## 重复\n\n末章内容\n\n＃ 全角\n\n全角内容\n\n下划线标题\n===\n\n尾部';

async function editor<T>(page: Page, method: string, ...args: unknown[]): Promise<T> {
  return page.evaluate(
    ({ method, args }) => (window as any).__jotluck_e2e.editor[method](...args),
    { method, args },
  );
}
async function setup(page: Page, extra: Record<string, string> = {}) {
  await page.addInitScript(
    (contents) => {
      window.__jotluck_e2e = { mockNotebook: { initialFiles: contents, persist: false } };
      localStorage.setItem('jotluck:welcome:completed', '1');
      localStorage.setItem('jotluck:autocomplete:settings', JSON.stringify({ enabled: false }));
    },
    { '/source.md': source, '/target.md': '# 目标\n\n## 章节\n\n目标正文', ...extra },
  );
  await waitForAppReady(page);
}
async function open(page: Page, name: string) {
  await page.locator('.topbar-btn--menu').click();
  await page.locator('.tree-item').filter({ hasText: name }).first().click();
  await page.keyboard.press('Escape');
  await expect(page.locator('.workspace-opening-overlay')).toHaveCount(0);
}
async function mode(page: Page, target: 'live' | 'split' | 'read') {
  const current = async () =>
    (await page.locator('.reader-workbench[data-view-mode="read"]').isVisible())
      ? 'read'
      : (await page.locator('.split-pane').isVisible())
        ? 'split'
        : 'live';
  for (let i = 0; i < 3 && (await current()) !== target; i++)
    await page.locator('.view-mode-toggle').click();
  expect(await current()).toBe(target);
}
async function backlinks(page: Page) {
  const header = page.locator('.section-header').filter({ hasText: /反链|Backlink/i });
  if (!(await page.locator('.section-body--backlinks').isVisible())) await header.click();
  return page.locator('.backlink-item');
}

test('outline follows cursor across nested, repeated, fullwidth and setext headings', async ({
  page,
}) => {
  await setup(page);
  await open(page, 'source.md');
  for (const [text, id] of [
    ['子节内容', 'heading-子节'],
    ['末章内容', 'heading-重复-2'],
    ['全角内容', 'heading-全角'],
    ['尾部', 'heading-下划线标题'],
  ]) {
    const started = Date.now();
    await editor(page, 'setCursor', source.indexOf(text!));
    await expect(page.locator('.heading-link[aria-current="location"]')).toHaveAttribute(
      'data-heading-id',
      id!,
    );
    expect(Date.now() - started).toBeLessThanOrEqual(100);
  }
  await page.locator('[data-heading-id="heading-重复"]').click();
  await expect.poll(() => editor(page, 'getCursor')).toBe(source.indexOf('## 重复'));
});

for (const view of ['live', 'split', 'read'] as const) {
  test(`each same-line backlink navigates exactly in ${view} mode`, async ({ page }) => {
    await setup(page);
    await open(page, 'target.md');
    await mode(page, view);
    const entries = await backlinks(page);
    await expect(entries).toHaveCount(3);
    const from = source.indexOf('[[目标#章节|别名]]');
    const measurement = page.evaluate(
      ({ from, mode }) =>
        new Promise<number>((resolve) => {
          const click = (event: MouseEvent) => {
            if (!(event.target as Element).closest('.backlink-item')) return;
            document.removeEventListener('click', click, true);
            const started = performance.now();
            const check = () => {
              const selection = (window as any).__jotluck_e2e.editor?.getSelection();
              const editReady =
                mode === 'read' ||
                (selection?.from === from &&
                  selection.to === from + '[[目标#章节|别名]]'.length &&
                  document
                    .querySelector('.cm-content')
                    ?.textContent?.includes('[[目标#章节|别名]]'));
              const target = document.querySelector('.preview-navigation-target');
              const preview = document.querySelector('.split-preview, .reader-workbench');
              const rect = target?.getBoundingClientRect(),
                bounds = preview?.getBoundingClientRect();
              const readReady =
                mode === 'live' ||
                (target?.textContent === '别名' &&
                  rect &&
                  bounds &&
                  rect.bottom > bounds.top &&
                  rect.top < bounds.bottom);
              if ((editReady && readReady) || performance.now() - started > 5000)
                resolve(performance.now() - started);
              else requestAnimationFrame(check);
            };
            requestAnimationFrame(check);
          };
          document.addEventListener('click', click, true);
        }),
      { from, mode: view },
    );
    await entries.nth(1).click();
    if (view !== 'read') {
      await expect
        .poll(() => editor(page, 'getSelection'))
        .toMatchObject({ from, to: from + '[[目标#章节|别名]]'.length });
      expect(await getEditorContentFromBridge(page)).toBe(source);
    }
    if (view !== 'live') {
      await expect(page.locator('.preview-navigation-target')).toHaveText('别名');
      await expect(
        page.locator(view === 'read' ? '.reader-workbench' : '.split-pane'),
      ).toBeVisible();
    }
    const elapsed = await measurement;
    console.log('[E6 reference ms]', view, elapsed);
    expect(elapsed).toBeLessThanOrEqual(500);
  });
}

test('reading scroll updates outline and split scrolling leaves the editor selection alone', async ({
  page,
}) => {
  await setup(page);
  await open(page, 'source.md');
  await mode(page, 'split');
  await editor(page, 'setCursor', 0);
  const before = await editor(page, 'getSelection');
  const preview = page.locator('.split-preview');
  await preview.hover();
  await page.mouse.wheel(0, 1500);
  await expect
    .poll(() =>
      page.locator('.heading-link[aria-current="location"]').getAttribute('data-heading-id'),
    )
    .not.toBe('heading-来源');
  expect(await editor(page, 'getSelection')).toEqual(before);
  await mode(page, 'read');
  await page.locator('[data-heading-id="heading-重复-2"]').click();
  const heading = page.locator('.reader-preview #heading-重复-2');
  await expect(heading).toBeInViewport();
  await expect(page.locator('.heading-link[aria-current="location"]')).toHaveAttribute(
    'data-heading-id',
    'heading-重复-2',
  );
});

test('backlinks paginate without hiding any occurrence and update after save', async ({ page }) => {
  await setup(page, {
    '/many.md':
      '# Many\n\n' + Array.from({ length: 65 }, (_, i) => `第${i}处 [[目标]]。`).join('\n\n'),
  });
  await open(page, 'target.md');
  const entries = await backlinks(page);
  await expect(entries).toHaveCount(50);
  await page.getByRole('button', { name: '显示更多', exact: true }).click();
  await expect(entries).toHaveCount(68);
  await open(page, 'many.md');
  await editor(page, 'setContent', '# Many\n\n只有 [[目标]]。');
  await page.keyboard.press('Control+s');
  await open(page, 'target.md');
  await expect(await backlinks(page)).toHaveCount(4);
});

test('a stale backlink relocates after text is inserted before the reference', async ({ page }) => {
  await setup(page);
  await open(page, 'target.md');
  await backlinks(page);
  const changed = '新插入的段落\n\n' + source;
  await page.evaluate(async (content) => {
    const button = document.querySelectorAll<HTMLButtonElement>('.backlink-item')[1]!;
    await (window as any).__jotluck_e2e.writeNoteFileExternally('/source.md', content);
    button.click();
  }, changed);
  const from = changed.indexOf('[[目标#章节|别名]]');
  await expect
    .poll(() => editor(page, 'getSelection'))
    .toMatchObject({ from, to: from + '[[目标#章节|别名]]'.length });
});

test('Windows line endings preserve source positions without rewriting the file on navigation', async ({
  page,
}) => {
  const original = source.replaceAll('\n', '\r\n');
  await setup(page, { '/source.md': original });
  await open(page, 'target.md');
  await (await backlinks(page)).nth(1).click();
  const from = source.indexOf('[[目标#章节|别名]]');
  await expect
    .poll(() => editor(page, 'getSelection'))
    .toMatchObject({ from, to: from + '[[目标#章节|别名]]'.length });
  const disk = await page.evaluate(() => (window as any).__jotluck_e2e.readNoteFile('/source.md'));
  expect(disk).toBe(original);
});

test('ambiguous stale references open the source without jumping to the first repeated reference', async ({
  page,
}) => {
  const repeated = '# 来源\n\n相同 [[目标]] 上下文\n\n相同 [[目标]] 上下文';
  await setup(page, { '/source.md': repeated });
  await open(page, 'target.md');
  await backlinks(page);
  await page.evaluate(async (content) => {
    const button = document.querySelectorAll<HTMLButtonElement>('.backlink-item')[1]!;
    await (window as any).__jotluck_e2e.writeNoteFileExternally('/source.md', '新增\n\n' + content);
    button.click();
  }, repeated);
  await expect(page.getByText('引用位置已变化，已打开来源笔记。', { exact: true })).toBeVisible();
  expect(await editor(page, 'getCursor')).toBe(0);
});

test('the last backlink click wins when two source notes are opened in quick succession', async ({
  page,
}) => {
  const other = '# 另一来源\n\n最后选择 [[目标]]。';
  await setup(page, { '/other.md': other });
  await open(page, 'target.md');
  await backlinks(page);
  await page.evaluate(() => {
    const groups = [...document.querySelectorAll('.backlink-group')];
    const first = groups.find((group) => group.querySelector('h3')?.textContent === '来源')!;
    const last = groups.find((group) => group.querySelector('h3')?.textContent === '另一来源')!;
    first.querySelector<HTMLButtonElement>('button')!.click();
    last.querySelector<HTMLButtonElement>('button')!.click();
  });
  await expect.poll(() => getEditorContentFromBridge(page)).toBe(other);
  await expect
    .poll(() => editor(page, 'getSelection'))
    .toMatchObject({ from: other.indexOf('[['), to: other.indexOf(']]') + 2 });
});

for (const size of [1_000_000, 3_000_000]) {
  test(`${size} character outline jumps to an unmounted chapter without moving focus on later scroll`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(90000);
    const body = '连续正文 mixed prose with **强调**，用于章节定位。\n\n'.repeat(100);
    let book = '# Book\n\n';
    for (let i = 0; book.length < size; i++) book += `## Chapter ${i}\n\n${body}`;
    book += '## Final chapter\n\n末尾 [[目标|末尾引用]]\n\nEND';
    await setup(page, { '/book.md': book });
    await open(page, 'book.md');
    await mode(page, 'read');
    await expect(page.locator('[data-heading-id="heading-final-chapter"]')).toBeAttached();
    await expect(page.locator('.progressive-preview #heading-final-chapter')).toHaveCount(0);
    await page.evaluate(() => {
      const state = { clicked: 0, visibleMs: -1, highlightMs: -1 };
      (window as any).chapterTiming = state;
      const clicked = (event: MouseEvent) => {
        if (!(event.target as Element).closest('[data-heading-id="heading-final-chapter"]')) return;
        document.removeEventListener('click', clicked, true);
        state.clicked = performance.now();
        const check = () => {
          const elapsed = performance.now() - state.clicked;
          if (
            state.highlightMs < 0 &&
            document.querySelector(
              '[data-heading-id="heading-final-chapter"][aria-current="location"]',
            )
          )
            state.highlightMs = elapsed;
          const heading = document.querySelector('.progressive-preview #heading-final-chapter');
          const bounds = document.querySelector('.reader-workbench')?.getBoundingClientRect();
          const bar = document.querySelector('.reader-workbench__bar')?.getBoundingClientRect();
          const rect = heading?.getBoundingClientRect();
          const paragraph = [...document.querySelectorAll('.progressive-preview p')].find((p) =>
            p.textContent?.includes('末尾'),
          );
          const prose = paragraph?.getBoundingClientRect();
          if (
            state.visibleMs < 0 &&
            rect &&
            bounds &&
            prose &&
            rect.top >= (bar?.bottom ?? bounds.top) &&
            rect.bottom <= bounds.bottom &&
            prose.top < bounds.bottom &&
            prose.bottom > bounds.top
          )
            state.visibleMs = elapsed;
          if ((state.visibleMs < 0 || state.highlightMs < 0) && elapsed < 5000)
            requestAnimationFrame(check);
        };
        requestAnimationFrame(check);
      };
      document.addEventListener('click', clicked, true);
    });
    const start = Date.now();
    await page.locator('[data-heading-id="heading-final-chapter"]').click();
    const clickMs = Date.now() - start;
    await page.waitForFunction(() => {
      const timing = (window as any).chapterTiming;
      return timing.visibleMs >= 0 && timing.highlightMs >= 0;
    });
    await expect(page.locator('.progressive-preview #heading-final-chapter')).toBeInViewport();
    const elapsed = Date.now() - start;
    const measured = await page.evaluate(
      () => (window as any).chapterTiming as { visibleMs: number; highlightMs: number },
    );
    console.log(
      '[E6 chapter ms]',
      size,
      JSON.stringify({ ...measured, clickMs, totalMs: elapsed }),
    );
    await testInfo.attach('chapter-navigation-ms', {
      body: JSON.stringify({ ...measured, clickMs, totalMs: elapsed }),
      contentType: 'application/json',
    });
    expect(measured.visibleMs).toBeLessThanOrEqual(500);
    expect(measured.highlightMs).toBeLessThanOrEqual(100);
    await expect(page.locator('.heading-link[aria-current="location"]')).toHaveAttribute(
      'data-heading-id',
      'heading-final-chapter',
    );
    await page.locator('.progressive-preview').hover();
    await page.mouse.wheel(0, -1500);
    await expect
      .poll(() =>
        page.locator('.heading-link[aria-current="location"]').getAttribute('data-heading-id'),
      )
      .not.toBe('heading-final-chapter');
    const middle = await page
      .locator('.heading-link')
      .evaluateAll(
        (items) => items[Math.floor(items.length / 2)]!.getAttribute('data-heading-id')!,
      );
    for (const id of [middle, 'heading-book']) {
      await page.locator(`[data-heading-id="${id}"]`).click();
      await expect(page.locator(`.progressive-preview #${id}`)).toBeInViewport();
      await expect(page.locator('.heading-link[aria-current="location"]')).toHaveAttribute(
        'data-heading-id',
        id,
      );
    }
    await mode(page, 'live');
    await page.locator('[data-heading-id="heading-chapter-0"]').click();
    await page.keyboard.insertText('跳转后继续输入');
    const firstChapter = book.indexOf('## Chapter 0');
    expect(await getEditorContentFromBridge(page)).toBe(
      book.slice(0, firstChapter) + '跳转后继续输入' + book.slice(firstChapter),
    );
  });
}
