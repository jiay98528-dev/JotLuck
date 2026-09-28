/**
 * 32-focused-ghost-prototype.spec.ts — R2 聚焦行幽灵语法 kill/keep 判定（PRD-v0.2 §4 R2）
 *
 * 判据（冻结口径）：
 *   ① 中文 IME 连续输入 200 字（合成 composition 会话，沿 14 号 spec 先例）无坐标漂移；
 *   ② 聚焦行渲染文本任意位置点击，光标落点正确率 100%——字符边界精度为设计上限：
 *      点击字符 p 的中心，落点必须是 p 或 p+1，落到其他位置即 FAIL。
 *
 * 诚实边界：合成 composition 是对真实 IME 的近似（无候选窗/preedit 交互）；
 * 真实输入法手感属开发者体验确认环节，不阻塞本判定（PRD 已列）。
 */
import { test, expect, type Page } from '@playwright/test';
import { ensureEditorReady, waitForAppReady } from '../helpers/test-utils';

interface CoordsRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

interface SelectionSnapshot {
  from: number;
  to: number;
  anchor: number;
  head: number;
}

async function bridgeCall<T>(page: Page, method: string, ...args: unknown[]): Promise<T> {
  return page.evaluate(
    ({ method, args }) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const editor = (window as any).__jotluck_e2e?.editor;
      return (editor?.[method]?.(...(args as unknown[])) ?? null) as T;
    },
    { method, args },
  );
}

const setContent = (page: Page, content: string) =>
  bridgeCall<unknown>(page, 'setContent', content);
const setCursor = (page: Page, pos: number) => bridgeCall<unknown>(page, 'setCursor', pos);
const getCursor = (page: Page) => bridgeCall<number>(page, 'getCursor');
const getSelection = (page: Page) => bridgeCall<SelectionSnapshot>(page, 'getSelection');
const coordsAtPos = (page: Page, pos: number) =>
  bridgeCall<CoordsRect | null>(page, 'getCoordsAtPos', pos);
const posAtCoordsAt = (page: Page, x: number, y: number) =>
  bridgeCall<number | null>(page, 'posAtCoordsAt', x, y);

/** 字符 p 的中心坐标 = 边界 p 与边界 p+1 的中点。
 * 同时用 posAtCoordsAt 做一次坐标→pos 反向核对：落点必须落在 {p, p+1} 内，
 * 确保 click→coords→pos→head 链路在判据②里被双向覆盖（用掉 posAtCoordsAt 桥接）。 */
async function charCenter(
  page: Page,
  p: number,
): Promise<{ x: number; y: number; pos: number } | null> {
  const a = await coordsAtPos(page, p);
  const b = await coordsAtPos(page, p + 1);
  if (!a || !b) return null;
  const x = (a.left + b.left) / 2;
  const y = (a.top + a.bottom) / 2;
  const pos = await posAtCoordsAt(page, x, y);
  if (pos !== null && pos !== p && pos !== p + 1) return null;
  return { x, y, pos: pos ?? p };
}

