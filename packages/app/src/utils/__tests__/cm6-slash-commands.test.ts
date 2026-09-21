/**
 * cm6-slash-commands 单测（V0.2-E2 spec §10.1）
 *
 * 覆盖（spec §10.1 七组用例）：
 *   1. 触发判定：空行 / 空白前缀 / 行中 / 缩进列表项内 / fence / frontmatter / 行首非斜杠
 *   2. 过滤：标签命中（zh）、别名命中（h1/table）、大小写、零匹配
 *   3. 每类条目插入文本与光标落点（10 项逐一断言；含 table 三行模板与 codeBlock 围栏）
 *   4. 触发文本替换语义（`/` 前空白保留、光标后余文跟随）
 *   5. 仲裁：菜单开时 Enter/Tab/Escape/Arrow 消费；关时全部放行
 *   6. readOnly 不触发；IME 守卫入口断言（组合标志期间命令返回 false）
 *   7. 撤销：插入后单步 undo 恢复触发前文本
 *
 * 测试风格沿用 `cm6-smart-continue.test.ts`（headless EditorView + jsdom）；
 * 仅断言状态与文档内容，不断言几何坐标（spec §10.1）。
 */
import { Compartment, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { history, undo } from '@codemirror/commands';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_COMPLETION_SETTINGS } from '@/services/CompletionSettings';
import type { MarkdownPredictor } from '@/services/MarkdownPredictor';
import { ghostTextPlugin } from '../cm6-ghost-text';
import {
  applySlashItem,
  buildSlashItems,
  filterSlashItems,
  getSlashMenuController,
  getSlashTrigger,
  slashCommandsExtension,
  type SlashItemId,
} from '../cm6-slash-commands';

const mountedViews: EditorView[] = [];

/** 测试自有的 readOnly 重配舱（复刻 MarkdownEditor 的 readOnlyCompartment 用法） */
const readOnlyCompartment = new Compartment();

function mountSlashEditor(doc: string, cursor = doc.length): EditorView {
  const host = document.createElement('div');
  document.body.append(host);
  const view = new EditorView({
    state: EditorState.create({
      doc,
      selection: { anchor: cursor },
      extensions: [history(), ...slashCommandsExtension()],
    }),
    parent: host,
  });
  mountedViews.push(view);
  view.focus();
  return view;
}

function pressKey(view: EditorView, key: string): void {
  view.contentDOM.dispatchEvent(
    new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
  );
}

function startIme(view: EditorView): void {
  view.contentDOM.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
}

function endIme(view: EditorView): void {
  view.contentDOM.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
}

afterEach(() => {
  while (mountedViews.length > 0) mountedViews.pop()?.destroy();
  document.body.replaceChildren();
});

// ─── 1. 触发判定（spec §10.1.1） ──────────────────────────────────────

