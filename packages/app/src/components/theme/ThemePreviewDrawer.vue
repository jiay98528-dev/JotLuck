<template>
  <Teleport to="body">
    <Transition name="theme-drawer-fade">
      <div v-if="visible && item" class="theme-drawer-overlay" @click.self="close">
        <Transition name="theme-drawer-slide" appear>
          <aside
            class="theme-drawer"
            role="dialog"
            aria-modal="true"
            :aria-labelledby="titleId"
            @keydown.escape="close"
          >
            <header class="theme-drawer-header">
              <div>
                <span class="theme-drawer-kicker">{{ item.sourceLabel }}主题</span>
                <h2 :id="titleId">{{ item.name }}</h2>
              </div>
              <button
                type="button"
                class="theme-drawer-close"
                aria-label="关闭主题预览"
                @click="close"
              >
                ×
              </button>
            </header>

            <div class="theme-drawer-preview" :data-theme-preview="item.id">
              <img
                v-if="item.officialProfile?.previewImage"
                :src="item.officialProfile.previewImage"
                :alt="`${item.name} 主题截图`"
              />
              <span v-else class="theme-drawer-preview-fallback">
                <span></span>
                <span></span>
                <span></span>
              </span>
            </div>

            <section class="theme-drawer-main">
              <div class="theme-drawer-titleline">
                <p class="theme-drawer-headline">
                  {{ item.officialProfile?.headline || item.description }}
                </p>
                <span v-if="item.performanceBadge" class="theme-performance-row">
                  <span
                    class="theme-performance-dot"
                    :data-performance-color="item.performanceBadge.color"
                  ></span>
                  <span>
                    {{ item.performanceBadge.level }} · {{ item.performanceBadge.name }}
                  </span>
                </span>
              </div>

              <p class="theme-drawer-story">
                {{ item.officialProfile?.story || item.description }}
              </p>

              <div v-if="item.officialProfile" class="theme-drawer-grid">
                <section>
                  <h3>适合</h3>
                  <ul>
                    <li v-for="entry in item.officialProfile.bestFor" :key="entry">
                      {{ entry }}
                    </li>
                  </ul>
                </section>
                <section>
                  <h3>主要变化</h3>
                  <ul>
                    <li v-for="entry in item.officialProfile.visualFeatures" :key="entry">
                      {{ entry }}
                    </li>
                  </ul>
                </section>
              </div>

              <div v-if="item.performanceBadge" class="theme-drawer-performance">
                <strong>性能压力 {{ item.performanceBadge.level }}/5</strong>
                <span>{{ item.performanceBadge.description }}</span>
              </div>

              <p v-if="!item.officialProfile" class="theme-drawer-local-note">
                本地导入主题仅获得 CSS 皮肤能力，不能替换布局、隐藏核心控件或运行脚本。
              </p>
            </section>

            <footer class="theme-drawer-footer">
              <button type="button" class="theme-drawer-btn" @click="$emit('restore-default')">
                恢复默认主题
              </button>
              <button
                type="button"
                class="theme-drawer-btn theme-drawer-btn--primary"
                :disabled="item.active"
                @click="$emit('apply', item.id)"
              >
                {{ item.active ? '已启用' : '启用主题' }}
              </button>
            </footer>
          </aside>
        </Transition>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { ThemeViewModel } from '@/stores/theme';

const props = defineProps<{
  visible: boolean;
  item: ThemeViewModel | null;
}>();

const emit = defineEmits<{
  close: [];
  apply: [string];
  'restore-default': [];
}>();

const titleId = computed(() => `theme-preview-${props.item?.id ?? 'drawer'}`);

function close(): void {
  emit('close');
}
</script>

<style scoped>
.theme-drawer-overlay {
  position: fixed;
  inset: 0;
  z-index: var(--z-modal);
  display: flex;
  justify-content: flex-end;
  background: color-mix(in oklch, var(--overlay) 78%, transparent);
}

