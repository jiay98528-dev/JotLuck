import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { inlineSourceMap, mapDomText, snapSourceBoundary } from '../editor-source-map';
import { TapGesture, guardPointerClicks } from '../editor-pointer';
import { placeEditorOverlay } from '../editor-overlay';
import { rememberEditorSelection, getInteractionSelection } from '../cm6-interaction-selection';

describe('touch source positions', () => {
  it.each([
    ['重复 **重复** 重复', '重复 重复 重复', [0, 1, 2, 5, 6, 9, 10, 11]],
    ['＊＊中文＊＊ ｀代码｀', '中文 代码', [2, 3, 6, 8, 9]],
    ['a \\* b ~~删除~~', 'a * b 删除', [0, 1, 3, 4, 5, 6, 9, 10]],
    ['[词](https://词) 词', '词 词', [1, 14, 15]],
  ])('maps token positions in %s', (source, text, starts) => {
    const map = inlineSourceMap(source);
    expect(map.text).toBe(text);
    expect(map.starts).toEqual(starts);
  });
  it('maps escaped entities to their whole source range', () => {
    const map = inlineSourceMap('&amp; `&amp;`');
    expect(map.text).toBe('& &amp;');
    expect(map.ends[0]).toBe(5);
  });
  it('maps repeated DOM nodes sequentially and ignores source-like attributes', () => {
    const root = document.createElement('span');
    root.innerHTML = '同名 <strong data-block-from="999">同名</strong> 同名';
    const map = mapDomText(root, inlineSourceMap('同名 **同名** 同名', 50));
    expect(map.get(root.querySelector('strong')!.firstChild!)).toEqual([55, 56, 57]);
    expect(map.get(root.lastChild!)?.at(-1)).toBe(62);
  });
  it('never splits surrogate pairs, combining marks or family emoji', () => {
    for (const text of ['😀', 'e\u0301', '👨‍👩‍👧‍👦']) {
      for (let i = 0; i <= text.length; i++)
        expect([0, text.length]).toContain(snapSourceBoundary(text, i));
    }
  });
});

describe('touch confirmation', () => {
  const down = { pointerId: 1, clientX: 40, clientY: 50, timeStamp: 100 };
  it('accepts only completed short taps', () => {
    const tap = new TapGesture();
    tap.begin(down);
    expect(tap.end({ ...down, timeStamp: 200 })).toBe(true);
    expect(tap.end({ ...down, timeStamp: 210 })).toBe(false);
  });
  it.each(['move', 'second', 'cancel', 'long'])('cancels %s', (kind) => {
    const tap = new TapGesture();
    tap.begin(down);
    if (kind === 'move') tap.move({ ...down, clientX: 51 });
    if (kind === 'second') tap.begin({ ...down, pointerId: 2 });
    if (kind === 'cancel') tap.cancel();
    expect(tap.end({ ...down, timeStamp: kind === 'long' ? 800 : 200 })).toBe(false);
  });
  it('confirms once, suppresses the compatibility click, and releases after cancellation', () => {
    const root = document.createElement('div');
    const button = document.createElement('button');
    root.append(button);
    document.body.append(root);
    const cleanup = guardPointerClicks(root);
    let actions = 0;
    button.addEventListener('click', () => actions++);
    const pointer = (type: string, x = 0) => {
      const event = new Event(type, { bubbles: true });
      Object.assign(event, { pointerType: 'touch', pointerId: 1, clientX: x, clientY: 0 });
      button.dispatchEvent(event);
    };
    pointer('pointerdown');
    pointer('pointerup');
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    expect(actions).toBe(1);
    pointer('pointerdown');
    pointer('pointermove', 20);
    pointer('pointercancel');
    expect(root.dataset.pointerActive).toBeUndefined();
    pointer('pointerdown');
    pointer('pointerup');
    expect(actions).toBe(2);
    cleanup();
    root.remove();
  });
});

it('keeps overlays within a keyboard-reduced viewport without scaling twice', () => {
  const placed = placeEditorOverlay({ left: 350, right: 350, top: 250, bottom: 270 }, 400, 80, {
    left: 8,
    right: 352,
    top: 100,
    bottom: 300,
  });
  expect(placed.left).toBe(8);
  expect(placed.top).toBe(166);
  expect(placed.maxWidth).toBe(344);
});

it('expires a selection after text changes or readonly reconfiguration', () => {
  const view = new EditorView({
    state: EditorState.create({ doc: 'hello', selection: { anchor: 1, head: 4 } }),
  });
  rememberEditorSelection(view);
  expect(getInteractionSelection(view)?.from).toBe(1);
  view.dispatch({ changes: { from: 5, insert: '!' } });
  expect(getInteractionSelection(view)).toBeNull();
  view.setState(EditorState.create({ doc: 'hello', extensions: EditorState.readOnly.of(true) }));
  rememberEditorSelection(view);
  expect(getInteractionSelection(view)).toBeNull();
  view.destroy();
});