describe('getSlashTrigger', () => {
  it('returns the trigger on an empty line with cursor right after /', () => {
    const view = mountSlashEditor('/');
    const trigger = getSlashTrigger(view.state);
    expect(trigger).toEqual({ slashPos: 0, queryFrom: 1, query: '' });
  });

  it('detects a slash with leading whitespace as the first non-whitespace char', () => {
    const view = mountSlashEditor('   /', 4);
    const trigger = getSlashTrigger(view.state);
    expect(trigger?.slashPos).toBe(3);
    expect(trigger?.query).toBe('');
  });

  it('returns the query when cursor sits in the middle of the typed text', () => {
    const view = mountSlashEditor('/he', 3);
    const trigger = getSlashTrigger(view.state);
    expect(trigger?.slashPos).toBe(0);
    expect(trigger?.query).toBe('he');
  });

  it('returns null when the line has a non-whitespace char before the slash (e.g. list-item prefix)', () => {
    // spec §1 v1 不做列表项内触发；列表项的行首标记 `-` 是非空白非斜杠字符
    // → regex `^\s*\/` 失配 → null
    const view = mountSlashEditor('- /foo', 6);
    expect(getSlashTrigger(view.state)).toBeNull();
  });

  it('returns null inside a quote block (regex path: line starts with `>`, block check is defensive)', () => {
    // 引用行 `> foo` 行首是 `>`：regex `^\s*\/` 在第一层即失配（块判定为防御层）
    const view = mountSlashEditor('> foo', 5);
    expect(getSlashTrigger(view.state)).toBeNull();
  });

  it('returns null inside fenced code blocks', () => {
    // 光标落在 fence 内部的 '/h' 行末 → regex 通过 → 块判定为 codeFence → null
    // （真正走到块判定分支的用例：fence 与下面的 frontmatter）
    const fenceDoc = '```\n/h\n```';
    const view = mountSlashEditor(fenceDoc, fenceDoc.indexOf('h') + 1);
    expect(getSlashTrigger(view.state)).toBeNull();
  });

  it('returns null inside frontmatter (slash-leading line reaches the block check branch)', () => {
    // frontmatter 内的 `/h1` 行：regex 通过，块判定为 frontmatter → null
    // （互审 F2：光标必须落在以 `/` 开头的行上才会真正执行到块判定分支）
    const fmDoc = '---\n/h1\n---\nfoo';
    const view = mountSlashEditor(fmDoc, fmDoc.indexOf('1') + 1);
    expect(getSlashTrigger(view.state)).toBeNull();
  });

  it('returns null when the line first non-whitespace char is not a slash', () => {
    const view = mountSlashEditor('hello /x');
    expect(getSlashTrigger(view.state)).toBeNull();
  });

  it('returns null when the selection is not a single cursor', () => {
    const view = mountSlashEditor('/abc', 3);
    view.dispatch({ selection: { anchor: 0, head: 3 } });
    expect(getSlashTrigger(view.state)).toBeNull();
  });

  it('returns null when the state is read-only', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const readonly = new EditorView({
      state: EditorState.create({
        doc: '/',
        selection: { anchor: 1 },
        extensions: [EditorState.readOnly.of(true)],
      }),
      parent: host,
    });
    mountedViews.push(readonly);
    expect(getSlashTrigger(readonly.state)).toBeNull();
  });
});

// ─── 2. 过滤（spec §10.1.2） ──────────────────────────────────────────

describe('filterSlashItems', () => {
  const items = buildSlashItems();

  it('matches against the localized label (zh-CN default in tests)', () => {
    const out = filterSlashItems(items, '标题');
    const ids = out.map((i) => i.id);
    expect(ids).toContain('heading1');
    expect(ids).toContain('heading2');
    expect(ids).toContain('heading3');
  });

  it('matches the ascii alias h1 regardless of locale', () => {
    const out = filterSlashItems(items, 'h1');
    expect(out.length).toBeGreaterThan(0);
    expect(out[0]?.id).toBe('heading1');
  });

  it('matches the table alias and the literal table entry', () => {
    const out = filterSlashItems(items, 'table');
    expect(out.length).toBeGreaterThan(0);
    expect(out[0]?.id).toBe('table');
  });

  it('is case-insensitive (h1 / H1 / H1 mixed)', () => {
    const a = filterSlashItems(items, 'H1');
    const b = filterSlashItems(items, 'h1');
    const c = filterSlashItems(items, 'H1'.toLowerCase());
    expect(a.length).toBe(b.length);
    expect(a.length).toBe(c.length);
  });

  it('returns the full list when the query is empty', () => {
    expect(filterSlashItems(items, '').length).toBe(items.length);
  });

  it('returns an empty array when nothing matches', () => {
    const out = filterSlashItems(items, 'zzz');
    expect(out).toEqual([]);
  });
});

// ─── 3. 插入文本与光标落点（spec §10.1.3） ─────────────────────────────

