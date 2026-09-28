<template>
  <ul
    ref="root"
    class="heading-tree"
    @wheel.passive="follow = false"
    @touchmove.passive="follow = false"
  >
    <li
      v-for="item in items"
      :key="item.node.id"
      class="heading-node"
      :class="{ active: activeId === item.node.id }"
    >
      <button
        type="button"
        class="heading-link"
        :data-heading-id="item.node.id"
        :aria-current="activeId === item.node.id ? 'location' : undefined"
        :style="{ paddingInlineStart: `${item.depth * 14 + 8}px` }"
        @click="emit('navigate', item.node.id, item.node.lineNumber)"
      >
        {{ item.node.text || t('shell.untitled') }}
      </button>
    </li>
  </ul>
</template>
<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue';
import { useI18n } from 'vue-i18n';
import type { HeadingItem } from '@/types';
const props = withDefaults(defineProps<{ nodes: HeadingItem[]; activeId?: string | null }>(), {
  activeId: null,
});
const emit = defineEmits<{ navigate: [id: string, line: number] }>();
const { t } = useI18n();
const root = ref<HTMLElement | null>(null);
const follow = ref(true);
const items = computed(() => {
  const flatten = (nodes: HeadingItem[], depth: number): { node: HeadingItem; depth: number }[] =>
    nodes.flatMap((node) => [{ node, depth }, ...flatten(node.children, depth + 1)]);
  return flatten(props.nodes, 0);
});
async function revealActive() {
  await nextTick();
  if (!follow.value || !props.activeId) return;
  const target = root.value?.querySelector<HTMLElement>(
    `[data-heading-id="${CSS.escape(props.activeId)}"]`,
  );
  if (!target) return;
  for (let parent = root.value?.parentElement; parent; parent = parent.parentElement) {
    if (
      /(auto|scroll)/.test(getComputedStyle(parent).overflowY) &&
      parent.scrollHeight > parent.clientHeight
    ) {
      const bounds = parent.getBoundingClientRect(),
        item = target.getBoundingClientRect();
      if (item.top < bounds.top) parent.scrollTop -= bounds.top - item.top;
      else if (item.bottom > bounds.bottom) parent.scrollTop += item.bottom - bounds.bottom;
      break;
    }
    if (parent.tagName === 'ASIDE') break;
  }
}
function resume() {
  follow.value = true;
  void revealActive();
}
let scrollHost: HTMLElement | null = null;
function pauseFollow() {
  follow.value = false;
}
watch(() => props.activeId, revealActive);
onMounted(() => {
  document.addEventListener('jotluck-document-activity', resume);
  scrollHost = root.value?.parentElement ?? null;
  scrollHost?.addEventListener('pointerdown', pauseFollow, true);
  scrollHost?.addEventListener('keydown', pauseFollow, true);
});
onUnmounted(() => {
  document.removeEventListener('jotluck-document-activity', resume);
  scrollHost?.removeEventListener('pointerdown', pauseFollow, true);
  scrollHost?.removeEventListener('keydown', pauseFollow, true);
});
</script>
<style scoped>
.heading-tree {
  list-style: none;
  padding: 0;
  margin: 0;
}

.heading-link {
  display: block;
  width: 100%;
  padding: var(--space-6) var(--space-8);
  border: 0;
  background: transparent;
  color: var(--ink-secondary);
  font: inherit;
  font-size: var(--text-sm);
  text-align: start;
  overflow-wrap: anywhere;
  cursor: pointer;
}

.heading-link[aria-current],
.heading-link:hover {
  color: var(--accent);
  background: var(--accent-soft);
}

:global([data-editor-pointer='touch']) .heading-link {
  min-height: var(--touch-target-min);
}
</style>
