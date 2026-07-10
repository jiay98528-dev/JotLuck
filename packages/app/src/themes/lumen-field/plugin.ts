/* eslint-disable vue/one-component-per-file -- Official theme keeps compact slot components together. */
import { defineComponent, h, type PropType, type VNode, type VNodeChild } from 'vue';
import type { BacklinkEntry, HeadingItem, TagEntry } from '@/types';
import type { ShellAction, ThemePluginModule } from '@/types/theme-pack';

type SlotBag = { default?: () => VNodeChild };

function actionButton(action: ShellAction, compact = false): VNode {
  return h(
    'button',
    {
      class: ['lumen-action', compact && 'lumen-action--compact', action.active && 'is-active'],
      title: action.title,
      disabled: action.disabled,
      onClick: () => void action.run(),
    },
    compact ? action.shortLabel : action.label,
  );
}

function actionStrip(actions: ShellAction[] = [], compact = false): VNode {
  return h(
    'div',
    { class: 'lumen-action-strip' },
    actions.map((action) => actionButton(action, compact)),
  );
}

function defaultSlotChildren(slots: SlotBag): VNodeChild[] {
  const children = slots.default?.();
  if (children === null || children === undefined) return [];
  return Array.isArray(children) ? children : [children];
}

const LumenLeftWing = defineComponent({
  name: 'LumenLeftWing',
  props: {
    notes: {
      type: Array as PropType<Array<{ path: string; title: string; colorIndex?: number }>>,
      default: () => [],
    },
    activePath: { type: String, default: '' },
    actions: { type: Array as PropType<ShellAction[]>, default: () => [] },
    onSelectNote: { type: Function as PropType<(path: string) => void>, default: undefined },
  },
  setup(props) {
    return () =>
      h('aside', { class: 'lumen-left', 'data-theme-plugin-slot': 'left-wing' }, [
        h('div', { class: 'lumen-left__header' }, [h('strong', 'JotLuck'), h('span', '本地笔记')]),
        actionStrip(props.actions, true),
        h(
          'div',
          { class: 'lumen-note-list' },
          props.notes.length > 0
            ? props.notes.slice(0, 12).map((note, index) =>
                h(
                  'button',
                  {
                    class: ['lumen-note', note.path === props.activePath && 'is-active'],
                    title: note.title,
                    onClick: () => props.onSelectNote?.(note.path),
                  },
                  [
                    h('span', { class: 'lumen-note__index' }, String(index + 1).padStart(2, '0')),
                    h('span', { class: 'lumen-note__title' }, note.title),
                  ],
                ),
              )
            : h('p', { class: 'lumen-empty' }, '打开文件夹后，最近编辑的笔记会显示在这里。'),
        ),
      ]);
  },
});

const LumenRightWing = defineComponent({
  name: 'LumenRightWing',
  props: {
    headings: { type: Array as PropType<HeadingItem[]>, default: () => [] },
    backlinks: { type: Array as PropType<BacklinkEntry[]>, default: () => [] },
    tags: { type: Array as PropType<TagEntry[]>, default: () => [] },
    onNavigateHeading: {
      type: Function as PropType<(id: string, lineNumber: number) => void>,
      default: undefined,
    },
    onNavigateBacklink: {
      type: Function as PropType<(entry: BacklinkEntry) => void>,
      default: undefined,
    },
    onSelectTag: { type: Function as PropType<(tagName: string) => void>, default: undefined },
  },
  setup(props) {
    const section = (title: string, count: number, children: VNodeChild[]): VNode =>
      h('section', { class: 'lumen-radar__section' }, [
        h('header', [h('strong', title), h('span', String(count))]),
        h(
          'div',
          { class: 'lumen-radar__body' },
          children.length > 0 ? children : [h('p', { class: 'lumen-empty' }, '当前笔记暂无内容。')],
        ),
      ]);

    return () =>
      h('aside', { class: 'lumen-radar', 'data-theme-plugin-slot': 'right-wing' }, [
        h('div', { class: 'lumen-radar__header' }, [
          h('span', '当前笔记'),
          h('span', `${props.headings.length + props.backlinks.length + props.tags.length} 条线索`),
        ]),
        section(
          '大纲',
          props.headings.length,
          props.headings.map((heading) =>
            h(
              'button',
              {
                class: ['lumen-radar-row', `lumen-radar-row--level-${heading.level}`],
                onClick: () => props.onNavigateHeading?.(heading.id, heading.lineNumber),
              },
              heading.text,
            ),
          ),
        ),
        section(
          '反链',
          props.backlinks.length,
          props.backlinks
            .slice(0, 8)
            .map((entry) =>
              h(
                'button',
                { class: 'lumen-radar-row', onClick: () => props.onNavigateBacklink?.(entry) },
                entry.noteTitle,
              ),
            ),
        ),
        section(
          '标签',
          props.tags.length,
          props.tags
            .slice(0, 18)
            .map((tag) =>
              h(
                'button',
                { class: 'lumen-tag', onClick: () => props.onSelectTag?.(tag.name) },
                `#${tag.name}`,
              ),
            ),
        ),
      ]);
  },
});