describe('applySlashItem insert text and cursor landing (spec §3 table)', () => {
  function insertAndExpect(
    query: string,
    id: SlashItemId,
    expectedDoc: string,
    expectedHead: number,
  ) {
    const view = mountSlashEditor(query);
    expect(applySlashItem(view, id)).toBe(true);
    expect(view.state.doc.toString()).toBe(expectedDoc);
    expect(view.state.selection.main.head).toBe(expectedHead);
  }

  it('heading1: `# ` with cursor after the space', () => {
    insertAndExpect('/', 'heading1', '# ', 2);
  });

  it('heading2: `## ` with cursor after the space', () => {
    insertAndExpect('/', 'heading2', '## ', 3);
  });

  it('heading3: `### ` with cursor after the space', () => {
    insertAndExpect('/', 'heading3', '### ', 4);
  });

  it('bulletList: `- ` with cursor after the space', () => {
    insertAndExpect('/', 'bulletList', '- ', 2);
  });

  it('orderedList: `1. ` with cursor after the space', () => {
    insertAndExpect('/', 'orderedList', '1. ', 3);
  });

  it('taskList: `- [ ] ` with cursor after the closing bracket', () => {
    insertAndExpect('/', 'taskList', '- [ ] ', 6);
  });

  it('quote: `> ` with cursor after the space', () => {
    insertAndExpect('/', 'quote', '> ', 2);
  });

  it('codeBlock: three-backtick fence with cursor on the middle line', () => {
    insertAndExpect('/', 'codeBlock', '```\n\n```', 4);
  });

  it('table: header + separator + one data row, cursor at first data cell', () => {
    // 数据行起点 = 7(表头)+1+13(分隔)+1 = 22；光标在首格内 offset 2（|␣▮␣|␣␣|）
    insertAndExpect('/', 'table', '|  |  |\n| --- | --- |\n|  |  |', 22 + 2);
  });

  it('divider: `---` followed by newline with cursor on the new line', () => {
    insertAndExpect('/', 'divider', '---\n', 4);
  });
});

// ─── 4. 触发文本替换语义（spec §10.1.4） ─────────────────────────────

describe('applySlashItem trigger text replacement semantics', () => {
  it('preserves leading whitespace before the slash', () => {
    const view = mountSlashEditor('   /h1', 6);
    expect(applySlashItem(view, 'heading1')).toBe(true);
    // 触发段 `   /h1` 整段替换为 `# `，光标在 `# ` 末尾
    expect(view.state.doc.toString()).toBe('   # ');
    expect(view.state.selection.main.head).toBe(5);
  });

  it('keeps trailing text after the trigger verbatim', () => {
    const view = mountSlashEditor('/h1tail', 3);
    expect(applySlashItem(view, 'heading1')).toBe(true);
    // 触发段 `/h1`（0..3）替换为 `# `，尾部 `tail` 紧跟其后
    expect(view.state.doc.toString()).toBe('# tail');
    expect(view.state.selection.main.head).toBe(2);
  });
});

// ─── 5. 仲裁（spec §10.1.5） ─────────────────────────────────────────

