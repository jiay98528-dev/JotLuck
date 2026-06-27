<template>
  <Button
    variant="ghost"
    :size="buttonSize"
    class="shell-action"
    :class="[
      `shell-action--${action.id}`,
      `shell-action--${labelMode}`,
      legacyActionClass,
      { 'is-active': action.active },
    ]"
    :title="action.title"
    :aria-label="action.label"
    :aria-pressed="action.active"
    :disabled="action.disabled"
    @click="action.run"
  >
    <template #icon-left>
      <svg
        v-if="action.icon === 'new-note'"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        aria-hidden="true"
      >
        <line x1="12" y1="5" x2="12" y2="19" />
        <line x1="5" y1="12" x2="19" y2="12" />
      </svg>
      <svg
        v-else-if="action.icon === 'file-drawer'"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        aria-hidden="true"
      >
        <path d="M3 6h6l2 2h10v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        <path d="M3 10h18" />
      </svg>
      <svg
        v-else-if="action.icon === 'search'"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        aria-hidden="true"
      >
        <circle cx="11" cy="11" r="8" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
      </svg>
      <svg
        v-else-if="action.icon === 'template'"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <rect x="4" y="4" width="16" height="16" rx="2" />
        <path d="M8 9h8" />
        <path d="M8 13h5" />
        <path d="M8 17h7" />
      </svg>
      <svg
        v-else-if="action.icon === 'export'"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="7 10 12 15 17 10" />
        <line x1="12" y1="15" x2="12" y2="3" />
      </svg>
      <svg
        v-else-if="action.icon === 'share'"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        aria-hidden="true"
      >
        <circle cx="18" cy="5" r="3" />
        <circle cx="6" cy="12" r="3" />
        <circle cx="18" cy="19" r="3" />
        <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
        <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
      </svg>
      <svg
        v-else-if="action.icon === 'theme'"
        class="shell-action__theme-icon"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.7"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <path d="M4 5.5h16" />
        <path d="M6.5 5.5v13" />
        <path d="M17.5 5.5v13" />
        <path d="M8 18.5h8" />
        <path d="M9 9.5h6" />
        <path d="M9 13h4" />
        <circle cx="18" cy="18" r="2.2" />
      </svg>
      <svg
        v-else-if="action.icon === 'settings'"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.6"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="3" />
        <path
          d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"
        />
      </svg>
      <svg
        v-else
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <path d="M8 5v14l11-7z" />
      </svg>
    </template>
    <span v-if="labelMode !== 'icon'" class="shell-action__label">
      {{ labelMode === 'short' ? action.shortLabel : action.label }}
    </span>
  </Button>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import Button from '@/components/common/Button.vue';
import type { ButtonSize } from '@/components/common/button-variants';
import type { ShellAction } from '@/types/theme-pack';

const props = withDefaults(
  defineProps<{
    action: ShellAction;
    labelMode?: 'icon' | 'short' | 'full';
    size?: ButtonSize;
  }>(),
  {
    labelMode: 'icon',
    size: undefined,
  },
);

const buttonSize = computed<ButtonSize>(() => {
  if (props.size) return props.size;
  return props.labelMode === 'icon' ? 'icon-sm' : 'sm';
});

const legacyActionClass = computed(() => {
  if (props.action.id === 'new-note') return 'wing-new-btn';
  if (props.action.id === 'file-drawer') return 'topbar-btn--menu';
  if (props.action.id === 'search') return 'topbar-search-hint';
  if (props.action.id === 'export') return 'topbar-btn--export';
  if (props.action.id === 'share') return 'topbar-btn--share';
  if (props.action.id === 'theme') return 'topbar-btn--theme';
  if (props.action.id === 'settings') return 'wing-settings-btn';
  if (props.action.id === 'view-toggle') return 'view-mode-toggle';
  return undefined;
});
</script>

<style scoped>
.shell-action {
  color: var(--ink-secondary);
}

.shell-action--full,
.shell-action--short {
  padding-inline: var(--space-8);
}

.shell-action--search.shell-action--full,
.shell-action--search.shell-action--short {
  justify-content: flex-start;
  min-width: 148px;
  border-color: var(--rule);
  background: var(--paper-raised);
}

.shell-action--export.is-active,
.shell-action--view-toggle.is-active,
.shell-action--search.is-active,
.shell-action--theme.is-active {
  color: var(--accent);
  border-color: var(--accent);
  background: var(--accent-soft);
}

.shell-action--theme {
  min-width: 40px;
  height: 40px;
  color: color-mix(in oklch, var(--accent) 58%, var(--ink-secondary));
}

.shell-action--theme :deep(.mk-btn__icon),
.shell-action--theme :deep(.mk-btn__icon svg),
.shell-action__theme-icon {
  width: 25px !important;
  height: 25px !important;
}

.shell-action__label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
