<template>
  <div class="welcome">
    <div class="welcome-content">
      <h1 class="welcome-title">欢迎使用 MarkLuck</h1>
      <p class="welcome-subtitle">
        你的笔记，你的文件，你的掌控。<br />每一篇笔记都是纯文本 Markdown 文件，永远属于你。
      </p>

      <div class="welcome-actions">
        <button class="welcome-btn welcome-btn--primary" @click="$emit('createNote')">
          ✦ 创建第一篇笔记
        </button>
      </div>

      <p class="welcome-hint">
        或使用
        <kbd>Ctrl+Shift+P</kbd>
        搜索已有笔记
      </p>

      <!-- Recent notebooks (M6+ will use real paths) -->
      <div v-if="recentNotebooks.length > 0" class="welcome-recent">
        <h3 class="welcome-recent-title">最近使用</h3>
        <ul class="welcome-recent-list">
          <li v-for="nb in recentNotebooks" :key="nb" class="welcome-recent-item">
            <button class="welcome-recent-btn" @click="$emit('openNotebook', nb)">
              📁 {{ nb }}
            </button>
          </li>
        </ul>
      </div>

      <!-- Error state -->
      <div v-if="error" class="welcome-error">
        <p>{{ error }}</p>
        <button class="welcome-btn" @click="$emit('retry')">重试</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * WelcomePage.vue — 首次启动引导页
 *
 * M1-19: 空笔记本时显示引导界面。M6+ 可扩展为文件夹选择流程。
 *
 * @see components.md §34
 */
withDefaults(
  defineProps<{
    recentNotebooks?: string[];
    error?: string;
  }>(),
  {
    recentNotebooks: () => [],
    error: '',
  },
);

defineEmits<{
  createNote: [];
  openNotebook: [path: string];
  retry: [];
}>();
</script>

<style scoped>
.welcome {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  background: var(--editor-bg, oklch(0.985 0.001 85));
}

.welcome-content {
  text-align: center;
  max-width: 420px;
  padding: var(--space-32, 32px);
}

.welcome-title {
  font-size: var(--text-2xl, 32px);
  font-weight: var(--fw-bold, 700);
  color: var(--ink-primary, oklch(0.15 0.003 85));
  margin: 0 0 12px;
  letter-spacing: var(--ls-tight, -0.02em);
}

.welcome-subtitle {
  font-size: var(--text-base, 16px);
  color: var(--ink-secondary, oklch(0.42 0.003 85));
  line-height: var(--lh-reading, 1.6);
  margin: 0 0 32px;
}

.welcome-actions {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  margin-bottom: 24px;
}

.welcome-btn {
  padding: 10px 24px;
  border: 1px solid var(--rule, oklch(0.88 0.003 85));
  border-radius: var(--radius, 2px);
  background: var(--paper-surface, oklch(0.985 0.002 85));
  color: var(--ink-secondary, oklch(0.42 0.003 85));
  font-size: var(--text-sm, 14px);
  cursor: pointer;
  transition:
    background 150ms var(--ease-fade, cubic-bezier(0.4, 0, 0.2, 1)),
    border-color 150ms var(--ease-fade, cubic-bezier(0.4, 0, 0.2, 1));
}

.welcome-btn:hover {
  background: var(--accent-soft, oklch(0.92 0.03 250 / 0.55));
  border-color: var(--accent, oklch(0.52 0.12 250));
}

.welcome-btn--primary {
  background: var(--accent, oklch(0.52 0.12 250));
  color: oklch(0.995 0 0);
  border-color: var(--accent, oklch(0.52 0.12 250));
  font-size: var(--text-base, 16px);
  padding: 12px 32px;
}

.welcome-btn--primary:hover {
  background: var(--accent-hover, oklch(0.47 0.13 250));
}

.welcome-hint {
  font-size: var(--text-xs, 12px);
  color: var(--ink-muted, oklch(0.6 0.002 85));
}

.welcome-hint kbd {
  display: inline-block;
  padding: 1px 6px;
  border: 1px solid var(--rule, oklch(0.88 0.003 85));
  border-radius: 3px;
  font-family: var(--ff-mono, monospace);
  font-size: 11px;
  background: var(--paper-surface, oklch(0.985 0.002 85));
}

.welcome-recent {
  margin-top: 40px;
  text-align: left;
}

.welcome-recent-title {
  font-size: var(--text-sm, 14px);
  font-weight: var(--fw-semibold, 600);
  color: var(--ink-secondary, oklch(0.42 0.003 85));
  margin: 0 0 8px;
}

.welcome-recent-list {
  list-style: none;
  padding: 0;
  margin: 0;
}

.welcome-recent-item {
  margin-bottom: 4px;
}

.welcome-recent-btn {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid var(--rule, oklch(0.88 0.003 85));
  border-radius: var(--radius, 2px);
  background: var(--paper-surface, oklch(0.985 0.002 85));
  color: var(--ink-secondary, oklch(0.42 0.003 85));
  font-size: var(--text-sm, 14px);
  cursor: pointer;
  text-align: left;
  transition: background 150ms var(--ease-fade, cubic-bezier(0.4, 0, 0.2, 1));
}

.welcome-recent-btn:hover {
  background: var(--accent-soft, oklch(0.92 0.03 250 / 0.55));
}

.welcome-error {
  margin-top: 24px;
  padding: 12px;
  border-radius: var(--radius, 2px);
  background: oklch(0.95 0.01 25 / 0.3);
  color: var(--signal-error, oklch(0.48 0.17 25));
  font-size: var(--text-sm, 14px);
}
</style>