.theme-drawer {
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr) auto;
  width: min(520px, 100vw);
  height: 100%;
  border-left: var(--border-thin) solid var(--rule-strong);
  background: var(--paper-raised);
  color: var(--ink-primary);
  box-shadow: var(--shadow-wing-float);
  outline: none;
}

.theme-drawer-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-16);
  padding: var(--space-24) var(--space-24) var(--space-16);
  border-bottom: var(--border-thin) solid var(--rule);
}

.theme-drawer-kicker {
  display: block;
  color: var(--ink-muted);
  font-size: var(--text-xs);
  line-height: var(--lh-ui);
}

.theme-drawer-header h2 {
  margin: var(--space-4) 0 0;
  color: var(--ink-primary);
  font-size: var(--text-xl);
  font-weight: var(--fw-semibold);
  line-height: var(--lh-heading);
}

.theme-drawer-close {
  width: 32px;
  height: 32px;
  border: var(--border-thin) solid transparent;
  border-radius: var(--radius);
  background: transparent;
  color: var(--ink-muted);
  font-size: var(--text-xl);
  line-height: 1;
  cursor: pointer;
}

.theme-drawer-close:hover {
  border-color: var(--rule);
  background: var(--surface-hover);
  color: var(--ink-primary);
}

.theme-drawer-close:focus-visible {
  outline: var(--focus-ring-width) solid var(--accent);
  outline-offset: var(--focus-ring-offset);
}

.theme-drawer-preview {
  height: 210px;
  overflow: hidden;
  border-bottom: var(--border-thin) solid var(--rule);
  background: var(--paper-bg);
}

.theme-drawer-preview img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.theme-drawer-preview-fallback {
  display: grid;
  grid-template-columns: 52px minmax(0, 1fr) 68px;
  gap: var(--space-12);
  height: 100%;
  padding: var(--space-18);
}

.theme-drawer-preview-fallback span {
  border-radius: var(--radius-sm);
  background: var(--rule);
}

.theme-drawer-preview-fallback span:nth-child(2) {
  background: var(--paper-surface);
}

.theme-drawer-preview-fallback span:nth-child(3) {
  background: var(--accent-soft);
}

.theme-drawer-preview[data-theme-preview='paper'] {
  background:
    linear-gradient(90deg, oklch(0.88 0.01 86) 0 56px, transparent 56px),
    linear-gradient(90deg, transparent 0 calc(100% - 96px), oklch(0.91 0.007 88) calc(100% - 96px)),
    oklch(0.97 0.004 86);
}

.theme-drawer-preview[data-theme-preview='markluck.archive'] {
  background:
    linear-gradient(90deg, oklch(0.72 0.035 95 / 0.32), transparent 38%),
    repeating-linear-gradient(0deg, transparent 0 18px, oklch(0.64 0.018 90 / 0.2) 18px 19px),
    oklch(0.93 0.015 82);
}

.theme-drawer-preview[data-theme-preview='markluck.studio'] {
  background:
    linear-gradient(90deg, oklch(0.78 0.08 28 / 0.34) 0 44px, transparent 44px),
    repeating-linear-gradient(90deg, transparent 0 48px, oklch(0.62 0.035 28 / 0.22) 48px 49px),
    oklch(0.9 0.01 220);
}

.theme-drawer-main {
  min-height: 0;
  overflow: auto;
  padding: var(--space-20) var(--space-24);
}

.theme-drawer-titleline {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-16);
}

.theme-drawer-headline {
  max-width: 42ch;
  margin: 0;
  color: var(--ink-primary);
  font-size: var(--text-lg);
  font-weight: var(--fw-semibold);
  line-height: var(--lh-heading);
}

.theme-performance-row {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: var(--space-6);
  color: var(--ink-secondary);
  font-size: var(--text-xs);
  line-height: var(--lh-ui);
}

.theme-performance-dot {
  width: 10px;
  height: 10px;
  border-radius: var(--radius-full);
  background: var(--performance-dot, var(--accent));
}

.theme-performance-dot[data-performance-color='green'] {
  --performance-dot: oklch(0.62 0.14 145);
}

