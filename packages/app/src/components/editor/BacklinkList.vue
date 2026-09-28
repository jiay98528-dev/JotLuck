<template>
  <div class="backlink-list">
    <section v-for="group in groups" :key="group.path" class="backlink-group">
      <h3 class="backlink-group-title">{{ group.title }}</h3>
      <button
        v-for="entry in group.entries"
        :key="`${entry.notePath}:${entry.location?.from ?? entry.lineNumber}`"
        type="button"
        class="backlink-item"
        @click="emit('navigate', entry)"
      >
        <span class="backlink-line">{{
          t('navigation.referenceLine', { line: entry.lineNumber })
        }}</span>
        <span class="backlink-context">{{ entry.context || entry.noteTitle }}</span>
      </button>
    </section>
    <button v-if="limit < entries.length" type="button" class="backlink-more" @click="limit += 50">
      {{ t('navigation.showMore') }}
    </button>
    <p v-if="!entries.length" class="empty-hint">{{ emptyText ?? t('shell.noBacklinks') }}</p>
  </div>
</template>
<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { BacklinkEntry } from '@/types';
const props = defineProps<{ entries: BacklinkEntry[]; emptyText?: string }>();
const emit = defineEmits<{ navigate: [entry: BacklinkEntry] }>();
const { t } = useI18n();
const limit = ref(50);
watch(
  () => props.entries,
  () => {
    limit.value = 50;
  },
);
const groups = computed(() => {
  const groups = new Map<string, { path: string; title: string; entries: BacklinkEntry[] }>();
  for (const entry of props.entries.slice(0, limit.value)) {
    const group = groups.get(entry.notePath) ?? {
      path: entry.notePath,
      title: entry.noteTitle,
      entries: [],
    };
    group.entries.push(entry);
    groups.set(entry.notePath, group);
  }
  return [...groups.values()];
});
</script>
<style scoped>
.backlink-list {
  min-width: 0;
}

.backlink-group-title {
  margin: var(--space-8) 0 var(--space-4);
  font-size: var(--text-sm);
  font-weight: var(--fw-medium);
  overflow-wrap: anywhere;
}

.backlink-item,
.backlink-more {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  width: 100%;
  padding: var(--space-8);
  border: 0;
  border-radius: var(--radius);
  color: var(--ink-primary);
  background: transparent;
  text-align: start;
  cursor: pointer;
  font: inherit;
}

.backlink-item:hover,
.backlink-more:hover {
  background: var(--accent-soft);
}

.backlink-line {
  color: var(--ink-muted);
  font-size: var(--text-xs);
}

.backlink-context {
  overflow-wrap: anywhere;
  font-size: var(--text-sm);
}

:global([data-editor-pointer='touch']) .backlink-item,
:global([data-editor-pointer='touch']) .backlink-more {
  min-height: var(--touch-target-min);
}
</style>
