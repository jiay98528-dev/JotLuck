import { markdown } from '@codemirror/lang-markdown';
import { EditorState, type Extension } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  __parseLiveBlocksForTest,
  exitLivePreviewOnEscape,
  livePreviewExtension,
  revealLivePreviewSourceAt,
  toggleBlockRender,
  unpinFocusedBlock,
} from '../cm6-live-preview';

const mountedViews: EditorView[] = [];

function mountLiveEditor(doc: string, anchor: number, extensions: Extension[] = []): EditorView {
  const host = document.createElement('div');
  document.body.append(host);
  const view = new EditorView({
    state: EditorState.create({
      doc,
      selection: { anchor },
      extensions: [
        keymap.of([
          {
            key: 'Enter',
            run: (target) => {
              const cursor = target.state.selection.main.head;
              target.dispatch({ changes: { from: cursor, insert: '\n' } });
              return true;
            },
          },
        ]),
        livePreviewExtension(),
        ...extensions,
      ],
    }),
    parent: host,
  });
  mountedViews.push(view);
  view.focus();
  return view;
}

function findRenderedBlock(view: EditorView, text: string): HTMLElement | undefined {
  return [...view.dom.querySelectorAll<HTMLElement>('.cm-live-block')].find((block) =>
    block.textContent?.includes(text),
  );
}

afterEach(() => {
  while (mountedViews.length > 0) mountedViews.pop()?.destroy();
  document.body.replaceChildren();
});

describe('cm6 live preview table rendering', () => {
  it('renders table rows with a shared grid template instead of fake table cells', () => {
    const blocks = __parseLiveBlocksForTest(
      ['| 维度 | 评分 | 说明 |', '| :--- | ---: | :--- |', '| 前端开发 | 85 | React 主力栈 |'].join(
        '\n',
      ),
    );

    const rows = blocks.filter((block) => block.type === 'tableRow');
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ tableColumnCount: 3, tableHeader: true });
    expect(rows[1]).toMatchObject({ position: 'separator' });
    expect(rows[2]?.tableGridTemplate).toBe(rows[0]?.tableGridTemplate);
    expect(rows[0]?.html).toContain('ml-table-cell--header');
    expect(rows[0]?.html).toContain('data-table-column-count="3"');
    expect(rows[2]?.html).toContain('ml-table-cell--align-right');
    expect(rows[2]?.html).not.toContain('ml-td');
  });

  it('marks table rows without a separator as unclosed', () => {
    const rows = __parseLiveBlocksForTest('| A | B |\n| C | D |').filter(
      (block) => block.type === 'tableRow',
    );

    expect(rows.every((row) => row.unclosed)).toBe(true);
  });
});