describe('keymap arbitration', () => {
  it('consumes ArrowDown / ArrowUp / Enter / Tab / Escape while menu is open', async () => {
    const view = mountSlashEditor('');
    // 用真实 change 触发 update() → 菜单打开（spec §2「每次文档变化后求值」）。
    // 注意必须显式带 selection：CM6 对「在光标处插入」默认把光标映射到插入点之前，
    // 真实键入路径光标在插入文本之后——单测里以 selection 模拟真实落点。
    view.dispatch({
      changes: { from: 0, to: 0, insert: '/' },
      selection: { anchor: 1 },
    });
    const ctrl = getSlashMenuController(view);
    expect(ctrl?.isOpen()).toBe(true);
    expect(ctrl?.selectBy(1)).toBe(true);
    expect(ctrl?.selectBy(-1)).toBe(true);
    expect(ctrl?.dismiss()).toBe(true);
    // 重新打开（dismiss 后字符仍在，可再次触发）
    expect(getSlashTrigger(view.state)).not.toBeNull();
  });

  it('passes through all keys when the menu is closed', () => {
    const view = mountSlashEditor('hello');
    const ctrl = getSlashMenuController(view);
    expect(ctrl?.isOpen()).toBe(false);
    expect(ctrl?.selectBy(1)).toBe(false);
    expect(ctrl?.confirm()).toBe(false);
    expect(ctrl?.dismiss()).toBe(false);
    // 不应修改文档
    expect(view.state.doc.toString()).toBe('hello');
  });

  it('pressing ArrowDown through the keymap does not mutate the doc when menu is open', () => {
    const view = mountSlashEditor('/');
    pressKey(view, 'ArrowDown');
    expect(view.state.doc.toString()).toBe('/');
  });

  it('passes ArrowDown through to the editor when the menu is closed (no interception)', () => {
    const view = mountSlashEditor('hi');
    pressKey(view, 'ArrowDown');
    // 菜单关闭时本扩展不拦截：文档不受影响（下游 defaultKeymap 的 ArrowDown
    // 只移动光标不改文本；本视图未挂 defaultKeymap，此处锁定「无本扩展副作用」）
    expect(view.state.doc.toString()).toBe('hi');
  });

  it('consumes Tab through the keymap when the menu is open (confirm fires)', () => {
    const view = mountSlashEditor('');
    // 触发一次 doc change → update() → 菜单打开；selection 落点见上组用例注释
    view.dispatch({
      changes: { from: 0, to: 0, insert: '/' },
      selection: { anchor: 1 },
    });
    expect(getSlashMenuController(view)?.isOpen()).toBe(true);
    pressKey(view, 'Tab');
    // 第一个条目是 heading1（buildSlashItems 顺序固定）
    expect(view.state.doc.toString()).toBe('# ');
  });

  it('closes the menu when the state flips to read-only mid-session', () => {
    // 互审 F3：readOnly compartment 重配不产生 doc/selection/focus 变化，
    // 菜单必须随 update 的 readOnly 检查关闭，不得悬空吞键。
    // 注意：compartment 必须在初始扩展里注册，reconfigure 才会生效。
    const host = document.createElement('div');
    document.body.append(host);
    const view = new EditorView({
      state: EditorState.create({
        doc: '/',
        selection: { anchor: 1 },
        extensions: [history(), readOnlyCompartment.of([]), ...slashCommandsExtension()],
      }),
      parent: host,
    });
    mountedViews.push(view);
    view.focus();
    view.dispatch({ selection: { anchor: 1 } });
    expect(getSlashMenuController(view)?.isOpen()).toBe(true);
    view.dispatch({
      effects: readOnlyCompartment.reconfigure([
        EditorState.readOnly.of(true),
        EditorView.editable.of(false),
      ]),
    });
    expect(getSlashMenuController(view)?.isOpen()).toBe(false);
  });

  it('defers an item picked during active composition until compositionend', async () => {
    // 互审 F4 / spec §5「插入延后执行」：组合中确认条目 → 不插；组合落定后冲刷
    const view = mountSlashEditor('/');
    view.dispatch({ selection: { anchor: 1 } });
    expect(getSlashMenuController(view)?.isOpen()).toBe(true);
    const ctrl = getSlashMenuController(view);
    startIme(view);
    expect(ctrl?.confirm()).toBe(true); // 消费但不插入
    expect(view.state.doc.toString()).toBe('/');
    endIme(view); // compositionend → setTimeout(0) 后冲刷延后的插入
    await vi.waitFor(() => {
      expect(view.state.doc.toString()).toBe('# ');
    });
  });
});

// ─── 5b. ghost 优先级（spec §4 + §10.1.5：结构性断言） ────────────────

