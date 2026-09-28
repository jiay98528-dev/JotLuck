import { test, expect, type Page } from '@playwright/test';
import {
  ensureEditorReady,
  waitForAppReady,
  getEditorContentFromBridge,
} from '../helpers/test-utils';

test.use({ hasTouch: true, isMobile: false, viewport: { width: 1280, height: 800 } });

async function bridge<T>(page: Page, method: string, ...args: unknown[]): Promise<T> {
  return page.evaluate(
    ({ method, args }) => {
      const editor = (
        window as unknown as {
          __jotluck_e2e: { editor: Record<string, (...args: unknown[]) => T> };
        }
      ).__jotluck_e2e.editor;
      return editor[method]!(...args);
    },
    { method, args },
  );
}

async function seed(page: Page, text: string) {
  await bridge(page, 'setContent', text + '\n\n尾部');
  await expect(page.locator('.cm-live-block').first()).toBeVisible();
}

async function swipe(page: Page, selector: string, dx = 0, dy = -65, cancel = false) {
  const box = await page.locator(selector).first().boundingBox();
  expect(box).not.toBeNull();
  const x = box!.x + box!.width / 2,
    y = box!.y + box!.height / 2;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  for (let i = 1; i <= 5; i++)
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: x + (dx * i) / 5, y: y + (dy * i) / 5 }],
    });
  await cdp.send('Input.dispatchTouchEvent', {
    type: cancel ? 'touchCancel' : 'touchEnd',
    touchPoints: [],
  });
  await cdp.detach();
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('jotluck:autocomplete:settings', JSON.stringify({ enabled: false }));
    localStorage.setItem('jotluck:formatBubble:hintShown', '1');
  });
  await waitForAppReady(page);
  await ensureEditorReady(page);
});

test('one touch maps repeated, fullwidth and code text to its exact source boundary', async ({
  page,
}) => {
  for (const [source, selector, offset, expected, displayed] of [
    ['重复 **重复文字** 重复', 'strong', 2, 7, '重复文字'],
    ['＊＊中文表情😀＊＊ 后面', 'strong', 2, 4, '中文表情😀'],
    ['前面 `代码代码` 后面', 'code', 2, 6, '代码代码'],
    ['重复 重复 后面', 'p', 4, 4, '重复 重复 后面'],
    ['- 前面 **重复**', 'strong', 1, 8, '重复'],
    ['转义 \\*符号 后面', 'p', 4, 5, '转义 *符号 后面'],
    ['| 重复 | 重复 |\n| --- | --- |\n| a | b |', '.ml-table-cell:nth-child(2)', 1, 8, '重复'],
  ] as const) {
    await seed(page, source);
    await expect(page.locator(`.cm-live-block ${selector}`).first()).toHaveText(displayed);
    const point = await page
      .locator(`.cm-live-block ${selector}`)
      .first()
      .evaluate((element, offset) => {
        const node = element.firstChild!;
        const range = document.createRange();
        range.setStart(node, offset);
        range.setEnd(node, offset + 1);
        const box = range.getBoundingClientRect();
        return { x: box.left + 1, y: (box.top + box.bottom) / 2 };
      }, offset);
    await page.touchscreen.tap(point.x, point.y);
    await expect.poll(() => bridge(page, 'getCursor')).toBe(expected);
    await page.keyboard.insertText('好');
    expect(await getEditorContentFromBridge(page)).toBe(
      source.slice(0, expected) + '好' + source.slice(expected) + '\n\n尾部',
    );
  }
});

