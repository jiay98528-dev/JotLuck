import { guardPointerClicks } from './editor-pointer';
import { observeEditorViewport, positionEditorOverlay } from './editor-overlay';
import { rememberEditorSelection, getInteractionSelection } from './cm6-interaction-selection';
import { getDocumentAst } from './cm6-document-analysis';
/**
 * cm6-slash-commands — CodeMirror 6 斜杠命令（块插入菜单）
 *
 * 行为契约：`docs/wip/specs/v0.2-E2-slash-commands.md` v1.0（冻结）。
 *
 * 装配：在 `MarkdownEditor.vue` `createState()` 扩展数组中，置于 `readOnlyCompartment`
 * 之后、智能续格式 keymap（Enter/Backspace/Escape）之前。ghost 补全的 Tab/Escape
 * 已用 `Prec.highest` 包装，结构上先于本扩展执行——本扩展禁止使用任何 Prec。
 *
 * 架构要点：
 *   - 触发判定复用 `@jotluck/renderer` 的 AST（`parseDocument` + `blockAtLine`），与
 *     `cm6-smart-continue` 共用同一份块判定路径，fence / frontmatter 内不弹菜单。
 *   - 插入为单次 `view.dispatch`，带 `isolateHistory('full')` 与之前的快速键入
 *     隔成两步历史，保证单次 Ctrl+Z 恰好回退到触发文本（E2E 12a 实证修正）。
 *   - 菜单 DOM 作为编辑器内部浮层挂在 `view.dom` 之下（不 Teleport、不占全局 z-index）。
 *     位置 = `coordsAtPos(slash)` 转换为 view.dom 相对坐标，下方空间不足翻转到上方。
 *   - 标签每次菜单打开时由 `translate()` 解析（规避 E1 phrases 静态快照的已知限制）。
 *   - keymap 命令入口统一 IME 守卫；composition 期间所有命令返回 false。
 *
 * @see V0.2-E2-slash-commands.md §2-§10
 */
import type { EditorState, Extension } from '@codemirror/state';
import { isolateHistory } from '@codemirror/commands';
import { EditorView, ViewPlugin, keymap } from '@codemirror/view';
import type { KeyBinding, PluginValue, ViewUpdate } from '@codemirror/view';
import { blockAtLine } from '@jotluck/renderer';
import { translate } from '@/i18n';

// ─── 条目静态描述（spec §3 逐字表） ────────────────────────────────────

export type SlashItemId =
  | 'heading1'
  | 'heading2'
  | 'heading3'
  | 'bulletList'
  | 'orderedList'
  | 'taskList'
  | 'quote'
  | 'codeBlock'
  | 'table'
  | 'divider';

interface SlashItemSpec {
  id: SlashItemId;
  icon: string;
  labelKey: string;
  aliases: readonly string[];
  /**
   * 插入模板。`@` 在此字符串里充当光标占位（实际是 ASCII `@`，spec §3 表格里用
   * `▮` 表达）。dispatch 时按 from = `slashPos`, to = `cursorPos` 整段替换为
   * 占位被剥离后的文本，selection = `slashPos + 占位偏移`。
   */
  insert: string;
  /** 占位符（单字符，确保全文唯一）。 */
  cursorMarker: '@';
}

const CURSOR_MARKER = '@' as const;