describe('cm6 live preview markdown block boundaries', () => {
  it('keeps remote image controls interactive without revealing source', async () => {
    const doc = '![remote](https://cdn.example.com/image.png)\n\nTail';
    const onRemoteImageClick = vi.fn(() => true);
    const host = document.createElement('div');
    document.body.append(host);
    const view = new EditorView({
      state: EditorState.create({
        doc,
        selection: { anchor: doc.length },
        extensions: [
          livePreviewExtension({
            remoteImages: {
              scopeId: 'test-scope',
              labels: {
                blocked: 'blocked',
                source: 'source',
                loadAll: 'load all',
                loading: 'loading',
                failed: 'failed',
                retry: 'retry',
                insecure: 'insecure',
                unnamed: 'image',
              },
              decide: () => 'blocked',
            },
            onRemoteImageClick,
          }),
        ],
      }),
      parent: host,
    });
    mountedViews.push(view);

    await vi.waitFor(() => {
      expect(view.dom.querySelector('[data-remote-image-action="load-all"]')).not.toBeNull();
    });
    const selectionBefore = view.state.selection.main.head;
    view.dom.querySelector<HTMLButtonElement>('[data-remote-image-action="load-all"]')?.click();

    expect(onRemoteImageClick).toHaveBeenCalledOnce();
    expect(view.state.selection.main.head).toBe(selectionBefore);
    expect(view.dom.querySelector('[data-remote-image-action="load-all"]')).not.toBeNull();
  });

  it('keeps setext heading text and rule as paired heading blocks', () => {
    const blocks = __parseLiveBlocksForTest('Release Notes\n---\n\nBody text');

    expect(blocks[0]).toMatchObject({
      type: 'setextHeadingText',
      raw: 'Release Notes',
    });
    expect(blocks[0]?.html).toContain('Release Notes');
    expect(blocks[0]?.html).toContain('<h2 id="heading-release-notes">');
    expect(blocks[1]).toMatchObject({
      type: 'setextHeadingRule',
      raw: '---',
    });
    expect(blocks[1]?.html).toBe('');
  });

  it('keeps fenced JSON as code fence lines instead of wrapping it as bare JSON', () => {
    const blocks = __parseLiveBlocksForTest(
      ['```json', '{', '  "ok": true', '}', '```'].join('\n'),
    );

    expect(blocks).toHaveLength(5);
    expect(blocks.every((block) => block.type === 'codeFenceLine')).toBe(true);
    expect(blocks[0]?.html).toContain('cm-code-lang');
    expect(blocks[2]?.html).toContain('"ok": true');
  });

  it('renders fenced code containing blank lines without crashing the view plugin', async () => {
    const doc = ['```json', '{', '', '  "ok": true', '}', '```', '', '# End'].join('\n');
    const host = document.createElement('div');
    document.body.append(host);
    const view = new EditorView({
      state: EditorState.create({
        doc,
        selection: { anchor: doc.length },
        extensions: [livePreviewExtension()],
      }),
      parent: host,
    });
    mountedViews.push(view);

    await vi.waitFor(() => {
      expect(
        view.dom.querySelectorAll('.cm-live-block[data-block-type="codeFenceLine"]').length,
      ).toBeGreaterThanOrEqual(6);
    });
    expect(view.state.doc.toString()).toBe(doc);
  });

  it('renders a bare JSON block with preserved indentation', () => {
    const blocks = __parseLiveBlocksForTest(['{', '  "ok": true', '}'].join('\n'));

    expect(blocks).toHaveLength(3);
    expect(blocks.every((block) => block.type === 'jsonBlockLine')).toBe(true);
    expect(blocks[0]?.html).toContain('cm-json-line');
    expect(blocks[1]?.html).toContain('&nbsp;&nbsp;');
  });

  it('recognizes GFM tables without outer pipes', () => {
    const rows = __parseLiveBlocksForTest(
      ['Name | Score', '--- | ---:', 'JotLuck | 95'].join('\n'),
    ).filter((block) => block.type === 'tableRow');

    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ tableHeader: true, tableColumnCount: 2 });
    expect(rows[2]?.html).toContain('ml-table-cell--align-right');
  });
});

