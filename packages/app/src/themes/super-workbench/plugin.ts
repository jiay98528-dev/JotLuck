/* eslint-disable vue/one-component-per-file -- Theme plugin registers compact slot components together. */
import { defineComponent, h, type PropType, type VNode, type VNodeChild } from 'vue';
import type { BacklinkEntry, HeadingItem, TagEntry } from '@/types';
import type { ShellAction, ThemePluginModule, ThemeSlotProps } from '@/types/theme-pack';

type SlotBag = { default?: () => VNodeChild };

function actionButton(action: ShellAction, compact = false): VNode {
  return h(
    'button',
    {
      class: ['super-action', compact && 'super-action--compact', action.active && 'is-active'],
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
    { class: 'super-action-strip' },
    actions.map((action) => actionButton(action, compact)),
  );
}

const SuperTopBar = defineComponent({
  name: 'SuperTopBar',
  props: {
    noteTitle: { type: String, default: '' },
    notebookName: { type: String, default: '' },
    leftActions: { type: Array as PropType<ShellAction[]>, default: () => [] },
    centerActions: { type: Array as PropType<ShellAction[]>, default: () => [] },
    rightActions: { type: Array as PropType<ShellAction[]>, default: () => [] },
  },
  setup(props) {
    return () =>
      h('header', { class: 'super-topbar', 'data-theme-plugin-slot': 'topbar' }, [
        h('div', { class: 'super-topbar__launch' }, actionStrip(props.leftActions, true)),
        h('div', { class: 'super-topbar__title' }, [
          h('span', { class: 'super-kicker' }, props.notebookName || 'JotLuck'),
          h('strong', props.noteTitle || '未命名工作台'),
        ]),
        h('div', { class: 'super-topbar__center' }, actionStrip(props.centerActions)),
        h('div', { class: 'super-topbar__right' }, actionStrip(props.rightActions, true)),
      ]);
  },
});

const SuperLeftWing = defineComponent({
  name: 'SuperLeftWing',
  props: {
    notes: { type: Array as PropType<Array<{ path: string; title: string }>>, default: () => [] },
    activePath: { type: String, default: '' },
    actions: { type: Array as PropType<ShellAction[]>, default: () => [] },
    onSelectNote: { type: Function as PropType<(path: string) => void>, default: undefined },
  },
  setup(props) {
    return () =>
      h('aside', { class: 'super-left-wing', 'data-theme-plugin-slot': 'left-wing' }, [
        h('div', { class: 'super-left-wing__brand' }, ['ML', h('span', 'UX')]),
        h(
          'div',
          { class: 'super-left-wing__notes' },
          props.notes.slice(0, 8).map((note, index) =>
            h(
              'button',
              {
                class: ['super-note-dot', note.path === props.activePath && 'is-active'],
                title: note.title,
                onClick: () => props.onSelectNote?.(note.path),
              },
              String(index + 1),
            ),
          ),
        ),
        h('div', { class: 'super-left-wing__actions' }, actionStrip(props.actions, true)),
      ]);
  },
});

const SuperRightWing = defineComponent({
  name: 'SuperRightWing',
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
      h('section', { class: 'super-atlas__section' }, [
        h('h3', [title, h('span', String(count))]),
        h('div', { class: 'super-atlas__body' }, children),
      ]);
    return () =>
      h('aside', { class: 'super-atlas', 'data-theme-plugin-slot': 'right-wing' }, [
        h('div', { class: 'super-atlas__header' }, [h('span', 'Atlas'), h('strong', '知识导航')]),
        section(
          '大纲',
          props.headings.length,
          props.headings.map((heading) =>
            h(
              'button',
              {
                class: ['super-heading', `super-heading--level-${heading.level}`],
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
            .slice(0, 5)
            .map((entry) =>
              h(
                'button',
                { class: 'super-backlink', onClick: () => props.onNavigateBacklink?.(entry) },
                entry.noteTitle,
              ),
            ),
        ),
        section(
          '标签',
          props.tags.length,
          props.tags
            .slice(0, 12)
            .map((tag) =>
              h(
                'button',
                { class: 'super-tag', onClick: () => props.onSelectTag?.(tag.name) },
                `#${tag.name}`,
              ),
            ),
        ),
      ]);
  },
});

const SuperStatusBar = defineComponent({
  name: 'SuperStatusBar',
  props: {
    statusText: { type: String, default: '' },
    wordCount: { type: Number, default: 0 },
    charCount: { type: Number, default: 0 },
    actions: { type: Array as PropType<ShellAction[]>, default: () => [] },
  },
  setup(props) {
    return () =>
      h('footer', { class: 'super-status', 'data-theme-plugin-slot': 'status-bar' }, [
        h('span', { class: 'super-status__state' }, props.statusText),
        h('span', `${props.wordCount} 词 / ${props.charCount} 字`),
        actionStrip(props.actions, true),
      ]);
  },
});

const SuperWrapper = defineComponent({
  name: 'SuperWrapper',
  props: {
    slotId: { type: String, required: true },
  },
  setup(props, { slots }: { slots: SlotBag }) {
    return () =>
      h(
        'div',
        {
          class: ['super-slot-shell', `super-slot-shell--${props.slotId}`],
          'data-theme-plugin-slot': props.slotId,
        },
        [
          h('div', { class: 'super-slot-shell__label' }, `ThemePlugin slot: ${props.slotId}`),
          slots.default?.(),
        ],
      );
  },
});

const SuperEditorControl = defineComponent({
  name: 'SuperEditorControl',
  props: {
    actions: { type: Array as PropType<ShellAction[]>, default: () => [] },
  },
  setup(props, { slots }: { slots: SlotBag }) {
    return () =>
      h('div', { class: 'super-editor-control', 'data-theme-plugin-slot': 'editor-control' }, [
        h('div', { class: 'super-editor-control__rail' }, [
          h('strong', 'Command Deck'),
          actionStrip(props.actions, true),
        ]),
        slots.default?.(),
      ]);
  },
});

const SuperThemeDialog = defineComponent({
  name: 'SuperThemeDialog',
  props: {
    visible: { type: Boolean, default: false },
  },
  setup(props, { slots }: { slots: SlotBag }) {
    return () => [
      props.visible
        ? h('div', { class: 'super-dialog-beacon' }, '超级主题已接管主题中心入口')
        : null,
      slots.default?.(),
    ];
  },
});

export const plugin: ThemePluginModule = {
  activate(context) {
    context.storage.set('lastActivatedAt', new Date().toISOString());
  },
  components: {
    'app-shell': SuperWrapper,
    topbar: SuperTopBar,
    'left-wing': SuperLeftWing,
    'right-wing': SuperRightWing,
    'status-bar': SuperStatusBar,
    'editor-control': SuperEditorControl,
    'workflow-canvas': SuperWrapper,
    'editor-surface': SuperWrapper,
    'file-drawer': SuperWrapper,
    'command-palette': SuperWrapper,
    'export-dialog': SuperWrapper,
    'template-dialog': SuperWrapper,
    'settings-dialog': SuperWrapper,
    'share-dialog': SuperWrapper,
    'new-file-dialog': SuperWrapper,
    'delete-confirm-dialog': SuperWrapper,
    'external-edit-dialog': SuperWrapper,
    'scratch-exit-dialog': SuperWrapper,
    'toast-container': SuperWrapper,
    'update-notification': SuperWrapper,
    'markdown-cheat-sheet': SuperWrapper,
    'dialogs.theme': SuperThemeDialog,
  },
};

export type SuperThemeSlotProps = ThemeSlotProps;