const ITEM_SPECS: readonly SlashItemSpec[] = [
  {
    id: 'heading1',
    icon: 'H1',
    labelKey: 'editor.slash.heading1',
    aliases: ['h1', 'heading'],
    insert: '# @',
    cursorMarker: CURSOR_MARKER,
  },
  {
    id: 'heading2',
    icon: 'H2',
    labelKey: 'editor.slash.heading2',
    aliases: ['h2'],
    insert: '## @',
    cursorMarker: CURSOR_MARKER,
  },
  {
    id: 'heading3',
    icon: 'H3',
    labelKey: 'editor.slash.heading3',
    aliases: ['h3'],
    insert: '### @',
    cursorMarker: CURSOR_MARKER,
  },
  {
    id: 'bulletList',
    icon: '•',
    labelKey: 'editor.slash.bulletList',
    aliases: ['ul', 'list'],
    insert: '- @',
    cursorMarker: CURSOR_MARKER,
  },
  {
    id: 'orderedList',
    icon: '1.',
    labelKey: 'editor.slash.orderedList',
    aliases: ['ol', 'list'],
    insert: '1. @',
    cursorMarker: CURSOR_MARKER,
  },
  {
    id: 'taskList',
    icon: '☑',
    labelKey: 'editor.slash.taskList',
    aliases: ['task', 'todo'],
    insert: '- [ ] @',
    cursorMarker: CURSOR_MARKER,
  },
  {
    id: 'quote',
    icon: '"',
    labelKey: 'editor.slash.quote',
    aliases: ['quote', 'bq'],
    insert: '> @',
    cursorMarker: CURSOR_MARKER,
  },
  {
    id: 'codeBlock',
    icon: '{ }',
    labelKey: 'editor.slash.codeBlock',
    aliases: ['code'],
    insert: '```\n@\n```',
    cursorMarker: CURSOR_MARKER,
  },
  {
    id: 'table',
    icon: '▦',
    labelKey: 'editor.slash.table',
    aliases: ['table'],
    insert: '|  |  |\n| --- | --- |\n| @ |  |',
    cursorMarker: CURSOR_MARKER,
  },
  {
    id: 'divider',
    icon: '—',
    labelKey: 'editor.slash.divider',
    aliases: ['hr', 'divider'],
    insert: '---\n@',
    cursorMarker: CURSOR_MARKER,
  },
];

// ─── 公共 API：buildSlashItems ─────────────────────────────────────────

export interface SlashItem {
  id: SlashItemId;
  icon: string;
  label: string;
  aliases: readonly string[];
  insert: string;
  cursorMarker: '@';
}

/**
 * 解析 i18n 后返回当前 locale 下的条目表。每次菜单打开时调用——规避 E1 phrases
 * 静态快照的已知限制（spec §7 钉死）。
 */
export function buildSlashItems(): SlashItem[] {
  return ITEM_SPECS.map((spec) => ({
    id: spec.id,
    icon: spec.icon,
    // i18n-dynamic-key — 键为 ITEM_SPECS 静态 12 项，全部已在 locales/editor.slash.* 注册
    label: translate(spec.labelKey),
    aliases: spec.aliases,
    insert: spec.insert,
    cursorMarker: CURSOR_MARKER,
  }));
}

// ─── 公共 API：filterSlashItems ────────────────────────────────────────

/**
 * 大小写不敏感子串匹配（spec §3 「过滤」）：同时匹配 label 与 aliases。
 * 零匹配时返回空数组。
 */
export function filterSlashItems(items: readonly SlashItem[], query: string): SlashItem[] {
  const q = query.toLowerCase();
  if (q === '') return items.slice();
  return items.filter((item) => {
    if (item.label.toLowerCase().includes(q)) return true;
    return item.aliases.some((alias) => alias.toLowerCase().includes(q));
  });
}

// ─── 公共 API：getSlashTrigger ─────────────────────────────────────────

export interface SlashTrigger {
  slashPos: number;
  queryFrom: number;
  query: string;
}

/**
 * 触发判定（spec §2）：
 *   - 选区为空（单光标）
 *   - 光标所在行从行首到光标匹配 `/^\s*\/[^]*$/`
 *   - 不处于 fence / frontmatter / jsonBlock / table / listItem / blockquote 内部
 *   - 编辑器可编辑（`state.readOnly === false`）
 */