test.describe('32 聚焦行幽灵语法 kill/keep 原型', () => {
  test.beforeEach(async ({ page }) => {
    // 本 spec 考核渲染/坐标，不考核补全；禁用补全避免 ghost 建议 widget 的
    // aria-hidden 文本混入行 textContent / 干扰坐标（结构化「补 **」建议实测会命中用例 1 的光标位置）。
    await page.addInitScript(() => {
      localStorage.setItem('jotluck:autocomplete:settings', JSON.stringify({ enabled: false }));
    });
    await waitForAppReady(page);
    await ensureEditorReady(page);
  });

  // ==========================================================
  // 前置：机制存在性——聚焦块幽灵可见、可编辑、离开即恢复渲染
  // ==========================================================
  test('1-聚焦加粗行符号幽灵可见，光标离开恢复纯渲染', async ({ page }) => {
    const line = '**加粗文字**后续plain混合文字';
    await setContent(page, `${line}\n\n# 标题块\n\n尾段`);
    await setCursor(page, 4); // 光标进入加粗词 → 该块聚焦

    const focusedLine = page.locator('.cm-line.cm-live-focused-source');
    await expect(focusedLine).toHaveCount(1);
    await expect(focusedLine).toContainText('**加粗文字**');

    const ghostMarks = focusedLine.locator('.cm-live-ghost-mark');
    await expect(ghostMarks).toHaveCount(2);
    await expect(ghostMarks.nth(0)).toHaveText('**');
    await expect(ghostMarks.nth(1)).toHaveText('**');

    // 非聚焦块照常即时渲染（widget），不带幽灵
    await expect(page.locator('.cm-live-block[data-block-type="heading"]')).toHaveCount(1);
    await expect(page.locator('.cm-live-block .cm-live-ghost-mark')).toHaveCount(0);

    // 光标离开 → 加粗块恢复纯渲染（其符号不再幽灵；渲染 widget 永不携带幽灵标记）。
    // 放量后新聚焦块（此处为标题行）自身的 # 合法地被幽灵化，故零断言只限渲染块范围。
    await setCursor(page, line.length + 4); // 进入标题行
    await expect(page.locator('.cm-live-block .cm-live-ghost-mark')).toHaveCount(0);
    await expect(page.locator('.cm-live-block', { hasText: '加粗文字' })).toHaveCount(1);
  });

  // ==========================================================
  // R2-F1：聚焦块内加粗 token 仍由全视图 HighlightStyle 提供粗体字重
  // （澄清实现路径：「词仍粗体」由既有 JotLuckHighlightStyle 提供，
  // 与聚焦行类/幽灵 CSS 无关——切片 C 只确保幽灵化不打断它）
  // ==========================================================
  test('4-R2-F1: 聚焦加粗词由全视图 HighlightStyle 保持粗体字重', async ({ page }) => {
    const line = '**加粗词**尾段';
    await setContent(page, line);
    await setCursor(page, 2); // 光标进入加粗词 → 该块聚焦
    await expect(page.locator('.cm-line.cm-live-focused-source')).toHaveCount(1);

    // 取首段加粗 token（CM6 HighlightStyle 派生类名因版本而异：用 computed fontWeight 判定粗体保持）
    const focusedLine = page.locator('.cm-line.cm-live-focused-source');
    const focusedLineWeight = await focusedLine.evaluate((line) => {
      // 找到行内"加粗词"三个字的位置（** 加粗词 ** 中 index 2-4），取该段文本节点的 computed fontWeight
      // 行结构：<span>*, *</span><span>加, 粗, 词</span><span>*, *</span>——中间节点就是加粗段
      const spans = [...line.querySelectorAll('span')];
      const boldSpan = spans.find((s) => s.textContent === '加粗词');
      return boldSpan ? Number(getComputedStyle(boldSpan).fontWeight) : 0;
    });
    // 600/bold 在不同解析下可能是 600 或 700，任一即视为粗体保持
    expect(focusedLineWeight, `tok-strong fontWeight=${focusedLineWeight}`).toBeGreaterThanOrEqual(
      600,
    );
  });

  // ==========================================================
  // R2-F3：聚焦加粗行内 Backspace 即时删除符号 + 幽灵实时同步
  // ==========================================================
  test('5-R2-F3: 聚焦加粗行内 Backspace 即时删除符号 + 幽灵实时同步', async ({ page }) => {
    // 文档：0-1=** / 2-4=加粗词 / 5-6=** / 7-8=尾段
    // 光标停在第一个 * 之后（锚点 1），Backspace 删 doc[0]=*（左侧 ** 首字符）
    // → 文本 *加粗词**尾段（8 字符）；Lezer 不再产出 EmphasisMark（缺左闭区间），
    //   该行变普通段落，无幽灵——验证"幽灵=Lezer/AST 路径唯一来源"在 Backspace 路径下实时归零。
    const line = '**加粗词**尾段';
    await setContent(page, line);
    await setCursor(page, 1);
    await expect(page.locator('.cm-live-focused-source .cm-live-ghost-mark')).toHaveCount(2);

    await page.keyboard.press('Backspace');
    await page.waitForTimeout(80);

    const content = await page.evaluate(
      () =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ((window as any).__jotluck_e2e?.editor?.getContent?.() as string | undefined) ?? '',
    );
    expect(content).toBe('*加粗词**尾段');

    // 行仍是聚焦块（paragraph 由 GHOST_INLINE_SCAN_BLOCK_TYPES 接纳），但 Lezer 不再有
    // EmphasisMark → count 应为 0。这正是"幽灵即时归零"的可观察承诺。
    await expect(page.locator('.cm-line.cm-live-focused-source')).toHaveCount(1);
    await expect(page.locator('.cm-line.cm-live-focused-source .cm-live-ghost-mark')).toHaveCount(
      0,
    );

    // 反向验证：在新位置再按 Backspace 删 doc[2]（加粗词首字"加"）→ 行变纯文本，幽灵仍 0（paragraph 无 inline mark 时无幽灵）
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(80);
    await expect(page.locator('.cm-line.cm-live-focused-source .cm-live-ghost-mark')).toHaveCount(
      0,
    );
  });

  // ==========================================================
  // 判据②：渲染文本任意位置点击，光标落点正确率 100%
  // ==========================================================
  test('2-判据②：聚焦行任意字符位置点击落点 100% 正确 + 拖选正确', async ({ page }) => {
    const line = '**加粗文字**后续plain混合文字';
    await setContent(page, line);
    await setCursor(page, 4);
    await expect(page.locator('.cm-live-focused-source .cm-live-ghost-mark')).toHaveCount(2);

    const failures: string[] = [];
    for (let p = 0; p < line.length; p++) {
      const center = await charCenter(page, p);
      if (!center) {
        failures.push(`char ${p}(${line[p]}): coords null`);
        continue;
      }
      await page.mouse.click(center.x, center.y);
      const head = await getCursor(page);
      if (head !== p && head !== p + 1) {
        failures.push(`click@char ${p}(${line[p]}) → head ${head}`);
      }
    }
    expect(failures, `落点失败清单: ${failures.join('; ')}`).toEqual([]);

    // 拖选：字符 2 中心按住拖到字符 12 中心 → 选区两端落在各自字符的边界上
    const from = await charCenter(page, 2);
    const to = await charCenter(page, 12);
    expect(from && to).toBeTruthy();
    await page.mouse.move(from!.x, from!.y);
    await page.mouse.down();
    await page.mouse.move(to!.x, to!.y, { steps: 6 });
    await page.mouse.up();
    const sel = await getSelection(page);
    expect(
      (sel.from === 2 || sel.from === 3) && (sel.to === 12 || sel.to === 13) && sel.from < sel.to,
      `drag selection got from=${sel.from} to=${sel.to}`,
    ).toBe(true);
  });

  // ==========================================================
  // 判据①：中文 IME 连续 200 字组合输入，无坐标漂移
  // ==========================================================
  test('3-判据①：IME 连续组合输入 200 字后符号位置与坐标无漂移', async ({ page }) => {
    const prefix = '**粗体起**'; // 7 字符：0,1=**；2,3,4=粗体起；5,6=**
    const composed = '聚焦行幽灵语法与坐标稳定性验证场景'.repeat(20).slice(0, 200);
    await setContent(page, `${prefix}\n尾段`);
    await setCursor(page, prefix.length); // 行尾，紧跟第二段 **
    await expect(page.locator('.cm-live-focused-source .cm-live-ghost-mark')).toHaveText([
      '**',
      '**',
    ]);
    await page.evaluate(() => document.fonts.ready.then(() => undefined));

    // Measure all positions in the same frame after initial painting settles.
    // A count of two spans alone does not guarantee complete marker ranges/layout.
    let baseline: Array<{ p: number; c: CoordsRect }> = [];
    await expect
      .poll(
        async () => {
          const next = await page.evaluate(
            async (positions) => {
              await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
              return positions.map((p) => ({
                p,
                c: window.__jotluck_e2e!.editor!.getCoordsAtPos(p),
              }));
            },
            [0, 1, 2, 3, 5, 6],
          );
          const stable =
            next.length === baseline.length &&
            next.every(
              (item, i) =>
                item.c &&
                Math.abs(item.c.left - baseline[i]!.c.left) < 0.01 &&
                Math.abs(item.c.top - baseline[i]!.c.top) < 0.01,
            );
          if (next.every((item) => item.c)) baseline = next as Array<{ p: number; c: CoordsRect }>;
          return stable;
        },
        { timeout: 2000, intervals: [16] },
      )
      .toBe(true);

    const editor = page.locator('.cm-content');
    await editor.dispatchEvent('compositionstart', { data: '' });
    for (let i = 0; i < 25; i++) {
      const chunk = composed.slice(i * 8, (i + 1) * 8);
      await editor.dispatchEvent('compositionupdate', { data: composed.slice(0, (i + 1) * 8) });
      await page.keyboard.insertText(chunk);
      await page.waitForTimeout(8);
      if (i === 12) {
        // 组合期间的 DOM 由浏览器直接管理，CM6 不保证装饰类稳定（实测合成组合下
        // 行类/mark span 会被局部重绘抖掉、上屏文本可续进相邻 span 的文本节点）——
        // 这些在 compositionend 后一次性重建归位。用户可感知的冻结承诺 =
        // 聚焦块内容保持源码形态，没有闪回渲染 widget。
        await expect(page.locator('.cm-live-block', { hasText: '粗体起' })).toHaveCount(0);
      }
    }
    await editor.dispatchEvent('compositionend', { data: composed });
    await page.waitForTimeout(350); // compositionend → settling → 一次性重建落定

    // 内容精确：200 字全部落在光标处，无丢失无重复
    const content = await page.evaluate(
      () =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ((window as any).__jotluck_e2e?.editor?.getContent?.() as string | undefined) ?? '',
    );
    expect(content).toBe(`${prefix}${composed}\n尾段`);

    // 幽灵范围仍恰好覆盖两段 **
    const marks = page.locator('.cm-live-focused-source .cm-live-ghost-mark');
    await expect(marks).toHaveCount(2);
    await expect(marks.nth(0)).toHaveText('**');
    await expect(marks.nth(1)).toHaveText('**');

    // 无坐标漂移：前缀位置坐标与组合前一致（±1px 容差）
    const drift: string[] = [];
    for (const { p, c: base } of baseline) {
      const c = await coordsAtPos(page, p);
      if (!c) {
        drift.push(`pos ${p}: coords null`);
        continue;
      }
      if (Math.abs(c.left - base.left) > 1 || Math.abs(c.top - base.top) > 1) {
        drift.push(`pos ${p}: left ${base.left}→${c.left}, top ${base.top}→${c.top}`);
      }
    }
    expect(drift, `坐标漂移清单: ${drift.join('; ')}`).toEqual([]);

    // 采样点击（幽灵字符 0/5、内容字符 3）仍落本字符边界
    for (const p of [0, 3, 5]) {
      const center = await charCenter(page, p);
      expect(center, `post-IME char ${p}`).not.toBeNull();
      await page.mouse.click(center!.x, center!.y);
      const head = await getCursor(page);
      expect([p, p + 1], `post-IME click@char ${p} → head ${head}`).toContain(head);
    }
  });
});
