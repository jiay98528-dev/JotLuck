/* eslint-disable vue/one-component-per-file -- Official theme keeps small slot frames together. */
import { defineComponent, h, type PropType, type VNodeChild } from 'vue';
import type { ThemePluginModule, ThemeSlotId } from '@/types/theme-pack';

type SlotBag = { default?: () => VNodeChild };

function defaultSlotChildren(slots: SlotBag): VNodeChild[] {
  const children = slots.default?.();
  if (children === null || children === undefined) return [];
  return Array.isArray(children) ? children : [children];
}

/**
 * Halo deliberately preserves the host's action controls and editor surfaces.
 * The theme owns the material frame, while JotLuck keeps semantic controls,
 * keyboard behavior, iconography, and state wiring intact.
 */
const HaloChromeFrame = defineComponent({
  name: 'HaloChromeFrame',
  props: {
    slotId: { type: String as PropType<ThemeSlotId>, required: true },
  },
  setup(props, { slots }: { slots: SlotBag }) {
    return () =>
      h(
        'div',
        {
          class: ['halo-frame', `halo-frame--${props.slotId}`],
          'data-theme-plugin-slot': props.slotId,
          'data-halo-zone': props.slotId,
        },
        defaultSlotChildren(slots),
      );
  },
});

const HaloCommandDeck = defineComponent({
  name: 'HaloCommandDeck',
  props: {
    slotId: { type: String as PropType<ThemeSlotId>, required: true },
  },
  setup(props, { slots }: { slots: SlotBag }) {
    return () =>
      h(
        'section',
        {
          class: 'halo-command-deck',
          'data-theme-plugin-slot': props.slotId,
          'data-halo-zone': 'command-deck',
        },
        [h('div', { class: 'halo-command-deck__content' }, defaultSlotChildren(slots))],
      );
  },
});

export const plugin: ThemePluginModule = {
  components: {
    topbar: HaloChromeFrame,
    'left-wing': HaloChromeFrame,
    'right-wing': HaloChromeFrame,
    'editor-control': HaloCommandDeck,
    'status-bar': HaloChromeFrame,
    'workflow-canvas': HaloChromeFrame,
    'editor-surface': HaloChromeFrame,
    'external-reader': HaloChromeFrame,
  },
};