export function getSlashTrigger(state: EditorState): SlashTrigger | null {
  if (state.readOnly) return null;
  const sel = state.selection.main;
  if (!sel.empty) return null;

  const cursor = sel.head;
  const line = state.doc.lineAt(cursor);
  const before = state.doc.sliceString(line.from, cursor);
  if (!/^\s*\/[^]*$/.test(before)) return null;

  // 块级语境判定：与 cm6-smart-continue 同一口径
  const lineNumber = line.number - 1;
  const ast = getDocumentAst(state);
  const block = blockAtLine(ast, lineNumber);
  if (block) {
    if (
      block.type === 'codeFence' ||
      block.type === 'frontmatter' ||
      block.type === 'jsonBlock' ||
      block.type === 'table' ||
      block.type === 'listItem' ||
      block.type === 'blockquote'
    ) {
      return null;
    }
  }

  const slashOffsetInBefore = before.search(/\//);
  if (slashOffsetInBefore < 0) return null;
  const slashPos = line.from + slashOffsetInBefore;
  const queryFrom = slashPos + 1;
  const query = state.doc.sliceString(queryFrom, cursor);
  return { slashPos, queryFrom, query };
}

// ─── 公共 API：applySlashItem ──────────────────────────────────────────

/**
 * 插入条目（spec §3）：
 *   - 单次 `view.dispatch` 完成文本替换 + 光标落点
 *   - 斜杠前空白保留、光标后余文自然跟随
 *   - isolateHistory('full')：把插入与之前的快速键入隔成两步历史——否则 CM6
 *     500ms 邻组合并把「键入 /h1 + 插入」并成一步，单次 Ctrl+Z 会退回空串
 *     （E2E 12a 实证；规格 §9 原文「不用 isolateHistory」经实测修正）
 */
export function applySlashItem(view: EditorView, id: SlashItemId): boolean {
  if (view.state.readOnly) return false;
  if (view.composing || view.compositionStarted) return false;
  const trigger = getSlashTrigger(view.state);
  if (!trigger) return false;
  const spec = ITEM_SPECS.find((item) => item.id === id);
  if (!spec) return false;

  const markerOffset = spec.insert.indexOf(spec.cursorMarker);
  if (markerOffset < 0) return false;
  const cleanInsert = spec.insert.replaceAll(spec.cursorMarker, '');
  const cursor = trigger.slashPos + markerOffset;

  view.dispatch({
    changes: {
      from: trigger.slashPos,
      to: view.state.selection.main.head,
      insert: cleanInsert,
    },
    selection: { anchor: cursor },
    annotations: isolateHistory.of('full'),
  });
  return true;
}

// ─── 内部：菜单 DOM 构建与定位 ─────────────────────────────────────────

export const SLASH_MENU_DOM_CLASS = 'cm-jotluck-slash-menu';

function buildMenuDom(menuAria: string): HTMLDivElement {
  const root = document.createElement('div');
  root.className = SLASH_MENU_DOM_CLASS;
  root.setAttribute('role', 'listbox');
  root.setAttribute('aria-label', menuAria);
  root.dataset.cmJotluck = 'slash-menu';
  root.style.position = 'absolute';
  root.style.visibility = 'hidden';
  return root;
}

/**
 * 重算菜单位置。锚 = 斜杠字符的 coordsAtPos（左下角）。
 *   - 下方空间不足翻转到上方
 *   - 横向夹紧在 editor 视口内
 *   - coordsAtPos 在 jsdom 中可能返回 null 或直接抛错（Range 无 getClientRects）；
 *     空值/异常均降级为隐藏，几何断言只属于真实浏览器 E2E（spec §10）
 */
function positionMenu(root: HTMLElement, view: EditorView, slashPos: number): void {
  let coords: ReturnType<EditorView['coordsAtPos']> = null;
  try {
    coords = view.coordsAtPos(slashPos);
  } catch {
    coords = null;
  }
  if (!coords) {
    root.style.visibility = 'hidden';
    return;
  }
  positionEditorOverlay(root, view.dom, coords);
}

// ─── 内部：ViewPlugin 管理菜单生命周期 ─────────────────────────────────

interface MenuState {
  open: boolean;
  query: string;
  slashPos: number;
  selectedIndex: number;
  items: SlashItem[];
  filtered: SlashItem[];
  composing: boolean;
}

/** ViewPlugin 暴露的菜单控制接口；keymap 与单测通过 `view.plugin(pluginSpec)` 取得。 */
export interface SlashMenuController {
  isOpen(): boolean;
  selectedId(): SlashItemId | null;
  selectBy(delta: number): boolean;
  confirm(): boolean;
  dismiss(): boolean;
}

class SlashMenuPlugin implements PluginValue {
  private view: EditorView;
  private root: HTMLDivElement;
  private state: MenuState;
  private menuAria: string;
  private noMatchText: string;
  /** 组合输入期间被点选/确认的条目——延后到 compositionend 落定执行（spec §5，互审 F4） */
  private deferredItemId: SlashItemId | null = null;
  /** compositionend 的重判定时器句柄——destroy 时清掉，防止向已脱离 DOM 的 view 挂回 root（互审 L3） */
  private compTimer: ReturnType<typeof setTimeout> | null = null;
  private detachFns: Array<() => void> = [];
  private overlay: ReturnType<typeof observeEditorViewport>;

  public readonly controller: SlashMenuController;

  constructor(view: EditorView) {
    this.view = view;
    this.menuAria = translate('editor.slash.menuAria');
    this.noMatchText = translate('editor.slash.noMatch');
    this.root = buildMenuDom(this.menuAria);
    this.state = {
      open: false,
      query: '',
      slashPos: 0,
      selectedIndex: 0,
      items: [],
      filtered: [],
      composing: false,
    };
    view.dom.appendChild(this.root);
    this.overlay = observeEditorViewport(() => {
      if (this.root.isConnected) positionMenu(this.root, this.view, this.state.slashPos);
    });
    this.detachFns.push(
      this.overlay.destroy,
      guardPointerClicks(this.root, () => rememberEditorSelection(this.view)),
    );

    this.controller = {
      isOpen: () => this.state.open,
      selectedId: () => {
        const item = this.state.filtered[this.state.selectedIndex];
        return item ? item.id : null;
      },
      selectBy: (delta: number) => this.selectBy(delta),
      confirm: () => this.confirm(),
      dismiss: () => this.dismiss(),
    };

    const onCompStart = () => {
      this.state.composing = true;
    };
    const onCompEnd = () => {
      this.state.composing = false;
      // compositionend 落定后一拍统一重判（spec §5）；随后冲刷被延后的插入
      this.compTimer = setTimeout(() => {
        this.recomputeFromState();
        this.flushDeferredItem();
      }, 0);
    };
    view.contentDOM.addEventListener('compositionstart', onCompStart);
    view.contentDOM.addEventListener('compositionend', onCompEnd);
    this.detachFns.push(() => {
      view.contentDOM.removeEventListener('compositionstart', onCompStart);
      view.contentDOM.removeEventListener('compositionend', onCompEnd);
    });
  }

  update(update: ViewUpdate): void {
    // 运行中切入 readOnly（compartment 重配不触发 doc/selection/focus 变化）
    // 也要关菜单——否则菜单悬空且吞键（互审 F3）
    if (update.state.readOnly && this.state.open) {
      this.closeMenu();
      return;
    }
    if (this.root.dataset.pointerActive === 'true') return;
    // 失焦：focusChanged=true 且当前无焦点 → 关菜单（spec §2 「编辑器失焦」）
    if (update.focusChanged && this.root.contains(document.activeElement)) return;
    if (update.focusChanged && !update.view.hasFocus) {
      this.closeMenu();
      return;
    }
    if (update.selectionSet || update.docChanged || update.focusChanged) {
      this.recomputeFromState();
    }
  }

  private recomputeFromState(): void {
    if (this.state.composing || this.view.composing || this.view.compositionStarted) {
      return;
    }
    const trigger = getSlashTrigger(this.view.state);
    if (!trigger) {
      this.closeMenu();
      return;
    }
    if (
      this.state.open &&
      this.state.slashPos === trigger.slashPos &&
      this.state.query === trigger.query
    ) {
      return;
    }
    this.openOrUpdateMenu(trigger.slashPos, trigger.query);
  }

  private openOrUpdateMenu(slashPos: number, query: string): void {
    if (!this.state.open) {
      // 打开瞬间：解析 i18n 标签与菜单级文案（spec §7 「每次打开时」——含
      // menuAria/noMatch，规避构造期快照在运行中切语言后过期，互审 F6）
      this.state.items = buildSlashItems();
      this.menuAria = translate('editor.slash.menuAria');
      this.noMatchText = translate('editor.slash.noMatch');
      this.root.setAttribute('aria-label', this.menuAria);
      this.state.open = true;
      this.state.selectedIndex = 0;
    }
    // 关闭态容器已从 DOM 摘除（见 closeMenu）——重新挂回，保证「菜单关闭 =
    // 元素不存在」的合同（E2E 以元素计数判定开闭）
    if (!this.root.parentElement) this.view.dom.appendChild(this.root);
    this.state.slashPos = slashPos;
    this.state.query = query;
    this.state.filtered = filterSlashItems(this.state.items, query);
    if (this.state.selectedIndex >= this.state.filtered.length) {
      this.state.selectedIndex = 0;
    }
    this.render();
  }

  private closeMenu(): void {
    if (!this.state.open) return;
    this.state.open = false;
    this.state.filtered = [];
    this.state.items = [];
    this.root.replaceChildren();
    this.root.style.visibility = 'hidden';
    if (this.root.parentElement) {
      this.root.parentElement.removeChild(this.root);
    }
  }

  private render(): void {
    this.root.replaceChildren();
    if (this.state.filtered.length === 0) {
      const empty = document.createElement('div');
      empty.className = `${SLASH_MENU_DOM_CLASS}__empty`;
      empty.setAttribute('role', 'presentation');
      empty.textContent = this.noMatchText;
      this.root.appendChild(empty);
    } else {
      this.state.filtered.forEach((item, idx) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `${SLASH_MENU_DOM_CLASS}__item`;
        btn.setAttribute('role', 'option');
        btn.setAttribute('aria-selected', String(idx === this.state.selectedIndex));
        btn.dataset.slashId = item.id;
        btn.dataset.cmJotluck = 'slash-item';
        const commandDoc = this.view.state.doc;
        const commandSelection = this.view.state.selection;
        btn.addEventListener('mousedown', (event) => event.preventDefault());
        btn.addEventListener('click', () => {
          if (this.view.state.readOnly || commandDoc !== this.view.state.doc) return;
          if (!this.view.composing && !this.view.compositionStarted) {
            const saved = getInteractionSelection(this.view);
            this.view.dispatch({
              selection: saved ? { anchor: saved.from, head: saved.to } : commandSelection,
            });
          }
          this.handleItemPicked(item.id);
        });
        const icon = document.createElement('span');
        icon.className = `${SLASH_MENU_DOM_CLASS}__icon`;
        icon.textContent = item.icon;
        const label = document.createElement('span');
        label.className = `${SLASH_MENU_DOM_CLASS}__label`;
        label.textContent = item.label;
        btn.append(icon, label);
        this.root.appendChild(btn);
      });
    }
    // rAF 等下一帧再定位——此时 root.getBoundingClientRect 才有内容高度
    this.overlay.schedule();
  }

  private handleItemPicked(id: SlashItemId): void {
    if (this.view.composing || this.view.compositionStarted) {
      // spec §5「插入动作若遇活跃组合：延后到 compositionend 执行」——
      // 组合中点选/确认不吞不插，落定后由 flushDeferredItem 冲刷（互审 F4）
      this.deferredItemId = id;
      return;
    }
    const ok = applySlashItem(this.view, id);
    if (ok) {
      this.closeMenu();
      this.view.focus();
    }
  }

  private flushDeferredItem(): void {
    const id = this.deferredItemId;
    this.deferredItemId = null;
    if (!id || !this.state.open) return;
    if (this.view.composing || this.view.compositionStarted) {
      this.deferredItemId = id;
      return;
    }
    this.handleItemPicked(id);
  }

  private selectBy(delta: number): boolean {
    if (!this.state.open) return false;
    const len = this.state.filtered.length;
    if (len === 0) return true; // 消费事件，避免落入续格式
    this.state.selectedIndex = (this.state.selectedIndex + delta + len) % len;
    this.render();
    // 10 项超过 maxHeight 需滚动——键盘循环到折叠区时把选中项滚入视野
    // （黑盒审计 A-F5）；jsdom 未实现 scrollIntoView，try/catch 兜底
    const selected = this.root.querySelector('[aria-selected="true"]');
    if (selected instanceof HTMLElement) {
      try {
        selected.scrollIntoView({ block: 'nearest' });
      } catch {
        /* jsdom/旧环境无实现——忽略 */
      }
    }
    return true;
  }

  private confirm(): boolean {
    if (!this.state.open) return false;
    const item = this.state.filtered[this.state.selectedIndex];
    if (!item) {
      // 零匹配：消费事件（spec §2 「零匹配时的 Enter/Tab」）
      this.closeMenu();
      return true;
    }
    this.handleItemPicked(item.id);
    return true;
  }

  private dismiss(): boolean {
    if (!this.state.open) return false;
    this.closeMenu();
    return true;
  }

  destroy(): void {
    if (this.compTimer !== null) {
      clearTimeout(this.compTimer);
      this.compTimer = null;
    }
    this.detachFns.forEach((fn) => fn());
    if (this.root.parentElement) {
      this.root.parentElement.removeChild(this.root);
    }
  }
}