test('link swipe, cancelled gestures and IME never activate or edit rendered controls', async ({
  page,
  browserName,
}) => {
  test.skip(
    browserName !== 'chromium',
    'Native touch drag requires Chromium CDP; shared pointer checks run separately.',
  );
  await seed(page, '[链接](https://example.com)\n\n- [ ] 任务');
  const original = await getEditorContentFromBridge(page);
  let popups = 0;
  page.on('popup', (popup) => {
    popups++;
    void popup.close();
  });
  await swipe(page, '.cm-live-block a', 60, 0);
  expect(popups).toBe(0);
  const toggle = page.locator('.cm-task-toggle');
  await toggle.dispatchEvent('pointerdown', {
    pointerType: 'touch',
    pointerId: 6,
    clientX: 1,
    clientY: 1,
  });
  await toggle.dispatchEvent('pointercancel', { pointerType: 'touch', pointerId: 6 });
  await toggle.dispatchEvent('click', { detail: 1 });
  expect(await getEditorContentFromBridge(page)).toBe(original);
  await page.locator('.cm-content').dispatchEvent('compositionstart', { data: '中' });
  await toggle.tap();
  expect(await getEditorContentFromBridge(page)).toBe(original);
  await page.locator('.cm-content').dispatchEvent('compositionend', { data: '中' });
});

test('checkbox swipe does not edit; a tap plus compatibility click toggles once', async ({
  page,
  browserName,
}) => {
  test.skip(
    browserName !== 'chromium',
    'Native touch drag requires Chromium CDP; shared pointer checks run separately.',
  );
  await seed(page, '- [ ] 任务\n\n' + '一行文字\n\n'.repeat(40));
  const original = await getEditorContentFromBridge(page);
  await swipe(page, '.cm-task-toggle', 80, 0);
  expect(await getEditorContentFromBridge(page)).toBe(original);
  await page.locator('.cm-task-toggle').first().tap();
  await expect
    .poll(() => getEditorContentFromBridge(page))
    .toBe(original.replace('- [ ]', '- [x]'));
});

test('shared pointer cancellation, IME guards and compatibility clicks preserve tasks', async ({
  page,
}) => {
  await seed(page, '[链接](https://example.com)\n\n- [ ] 任务');
  const original = await getEditorContentFromBridge(page);
  let popups = 0;
  page.on('popup', (popup) => {
    popups++;
    void popup.close();
  });
  for (const selector of ['.cm-live-block a', '.cm-task-toggle']) {
    const control = page.locator(selector).first();
    await control.dispatchEvent('pointerdown', {
      pointerType: 'touch',
      pointerId: 6,
      clientX: 1,
      clientY: 1,
    });
    await control.dispatchEvent('pointermove', {
      pointerType: 'touch',
      pointerId: 6,
      clientX: 31,
      clientY: 1,
    });
    await control.dispatchEvent('pointercancel', { pointerType: 'touch', pointerId: 6 });
    await control.dispatchEvent('click', { detail: 1 });
  }
  expect(popups).toBe(0);
  expect(await getEditorContentFromBridge(page)).toBe(original);
  const toggle = page.locator('.cm-task-toggle');
  await page.locator('.cm-content').dispatchEvent('compositionstart', { data: '中' });
  await toggle.tap();
  expect(await getEditorContentFromBridge(page)).toBe(original);
  await page.locator('.cm-content').dispatchEvent('compositionend', { data: '中' });
  await expect(toggle).toBeVisible();
  await toggle.tap();
  await toggle.dispatchEvent('click', { detail: 1 });
  await expect
    .poll(() => getEditorContentFromBridge(page))
    .toBe(original.replace('- [ ]', '- [x]'));
});