const LumenEditorControl = defineComponent({
  name: 'LumenEditorControl',
  props: {
    actions: { type: Array as PropType<ShellAction[]>, default: () => [] },
  },
  setup(props, { slots }: { slots: SlotBag }) {
    return () =>
      h('div', { class: 'lumen-command-deck', 'data-theme-plugin-slot': 'editor-control' }, [
        h('div', { class: 'lumen-command-deck__actions' }, [
          h('strong', '命令'),
          actionStrip(props.actions),
        ]),
        h('div', { class: 'lumen-command-deck__format' }, defaultSlotChildren(slots)),
      ]);
  },
});

const LumenStatusBar = defineComponent({
  name: 'LumenStatusBar',
  props: {
    statusText: { type: String, default: '' },
    wordCount: { type: Number, default: 0 },
    charCount: { type: Number, default: 0 },
    cursorLine: { type: Number as PropType<number | null>, default: null },
    cursorCol: { type: Number as PropType<number | null>, default: null },
    saveError: { type: String as PropType<string | null>, default: null },
    actions: { type: Array as PropType<ShellAction[]>, default: () => [] },
  },
  setup(props) {
    return () =>
      h('footer', { class: 'lumen-status', 'data-theme-plugin-slot': 'status-bar' }, [
        h(
          'span',
          { class: ['lumen-status__state', props.saveError && 'is-error'] },
          props.statusText,
        ),
        h('span', `${props.wordCount} 词 / ${props.charCount} 字`),
        h('span', props.cursorLine === null ? '就绪' : `第 ${props.cursorLine} 行`),
        actionStrip(props.actions, true),
      ]);
  },
});

const LumenSlotFrame = defineComponent({
  name: 'LumenSlotFrame',
  props: {
    slotId: { type: String, required: true },
  },
  setup(props, { slots }: { slots: SlotBag }) {
    return () =>
      h(
        'div',
        {
          class: ['lumen-slot-frame', `lumen-slot-frame--${props.slotId}`],
          'data-theme-plugin-slot': props.slotId,
        },
        defaultSlotChildren(slots),
      );
  },
});

export const plugin: ThemePluginModule = {
  components: {
    'left-wing': LumenLeftWing,
    'right-wing': LumenRightWing,
    'editor-control': LumenEditorControl,
    'status-bar': LumenStatusBar,
    'workflow-canvas': LumenSlotFrame,
    'editor-surface': LumenSlotFrame,
    'external-reader': LumenSlotFrame,
    'file-drawer': LumenSlotFrame,
    'command-palette': LumenSlotFrame,
    'export-dialog': LumenSlotFrame,
    'template-dialog': LumenSlotFrame,
    'settings-dialog': LumenSlotFrame,
    'share-dialog': LumenSlotFrame,
    'new-file-dialog': LumenSlotFrame,
    'delete-confirm-dialog': LumenSlotFrame,
    'external-edit-dialog': LumenSlotFrame,
    'scratch-exit-dialog': LumenSlotFrame,
    'toast-container': LumenSlotFrame,
    'update-notification': LumenSlotFrame,
    'markdown-cheat-sheet': LumenSlotFrame,
    'dialogs.theme': LumenSlotFrame,
  },
};