describe('cm6 live preview Escape focus contract', () => {
  it('reveals an exact programmatic target before editor focus settles', async () => {
    const doc = ['# 欢迎使用 JotLuck', '', 'Rendered sibling'].join('\n');
    const view = mountLiveEditor(doc, doc.indexOf('Rendered sibling'));
    view.contentDOM.blur();

    await vi.waitFor(() => {
      expect(findRenderedBlock(view, '欢迎使用 JotLuck')).toBeDefined();
    });

    const target = doc.indexOf('欢迎使用');
    revealLivePreviewSourceAt(view, target);

    expect(view.hasFocus).toBe(false);
    expect(view.state.selection.main.head).toBe(target);
    expect(findRenderedBlock(view, '欢迎使用 JotLuck')).toBeUndefined();
  });

  it('restores the exact edited block and lets Enter return to source editing', async () => {
    const doc = ['# First', '', 'Unique edited paragraph'].join('\n');
    const anchor = doc.indexOf('Unique') + 3;
    const view = mountLiveEditor(doc, anchor);

    await vi.waitFor(() => {
      expect(findRenderedBlock(view, 'First')).toBeDefined();
      expect(findRenderedBlock(view, 'Unique edited paragraph')).toBeUndefined();
    });

    expect(unpinFocusedBlock(view)).toBe(true);
    await vi.waitFor(() => {
      const restored = findRenderedBlock(view, 'Unique edited paragraph');
      expect(restored).toBeDefined();
      expect(document.activeElement).toBe(restored);
    });
    expect(view.state.doc.toString()).toBe(doc);

    const restored = findRenderedBlock(view, 'Unique edited paragraph')!;
    restored.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    );

    await vi.waitFor(() => {
      expect(view.hasFocus).toBe(true);
      expect(findRenderedBlock(view, 'Unique edited paragraph')).toBeUndefined();
    });
    expect(view.state.selection.main.head).toBe(doc.indexOf('Unique'));
    expect(view.state.doc.toString()).toBe(doc);
  });

  it('retries focus transfer when a restored widget declines the first focus calls', async () => {
    const doc = ['Rendered sibling', '', 'WebKit focus target'].join('\n');
    const view = mountLiveEditor(doc, doc.indexOf('WebKit') + 2);
    const nativeFocus = HTMLElement.prototype.focus;
    let declinedCalls = 0;
    const focusSpy = vi.spyOn(HTMLElement.prototype, 'focus').mockImplementation(function (
      this: HTMLElement,
      options?: FocusOptions,
    ) {
      if (this.classList.contains('cm-live-block') && declinedCalls < 2) {
        declinedCalls++;
        return;
      }
      nativeFocus.call(this, options);
    });

    try {
      expect(unpinFocusedBlock(view)).toBe(true);
      await vi.waitFor(() => {
        const restored = findRenderedBlock(view, 'WebKit focus target');
        expect(restored).toBeDefined();
        expect(document.activeElement).toBe(restored);
      });
      expect(declinedCalls).toBe(2);
    } finally {
      focusSpy.mockRestore();
    }
  });

  it('cleans a pending focus transfer synchronously when the editor is destroyed', () => {
    const doc = ['Rendered sibling', '', 'Disposable focus target'].join('\n');
    const view = mountLiveEditor(doc, doc.indexOf('Disposable') + 2);
    const addSpy = vi.spyOn(document, 'addEventListener');
    const removeSpy = vi.spyOn(document, 'removeEventListener');
    const lifecycleEvents = new Set(['pointerdown', 'keydown', 'beforeinput', 'compositionstart']);

    try {
      expect(unpinFocusedBlock(view)).toBe(true);
      const registrations = addSpy.mock.calls.filter(([type]) => lifecycleEvents.has(type));
      expect(registrations).toHaveLength(4);

      view.destroy();
      mountedViews.splice(mountedViews.indexOf(view), 1);

      for (const [type, listener] of registrations) {
        expect(removeSpy).toHaveBeenCalledWith(type, listener, true);
      }
    } finally {
      addSpy.mockRestore();
      removeSpy.mockRestore();
    }
  });

  it('unpins a pinned block before restoring and focusing that same rendered block', async () => {
    const doc = ['Rendered sibling', '', 'Pinned unique paragraph'].join('\n');
    const anchor = doc.indexOf('Pinned') + 2;
    const view = mountLiveEditor(doc, anchor);

    expect(toggleBlockRender(view)).toBe(true);
    expect(unpinFocusedBlock(view)).toBe(true);

    await vi.waitFor(() => {
      const restored = findRenderedBlock(view, 'Pinned unique paragraph');
      expect(restored).toBeDefined();
      expect(document.activeElement).toBe(restored);
    });
    expect(view.state.doc.toString()).toBe(doc);
  });

  it('restores by document position when editing changes the block type and key', async () => {
    const doc = ['## Mutable heading', '', 'Rendered sibling'].join('\n');
    const view = mountLiveEditor(doc, doc.indexOf('Mutable') + 2);

    view.dispatch({
      changes: { from: 0, to: 3, insert: 'GUI ' },
      selection: { anchor: 4 },
    });
    expect(unpinFocusedBlock(view)).toBe(true);

    await vi.waitFor(() => {
      const restored = findRenderedBlock(view, 'GUI Mutable heading');
      expect(restored).toBeDefined();
      expect(document.activeElement).toBe(restored);
    });
    expect(view.state.doc.toString()).toBe(
      ['GUI Mutable heading', '', 'Rendered sibling'].join('\n'),
    );
  });

  it('does not consume Escape or restore the block while IME composition is active', async () => {
    const doc = ['Rendered sibling', '', '正在输入的段落'].join('\n');
    const anchor = doc.indexOf('正在输入') + 2;
    const view = mountLiveEditor(doc, anchor);
    view.contentDOM.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));

    expect(view.composing || view.compositionStarted).toBe(true);
    expect(exitLivePreviewOnEscape(view)).toBe(false);
    expect(view.hasFocus).toBe(true);
    expect(findRenderedBlock(view, '正在输入的段落')).toBeUndefined();
    expect(view.state.doc.toString()).toBe(doc);

    view.contentDOM.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
  });
});

