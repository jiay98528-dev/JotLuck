/**
 * 98-element-probe.spec.ts — 元素级渲染/交互探针（Chromium only）
 *
 * 一篇 mock 笔记（探针.md，目标笔记 基础.md 同夹具）覆盖四类元素：
 *   ① data:URL 图片（1x1 png base64）— 三视图（即时/分栏/阅读）都渲染出
 *      <img src="data:image/png;base64,...">。
 *      依据：renderer 把 data: 归类为 local 直通（packages/renderer/src/index.ts
 *      classifyRemoteImage），宿主 resolveImageSrc 对 data: 原样放行
 *      （packages/app/src/composables/usePreviewImageResolver.ts PASSTHROUGH_SOURCE_RE）。
 *   ② 远程 https 图片 ![远](https://example.com/x.png) — 渲染为阻断占位
 *      .remote-image-placeholder--blocked（标题=alt「远」+ detail 含 zh-CN 文案
 *      「远程图片已阻止」「来源: example.com」+ load-all 按钮「加载本篇远程图片」），
 *      且视图内不存在 <img src="https://...">。
 *      依据：packages/renderer/src/index.ts createRemoteImagePlaceholder、
 *      packages/app/src/locales/zh-CN.ts notebook.remoteImages、
 *      useRemoteImageSession.ts 默认 decide='blocked'。
 *   ③ 外链 [示例](https://example.com) — 三视图渲染出 <a href>；阅读/分栏预览中
 *      点击后走外部打开（popup 事件，同 14 号 spec 的 window.open 判定），
 *      主页面不发生站内导航（page.url 不变 + 主 frame 无跨源 framenavigated）。
 *      依据：NotebookHome.vue onPreviewClick 外链分支 → urlUtils.openExternalUrl
 *      → web 运行时 window.open(url,'_blank','noopener,noreferrer')。
 *   ④ wiki 链接 [[基础]]（目标存在，非死链）— 阅读预览点击后编辑器/视图发生跳转
 *      （activePath → /基础.md、阅读预览出现目标笔记唯一标记；判定思路同
 *      09-wiki-link.spec.ts 的「目标笔记内容出现」）。
 *
 * ⚠ ④ 为【修复后常绿断言】：onPreviewClick（packages/app/src/pages/
 *   NotebookHome.vue）的 data-note 分支曾被 `progressivePreviewRef.value` 门控
 *   （仅 isLargeDocument >120KB 挂载 ProgressivePreview），普通体量笔记的阅读/
 *   分栏静态预览点击 wikilink 为 no-op——该缺陷已修复（94d537d 渲染交互矩阵），
 *   分支不再门控。本用例现为回归守卫：静态预览点击 wikilink 应跳转，红=回归。
 *   即时视图对照（应绿）先行验证夹具/索引/导航链路本身可用。
 *   禁止为绿灯弱化断言。
 *
 * 搭建方式参考 e2e/helpers/test-utils.ts 与 40/43 号 spec 的
 * mockNotebook.initialFiles + 文件树打开链路；三视图切换参考
 * 43-acceptance-visual.spec.ts 的 switchMode（.view-mode-toggle 循环点按 +
 * 容器探测，此处补 live 判定）。
 */
import { expect, test, type Frame, type Locator, type Page } from '@playwright/test';
import { waitForAppReady } from '../helpers/test-utils';

// ============================================================
// 夹具材料
// ============================================================

/** 1x1 透明 PNG 的 data:URL（标准最小 base64 png）。 */
const PNG_1X1_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

/** 探针笔记：四类元素各占独立段落（即时模式按行渲染 live block）。 */
const PROBE_NOTE_CONTENT = [
  '# 元素探针',
  '',
  `数据图：![本地像素](${PNG_1X1_DATA_URL})`,
  '',
  '远程图：![远](https://example.com/x.png)',
  '',
  '外链：[示例](https://example.com)',
  '',
  '维基：跳转 [[基础]] 收尾。',
  '',
].join('\n');

/** wiki 链接目标笔记：含唯一标记，供跳转后内容判定。 */
const BASE_NOTE_CONTENT = '# 基础标题\n\n基础笔记正文，唯一标记：基础笔记唯一标记。\n';