test('shared menu scroll cancellation preserves targets and tap confirmation undoes once', async ({
  page,
}) => {
  const source = '| 名称 | 数量 |\n| --- | --- |\n| 苹果 | 一 |';
  await seed(page, source);
  await bridge(page, 'setCursor', source.indexOf('苹果'));
  const button = page.locator('[data-table-action="insertRowBelow"]');
  await button.dispatchEvent('pointerdown', {
    pointerType: 'touch',
    pointerId: 6,
    clientX: 1,
    clientY: 1,
  });
  await page.locator('.cm-jotluck-table-toolbar').dispatchEvent('scroll');
  await button.dispatchEvent('pointerup', {
    pointerType: 'touch',
    pointerId: 6,
    clientX: 1,
    clientY: 1,
  });
  await button.dispatchEvent('click', { detail: 1 });
  expect(await getEditorContentFromBridge(page)).toBe(source + '\n\n尾部');
  await button.tap();
  await expect
    .poll(async () => (await getEditorContentFromBridge(page)).split('\n').length)
    .toBe(6);
  await page.keyboard.press('Control+z');
  expect(await getEditorContentFromBridge(page)).toBe(source + '\n\n尾部');
  await bridge(page, 'setContent', '/');
  const item = page.locator('[data-slash-id="heading1"]');
  await item.dispatchEvent('pointerdown', {
    pointerType: 'touch',
    pointerId: 7,
    clientX: 1,
    clientY: 1,
  });
  await page.locator('.cm-jotluck-slash-menu').dispatchEvent('scroll');
  await item.dispatchEvent('pointerup', {
    pointerType: 'touch',
    pointerId: 7,
    clientX: 1,
    clientY: 1,
  });
  await item.dispatchEvent('click', { detail: 1 });
  expect(await getEditorContentFromBridge(page)).toBe('/');
  await item.tap();
  await expect.poll(() => getEditorContentFromBridge(page)).toBe('# ');
});

test.describe('desktop mouse pointer', () => {
  test.use({ hasTouch: false });
  test('shared pointer divider cancellation releases capture and keeps typing available', async ({
    page,
  }) => {
    await seed(page, '分栏正文');
    await page.locator('.view-mode-toggle').click();
    const divider = page.locator('.split-divider');
    await divider.evaluate((element) =>
      element.addEventListener(
        'pointerdown',
        (event) => {
          (element as HTMLElement).dataset.testPointerId = String(
            (event as PointerEvent).pointerId,
          );
        },
        { once: true },
      ),
    );
    const bounds = (await divider.boundingBox())!;
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + 50);
    await page.mouse.down();
    await page.mouse.move(bounds.x + 90, bounds.y + 50);
    // The existing pane minimum widths can clamp visual movement in a narrow editor.
    await expect.poll(async () => (await divider.boundingBox())!.x).toBeGreaterThan(bounds.x + 1);
    const moved = (await divider.boundingBox())!.x;
    // A real mouse pointer establishes capture; cancellation exercises the shared handler.
    await divider.dispatchEvent('pointercancel', {
      pointerType: 'mouse',
      pointerId: Number(await divider.getAttribute('data-test-pointer-id')),
    });
    await page.mouse.move(bounds.x - 90, bounds.y + 50);
    await page.mouse.up();
    expect(Math.abs((await divider.boundingBox())!.x - moved)).toBeLessThanOrEqual(1);
    await bridge(page, 'focus');
    await page.keyboard.insertText('继续');
    expect(await getEditorContentFromBridge(page)).toContain('继续');
  });
});

test('native rendered selection survives the bubble timeout, formats and undoes once', async ({
  page,
}) => {
  await seed(page, '前面 **重复文字** 后面');
  await page
    .locator('.cm-content')
    .dispatchEvent('pointerdown', { pointerType: 'touch', pointerId: 9, clientX: 0, clientY: 0 });
  await page
    .locator('.cm-content')
    .dispatchEvent('pointercancel', { pointerType: 'touch', pointerId: 9 });
  await page.locator('.cm-live-block strong').evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const selection = document.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
  });
  const bubble = page.locator('.format-bubble');
  await expect(bubble).toBeVisible();
  await page.waitForTimeout(3200);
  await expect(bubble).toBeVisible();
  await bubble.locator('.bubble-btn--clear').tap();
  await expect.poll(() => getEditorContentFromBridge(page)).toBe('前面 重复文字 后面\n\n尾部');
  await page.keyboard.press('Control+z');
  await expect.poll(() => getEditorContentFromBridge(page)).toBe('前面 **重复文字** 后面\n\n尾部');
});