describe('cm6 live preview list rendering', () => {
  it('renders ordered list numbers in a dedicated marker column', () => {
    const rows = __parseLiveBlocksForTest('1. Alpha\n1. Beta').filter(
      (block) => block.type === 'orderedListItem',
    );

    expect(rows).toHaveLength(2);
    expect(rows[0]?.html).toContain('cm-list-marker-slot');
    expect(rows[0]?.html).toContain('cm-list-content');
    expect(rows[0]?.html).toContain('>1.</span>');
    expect(rows[1]?.html).toContain('>2.</span>');
  });

  it('renders unordered list bullets in the same stable list structure', () => {
    const [row] = __parseLiveBlocksForTest('- Alpha').filter(
      (block) => block.type === 'unorderedListItem',
    );

    expect(row?.html).toContain('cm-list-marker-slot');
    expect(row?.html).toContain('cm-list-content');
    expect(row?.html).toContain('Alpha');
  });
});

describe('cm6 live preview unified AST adapter', () => {
  it('uses source offsets even when fullwidth normalization changes line length', () => {
    // ＞引用 归一化为 '> 引用'（插入空白、行变长）；from 必须是源码偏移。
    // 源码行 0 '＞引用' 长 3 → 第 2 行起点 = 3+1+0+1 = 5；按归一化文本算是 6（旧实现漂移）。
    const blocks = __parseLiveBlocksForTest('＞引用\n\n# X');

    expect(blocks[0]).toMatchObject({ type: 'blockquoteLine', position: 'single' });
    expect(blocks[0]?.html).toContain('data-block-from="0"');
    expect(blocks[1]).toMatchObject({ type: 'heading' });
    expect(blocks[1]?.html).toContain('data-block-from="5"');
  });

  it('treats tilde fences as code fence lines', () => {
    // 明示收紧：AST 支持 ~~~ 围栏（旧实现仅 ```）
    const blocks = __parseLiveBlocksForTest(['~~~js', 'const a = 1;', '~~~'].join('\n'));

    expect(blocks).toHaveLength(3);
    expect(blocks.every((block) => block.type === 'codeFenceLine')).toBe(true);
    expect(blocks[0]?.position).toBe('first');
    expect(blocks[2]?.position).toBe('last');
    expect(blocks.every((block) => !block.unclosed)).toBe(true);
  });

  it('accepts a closing fence longer than the opener', () => {
    // 明示收紧：AST 闭合规则为「同字符且长度 ≥ 开围栏」（旧实现要求等长）
    const blocks = __parseLiveBlocksForTest('```\nx\n````');

    expect(blocks).toHaveLength(3);
    expect(blocks.every((block) => block.type === 'codeFenceLine')).toBe(true);
    expect(blocks.every((block) => !block.unclosed)).toBe(true);
    expect(blocks[2]?.position).toBe('last');
  });

  it('marks an unclosed tilde fence as unclosed', () => {
    const blocks = __parseLiveBlocksForTest('~~~\ncode');

    expect(blocks.every((block) => block.type === 'codeFenceLine')).toBe(true);
    expect(blocks.every((block) => block.unclosed)).toBe(true);
  });

  it('keeps dash-bracket task markers as task list items', () => {
    const blocks = __parseLiveBlocksForTest('- [x] done\n- [ ] todo');

    expect(blocks).toHaveLength(2);
    expect(blocks.every((block) => block.type === 'taskListItem')).toBe(true);
  });

  it('downgrades star-bullet and uppercase-X tasks to plain bullets', () => {
    const blocks = __parseLiveBlocksForTest('* [x] star\n- [X] upper');

    expect(blocks).toHaveLength(2);
    expect(blocks.every((block) => block.type === 'unorderedListItem')).toBe(true);
  });

  it('treats a fullwidth-dash task marker as a task list item', () => {
    // 现行语义：旧实现先归一化（行首 － → -）再判定任务，适配器在源码切片上等价处理
    const [block] = __parseLiveBlocksForTest('－ [x] 全角');

    expect(block?.type).toBe('taskListItem');
  });

  it('downgrades paren-delimited ordered items to paragraphs', () => {
    const blocks = __parseLiveBlocksForTest('1) nope');

    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.type).toBe('paragraph');
  });

  it('renumbers ordered items within runs split by a paren downgrade', () => {
    const blocks = __parseLiveBlocksForTest('1. a\n2) skip\n3. c');
    const ordered = blocks.filter((block) => block.type === 'orderedListItem');

    expect(ordered).toHaveLength(2);
    expect(blocks.find((block) => block.raw === '2) skip')?.type).toBe('paragraph');
    expect(ordered[0]?.html).toContain('>1.</span>');
    expect(ordered[1]?.html).toContain('>1.</span>');
  });
});

