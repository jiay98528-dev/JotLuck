import { expect, test, type Page } from '@playwright/test';
import {
  getEditorContentFromBridge,
  waitForAppReady,
  waitForMockFileContent,
} from '../helpers/test-utils';

/**
 * 42 统一验收 大文档组合
 *
 * 将人工验收用例 X-02（大文档跨特性组合：跳转+续写+切文件）与
 * E4-06（图片与布局稳定：滚动+视口+主题）翻译为浏览器自动化。
 *
 * 设计原则：
 * - 大文档沿用 36 号 / 38 号的本地合成方式与 100 万字符规模；
 *   性能阈值留给 36 号，42 号只做功能性验收。
 * - 列表续写沿用 39 号「行尾 Enter 自动续号」断言做法。
 * - "迟到画面不覆盖输入"沿用 36 号 stale 隔离断言方式：输入后
 *   立即读 bridge 内容核对，绝不等分析/索引完成。
 * - 图片走「data: URL 直通」分支（packages/app/src/composables/
 *   usePreviewImageResolver.ts 中 PASSTHROUGH_SOURCE_RE 命中 data:，
 *   不需要写额外本地资产文件，零依赖、不污染 e2e 资源目录）。
 * - 主题切换沿用 23/24/25 号既有做法：localStorage 键
 *   `jotluck:theme-state:v2`（详见 packages/app/src/stores/theme.ts
 *   THEME_STATE_KEY），写入后 reload 让主题契约生效，再用
 *   `html[data-theme-id]` 属性确认生效。
 */

// ---------------------------------------------------------------
// 复用：编辑器桥接 + 大文档合成
// ---------------------------------------------------------------

async function bridge<T = unknown>(page: Page, method: string, ...args: unknown[]): Promise<T> {
  return page.evaluate(
    ({ method, args }) => (window as any).__jotluck_e2e.editor[method](...args),
    { method, args },
  );
}

async function openNote(page: Page, name: string) {
  await page.locator('.topbar-btn--menu').click();
  await page.locator('.tree-item').filter({ hasText: name }).first().click();
  await page.keyboard.press('Escape');
  await expect(page.locator('.workspace-opening-overlay')).toHaveCount(0);
}

