<script lang="ts">
import { defineComponent, h, type PropType, type VNodeChild } from 'vue';
import ShellActionButton from '@/components/layout/ShellActionButton.vue';
import { getTrustedThemeComponent } from '@/services/ThemeRuntimeHost';
import type {
  ShellAction,
  ThemeActionRegion,
  ThemePrimitiveNode,
  ThemeSlotId,
  UxComponentRecipe,
} from '@/types/theme-pack';

function normalizeClass(...parts: Array<string | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

export default defineComponent({
  name: 'ThemeRuntimeRenderer',
  props: {
    slotId: {
      type: String as PropType<ThemeSlotId>,
      required: true,
    },
    themeId: {
      type: String,
      required: true,
    },
    recipe: {
      type: Object as PropType<UxComponentRecipe | undefined>,
      default: undefined,
    },
    actions: {
      type: Array as PropType<ShellAction[]>,
      default: () => [],
    },
    statusText: {
      type: String,
      default: '',
    },
  },
  setup(props, { slots }) {
    const actionsFor = (region?: unknown): ShellAction[] => {
      if (typeof region !== 'string') return props.actions;
      return props.actions.filter((action) => action.region === (region as ThemeActionRegion));
    };

    const renderNode = (node: ThemePrimitiveNode): VNodeChild => {
      const className = normalizeClass(
        'theme-runtime-node',
        `theme-runtime-node--${node.type.toLowerCase()}`,
        node.className,
      );
      const children: VNodeChild[] = node.children?.map(renderNode) ?? [];

      if (node.type === 'Slot') return slots.default?.();

      if (node.type === 'Text') {
        return h('span', { class: className }, node.text ?? '');
      }

      if (node.type === 'ActionList') {
        return h(
          'div',
          { class: className },
          actionsFor(node.props?.region).map((action) =>
            h(ShellActionButton, {
              key: action.id,
              action,
              labelMode: node.props?.labelMode === 'short' ? 'short' : 'icon',
              size: node.props?.size === 'sm' ? 'sm' : undefined,
            }),
          ),
        );
      }

      if (node.type === 'ActionButton') {
        const action = props.actions.find((item) => item.id === node.action?.actionId);
        return action
          ? h(ShellActionButton, {
              class: className,
              action,
              labelMode: node.props?.labelMode === 'short' ? 'short' : 'icon',
              size: node.props?.size === 'sm' ? 'sm' : undefined,
            })
          : null;
      }

      if (node.type === 'EditorStatus') {
        return h('span', { class: className }, props.statusText);
      }

      const tag = node.type === 'Grid' ? 'div' : node.type === 'Panel' ? 'section' : 'div';
      return h(tag, { class: className, 'data-theme-node-id': node.id }, children);
    };

    return () => {
      const codeComponent = getTrustedThemeComponent(props.themeId, props.slotId);
      if (codeComponent) {
        return h(codeComponent, {
          slotId: props.slotId,
          actions: props.actions,
          statusText: props.statusText,
        });
      }

      if (!props.recipe) return slots.default?.();

      return h(
        'div',
        {
          class: ['theme-runtime', `theme-runtime--${props.slotId.replace('.', '-')}`],
          'data-theme-runtime-slot': props.slotId,
        },
        [renderNode(props.recipe.root)],
      );
    };
  },
});
</script>

<style scoped>
.theme-runtime {
  min-width: 0;
}

.theme-runtime-node--stack,
.theme-runtime-node--actionlist {
  display: flex;
  align-items: center;
  min-width: 0;
}

.theme-runtime-node--grid {
  display: grid;
  min-width: 0;
}

.theme-runtime-node--panel {
  min-width: 0;
  border: var(--border-thin) solid var(--rule);
  border-radius: var(--radius);
  background: var(--paper-raised);
}

.theme-runtime-node--text {
  min-width: 0;
  color: var(--ink-secondary);
  font-size: var(--text-sm);
  font-weight: var(--fw-semibold);
  letter-spacing: var(--ls-wide);
  white-space: nowrap;
}
</style>