const PROBE_NOTE_PATH = '/探针.md';
const BASE_NOTE_PATH = '/基础.md';
const BASE_NOTE_MARKER = '基础笔记唯一标记';

/** 视图容器根（三视图渲染产物的宿主）。 */
function viewRoot(page: Page, mode: 'live' | 'read' | 'split'): Locator {
  if (mode === 'live') return page.locator('.cm-content');
  if (mode === 'split') return page.locator('.split-pane .split-preview');
  return page.locator('.reader-workbench .reader-preview');
}

// ============================================================
// 视图切换（参考 43 号 switchMode：.view-mode-toggle 循环 + 容器探测）
// ============================================================

type ViewMode = 'live' | 'split' | 'read';

async function currentViewMode(page: Page): Promise<ViewMode> {
  if ((await page.locator('.reader-workbench').count()) > 0) return 'read';
  if ((await page.locator('.split-pane').count()) > 0) return 'split';
  return 'live';
}

async function switchMode(page: Page, target: ViewMode): Promise<void> {
  const targetReached = async (): Promise<boolean> => {
    if (target === 'read') return (await page.locator('.reader-workbench').count()) > 0;
    if (target === 'split') return (await page.locator('.split-pane').count()) > 0;
    // live：两种预览容器都不在 → 即时模式
    return (await currentViewMode(page)) === 'live';
  };
  for (let i = 0; i < 3; i++) {
    if (await targetReached()) break;
    await page.locator('.view-mode-toggle').click();
    // 有界条件等待（L11）：慢机上目标容器可能晚于固定盲等出现，直接再点按
    // 会越过目标模式（三态循环）停在错误状态——此处等待目标容器出现（或
    // 2s 超时吞掉）再决定下一次点按，保留 3 次点击上限与终验不变。
    await expect
      .poll(targetReached, { timeout: 2_000 })
      .toBe(true)
      .catch(() => undefined);
  }
  expect(await currentViewMode(page), `切换到 ${target} 视图失败`).toBe(target);
}

// ============================================================
// 通用辅助
// ============================================================

/** 即时模式：光标钉在文档首行（标题行），保证后续段落行全部以 live block 渲染。 */
async function settleLiveCursorAtDocStart(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.__jotluck_e2e?.editor?.focus?.();
    window.__jotluck_e2e?.editor?.setCursor?.(0);
  });
  await page.waitForTimeout(500);
}

/** 读取当前激活笔记路径（e2e bridge debugState）。 */
function activePathNow(page: Page): Promise<string> {
  return page.evaluate(() => window.__jotluck_e2e?.debugState?.().activePath ?? '');
}

function normalizeNotePath(path: string): string {
  return path.replace(/\\/gu, '/').toLowerCase();
}

/** 阅读或分栏预览中点击外链：断言「外部打开（popup）+ 主页面零站内导航」。 */
async function clickExternalLinkExpectingNoInAppNavigation(
  page: Page,
  link: Locator,
): Promise<void> {
  const appOrigin = new URL(page.url()).origin;
  const urlBefore = page.url();
  const mainFrame = page.mainFrame();
  const offOriginNavigations: string[] = [];
  const onFrameNavigated = (frame: Frame): void => {
    if (frame === mainFrame && !frame.url().startsWith(appOrigin)) {
      offOriginNavigations.push(frame.url());
    }
  };
  page.on('framenavigated', onFrameNavigated);
  try {
    // 预期路径：点击被 onPreviewClick preventDefault 后走 window.open（同 14 号 spec
    // 的 popup 判定）。若未弹 popup，waitForEvent 超时即红（拦截链路断裂）。
    const popupPromise = page.waitForEvent('popup', { timeout: 10_000 });
    await link.click();
    const popup = await popupPromise;
    await expect.poll(() => popup.url(), { timeout: 5_000 }).toContain('example.com');
    await popup.close().catch(() => undefined);

    await page.waitForTimeout(300);
    // 站内导航判定一：主页面 URL 不变
    expect(page.url(), '外链点击后主页面 URL 不应变化').toBe(urlBefore);
    // 站内导航判定二：主 frame 无任何跨源导航事件
    expect(offOriginNavigations, '主 frame 不应发生跨源导航').toEqual([]);
  } finally {
    page.off('framenavigated', onFrameNavigated);
  }
}

