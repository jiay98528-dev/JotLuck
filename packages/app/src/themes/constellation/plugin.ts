/* eslint-disable vue/one-component-per-file -- 官方主题把多个小 slot 帧合在一个文件（halo-canvas 同款例外） */
import {
  defineComponent,
  h,
  onMounted,
  onUnmounted,
  ref,
  type PropType,
  type VNodeChild,
} from 'vue';
import type { ThemePluginModule, ThemeSlotId } from '@/types/theme-pack';
import { createConstellationStarfield, type ConstellationStarfieldHandle } from './starfield';

type SlotBag = { default?: () => VNodeChild };

function defaultSlotChildren(slots: SlotBag): VNodeChild[] {
  const children = slots.default?.();
  if (children === null || children === undefined) return [];
  return Array.isArray(children) ? children : [children];
}

/**
 * Constellation deliberately preserves the host's action controls and editor surfaces.
 * Each frame only carries the deck material (hull / metal strip / instrument panel /
 * screen well); JotLuck keeps semantic controls, keyboard behavior, iconography,
 * and state wiring intact.
 */
function makeFrame(name: string, frameClass: string, tag: 'div' | 'section' = 'div') {
  return defineComponent({
    name,
    props: {
      slotId: { type: String as PropType<ThemeSlotId>, required: true },
    },
    setup(props, { slots }: { slots: SlotBag }) {
      return () =>
        h(
          tag,
          {
            class: [frameClass, `${frameClass}--${props.slotId}`],
            'data-theme-plugin-slot': props.slotId,
            'data-constellation-zone': props.slotId,
          },
          defaultSlotChildren(slots),
        );
    },
  });
}

/**
 * The hull owns the ambient starfield canvas. The engine handle stays in a
 * plain setup-scope binding — never inside a reactive container (BUG-139).
 * Unmounting the hull disposes the engine, so switching themes leaves no
 * animation loop or GL context behind.
 */
const ConstellationHull = defineComponent({
  name: 'ConstellationHull',
  props: {
    slotId: { type: String as PropType<ThemeSlotId>, required: true },
  },
  setup(props, { slots }: { slots: SlotBag }) {
    const starsEl = ref<HTMLCanvasElement | null>(null);
    let starfield: ConstellationStarfieldHandle | null = null;

    onMounted(() => {
      if (starsEl.value) starfield = createConstellationStarfield(starsEl.value);
    });

    onUnmounted(() => {
      starfield?.dispose();
      starfield = null;
    });

    return () =>
      h(
        'div',
        {
          class: ['constellation-hull', `constellation-hull--${props.slotId}`],
          'data-theme-plugin-slot': props.slotId,
          'data-constellation-zone': props.slotId,
        },
        [
          h('canvas', {
            ref: starsEl,
            class: 'constellation-stars',
            'aria-hidden': 'true',
          }),
          ...defaultSlotChildren(slots),
        ],
      );
  },
});
const ConstellationCommandBar = makeFrame('ConstellationCommandBar', 'constellation-command-bar');
const ConstellationNavPanel = makeFrame('ConstellationNavPanel', 'constellation-nav-panel');
const ConstellationAuxPanel = makeFrame('ConstellationAuxPanel', 'constellation-aux-panel');
const ConstellationControlDeck = makeFrame(
  'ConstellationControlDeck',
  'constellation-control-deck',
  'section',
);
const ConstellationTelemetry = makeFrame('ConstellationTelemetry', 'constellation-telemetry');
const ConstellationCanvas = makeFrame('ConstellationCanvas', 'constellation-canvas');
const ConstellationScreen = makeFrame('ConstellationScreen', 'constellation-screen');
const ConstellationReaderFrame = makeFrame(
  'ConstellationReaderFrame',
  'constellation-reader-frame',
);

export const plugin: ThemePluginModule = {
  components: {
    'app-shell': ConstellationHull,
    topbar: ConstellationCommandBar,
    'left-wing': ConstellationNavPanel,
    'right-wing': ConstellationAuxPanel,
    'editor-control': ConstellationControlDeck,
    'status-bar': ConstellationTelemetry,
    'workflow-canvas': ConstellationCanvas,
    'editor-surface': ConstellationScreen,
    'external-reader': ConstellationReaderFrame,
  },
};