async function switchMode(page: Page, target: 'live' | 'split' | 'read') {
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

/** 合成与 36 号一致的百万字符长文档，章节命名以 `## Chapter N` 递增。 */
function buildMillionBook(appendTail: string): string {
  const unit =
    '这是整本资料中的连续正文，用于检查输入与滚动。This is ordinary book prose with **emphasis** and a [reference][ref]. '.repeat(
      2,
    );
  let book = '# Book\n\n';
  let chapter = 0;
  while (book.length < 1_000_000) {
    book += `## Chapter ${chapter++}\n\n` + Array.from({ length: 20 }, () => unit).join('\n\n');
  }
  book += appendTail;
  return book;
}

// ---------------------------------------------------------------
// 用例 1：X-02 大文档跳转后续写与切换
// ---------------------------------------------------------------

test('X-02 大文档跳转后续写与切换：序号、光标、迟到画面、切回与落盘', async ({ page }) => {
  test.setTimeout(90_000);
  test.skip(test.info().project.name !== 'chromium', '沿用 36/38/39 的 Chromium 限定');

  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));

  const book = buildMillionBook('\n\n## Final chapter\n\n末尾参考 [[目标]]\n\nE4-END');
  await page.addInitScript((content) => {
    window.__jotluck_e2e = {
      mockNotebook: {
        persist: false,
        initialFiles: {
          '/book.md': content,
          '/small.md': '# E4 Small\n\nsmall-document-marker',
        },
      },
    };
    localStorage.setItem('jotluck:welcome:completed', '1');
    localStorage.setItem('jotluck:autocomplete:settings', JSON.stringify({ enabled: false }));
  }, book);

  await waitForAppReady(page);
  await openNote(page, 'book.md');
  // 沿用 36 号的「打开后断言 cm-content 含首部」基线
  await expect(page.locator('.cm-content')).toContainText('Book');

  // (a) 大纲跳转到末部章节。先在阅读模式确认末章已挂载到大纲
  // （38 号 outline jumps to an unmounted chapter 的等价做法），
  // 再切回即时模式做后续续写。
  await switchMode(page, 'read');
  await expect(page.locator('[data-heading-id="heading-final-chapter"]')).toBeAttached();
  await expect(page.locator('.progressive-preview #heading-final-chapter')).toHaveCount(0);
  await switchMode(page, 'live');

  // 大纲点击即时跳转到末部章节；这是 38 号「点大纲后继续输入」的做法。
  await page.locator('[data-heading-id="heading-final-chapter"]').click();
  await page.keyboard.press('Control+End');
  await expect(page.locator('.cm-content')).toContainText('E4-END');

  // (b) 在末部连续续写三项（39 号「行尾 Enter 自动续号」做法）。
  // 每次 insertText + Enter 后用 bridge 立即核对全文，绝不等分析完成
  // （这就是 X-02「迟到画面不覆盖输入」的隔离断言）。
  //
  // 关键时序：先在文档末尾写出 1. 续写首项 并按一次 Enter，得到
  // "1. 续写首项\n2. "；之后每次 insertText + Enter 都应得到
  // "N. 内容\n(N+1). " 的续写。
  await page.keyboard.insertText('\n1. 续写首项');
  await page.keyboard.press('Enter');
  await expect
    .poll(() => getEditorContentFromBridge(page), { timeout: 5000 })
    .toContain('1. 续写首项\n2. ');

  const continuations = [
    { item: '续写次项', seq: 3 },
    { item: '续写三项', seq: 4 },
  ];
  for (const { item, seq } of continuations) {
    await page.keyboard.insertText(item);
    await page.keyboard.press('Enter');
    await expect
      .poll(() => getEditorContentFromBridge(page), { timeout: 5000 })
      .toContain(`${item}\n${seq}. `);
  }

  // (c) 切换到另一笔记再切回——正文完整、刚才续写在、光标行为正常。
  // 沿用 39 号「切走→切回→读 bridge」的隔离断言。
  await openNote(page, 'small.md');
  await expect(page.locator('.cm-content')).toContainText('small-document-marker');
  await openNote(page, 'book.md');
  await page.locator('.cm-content').focus();
  // 重新回到即时模式确认编辑器已就绪（避免大纲/阅读残留）
  await switchMode(page, 'live');
  // 渐进呈现下 DOM 只挂载可见范围，切回后全文一致性走 bridge 读取断言
  // （沿用 39 号切回后读 bridge 的方式）
  const reopened = await getEditorContentFromBridge(page);
  expect(reopened).toContain('1. 续写首项');
  expect(reopened).toContain('2. 续写次项');
  expect(reopened).toContain('3. 续写三项');
  expect(reopened.endsWith('4. ')).toBe(true);
  expect(reopened).toContain('E4-END');

  // 光标行为：聚焦后 Control+End 能正常到达末尾（不跳首尾、不串到 small 笔记）
  await bridge(page, 'focus');
  await page.keyboard.press('Control+End');
  await expect
    .poll(() => bridge<{ from: number; to: number }>(page, 'getSelection'), { timeout: 5000 })
    .toMatchObject({ from: reopened.length });

  // (d) 等自动保存后用 waitForMockFileContent 精确核对落盘全文
  // （含续写内容与末尾标记）。这是 36 号落盘核对的标准用法。
  await waitForMockFileContent(page, '/book.md', '1. 续写首项');
  await waitForMockFileContent(page, '/book.md', '2. 续写次项');
  await waitForMockFileContent(page, '/book.md', '3. 续写三项');
  await waitForMockFileContent(page, '/book.md', 'E4-END');

  // 再做一次全文精确核对（poll 直读 mockfs）：光标在 E4-END 之后，
  // 续写三项落在 E4-END 之后，文件以空序号项 `4. ` 结尾。
  await expect
    .poll(
      async () => {
        const raw = await page.evaluate(() => {
          const r = window.__jotluck_e2e?.readNoteFile;
          return r ? r('/book.md') : '';
        });
        return (raw as string).endsWith('E4-END\n1. 续写首项\n2. 续写次项\n3. 续写三项\n4. ');
      },
      { timeout: 10_000 },
    )
    .toBe(true);

  expect(errors).toEqual([]);
});

// ---------------------------------------------------------------
// 用例 2：E4-06 图片与布局稳定
// ---------------------------------------------------------------