// ============================================================
// describe
// ============================================================

test.describe('98 元素探针（chromium）', () => {
  test.beforeEach(async ({ page }) => {
    test.skip(test.info().project.name !== 'chromium', '元素探针只需 Chromium');
    await page.addInitScript(
      (files) => {
        window.__jotluck_e2e = {
          mockNotebook: { initialFiles: files, persist: false },
        };
        localStorage.setItem('jotluck:welcome:completed', '1');
        localStorage.setItem('jotluck:locale:v1', 'zh-CN');
        localStorage.setItem('jotluck:autocomplete:settings', JSON.stringify({ enabled: false }));
      },
      { [PROBE_NOTE_PATH]: PROBE_NOTE_CONTENT, [BASE_NOTE_PATH]: BASE_NOTE_CONTENT },
    );
    await waitForAppReady(page);

    // 文件抽屉打开探针笔记（40/43 号 openNote 链路）
    await page.locator('.topbar-btn--menu').click();
    await page.locator('.tree-item').filter({ hasText: '探针' }).first().click();
    await page.keyboard.press('Escape');
    await expect(page.locator('.workspace-opening-overlay')).toHaveCount(0);
    await expect(page.locator('.cm-content')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('.cm-content')).toContainText('元素探针');
  });

  // ================================================================
  // ① data:URL 图片：三视图渲染出 <img src="data:...">
  // ================================================================
  test('PROBE-①-data-URL图片在三视图渲染出 img 且 src 以 data: 开头', async ({ page }) => {
    const modes: ViewMode[] = ['live', 'split', 'read'];
    for (const mode of modes) {
      await switchMode(page, mode);
      if (mode === 'live') await settleLiveCursorAtDocStart(page);

      const root = viewRoot(page, mode);
      const dataImage = root.locator('img[src^="data:"]');
      await expect(dataImage.first(), `[${mode}] 应渲染出 data:URL 图片`).toBeVisible({
        timeout: 10_000,
      });
      await expect(
        dataImage.first(),
        `[${mode}] data:URL 图片 src 应为内嵌 png base64`,
      ).toHaveAttribute('src', /^data:image\/png;base64,/u);
    }
  });

  // ================================================================
  // ② 远程 https 图片：阻断占位而非 <img src="https://...">
  // ================================================================
  test('PROBE-②-远程https图片渲染为阻断占位而非https图片', async ({ page }) => {
    const modes: ViewMode[] = ['live', 'split', 'read'];
    for (const mode of modes) {
      await switchMode(page, mode);
      if (mode === 'live') await settleLiveCursorAtDocStart(page);

      const root = viewRoot(page, mode);

      // 占位结构：blocked 变体 + 标题（alt）+ 文案明细 + load-all 按钮
      const placeholder = root.locator('.remote-image-placeholder--blocked');
      await expect(placeholder.first(), `[${mode}] 应渲染阻断占位`).toBeVisible({
        timeout: 10_000,
      });
      await expect(
        placeholder.first().locator('.remote-image-placeholder__title'),
        `[${mode}] 占位标题应为 alt 文本`,
      ).toContainText('远');
      const detail = placeholder.first().locator('.remote-image-placeholder__detail');
      await expect(detail, `[${mode}] 占位明细应为 zh-CN 阻断文案`).toContainText('远程图片已阻止');
      await expect(detail, `[${mode}] 占位明细应标注来源主机`).toContainText('来源: example.com');
      const action = placeholder.first().locator('.remote-image-placeholder__action');
      await expect(action, `[${mode}] 应提供加载本篇远程图片按钮`).toContainText(
        '加载本篇远程图片',
      );

      // 反向断言：视图内不得残留 https 直连 <img>
      await expect(
        root.locator('img[src^="https://"]'),
        `[${mode}] 不应存在 https 直连图片`,
      ).toHaveCount(0);
      await expect(
        root.locator('img[src^="http://"]'),
        `[${mode}] 不应存在 http 直连图片`,
      ).toHaveCount(0);
    }
  });

  // ================================================================
  // ③ 外链：三视图渲染 <a href>；阅读/分栏预览点击无站内导航
  // ================================================================
  test('PROBE-③-外链三视图渲染a-href且预览点击无站内导航', async ({ page }) => {
    // —— 三视图渲染出 <a href="https://example.com"> ——
    const modes: ViewMode[] = ['live', 'split', 'read'];
    for (const mode of modes) {
      await switchMode(page, mode);
      if (mode === 'live') await settleLiveCursorAtDocStart(page);
      const link = viewRoot(page, mode).locator('a[href="https://example.com"]');
      await expect(link.first(), `[${mode}] 应渲染外链锚点`).toBeVisible({ timeout: 10_000 });
      await expect(link.first(), `[${mode}] 外链文本应为「示例」`).toContainText('示例');
    }

    // —— 阅读预览点击：外部打开（popup）+ 主页面零站内导航 ——
    const readLink = viewRoot(page, 'read').locator('a[href="https://example.com"]');
    await clickExternalLinkExpectingNoInAppNavigation(page, readLink.first());
    await expect(page.locator('.reader-workbench')).toBeVisible();

    // —— 分栏预览点击：同判定 ——
    await switchMode(page, 'split');
    const splitLink = viewRoot(page, 'split').locator('a[href="https://example.com"]');
    await expect(splitLink.first()).toBeVisible({ timeout: 10_000 });
    await clickExternalLinkExpectingNoInAppNavigation(page, splitLink.first());
    await expect(page.locator('.split-pane')).toBeVisible();
  });

  // ================================================================
  // ④ wiki 链接 [[基础]]：阅读预览点击后编辑器/视图发生跳转
  // ✅ 修复后常绿断言（94d537d 起 data-note 分支不再被 progressivePreviewRef
  //   门控）：静态阅读预览点击 wikilink 应跳转。即时视图对照组夹具校验应绿；
  //   实验组红=回归（禁止为绿灯弱化断言）。
  // ================================================================
  test('PROBE-④-wiki链接阅读预览点击后编辑器视图发生跳转', async ({ page }) => {
    // —— 对照组：即时视图点击同一条 wikilink，验证夹具/索引/导航链路本身可用 ——
    await switchMode(page, 'live');
    await settleLiveCursorAtDocStart(page);
    const liveLink = page.locator('.cm-content a[data-note="基础"]');
    await expect(liveLink.first(), '即时视图应渲染出 wikilink 锚点').toBeVisible({
      timeout: 10_000,
    });
    await liveLink.first().click({ force: true }); // 同 14 号 spec 的 CM6 widget 点击方式
    await expect
      .poll(async () => normalizeNotePath(await activePathNow(page)), {
        timeout: 10_000,
      })
      .toBe(normalizeNotePath(BASE_NOTE_PATH));

    // —— 回到探针笔记，切阅读视图（实验组）——
    await page.evaluate(async (path) => {
      await window.__jotluck_e2e?.selectNote?.(path);
    }, PROBE_NOTE_PATH);
    await expect
      .poll(async () => normalizeNotePath(await activePathNow(page)), { timeout: 10_000 })
      .toBe(normalizeNotePath(PROBE_NOTE_PATH));

    await switchMode(page, 'read');
    const readerRoot = viewRoot(page, 'read');
    const wikiLink = readerRoot.locator('a[data-note="基础"]');
    await expect(wikiLink.first(), '阅读预览应渲染出 wikilink 锚点').toBeVisible({
      timeout: 10_000,
    });
    // 目标存在 ⇒ 非死链（渲染层已用 wikiLinkExists 判定过）
    await expect(
      readerRoot.locator('a.wikilink--dead[data-note="基础"]'),
      '目标存在的 wikilink 不应带死链类',
    ).toHaveCount(0);

    // —— 实验组（回归守卫）：点击后应跳转到 基础.md；红=回归 ——
    await wikiLink.first().click();
    await expect
      .poll(async () => normalizeNotePath(await activePathNow(page)), {
        timeout: 10_000,
      })
      .toBe(normalizeNotePath(BASE_NOTE_PATH));
    await expect(
      page.locator('.reader-workbench .reader-preview'),
      '跳转后阅读预览应显示目标笔记内容',
    ).toContainText(BASE_NOTE_MARKER);
  });
});
