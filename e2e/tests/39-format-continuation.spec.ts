import { expect, test, type Page } from '@playwright/test';
import {
  getEditorContentFromBridge,
  waitForAppReady,
  waitForMockFileContent,
} from '../helpers/test-utils';

async function bridge<T = unknown>(page: Page, method: string, ...args: unknown[]): Promise<T> {
  return page.evaluate(
    ({ method, args }) => (window as any).__jotluck_e2e.editor[method](...args),
    { method, args },
  );
}

async function setup(page: Page, large = false) {
  await page.addInitScript((large) => {
    const unit =
      '这是整本资料中的连续正文，用于检查续写、输入和滚动。This is ordinary book prose. '.repeat(2);
    const chapter = '# 章节\n\n' + Array.from({ length: 20 }, () => unit).join('\n\n') + '\n\n';
    const body = large
      ? chapter.repeat(Math.ceil(3_000_000 / chapter.length)) + '> 九、尾部'
      : '# E7\n\n开始';
    if (large)
      window.__jotluck_e2e = {
        mockNotebook: {
          persist: false,
          initialFiles: { '/formats.md': body, '/other.md': '# 其他\n\n独立笔记' },
        },
      };
    else
      localStorage.setItem(
        'jotluck-mockfs',
        JSON.stringify({
          version: 4,
          files: {
            '/formats.md': { content: body, size: body.length, mtime: Date.now() },
            '/other.md': { content: '# 其他\n\n独立笔记', size: 12, mtime: Date.now() - 1 },
          },
          dirs: { '/': ['formats.md', 'other.md'] },
        }),
      );
    localStorage.setItem('jotluck:welcome:completed', '1');
    localStorage.setItem('jotluck:autocomplete:settings', JSON.stringify({ enabled: false }));
  }, large);
  await waitForAppReady(page);
  await open(page, 'formats.md');
}

async function open(page: Page, name: string) {
  await page.locator('.topbar-btn--menu').click();
  await page.locator('.tree-item').filter({ hasText: name }).first().click();
  await page.keyboard.press('Escape');
  await expect(page.locator('.workspace-opening-overlay')).toHaveCount(0);
  await expect(page.locator('.cm-content')).toHaveAttribute('contenteditable', 'true');
}

const examples: Array<[string, string]> = [
  ['1. 内容', '2. '],
  ['1) 内容', '2) '],
  ['009、内容', '010、'],
  ['(1) 内容', '(2) '],
  ['（００９）内容', '（０１０）'],
  ['９． 内容', '１０． '],
  ['九、内容', '十、'],
  ['（十九）内容', '（二十）'],
  ['(九十九) 内容', '(一百) '],
  ['a. 甲\nb. 乙', 'c. '],
  ['A) 甲\nB) 乙', 'C) '],
  ['i. 甲\nii. 乙', 'iii. '],
  ['I) 甲\nII) 乙', 'III) '],
  ['①内容', '②'],
  ...['-', '*', '+', '•', '·', '●', '○', '▪', '■'].map((mark): [string, string] => [
    `${mark} 内容`,
    `${mark} `,
  ]),
  ['> - 内容', '> - '],
  ['> 2. 内容', '> 3. '],
  ['> - [x] 内容', '> - [ ] '],
  ['2. [x] 内容', '3. [ ] '],
  ['> > 一、内容', '> > 二、'],
  ['- 父项\n  - 子项', '  - '],
  ['> - 父项\n>   - 子项', '>   - '],
];