const slashMenuPlugin = ViewPlugin.fromClass(SlashMenuPlugin);

/** 取得菜单控制器；菜单未实例化或实例已被销毁时返回 null。 */
export function getSlashMenuController(view: EditorView): SlashMenuController | null {
  return view.plugin(slashMenuPlugin)?.controller ?? null;
}

// ─── 主题（spec §8：只用 paper token；禁 hex/rgb/hsl 字面量） ──────────

const slashCommandsTheme = EditorView.theme(
  {
    [`& .${SLASH_MENU_DOM_CLASS}`]: {
      fontFamily: 'var(--ff-body)',
      fontSize: 'var(--text-sm)',
      color: 'var(--ink-primary)',
      background: 'var(--paper-raised)',
      border: 'var(--border-thin) solid var(--rule-strong)',
      borderRadius: 'var(--radius)',
      boxShadow: 'var(--shadow-float)',
      padding: 'var(--space-4) 0',
      minWidth: '180px',
      maxWidth: '280px',
      maxHeight: '280px',
      overflowY: 'auto',
      zIndex: '10',
    },
    [`& .${SLASH_MENU_DOM_CLASS}__item`]: {
      display: 'flex',
      alignItems: 'center',
      gap: 'var(--space-12)',
      width: '100%',
      padding: 'var(--space-6) var(--space-12)',
      border: 'none',
      background: 'transparent',
      color: 'var(--ink-primary)',
      cursor: 'pointer',
      textAlign: 'left',
      font: 'inherit',
    },
    [`& .${SLASH_MENU_DOM_CLASS}__item[aria-selected="true"]`]: {
      background: 'var(--accent-soft)',
      color: 'var(--ink-primary)',
    },
    [`& .${SLASH_MENU_DOM_CLASS}__icon`]: {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      minWidth: 'var(--space-32)',
      color: 'var(--ink-secondary)',
      fontWeight: 'var(--fw-medium)',
    },
    [`& .${SLASH_MENU_DOM_CLASS}__label`]: {
      flex: '1 1 auto',
    },
    [`& .${SLASH_MENU_DOM_CLASS}__empty`]: {
      padding: 'var(--space-8) var(--space-12)',
      color: 'var(--ink-muted)',
      fontStyle: 'italic',
    },
  },
  { dark: false },
);