describe('cm6 live preview focused-line ghost syntax', () => {
  it('ghosts both bold markers in the focused block and tags the focused line', async () => {
    const doc = '# 标题\n\n**加粗**正文\n\n尾段';
    const view = mountLiveEditor(doc, doc.indexOf('正文'), [markdown()]);

    await vi.waitFor(() => {
      expect(view.dom.querySelectorAll('.cm-live-ghost-mark')).toHaveLength(2);
    });
    const marks = [...view.dom.querySelectorAll('.cm-live-ghost-mark')];
    expect(marks.map((mark) => mark.textContent)).toEqual(['**', '**']);
    expect(view.dom.querySelector('.cm-live-focused-source')).not.toBeNull();
  });

  it('leaves non-focused blocks rendered with the ghost count unchanged', async () => {
    const doc = '# 标题\n\n**加粗**正文\n\n尾段';
    const view = mountLiveEditor(doc, doc.indexOf('正文'), [markdown()]);

    await vi.waitFor(() => {
      expect(view.dom.querySelectorAll('.cm-live-ghost-mark')).toHaveLength(2);
    });
    // 标题块未被聚焦，仍是 RenderedBlockWidget（带 data-block-key 的渲染外壳）
    expect(view.dom.querySelector('[data-block-key]')).not.toBeNull();
    expect(view.dom.querySelectorAll('.cm-live-ghost-mark')).toHaveLength(2);
  });

  it('keeps a pinned block at full contrast even while its source holds the cursor', async () => {
    const doc = ['Rendered sibling', '', '**Pinned** paragraph'].join('\n');
    const anchor = doc.indexOf('Pinned') + 2;
    const view = mountLiveEditor(doc, anchor, [markdown()]);

    expect(toggleBlockRender(view)).toBe(true);
    // pin effect 本身不触发重建，补一次选区事务驱动 rebuild
    view.dispatch({ selection: { anchor } });

    await vi.waitFor(() => {
      expect(view.dom.querySelector('[data-block-key]')).not.toBeNull();
    });
    expect(view.dom.querySelectorAll('.cm-live-ghost-mark')).toHaveLength(0);
  });

  it('keeps the block above an empty cursor line in ghost mode with focused-source line class', async () => {
    const doc = '**粗**\n\n';
    // 光标必须在紧邻上一块的空行（位置 6）：再往后的空行不满足 block.to === cursorLine.from - 1
    const view = mountLiveEditor(doc, doc.length - 1, [markdown()]);

    await vi.waitFor(() => {
      expect(view.dom.querySelectorAll('.cm-live-ghost-mark')).toHaveLength(2);
    });
    expect(view.dom.querySelector('.cm-live-focused-source')).not.toBeNull();
    // 零宽隐藏路线已退役（WO-C3）
    expect(view.dom.querySelector('.cm-live-source-marker')).toBeNull();
  });

  it('ghosts emphasis markers when a block is revealed programmatically', async () => {
    const doc = ['**揭示**目标段落', '', '光标所在段落'].join('\n');
    const view = mountLiveEditor(doc, doc.indexOf('光标'), [markdown()]);

    await vi.waitFor(() => {
      expect(findRenderedBlock(view, '揭示')).toBeDefined();
    });
    revealLivePreviewSourceAt(view, doc.indexOf('揭示') + 2);

    await vi.waitFor(() => {
      expect(view.dom.querySelectorAll('.cm-live-ghost-mark')).toHaveLength(2);
    });
  });

  it('adds only the line hook when a plain paragraph without emphasis is focused', async () => {
    const doc = ['# 标题', '', '没有任何强调符号的段落', '', '尾段'].join('\n');
    const view = mountLiveEditor(doc, doc.indexOf('没有任何'), [markdown()]);

    await vi.waitFor(() => {
      expect(view.dom.querySelector('.cm-live-focused-source')).not.toBeNull();
    });
    expect(view.dom.querySelectorAll('.cm-live-ghost-mark')).toHaveLength(0);
  });
});