for (const mode of ['live', 'split']) {
  test(`all numbering families and combined formats continue and undo in ${mode}`, async ({
    page,
  }) => {
    await setup(page);
    if (mode === 'split') await page.locator('.view-mode-toggle').click();
    for (const [source, next] of examples) {
      // Seed through the user's paste path. Replacing an equally long document
      // through the test bridge can leave Firefox's DOM selection at an old node.
      await page.locator('.cm-content').focus();
      await page.keyboard.press('Control+a');
      await page.keyboard.insertText(source);
      await expect.poll(() => getEditorContentFromBridge(page)).toBe(source);
      expect(await bridge(page, 'getCursor')).toBe(source.length);
      await page.keyboard.press('Enter');
      expect(await getEditorContentFromBridge(page), source).toBe(`${source}\n${next}`);
      expect(await bridge(page, 'getCursor')).toBe(source.length + 1 + next.length);
      await page.keyboard.press('Control+z');
      expect(await getEditorContentFromBridge(page), `undo ${source}`).toBe(source);
    }
  });
}

test('inner empty formats exit one layer at a time, split at the caret, and save on reopening', async ({
  page,
}) => {
  await setup(page);
  for (const key of ['Enter', 'Backspace', 'Escape']) {
    await bridge(page, 'setContent', '> - ');
    await page.keyboard.press(key);
    expect(await getEditorContentFromBridge(page)).toBe('> ');
    await page.keyboard.press(key);
    expect(await getEditorContentFromBridge(page)).toBe('');
    await page.keyboard.press('Control+z');
    expect(await getEditorContentFromBridge(page)).toBe('> ');
  }
  const source = '> （九）甲👩‍💻乙';
  await bridge(page, 'setContent', source);
  await bridge(page, 'setCursor', source.indexOf('乙'));
  await page.keyboard.press('Enter');
  const expected = '> （九）甲👩‍💻\n> （十）乙';
  expect(await getEditorContentFromBridge(page)).toBe(expected);
  await waitForMockFileContent(page, '/formats.md', expected);
  await open(page, 'other.md');
  await open(page, 'formats.md');
  expect(await getEditorContentFromBridge(page)).toBe(expected);
});

test('ambiguous text, exhausted sequences and code do not acquire new markers', async ({
  page,
}) => {
  await setup(page);
  for (const source of [
    'a. 正文',
    'a. 甲\nc. 乙',
    'a. 甲\n\nb. 乙',
    'a. 甲\n  b. 乙',
    'y. 甲\nz. 乙',
    '⑳内容',
    '九千九百九十九、内容',
    '1.23',
    '2026-09-22',
    'v1.2.3',
    'https://example.com',
    '\\①内容',
    '```\n一、代码',
    '> ```text\n> - 代码',
    '>     一、代码',
    '- ```\n  - 代码',
    '---\n一、头部',
  ]) {
    await bridge(page, 'setContent', source);
    await page.keyboard.press('Enter');
    const result = await getEditorContentFromBridge(page);
    expect(result.slice(0, source.length), source).toBe(source);
    // The editor's default newline may preserve indentation, but cannot insert a marker.
    expect(result.slice(source.length), source).toMatch(/^\n[ \t]*$/);
  }
});

test('native Chromium composition replacement commits once before continuation', async ({
  page,
  browserName,
}) => {
  test.skip(
    browserName !== 'chromium',
    'Candidate-text injection requires Chromium CDP; shared composition guards run separately.',
  );
  await setup(page);
  await bridge(page, 'setContent', '> 一、中文');
  const content = page.locator('.cm-content');
  const ime = await page.context().newCDPSession(page);
  await content.focus();
  await ime.send('Input.imeSetComposition', { text: '中', selectionStart: 1, selectionEnd: 1 });
  // Windows IME owns the confirming key; do not synthesize a separate native
  // insertParagraph, which page.keyboard.press would do without a system IME.
  await expect.poll(() => getEditorContentFromBridge(page)).toBe('> 一、中文中');
  await content.dispatchEvent('keydown', {
    key: 'Enter',
    code: 'Enter',
    keyCode: 229,
    isComposing: true,
  });
  expect(await getEditorContentFromBridge(page)).toBe('> 一、中文中');
  await ime.send('Input.insertText', { text: '提交' });
  await expect.poll(() => getEditorContentFromBridge(page)).toBe('> 一、中文提交');
  await page.keyboard.press('Enter');
  expect(await getEditorContentFromBridge(page)).toBe('> 一、中文提交\n> 二、');
});