// ─── 公共 API：slashCommandsExtension ───────────────────────────────────

/**
 * 装配用扩展（spec §9）：返回一组普通扩展（非 Compartment，与 find-replace 同款），
 * MarkdownEditor.vue 把它插入 readOnlyCompartment 之后、智能续格式 keymap 之前。
 *
 * keymap 命令入口统一 IME 守卫：返回 false 时 CM6 自动放行至下游 keymap。
 */
export function slashCommandsExtension(): Extension[] {
  const keyBindings: KeyBinding[] = [
    {
      key: 'ArrowDown',
      run: (view) => {
        if (view.composing || view.compositionStarted) return false;
        const ctrl = view.plugin(slashMenuPlugin)?.controller ?? null;
        if (!ctrl || !ctrl.isOpen()) return false;
        return ctrl.selectBy(1);
      },
    },
    {
      key: 'ArrowUp',
      run: (view) => {
        if (view.composing || view.compositionStarted) return false;
        const ctrl = view.plugin(slashMenuPlugin)?.controller ?? null;
        if (!ctrl || !ctrl.isOpen()) return false;
        return ctrl.selectBy(-1);
      },
    },
    {
      key: 'Enter',
      run: (view) => {
        if (view.composing || view.compositionStarted) return false;
        const ctrl = view.plugin(slashMenuPlugin)?.controller ?? null;
        if (!ctrl || !ctrl.isOpen()) return false;
        return ctrl.confirm();
      },
    },
    {
      key: 'Tab',
      run: (view) => {
        if (view.composing || view.compositionStarted) return false;
        const ctrl = view.plugin(slashMenuPlugin)?.controller ?? null;
        if (!ctrl || !ctrl.isOpen()) return false;
        return ctrl.confirm();
      },
    },
    {
      key: 'Escape',
      run: (view) => {
        if (view.composing || view.compositionStarted) return false;
        const ctrl = view.plugin(slashMenuPlugin)?.controller ?? null;
        if (!ctrl || !ctrl.isOpen()) return false;
        return ctrl.dismiss();
      },
    },
  ];

  return [slashCommandsTheme, slashMenuPlugin, keymap.of(keyBindings)];
}