.theme-performance-dot[data-performance-color='cyan'] {
  --performance-dot: oklch(0.62 0.12 205);
}

.theme-performance-dot[data-performance-color='blue'] {
  --performance-dot: oklch(0.58 0.14 255);
}

.theme-performance-dot[data-performance-color='purple'] {
  --performance-dot: oklch(0.58 0.14 305);
}

.theme-performance-dot[data-performance-color='orange'] {
  --performance-dot: oklch(0.62 0.16 45);
}

.theme-drawer-story,
.theme-drawer-local-note {
  margin: var(--space-16) 0 0;
  color: var(--ink-secondary);
  font-size: var(--text-sm);
  line-height: var(--lh-body);
}

.theme-drawer-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-18);
  margin-top: var(--space-20);
}

.theme-drawer-grid h3 {
  margin: 0 0 var(--space-8);
  color: var(--ink-muted);
  font-size: var(--text-xs);
  font-weight: var(--fw-semibold);
  letter-spacing: var(--ls-wide);
  line-height: var(--lh-ui);
  text-transform: uppercase;
}

.theme-drawer-grid ul {
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
  margin: 0;
  padding-left: var(--space-16);
  color: var(--ink-secondary);
  font-size: var(--text-xs);
  line-height: var(--lh-ui);
}

.theme-drawer-performance {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  margin-top: var(--space-20);
  padding: var(--space-12);
  border: var(--border-thin) solid var(--rule);
  border-radius: var(--radius);
  background: var(--paper-surface);
  color: var(--ink-secondary);
  font-size: var(--text-xs);
  line-height: var(--lh-ui);
}

.theme-drawer-performance strong {
  color: var(--ink-primary);
  font-weight: var(--fw-semibold);
}

.theme-drawer-footer {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-10);
  padding: var(--space-16) var(--space-24);
  border-top: var(--border-thin) solid var(--rule);
  background: var(--paper-raised);
}

.theme-drawer-btn {
  min-height: 34px;
  padding: 0 var(--space-14);
  border: var(--border-thin) solid var(--rule);
  border-radius: var(--radius);
  background: var(--paper-surface);
  color: var(--ink-secondary);
  font-size: var(--text-sm);
  cursor: pointer;
}

.theme-drawer-btn--primary {
  border-color: var(--accent);
  background: var(--accent);
  color: var(--paper-bg);
}

.theme-drawer-btn:disabled {
  cursor: default;
  opacity: var(--opacity-disabled);
}

.theme-drawer-btn:focus-visible {
  outline: var(--focus-ring-width) solid var(--accent);
  outline-offset: var(--focus-ring-offset);
}

.theme-drawer-btn:hover:not(:disabled) {
  background: var(--surface-hover);
  color: var(--ink-primary);
}

.theme-drawer-fade-enter-active,
.theme-drawer-fade-leave-active {
  transition: opacity 180ms var(--ease-fade);
}

.theme-drawer-fade-enter-from,
.theme-drawer-fade-leave-to {
  opacity: 0;
}

.theme-drawer-slide-enter-active,
.theme-drawer-slide-leave-active {
  transition:
    opacity 220ms var(--ease-enter),
    transform 220ms var(--ease-enter);
}

.theme-drawer-slide-enter-from,
.theme-drawer-slide-leave-to {
  opacity: 0;
  transform: translateX(20px);
}

@media (width <= 640px) {
  .theme-drawer {
    width: 100vw;
  }

  .theme-drawer-grid {
    grid-template-columns: 1fr;
  }
}

@media (prefers-reduced-motion: reduce) {
  .theme-drawer-fade-enter-active,
  .theme-drawer-fade-leave-active,
  .theme-drawer-slide-enter-active,
  .theme-drawer-slide-leave-active {
    transition: opacity 120ms var(--ease-fade);
  }

  .theme-drawer-slide-enter-from,
  .theme-drawer-slide-leave-to {
    transform: none;
  }
}
</style>