describe('cm6 live preview focused-line ghost syntax rollout', () => {
  const ghostTexts = (view: EditorView): string[] =>
    [...view.dom.querySelectorAll('.cm-live-ghost-mark')].map((mark) => mark.textContent ?? '');

  it('ghosts the heading marker only, swallowing the following space', async () => {
    const doc = ['# 标题', '', '尾段'].join('\n');
    const view = mountLiveEditor(doc, 2, [markdown()]);

    await vi.waitFor(() => {
      expect(view.dom.querySelectorAll('.cm-live-ghost-mark')).toHaveLength(1);
    });
    const marks = ghostTexts(view);
    expect(marks[0]!.trim()).toBe('#');
    // 标题文本保持全对比度，不被幽灵化
    expect(marks.join('')).not.toContain('标题');
  });

  it('ghosts link marks and URL but leaves the link text at full contrast', async () => {
    const doc = ['[文字](https://e.com)', '', '尾段'].join('\n');
    const view = mountLiveEditor(doc, doc.indexOf('文字') + 1, [markdown()]);

    await vi.waitFor(() => {
      expect(view.dom.querySelectorAll('.cm-live-ghost-mark')).toHaveLength(5);
    });
    const merged = ghostTexts(view).join('');
    expect(merged).toContain('](https://e.com)');
    expect(merged).not.toContain('文字');
  });

  it('ghosts blockquote/list/task markers via AST markerRange, including fullwidth symbols', async () => {
    const doc = ['＞ 引用', '', '－ 项目', '', '1. 有序', '', '- [ ] 任务', '', '尾段'].join('\n');
    const view = mountLiveEditor(doc, doc.indexOf('引用'), [markdown()]);

    // 全角 ＞（含其后一个空白，AST markerRange 源码空间切分）
    await vi.waitFor(() => {
      expect(view.dom.querySelectorAll('.cm-live-ghost-mark')).toHaveLength(1);
    });
    expect(ghostTexts(view)[0]!.trim()).toBe('＞');

    // 全角 － bullet
    view.dispatch({ selection: { anchor: doc.indexOf('项目') } });
    await vi.waitFor(() => {
      expect(ghostTexts(view)).toEqual(['－']);
    });

    // 有序 `1.`（不含标记后空白）
    view.dispatch({ selection: { anchor: doc.indexOf('有序') } });
    await vi.waitFor(() => {
      expect(ghostTexts(view)).toEqual(['1.']);
    });

    // 任务 `- [ ]`（markerRange 含任务复选框）
    view.dispatch({ selection: { anchor: doc.indexOf('任务') } });
    await vi.waitFor(() => {
      expect(ghostTexts(view)).toEqual(['- [ ]']);
    });
  });

  it('ghosts only fence delimiter lines and frontmatter delimiter rows', async () => {
    // frontmatter 仅在文档第 0 行开启，须置于围栏之前
    const doc = ['---', 'title: x', '---', '', '```js', 'const a = 1;', '```', '', '尾段'].join(
      '\n',
    );
    const view = mountLiveEditor(doc, 1, [markdown()]);

    // frontmatter：仅 `---` 定界行幽灵，YAML 内容行不幽灵
    await vi.waitFor(() => {
      expect(view.dom.querySelectorAll('.cm-live-ghost-mark')).toHaveLength(1);
    });
    expect(ghostTexts(view)).toEqual(['---']);
    view.dispatch({ selection: { anchor: doc.indexOf('title') } });
    await vi.waitFor(() => {
      expect(view.dom.querySelectorAll('.cm-live-ghost-mark')).toHaveLength(0);
    });

    // 开围栏定界行（```+语言标签）幽灵，代码内容行不幽灵
    view.dispatch({ selection: { anchor: doc.indexOf('```js') } });
    await vi.waitFor(() => {
      expect(view.dom.querySelectorAll('.cm-live-ghost-mark')).toHaveLength(1);
    });
    expect(ghostTexts(view)).toEqual(['```js']);
    view.dispatch({ selection: { anchor: doc.indexOf('const') } });
    await vi.waitFor(() => {
      expect(view.dom.querySelectorAll('.cm-live-ghost-mark')).toHaveLength(0);
    });
  });

  it('ghosts each unescaped halfwidth pipe and fullwidth pipes in a focused table row', async () => {
    const doc = ['| a | b |', '', '尾段'].join('\n');
    const view = mountLiveEditor(doc, 3, [markdown()]);

    await vi.waitFor(() => {
      expect(view.dom.querySelectorAll('.cm-live-ghost-mark')).toHaveLength(3);
    });
    expect(ghostTexts(view)).toEqual(['|', '|', '|']);
  });

  it('skips escaped pipes in a focused table row', async () => {
    const doc = ['| a \\| b |', '', '尾段'].join('\n');
    const view = mountLiveEditor(doc, doc.indexOf('a'), [markdown()]);

    // 中间 `\|` 被转义不幽灵；行首/行尾两个半角 `|` 各一条
    await vi.waitFor(() => {
      expect(view.dom.querySelectorAll('.cm-live-ghost-mark')).toHaveLength(2);
    });
    expect(ghostTexts(view)).toEqual(['|', '|']);
  });

  it('ghosts fullwidth ｜ pipes in a focused table row', async () => {
    const doc = ['｜ a ｜ b ｜', '', '尾段'].join('\n');
    const view = mountLiveEditor(doc, 3, [markdown()]);

    await vi.waitFor(() => {
      expect(view.dom.querySelectorAll('.cm-live-ghost-mark')).toHaveLength(3);
    });
    expect(ghostTexts(view)).toEqual(['｜', '｜', '｜']);
  });

  it('ghosts wiki-link delimiters and tag hash while coloring their contents', async () => {
    const doc = ['[[笔记|别名]] #标签', '', '尾段'].join('\n');
    const view = mountLiveEditor(doc, doc.indexOf('笔记'), [markdown()]);

    await vi.waitFor(() => {
      expect(view.dom.querySelectorAll('.cm-live-ghost-mark')).toHaveLength(3);
    });
    expect(ghostTexts(view)).toEqual(['[[', ']]', '#']);
    const wiki = view.dom.querySelector('.cm-live-ghost-wikilink');
    expect(wiki?.textContent).toBe('笔记|别名');
    const tag = view.dom.querySelector('.cm-live-ghost-tag');
    expect(tag?.textContent).toBe('标签');
  });

  it('does not paint wiki-link delimiters inside inline code spans', async () => {
    const doc = ['`[[code]]` #外', '', '尾段'].join('\n');
    const view = mountLiveEditor(doc, doc.indexOf('外'), [markdown()]);

    // 反引号本身是 CodeMark 幽灵；`[[code]]` 位于成对反引号段内，整体不染
    await vi.waitFor(() => {
      expect(view.dom.querySelectorAll('.cm-live-ghost-mark')).toHaveLength(3);
    });
    expect(ghostTexts(view)).toEqual(['`', '`', '#']);
    expect(view.dom.querySelector('.cm-live-ghost-wikilink')).toBeNull();
    const tag = view.dom.querySelector('.cm-live-ghost-tag');
    expect(tag?.textContent).toBe('外');
  });

  it('paints wiki-link with anchor as a single wikilink-colored span', async () => {
    const doc = ['[[笔记#锚点]]', '', '尾段'].join('\n');
    const view = mountLiveEditor(doc, doc.indexOf('笔记'), [markdown()]);

    await vi.waitFor(() => {
      expect(view.dom.querySelectorAll('.cm-live-ghost-mark')).toHaveLength(2);
    });
    expect(ghostTexts(view)).toEqual(['[[', ']]']);
    const wiki = view.dom.querySelector('.cm-live-ghost-wikilink');
    // 锚点 # 计入内容（不视作 #tag，因为 # 紧跟 [[ 内部）
    expect(wiki?.textContent).toBe('笔记#锚点');
  });

  it('ghosts fullwidth ＃ heading prefix in addition to trailing space (R1-M4)', async () => {
    // 全角 ＃ Lezer 不识 → 必须走 AST markerRange 兜底幽灵化
    const doc = '＃ 全角井号标题\n\n尾段';
    const view = mountLiveEditor(doc, 1, [markdown()]);

    await vi.waitFor(() => {
      expect(view.dom.querySelectorAll('.cm-live-ghost-mark')).toHaveLength(1);
    });
    // 归一化把全角 \u3000 转半角空格 → 期望 `＃ `（长度 2）
    const ghosts = view.dom.querySelectorAll('.cm-live-ghost-mark');
    expect(ghosts[0]?.textContent).toBe('＃ ');
  });

  it('ghosts the setext rule line as a whole when the rule line is focused (R1-M1)', async () => {
    // setext 二级标题：文字行 + `---` 规则线。光标进入规则线行 → 整行幽灵化（markerRange 整行）
    const doc = '二级setext\n---';
    const view = mountLiveEditor(doc, doc.length, [markdown()]);

    await vi.waitFor(() => {
      expect(view.dom.querySelector('.cm-line.cm-live-focused-source')).not.toBeNull();
    });
    const ghost = view.dom.querySelector('.cm-line.cm-live-focused-source .cm-live-ghost-mark');
    expect(ghost?.textContent).toBe('---');
  });

  it('does not double-paint table pipe inside wiki-link alias (R1-M2)', async () => {
    // 聚焦表行 `| [[a|b]] |` 中别名 `|` 必须被表格管线豁免（C1 skipRanges 含 wikiSpans 后，
    // 中间别名 `|` 不再被当作管线幽灵），但 wiki 定界符 `[[`/`]]` 仍按 wiki 链接标准行为幽灵化。
    const doc = ['| 表头 |', '| --- |', '| [[a|b]] |', '', '尾段'].join('\n');
    const view = mountLiveEditor(doc, doc.indexOf('a|b'), [markdown()]);

    await vi.waitFor(() => {
      expect(view.dom.querySelector('.cm-line.cm-live-focused-source')).not.toBeNull();
    });
    const ghostTextsInLine = [
      ...view.dom.querySelectorAll('.cm-line.cm-live-focused-source .cm-live-ghost-mark'),
    ].map((n) => n.textContent);
    // 期望：左/右各 1 个 `|`（管线）+ wiki 定界符 `[[`/`]]` 两段；中间别名 `|` 不出现
    expect(ghostTextsInLine).toEqual(['|', '[[', ']]', '|']);
    // wikilink 类着色应命中别名文字（含中间的 |）
    const wiki = view.dom.querySelector('.cm-line.cm-live-focused-source .cm-live-ghost-wikilink');
    expect(wiki?.textContent).toBe('a|b');
  });

  it('covers both lines of a multiline bold emphasis without throwing', async () => {
    const doc = ['**加粗起', '继续**', '', '尾段'].join('\n');
    const view = mountLiveEditor(doc, doc.indexOf('继续'), [markdown()]);

    // 聚焦行 2：闭合 `**` 一条（适配器按行展开，块内 mark 不跨行）
    await vi.waitFor(() => {
      expect(ghostTexts(view)).toEqual(['**']);
    });
    // 聚焦行 1：起始 `**` 一条；跨行拆分防御路径不抛错
    view.dispatch({ selection: { anchor: doc.indexOf('加粗') } });
    await vi.waitFor(() => {
      expect(ghostTexts(view)).toEqual(['**']);
    });
    expect(view.state.doc.toString()).toBe(doc);
  });
});
