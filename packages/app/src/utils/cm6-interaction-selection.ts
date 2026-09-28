import type { EditorView } from '@codemirror/view';
import type { Text } from '@codemirror/state';

export interface InteractionSelection {
  doc: Text;
  from: number;
  to: number;
  native: boolean;
  head: number;
}
const saved = new WeakMap<EditorView, InteractionSelection>();
const readers = new WeakMap<EditorView, (node: Node, offset: number) => number | null>();

export function registerSourceHitReader(
  view: EditorView,
  reader: (node: Node, offset: number) => number | null,
): () => void {
  readers.set(view, reader);
  return () => {
    if (readers.get(view) === reader) {
      readers.delete(view);
    }
  };
}

export function nativeEditorSelection(view: EditorView): InteractionSelection | null {
  const selection = document.getSelection();
  if (
    !selection ||
    selection.isCollapsed ||
    !selection.anchorNode ||
    !selection.focusNode ||
    !view.contentDOM.contains(selection.anchorNode) ||
    !view.contentDOM.contains(selection.focusNode)
  )
    return null;
  const position = (node: Node, offset: number): number | null => {
    const mapped = readers.get(view)?.(node, offset);
    if (mapped !== null && mapped !== undefined) return mapped;
    try {
      return view.posAtDOM(node, offset);
    } catch {
      return null;
    }
  };
  const anchor = position(selection.anchorNode, selection.anchorOffset);
  const head = position(selection.focusNode, selection.focusOffset);
  if (anchor === null || head === null) return null;
  return {
    doc: view.state.doc,
    from: Math.min(anchor, head),
    to: Math.max(anchor, head),
    native: true,
    head,
  };
}

export function rememberEditorSelection(view: EditorView): InteractionSelection {
  const native = nativeEditorSelection(view);
  const range = view.state.selection.main;
  const selection = native ?? {
    doc: view.state.doc,
    from: range.from,
    to: range.to,
    native: false,
    head: range.head,
  };
  saved.set(view, selection);
  return selection;
}

export function getInteractionSelection(view: EditorView): InteractionSelection | null {
  const selection = saved.get(view);
  if (
    view.state.readOnly ||
    view.composing ||
    view.compositionStarted ||
    selection?.doc !== view.state.doc
  )
    return null;
  return selection;
}

export function clearInteractionSelection(view: EditorView): void {
  saved.delete(view);
}