test('composition events guard continuation and slash confirmation on every browser', async ({
  page,
}) => {
  await setup(page);
  await bridge(page, 'setContent', '> 一、中文');
  const content = page.locator('.cm-content');
  await content.dispatchEvent('compositionstart', { data: '' });
  await page.keyboard.insertText('中');
  await expect.poll(() => getEditorContentFromBridge(page)).toBe('> 一、中文中');
  for (const key of ['Enter', 'Backspace', 'Escape']) {
    await content.dispatchEvent('keydown', { key, code: key, keyCode: 229, isComposing: true });
    expect(await getEditorContentFromBridge(page)).toBe('> 一、中文中');
  }
  await content.dispatchEvent('compositionend', { data: '' });
  // Synthetic composition events check guards; committed typing is a separate normal input.
  await page.keyboard.insertText('提交');
  await expect.poll(() => getEditorContentFromBridge(page)).toBe('> 一、中文中提交');
  // Safari deliberately suppresses a key immediately after compositionend (100ms).
  // This is the next ordinary Enter, not the IME's confirming key.
  await page.waitForTimeout(150);
  await page.keyboard.press('Enter');
  expect(await getEditorContentFromBridge(page)).toBe('> 一、中文中提交\n> 二、');
  for (const key of ['Enter', 'Tab']) {
    await bridge(page, 'setContent', '/');
    await expect(page.locator('.cm-jotluck-slash-menu')).toBeVisible();
    await page.keyboard.press(key);
    expect(await getEditorContentFromBridge(page)).toBe('# ');
  }
});

test('three-million-character tail continues while stale analysis is pending', async ({
  page,
}, testInfo) => {
  test.setTimeout(120000);
  await setup(page, true);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await bridge(page, 'focus');
  await page.keyboard.press('Control+End');
  await expect(page.locator('.cm-content')).toContainText('> 九、尾部');
  await page.evaluate(() => {
    (window as any).e7Frames = [];
    document.querySelector('.cm-content')!.addEventListener(
      'keydown',
      (event) => {
        if ((event as KeyboardEvent).key !== 'Enter') return;
        const started = performance.now();
        requestAnimationFrame(() => (window as any).e7Frames.push(performance.now() - started));
      },
      { capture: true },
    );
  });
  const times: number[] = [];
  for (const numeral of ['十', '十一', '十二']) {
    await page.keyboard.insertText('追加');
    const started = Date.now();
    await page.keyboard.press('Enter');
    const text = await getEditorContentFromBridge(page);
    expect(text.endsWith(`\n> ${numeral}、`)).toBe(true);
    await expect(page.locator('.cm-content')).toContainText(`${numeral}、`);
    times.push(Date.now() - started);
  }
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          return (await window.__jotluck_e2e?.readNoteFile?.('/formats.md'))?.slice(-100) ?? '';
        }),
      { timeout: 10000 },
    )
    .toContain('> 十二、');
  await open(page, 'other.md');
  await open(page, 'formats.md');
  expect((await getEditorContentFromBridge(page)).endsWith('> 十二、')).toBe(true);
  expect(errors).toEqual([]);
  const nextFrameMs = await page.evaluate(() => (window as any).e7Frames as number[]);
  console.log(
    '[E7 timings]',
    JSON.stringify({
      characters: (await getEditorContentFromBridge(page)).length,
      commandVisibleMs: times,
      nextFrameMs,
    }),
  );
  await testInfo.attach('e7-large-continuation.json', {
    body: JSON.stringify({
      characters: (await getEditorContentFromBridge(page)).length,
      commandVisibleMs: times,
      nextFrameMs,
    }),
    contentType: 'application/json',
  });
});