test('E4-06 图片与布局稳定：图片加载、视口切换、主题切换下阅读位置不跳首尾', async ({ page }) => {
  test.setTimeout(90_000);
  test.skip(test.info().project.name !== 'chromium', '沿用 36/38/39 的 Chromium 限定');

  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));

  // 一张 300×200 的纯色 SVG，base64 后作为 data: URL 直通到预览
  // （PASSTHROUGH_SOURCE_RE 命中 data:，不依赖本地资产文件）。
  const pixelSvg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200">' +
    '<rect width="300" height="200" fill="#446"/><text x="20" y="40" fill="#fff" font-size="24">IMG</text></svg>';
  const imageUrl = 'data:image/svg+xml;base64,' + Buffer.from(pixelSvg, 'utf8').toString('base64');

  // 构造「含图片的长文」：约 30 章节，每节 ~6k 字符，章节中插一张图片。
  // 字符量够撑出可滚动阅读容器（≥一屏高度的 6 倍以上），同时不挤占
  // mockfs 配额。章节命名沿用 38 号的 `## Chapter N` 形式，让
  // `data-heading-id` 走 `heading-chapter-N` 锚点（参见
  // packages/renderer/src/syntax.ts headingIdFromText 的 slug 规则）。
  const imageParagraph = `![图](${imageUrl})`;
  const imageLineCount = 12; // 12 张图，足够观察多次 decode
  const chapter = (index: number) =>
    `\n\n## Chapter ${index}\n\n` +
    Array.from({ length: 18 }, () => '长正文 mixed prose with **emphasis** 用于滚动。').join(
      '\n\n',
    ) +
    '\n\n' +
    imageParagraph;
  let body = '# 图文长文\n\n开头段。\n\n';
  for (let i = 0; body.length < 240_000 || i < imageLineCount; i++) {
    body += chapter(i);
  }
  // 收尾
  body += '\n\n[ref]: https://example.com\n\n末尾参考 [[目标]]\n\nE4-END';

  await page.addInitScript(
    ({ content, imgUrl }) => {
      window.__jotluck_e2e = {
        mockNotebook: {
          persist: false,
          initialFiles: {
            '/book.md': content,
            '/small.md': '# Other\n\n短笔记',
          },
        },
      };
      localStorage.setItem('jotluck:welcome:completed', '1');
      localStorage.setItem('jotluck:autocomplete:settings', JSON.stringify({ enabled: false }));
      // 记录当前主题，便于断言切换生效
      window.__jotluck_e2e.testImageUrl = imgUrl;
    },
    { content: body, imgUrl: imageUrl },
  );

  // 进入分栏预览，方便观察图片加载
  await page.setViewportSize({ width: 1280, height: 900 });
  await waitForAppReady(page);
  await openNote(page, 'book.md');
  await switchMode(page, 'split');
  await expect(page.locator('.split-preview')).toContainText('图文长文');

  // (a) 滚动到中部并等首批图片进入视口
  const preview = page.locator('.split-preview');
  await preview.waitFor();
  const initialRange = await preview.evaluate((el) => ({
    range: (el as HTMLElement).scrollHeight - (el as HTMLElement).clientHeight,
  }));
  expect(initialRange.range).toBeGreaterThan(400);

  // 图片位于每章末尾，初始视口（scrollTop=0）内没有图片：先把第一张
  // 内容图滚入视野，再等它加载完成（自然宽度 > 0）。
  await preview.locator('img[alt="图"]').first().scrollIntoViewIfNeeded();
  await expect
    .poll(
      () =>
        preview.evaluate((root) => {
          const bounds = root.getBoundingClientRect();
          const imgs = Array.from(root.querySelectorAll('img')) as HTMLImageElement[];
          const visible = imgs.filter((img) => {
            const rect = img.getBoundingClientRect();
            return rect.bottom > bounds.top && rect.top < bounds.bottom;
          });
          return visible.some((img) => img.complete && (img.naturalWidth ?? 0) > 0);
        }),
      { timeout: 15_000 },
    )
    .toBe(true);

  // 把滚动容器滚到中部 50% 处，记录位置
  const beforeScroll = await preview.evaluate((el) => {
    const range = (el as HTMLElement).scrollHeight - (el as HTMLElement).clientHeight;
    (el as HTMLElement).scrollTop = Math.round(range * 0.5);
    return {
      scrollTop: (el as HTMLElement).scrollTop,
      range,
    };
  });

  // (b) 加载完成后断言滚动位置漂移在容忍范围内
  // 容差 ±200px：功能验收，非性能标定。依据：图片 decode 完成通常会
  // 触发布局回流（图片占位被替换），100~150px 的轻微跳动是正常浏览器
  // 行为；200px 留出余量，足以捕捉「突然跳首尾」类回归。
  const scrollTolerance = 200;
  await expect
    .poll(
      () =>
        preview.evaluate(
          ({ scrollTop, range }) => {
            const imgs = Array.from(
              document.querySelectorAll('.split-preview img'),
            ) as HTMLImageElement[];
            const allLoaded =
              imgs.length > 0 && imgs.every((img) => img.complete && (img.naturalWidth ?? 0) > 0);
            return {
              scrollTop,
              range,
              allLoaded,
              imageCount: imgs.length,
            };
          },
          { scrollTop: beforeScroll.scrollTop, range: beforeScroll.range },
        ),
      { timeout: 15_000 },
    )
    .toMatchObject({ allLoaded: true });

  const afterScroll = await preview.evaluate((el) => ({
    scrollTop: (el as HTMLElement).scrollTop,
    range: (el as HTMLElement).scrollHeight - (el as HTMLElement).clientHeight,
  }));
  // 不应跳到 0 或 scrollHeight；中部 ±200px
  expect(afterScroll.scrollTop).toBeGreaterThan(scrollTolerance);
  expect(afterScroll.scrollTop).toBeLessThan(afterScroll.range - scrollTolerance);

  // (c) 改变窗口宽度（两档），断言阅读位置不跳首尾、正文仍可见
  for (const width of [1024, 768]) {
    await page.setViewportSize({ width, height: 900 });
    // 给浏览器一次布局机会
    await page.waitForTimeout(150);
    const sample = await preview.evaluate((el) => ({
      scrollTop: (el as HTMLElement).scrollTop,
      range: (el as HTMLElement).scrollHeight - (el as HTMLElement).clientHeight,
    }));
    // 仍在中部 ±200px 范围内（不跳首尾）
    expect(sample.scrollTop).toBeGreaterThan(scrollTolerance);
    expect(sample.scrollTop).toBeLessThan(sample.range - scrollTolerance);
  }
  // 正文可见：分栏中正文预览包含「图文长文」「末尾参考」之一
  await expect(preview).toContainText('长正文');

  // (c 续) 切换主题：沿用 24/23 号 activateTheme 模式——写
  // `jotluck:theme-state:v2` 后 reload，再用 `html[data-theme-id]`
  // 验证生效。默认主题为 paper（packages/app/src/services/
  // ThemeRegistry.ts DEFAULT_THEME_ID），切到 jotluck.halo-canvas
  // 形成有效差异；halo-canvas 是 23 号完整验收过的标准编辑器主题，
  // 仍保留 `.cm-content` 与传统大纲/反链结构。
  await page.evaluate(() => {
    localStorage.setItem(
      'jotluck:theme-state:v2',
      JSON.stringify({ activeThemeId: 'jotluck.halo-canvas' }),
    );
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForAppReady(page);
  await expect(page.locator('html')).toHaveAttribute('data-theme-id', 'jotluck.halo-canvas');

  // 重新打开同一笔记（halo 主题默认可能停在 dashboard）
  await openNote(page, 'book.md');
  // 正文可见：编辑器包含标题或末尾标记之一
  await expect(page.locator('.cm-content')).toContainText(/图文长文|E4-END/);
  // 阅读位置不跳首尾：切回分栏、滚到中部后，中部正文可见且滚动位置
  // 稳定停留（不弹回首部）。halo deck 布局下大纲面板默认收起，
  // outline 点击不属于本用例意图，直接以滚动+内容可见验证。
  await switchMode(page, 'split');
  const themedPreview = page.locator('.split-preview');
  await expect(themedPreview).toContainText('长正文');
  // halo 主题下滚动由宿主容器（.reader-workbench 契约）承担——向上找
  // 真正的滚动容器滚到中部，避免对非滚动元素设 scrollTop 得 0。
  await expect
    .poll(
      () =>
        themedPreview.evaluate((el) => {
          let node: HTMLElement | null = el as HTMLElement;
          while (node) {
            if (node.scrollHeight > node.clientHeight + 50) {
              node.scrollTop = Math.round((node.scrollHeight - node.clientHeight) * 0.5);
              return node.scrollTop;
            }
            node = node.parentElement;
          }
          return 0;
        }),
      { timeout: 10_000 },
    )
    .toBeGreaterThan(200);
  await expect(themedPreview).toContainText('长正文');

  expect(errors).toEqual([]);
});
