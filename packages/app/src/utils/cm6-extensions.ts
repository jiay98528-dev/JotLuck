/**
 * cm6-extensions — CodeMirror 6 自定义扩展
 *
 * 纸张主题编辑器扩展：markdown 语言支持 + 历史 + 快捷键 + 行换行 + 主题
 *
 * @see migration-map.md §6
 */
import {
  EditorView,
  keymap,
  highlightActiveLine,
  placeholder as cmPlaceholder,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { syntaxHighlighting, HighlightStyle } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import type { Extension } from '@codemirror/state';

/**
 * JotLuck 自定义语法高亮样式。
 *
 * 基于 paper 主题的 heading 表现：bold-only（无下划线）。
 * CodeMirror 6 默认的 defaultHighlightStyle 会给 heading 加
 * `textDecoration: 'underline'`，这在纸张隐喻中过于抢眼，改为纯加粗。
 */
const JotLuckHighlightStyle = HighlightStyle.define([
  // Headings: bold only, no underline — matches .markdown-body h1-h6 preview style
  { tag: tags.heading, fontWeight: 'bold', textDecoration: 'none' },
  { tag: tags.heading1, fontWeight: 'bold', fontSize: '2em', textDecoration: 'none' },
  { tag: tags.heading2, fontWeight: 'bold', fontSize: '1.5em', textDecoration: 'none' },
  { tag: tags.heading3, fontWeight: 'bold', fontSize: '1.25em', textDecoration: 'none' },
  { tag: tags.heading4, fontWeight: 'bold', fontSize: '1.1em', textDecoration: 'none' },
  { tag: tags.heading5, fontWeight: 'bold', textDecoration: 'none' },
  { tag: tags.heading6, fontWeight: 'bold', color: 'var(--ink-secondary)', textDecoration: 'none' },
  // Strong / emphasis
  { tag: tags.strong, fontWeight: 'bold' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  // Code
  { tag: tags.monospace, fontFamily: 'var(--ff-mono)' },
  // Links
  { tag: tags.link, color: 'var(--link)', textDecoration: 'underline' },
  // Other tags: fall through to browser defaults
]);

const sourceOnlyHighlightStyle = HighlightStyle.define([
  { tag: tags.heading, fontWeight: 'normal', fontSize: '1em', textDecoration: 'none' },
  { tag: tags.strong, fontWeight: 'normal' },
  { tag: tags.emphasis, fontStyle: 'normal' },
  { tag: tags.monospace, fontFamily: 'var(--ff-mono)' },
  { tag: tags.link, color: 'var(--link)', textDecoration: 'none' },
]);

export function jotluckExtensions(ph = '开始书写…', sourceOnly = false): Extension[] {
  return [
    markdown(),
    history(),
    highlightActiveLine(),
    keymap.of([...defaultKeymap, ...historyKeymap]),
    EditorView.lineWrapping,
    cmPlaceholder(ph),
    syntaxHighlighting(sourceOnly ? sourceOnlyHighlightStyle : JotLuckHighlightStyle),
    EditorView.theme(
      {
        '&': {
          fontSize: '16px',
          fontFamily: 'var(--ff-body)',
          lineHeight: 'var(--lh-body)',
          color: 'var(--ink-primary)',
          backgroundColor: 'transparent',
        },
        '.cm-content': {
          fontFamily: 'var(--ff-body)',
          maxWidth: 'var(--editor-max-width)',
          margin: '0 auto',
          padding: 'var(--editor-top-pad) 0 var(--space-96)',
          caretColor: 'var(--editor-cursor)',
        },
        '.cm-cursor': {
          borderLeftColor: 'var(--editor-cursor)',
        },
        '.cm-selectionBackground': {
          background: 'var(--editor-selection) !important',
        },
        '.cm-activeLine': {
          background: 'var(--editor-line-highlight)',
        },
        '.cm-gutters': {
          backgroundColor: 'transparent',
          color: 'var(--editor-gutter)',
          border: 'none',
          paddingRight: '8px',
        },
        '.cm-activeLineGutter': {
          color: 'var(--ink-secondary)',
        },
        '&.cm-focused .cm-selectionBackground': {
          background: 'var(--editor-selection) !important',
        },
      },
      { dark: false },
    ),
  ];
}

export function markdownKeymap(): Record<string, (view: EditorView) => boolean> {
  return {};
}
