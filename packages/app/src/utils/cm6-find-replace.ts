/**
 * cm6-find-replace — CodeMirror 6 查找替换扩展
 *
 * 接通 @codemirror/search 6.7.0，使用其默认 search 面板 + EditorState.phrases
 * facet 注入五语文案，并在自定义 keymap 包装 readOnly 门：
 *   - 查找类（openSearchPanel / findNext / findPrevious）允许在 readOnly 触发
 *   - 替换类（replaceNext / replaceAll）+ RegExp 入口在 readOnly 返回 false
 *
 * Phrase 键取自 @codemirror/search dist/index.js 的 state.phrase(...) / phrase(view, ...)
 * 实测调用，作为本仓 i18n 的契约源——任何增减都需同步更新此处 + locales/*。
 *
 * @see PRD-v0.2 E1 切片
 */
import type { Extension } from '@codemirror/state';
import { EditorState } from '@codemirror/state';
import { keymap } from '@codemirror/view';
import { search, searchKeymap } from '@codemirror/search';
import { translate } from '@/i18n';

/**
 * 从 i18n 取 17 个 panel/dialog 文案，缺一即返回英文原串（CM6 state.phrase 兜底）。
 * 严禁 hex/rgb；纯 token 风格——所有文案通过 vue-i18n translate() 同步取。
 */
function buildPhrases(): { [key: string]: string } {
  const keys: ReadonlyArray<readonly [string, string]> = [
    // panel (phrase(view, …))
    ['Find', 'editor.find.find'],
    ['Replace', 'editor.find.replace'],
    ['next', 'editor.find.next'],
    ['previous', 'editor.find.previous'],
    ['all', 'editor.find.all'],
    ['match case', 'editor.find.matchCase'],
    ['regexp', 'editor.find.regexp'],
    ['by word', 'editor.find.byWord'],
    ['replace', 'editor.find.replaceOne'],
    ['replace all', 'editor.find.replaceAll'],
    ['close', 'editor.find.close'],
    // dialog (state.phrase(…))
    ['Go to line', 'editor.find.goToLine'],
    ['go', 'editor.find.go'],
    ['replaced match on line $', 'editor.find.replacedMatchOnLine'],
    ['replaced $ matches', 'editor.find.replacedMatches'],
    ['current match', 'editor.find.currentMatch'],
    ['on line', 'editor.find.onLine'],
  ];
  const phrases: { [key: string]: string } = {};
  for (const [source, key] of keys) {
    // i18n-dynamic-key — 键为上方静态 17 项，全部已在 locales/editor.find.* 注册
    phrases[source] = translate(key);
  }
  return phrases;
}

/**
 * 允许 readOnly 触发的命令集（查找 / 跳转 / 关面板）。其余 CM6 默认 searchKeymap
 * 项（Mod-Shift-l = selectSelectionMatches、Mod-d = selectNextOccurrence 等选区写操作）
 * 在 readOnly 下经 readOnlyGate 阻断。
 *
 * 注：searchKeymap 含 7 项（Mod-f / F3 / Mod-g / Escape / Mod-Shift-l / Mod-Alt-g / Mod-d），
 *    本集合只列允许 readOnly 触发的键。
 */
const FIND_KEYS = new Set([
  // CM6 用 F3/Mod-g 条目自身的 shift: 字段表达 Shift 变体（无需单列 Shift-F3/Shift-Mod-g）
  'Mod-f',
  'F3',
  'Mod-g',
  'Escape',
  'Mod-Alt-g',
]);

/**
 * readOnly 门语义：readOnly 状态下
 *   - 允许 openSearchPanel / findNext / findPrevious / gotoLine（让用户能定位）
 *   - 拒绝 replaceNext / replaceAll / selectMatches / selectNextOccurrence（写操作）
 *
 * 与 MarkdownEditor.vue 中既有 `v.state.readOnly ? false : ...` 一致。
 */
export function findReplaceExtension(): Extension[] {
  const phrases = buildPhrases();

  // 顶层 Mod-f / F3 / Mod-g 等查找键允许 readOnly；其余 searchKeymap 项
  // （含替换类）统一受 readOnly 门包裹。这与 CM6 默认 searchKeymap 范围对齐。
  const keyBindings = searchKeymap
    .filter(
      (binding): binding is typeof binding & { run: NonNullable<typeof binding.run> } =>
        typeof binding.run === 'function',
    )
    .map((binding) => {
      const original = binding.run;
      const allowInReadOnly = binding.key !== undefined && FIND_KEYS.has(binding.key);
      return {
        ...binding,
        run: (view: Parameters<typeof original>[0]): boolean => {
          if (allowInReadOnly) return original(view);
          if (view.state.readOnly) return false;
          return original(view);
        },
      };
    });

  return [search({ top: true }), EditorState.phrases.of(phrases), keymap.of(keyBindings)];
}