test('table controls confirm on tap, never on a swipe, and restore mouse sizing', async ({
  page,
  browserName,
}) => {
  test.skip(
    browserName !== 'chromium',
    'Native touch drag requires Chromium CDP; shared pointer checks run separately.',
  );
  const text = '| 名称 | 数量 |\n| --- | --- |\n| 苹果 | 一 |';
  await seed(page, text);
  await bridge(page, 'setCursor', text.indexOf('苹果'));
  const button = page.locator('[data-table-action="insertRowBelow"]');
  await expect(button).toBeVisible();
  await swipe(page, '[data-table-action="insertRowBelow"]', 70, 0);
  expect(await getEditorContentFromBridge(page)).toBe(text + '\n\n尾部');
  await expect.poll(async () => (await button.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  await button.tap();
  await expect
    .poll(async () => (await getEditorContentFromBridge(page)).split('\n').length)
    .toBe(6);
  await page.keyboard.press('Control+z');
  await expect.poll(() => getEditorContentFromBridge(page)).toBe(text + '\n\n尾部');
  await button.click();
  await expect(page.locator('html')).toHaveAttribute('data-editor-pointer', 'mouse');
});

test('slash menu scroll does not confirm and touch confirmation preserves keyboard priority', async ({
  page,
  browserName,
}) => {
  test.skip(
    browserName !== 'chromium',
    'Native touch drag requires Chromium CDP; shared pointer checks run separately.',
  );
  await bridge(page, 'setContent', '/');
  const menu = page.locator('.cm-jotluck-slash-menu');
  await expect(menu).toBeVisible();
  await swipe(page, '.cm-jotluck-slash-menu__item', 0, -60);
  expect(await getEditorContentFromBridge(page)).toBe('/');
  await menu.locator('[data-slash-id="heading1"]').tap();
  await expect.poll(() => getEditorContentFromBridge(page)).toBe('# ');
});

for (const width of [768, 360]) {
  test(`touch controls stay within a ${width}px window and a reduced visual viewport`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1024 });
    await bridge(page, 'setContent', '/');
    await page
      .locator('.cm-content')
      .dispatchEvent('pointerdown', { pointerType: 'touch', pointerId: 7 });
    await page
      .locator('.cm-content')
      .dispatchEvent('pointercancel', { pointerType: 'touch', pointerId: 7 });
    await page.evaluate(() => {
      Object.defineProperty(window.visualViewport, 'height', { configurable: true, value: 460 });
      window.visualViewport!.dispatchEvent(new Event('resize'));
    });
    const menu = page.locator('.cm-jotluck-slash-menu');
    await expect(menu).toBeVisible();
    await expect
      .poll(async () => (await menu.boundingBox())!.y + (await menu.boundingBox())!.height)
      .toBeLessThanOrEqual(453);
    const box = (await menu.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(7);
    expect(box.x + box.width).toBeLessThanOrEqual(width - 7);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  });
}

test('touch divider drag ends on cancellation and subsequent typing still edits', async ({
  page,
  browserName,
}) => {
  test.skip(
    browserName !== 'chromium',
    'Native touch drag requires Chromium CDP; shared pointer checks run separately.',
  );
  await seed(page, '分栏正文');
  for (let i = 0; i < 3 && !(await page.locator('.split-pane').isVisible()); i++)
    await page.locator('.view-mode-toggle').click();
  const divider = page.locator('.split-divider');
  await expect(divider).toBeVisible();
  await swipe(page, '.split-divider', 90, 0, true);
  const box = (await page.locator('.split-pane').boundingBox())!;
  const line = (await divider.boundingBox())!;
  expect((line.x - box.x) / box.width).toBeGreaterThan(0.5);
  await divider.dispatchEvent('pointercancel', { pointerId: 1, pointerType: 'touch' });
  await bridge(page, 'focus');
  await page.keyboard.insertText('继续');
  expect(await getEditorContentFromBridge(page)).toContain('继续');
});