describe('ghost text has strict Tab/Escape priority over the slash menu', () => {
  function mountGhostSlashEditor() {
    const host = document.createElement('div');
    document.body.append(host);
    // stub 预测器：第 1 次是挂载即发的预测（会被丢弃），第 2 次（doc 变化
    // 后的重预测）才是可见 ghost；第 3 次起为空——保证 Escape 拒绝/Tab 接受
    // 后不再复现 ghost，「Escape #2 到达菜单」不被截走（确定性时序）
    let ghostCalls = 0;
    const predictor = {
      getGhostText: vi.fn((cursor: number) => {
        ghostCalls += 1;
        if (ghostCalls > 2) return null;
        return {
          text: ' world',
          confidence: 0.9,
          from: cursor,
          source: 'ngram' as const,
          sourceLayer: 'l2',
          syntaxType: 'general',
          providerId: 'ngram',
          learnable: true,
          feedbackToken: 'prediction-1',
        };
      }),
      acceptCompletion: vi.fn(),
      rejectCompletion: vi.fn(),
    } as unknown as MarkdownPredictor;
    const view = new EditorView({
      state: EditorState.create({
        doc: '/hello',
        selection: { anchor: '/hello'.length },
        extensions: [
          history(),
          ghostTextPlugin(predictor, DEFAULT_COMPLETION_SETTINGS),
          ...slashCommandsExtension(),
        ],
      }),
      parent: host,
    });
    mountedViews.push(view);
    view.focus();
    return { view, predictor };
  }

  it('Tab goes to ghost (accepted), never to the slash menu insert', async () => {
    const { view, predictor } = mountGhostSlashEditor();
    // 打开斜杠菜单：模拟一次真实键入（doc 变化触发重判）。不能用「挂载后
    // 立刻派发选区」——那会作废 ghost 的首个预测请求，而其重试又因请求键
    // 相同被去重短路，ghost 将永不出现（ghost 插件既有边角，与本扩展无关）。
    view.dispatch({
      changes: { from: '/hello'.length, to: '/hello'.length, insert: 'o' },
      selection: { anchor: '/hello'.length + 1 },
    });
    expect(getSlashMenuController(view)?.isOpen()).toBe(true);
    // 等待 ghost 出现（Prec.highest 注册于本扩展之前；jsdom 下 ghost 渲染
    // 走延迟调度，放宽等待上限）
    await vi.waitFor(
      () => {
        expect(view.dom.querySelector('.cm-ghost-text')).not.toBeNull();
      },
      { timeout: 3000 },
    );

    // Tab：ghost 先吃 → 接受预测文本；斜杠菜单不插入（doc 不是 `# `）且保持打开
    pressKey(view, 'Tab');
    expect(predictor.acceptCompletion).toHaveBeenCalledTimes(1);
    expect(view.state.doc.toString()).toBe('/helloo world');
    expect(getSlashMenuController(view)?.isOpen()).toBe(true);
  });

  it('Escape #1 rejects the ghost (menu survives); Escape #2 closes the menu', async () => {
    const { view, predictor } = mountGhostSlashEditor();
    view.dispatch({
      changes: { from: '/hello'.length, to: '/hello'.length, insert: 'o' },
      selection: { anchor: '/hello'.length + 1 },
    });
    expect(getSlashMenuController(view)?.isOpen()).toBe(true);
    await vi.waitFor(
      () => {
        expect(view.dom.querySelector('.cm-ghost-text')).not.toBeNull();
      },
      { timeout: 3000 },
    );

    // Escape：ghost 可见时归 ghost（拒绝、清预测）——菜单保持打开
    pressKey(view, 'Escape');
    expect(predictor.rejectCompletion).toHaveBeenCalledTimes(1);
    expect(getSlashMenuController(view)?.isOpen()).toBe(true);

    // 第二次 Escape：ghost 已清，才轮到斜杠菜单关闭
    pressKey(view, 'Escape');
    expect(getSlashMenuController(view)?.isOpen()).toBe(false);
  });
});

// ─── 6. readOnly / IME 守卫（spec §10.1.6） ───────────────────────────

describe('readOnly and IME guards', () => {
  it('applySlashItem returns false on a read-only state', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const view = new EditorView({
      state: EditorState.create({
        doc: '/',
        selection: { anchor: 1 },
        extensions: [EditorState.readOnly.of(true)],
      }),
      parent: host,
    });
    mountedViews.push(view);
    expect(applySlashItem(view, 'heading1')).toBe(false);
  });

  it('returns false while composing (applySlashItem entry guard)', () => {
    const view = mountSlashEditor('/');
    startIme(view);
    expect(view.composing || view.compositionStarted).toBe(true);
    expect(applySlashItem(view, 'heading1')).toBe(false);
    expect(view.state.doc.toString()).toBe('/');
    endIme(view);
  });

  it('keymap commands stay inert while composing', () => {
    const view = mountSlashEditor('/');
    startIme(view);
    pressKey(view, 'Enter');
    pressKey(view, 'Tab');
    pressKey(view, 'Escape');
    expect(view.state.doc.toString()).toBe('/');
    endIme(view);
  });
});

// ─── 7. 撤销（spec §10.1.7） ─────────────────────────────────────────

describe('undo restores pre-trigger text in one step', () => {
  it('inserts then undoes back to the trigger line', () => {
    const view = mountSlashEditor('/h1');
    expect(applySlashItem(view, 'heading1')).toBe(true);
    expect(view.state.doc.toString()).toBe('# ');
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe('/h1');
  });

  it('inserts then undoes back even with leading whitespace preserved', () => {
    const view = mountSlashEditor('  /h1', 5);
    expect(applySlashItem(view, 'heading1')).toBe(true);
    expect(view.state.doc.toString()).toBe('  # ');
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe('  /h1');
  });
});
