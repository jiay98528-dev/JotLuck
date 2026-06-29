<template>
  <Teleport to="body">
    <div v-if="visible" class="modal-overlay" @click.self="close">
      <div
        class="modal-card theme-center"
        role="dialog"
        aria-modal="true"
        aria-labelledby="theme-center-title"
      >
        <header class="theme-center__header">
          <div>
            <span class="theme-center__eyebrow">外观</span>
            <h2 id="theme-center-title">选择主题</h2>
            <p>为写作环境选择合适的界面风格。预览不会改变当前设置，使用后会自动记住。</p>
          </div>
          <button
            class="theme-center__close"
            type="button"
            aria-label="关闭主题中心"
            @click="close"
          >
            ×
          </button>
        </header>

        <section class="theme-center__status">
          <div>
            <span>当前使用</span>
            <strong>{{ theme.activeThemeLabel }}</strong>
          </div>
          <small v-if="theme.previewThemeId">正在预览，关闭窗口后会恢复当前主题</small>
          <small v-else>所有主题都可以离线使用</small>
        </section>

        <div class="theme-center__body">
          <main class="theme-center__main">
            <section class="theme-section">
              <div class="theme-section__head">
                <h3>内置主题</h3>
                <p>这些主题随 MarkLuck 一起提供，适合日常写作和整理。</p>
              </div>

              <div class="theme-grid">
                <article
                  v-for="pack in theme.publicCatalogThemes"
                  :key="pack.manifest.id"
                  class="theme-card"
                  :class="{
                    'is-active': pack.manifest.id === theme.activeThemeId,
                    'is-preview': pack.manifest.id === theme.previewThemeId,
                  }"
                >
                  <button
                    class="theme-card__preview"
                    type="button"
                    :aria-label="`查看 ${pack.manifest.name}`"
                    @click="select(pack.manifest.id)"
                  >
                    <img
                      v-if="previewImage(pack)"
                      :src="previewImage(pack)"
                      :alt="`${pack.manifest.name} 首页预览`"
                    />
                    <span v-else class="theme-card__fallback" aria-hidden="true">
                      <span />
                      <span />
                      <span />
                    </span>
                  </button>

                  <div class="theme-card__copy">
                    <div class="theme-card__title-row">
                      <h4>{{ pack.manifest.name }}</h4>
                      <span v-if="pack.manifest.id === theme.activeThemeId" class="theme-pill">
                        使用中
                      </span>
                    </div>
                    <p>{{ themeSummary(pack) }}</p>
                  </div>

                  <div class="theme-card__meta">
                    <span>{{ readingWidthLabel(pack) }}</span>
                    <span>{{ motionLabel(pack) }}</span>
                    <span>{{ performanceLabel(pack) }}</span>
                  </div>

                  <div class="theme-card__actions">
                    <button class="theme-action" type="button" @click="preview(pack.manifest.id)">
                      预览
                    </button>
                    <button
                      v-if="theme.previewThemeId === pack.manifest.id"
                      class="theme-action"
                      type="button"
                      @click="theme.clearPreview()"
                    >
                      结束预览
                    </button>
                    <button
                      class="theme-action theme-action--primary"
                      type="button"
                      :disabled="pack.manifest.id === theme.activeThemeId"
                      @click="activate(pack.manifest.id)"
                    >
                      {{ pack.manifest.id === theme.activeThemeId ? '已使用' : '使用' }}
                    </button>
                  </div>
                </article>
              </div>
            </section>

            <section v-if="showDeveloperThemes" class="theme-section theme-section--developer">
              <div class="theme-section__head">
                <h3>开发主题</h3>
                <p>仅在本机开发开关启用时显示，用于内部检查主题能力。</p>
              </div>

              <div class="theme-grid theme-grid--compact">
                <article
                  v-for="pack in theme.developerCatalogThemes"
                  :key="pack.manifest.id"
                  class="theme-card theme-card--compact"
                >
                  <div class="theme-card__copy">
                    <h4>{{ pack.manifest.name }}</h4>
                    <p>{{ themeSummary(pack) }}</p>
                  </div>
                  <div class="theme-card__actions">
                    <button class="theme-action" type="button" @click="preview(pack.manifest.id)">
                      预览
                    </button>
                    <button
                      class="theme-action theme-action--primary"
                      type="button"
                      :disabled="pack.manifest.id === theme.activeThemeId"
                      @click="activate(pack.manifest.id)"
                    >
                      {{ pack.manifest.id === theme.activeThemeId ? '已使用' : '使用' }}
                    </button>
                  </div>
                </article>
              </div>
            </section>
          </main>

          <aside class="theme-center__side">
            <section class="theme-detail">
              <div v-if="selectedTheme">
                <img
                  v-if="previewImage(selectedTheme)"
                  class="theme-detail__image"
                  :src="previewImage(selectedTheme)"
                  :alt="`${selectedTheme.manifest.name} 首页预览`"
                />

                <div class="theme-detail__head">
                  <span class="theme-center__eyebrow">主题说明</span>
                  <h3>{{ selectedTheme.manifest.name }}</h3>
                  <p>
                    {{ selectedTheme.officialProfile?.headline || themeSummary(selectedTheme) }}
                  </p>
                </div>

                <div class="theme-detail__group">
                  <h4>适合</h4>
                  <div class="theme-token-list">
                    <span v-for="item in selectedTheme.officialProfile?.bestFor ?? []" :key="item">
                      {{ item }}
                    </span>
                  </div>
                </div>

                <div class="theme-detail__group">
                  <h4>界面特点</h4>
                  <ul>
                    <li
                      v-for="item in selectedTheme.officialProfile?.visualFeatures ?? []"
                      :key="item"
                    >
                      {{ item }}
                    </li>
                  </ul>
                </div>

                <div class="theme-detail__facts">
                  <div>
                    <span>阅读宽度</span>
                    <strong>{{ readingWidthLabel(selectedTheme) }}</strong>
                  </div>
                  <div>
                    <span>动效</span>
                    <strong>{{ motionLabel(selectedTheme) }}</strong>
                  </div>
                  <div>
                    <span>性能</span>
                    <strong>{{ performanceLabel(selectedTheme) }}</strong>
                  </div>
                </div>
              </div>
              <div v-else class="theme-empty">选择一个主题查看说明。</div>
            </section>

            <section class="theme-import">
              <div>
                <h3>导入主题文件</h3>
                <p>选择本机的主题包，安装后会出现在这里。</p>
              </div>
              <input
                ref="fileInput"
                class="theme-center__file"
                type="file"
                accept=".mltheme,.zip,application/zip"
                @change="onImportFile"
              />
              <button
                class="theme-action theme-action--primary theme-action--wide"
                type="button"
                @click="fileInput?.click()"
              >
                选择主题包
              </button>
              <p v-if="importMessage" class="theme-center__message">{{ importMessage }}</p>
              <p v-if="importError" class="theme-center__message theme-center__message--error">
                {{ importError }}
              </p>

              <div v-if="theme.importedThemes.length > 0" class="theme-import__list">
                <article
                  v-for="pack in theme.importedThemes"
                  :key="pack.manifest.id"
                  class="theme-installed"
                >
                  <div>
                    <strong>{{ pack.manifest.name }}</strong>
                    <span>已安装</span>
                  </div>
                  <button
                    class="theme-action"
                    type="button"
                    @click="theme.uninstallTheme(pack.manifest.id)"
                  >
                    移除
                  </button>
                </article>
              </div>
            </section>
          </aside>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useThemeStore } from '@/stores/theme';
import type { InstalledThemePack } from '@/types/theme-pack';

const props = defineProps<{
  visible: boolean;
}>();

const emit = defineEmits<{
  'update:visible': [visible: boolean];
}>();

const theme = useThemeStore();
const fileInput = ref<HTMLInputElement | null>(null);
const importMessage = ref('');
const importError = ref('');
const selectedThemeId = ref<string | null>(null);

const showDeveloperThemes = computed(
  () => theme.showDeveloperThemesInCatalog && theme.developerCatalogThemes.length > 0,
);
const selectedTheme = computed(() => {
  const id = selectedThemeId.value ?? theme.previewThemeId ?? theme.activeThemeId;
  return (
    theme.themes.find((pack) => pack.manifest.id === id) ?? theme.publicCatalogThemes[0] ?? null
  );
});

watch(
  () => props.visible,
  (visible) => {
    if (!visible) return;
    theme.refreshThemeCenterDeveloperVisibility();
    selectedThemeId.value = theme.previewThemeId ?? theme.activeThemeId;
  },
  { immediate: true },
);

function close(): void {
  theme.clearPreview();
  emit('update:visible', false);
}

function select(themeId: string): void {
  selectedThemeId.value = themeId;
}

function previewImage(pack: InstalledThemePack): string | undefined {
  return pack.previewImages?.[0] ?? pack.manifest.previewImages?.[0];
}

function themeSummary(pack: InstalledThemePack): string {
  return (
    pack.officialProfile?.story ?? pack.manifest.description ?? '为当前写作环境应用新的界面风格。'
  );
}

function readingWidthLabel(pack: InstalledThemePack): string {
  const width = pack.officialProfile?.uiProfile.readingWidth;
  if (width === 'immersive') return '沉浸版心';
  if (width === 'wide') return '宽版心';
  if (width === 'compact') return '紧凑版心';
  return '标准版心';
}

function motionLabel(pack: InstalledThemePack): string {
  const motion = pack.officialProfile?.uiProfile.motionIntensity;
  if (motion === 'none') return '无动效';
  if (motion === 'low') return '轻动效';
  if (motion === 'high') return '强动效';
  return '适中动效';
}

function performanceLabel(pack: InstalledThemePack): string {
  const level = pack.officialProfile?.performanceLevel ?? 1;
  if (level <= 1) return '轻量';
  if (level <= 3) return '标准';
  if (level === 4) return '沉浸';
  return '重载';
}

function preview(themeId: string): void {
  select(themeId);
  theme.previewThemeById(themeId);
}

function activate(themeId: string): void {
  select(themeId);
  theme.activateTheme(themeId);
}

async function onImportFile(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  importError.value = '';
  importMessage.value = '';
  if (!file) return;
  try {
    const pack = await theme.importThemePack(file);
    importMessage.value = `已安装：${pack.manifest.name}`;
    selectedThemeId.value = pack.manifest.id;
  } catch (error) {
    importError.value = error instanceof Error ? error.message : String(error);
  }
}
</script>

<style scoped>
.theme-center {
  width: min(1080px, calc(100vw - var(--space-32)));
  max-height: min(820px, calc(100vh - var(--space-32)));
  overflow: hidden;
}

.theme-center__header,
.theme-center__status,
.theme-section__head,
.theme-card__title-row,
.theme-card__meta,
.theme-card__actions,
.theme-installed {
  display: flex;
  gap: var(--space-12);
  align-items: center;
}

.theme-center__header {
  justify-content: space-between;
  padding: var(--space-24) var(--space-28);
  border-bottom: var(--border-thin) solid var(--rule);
  background: var(--paper-raised);
}

.theme-center__header h2,
.theme-section h3,
.theme-card h4,
.theme-detail h3,
.theme-detail h4,
.theme-import h3 {
  margin: 0;
  color: var(--ink-primary);
}

.theme-center__header h2 {
  font-size: var(--text-2xl);
  line-height: var(--lh-heading);
}

.theme-center__header p,
.theme-section p,
.theme-card p,
.theme-detail p,
.theme-import p {
  margin: var(--space-6) 0 0;
  color: var(--ink-secondary);
  font-size: var(--text-sm);
  line-height: var(--lh-body);
}

.theme-center__eyebrow {
  color: var(--ink-muted);
  font-size: var(--text-xs);
  font-weight: var(--fw-semibold);
  letter-spacing: var(--ls-wide);
}

.theme-center__close {
  width: 38px;
  height: 38px;
  display: grid;
  flex: 0 0 auto;
  place-items: center;
  border: var(--border-thin) solid transparent;
  border-radius: var(--radius);
  background: transparent;
  color: var(--ink-muted);
  font: inherit;
  font-size: var(--text-xl);
  line-height: 1;
  cursor: pointer;
}

.theme-center__close:hover,
.theme-center__close:focus-visible {
  border-color: var(--rule);
  background: var(--surface-hover);
  color: var(--ink-primary);
}

.theme-center__status {
  justify-content: space-between;
  padding: var(--space-14) var(--space-28);
  border-bottom: var(--border-thin) solid var(--rule);
  background: color-mix(in oklch, var(--accent-soft) 24%, var(--paper-raised));
  color: var(--ink-secondary);
}

.theme-center__status strong {
  margin-left: var(--space-8);
  color: var(--ink-primary);
}

.theme-center__body {
  max-height: calc(100vh - 176px);
  display: grid;
  grid-template-columns: minmax(0, 1fr) 320px;
  gap: var(--space-18);
  padding: var(--space-22) var(--space-24) var(--space-24);
  overflow: auto;
  background: var(--paper-surface);
}

.theme-center__main,
.theme-center__side,
.theme-section,
.theme-detail,
.theme-import {
  min-width: 0;
  display: grid;
  gap: var(--space-16);
}

.theme-section {
  align-self: start;
}

.theme-section__head {
  justify-content: space-between;
  align-items: flex-end;
}

.theme-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(284px, 1fr));
  gap: var(--space-16);
}

.theme-grid--compact {
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
}

.theme-card {
  min-width: 0;
  display: grid;
  gap: var(--space-14);
  padding: var(--space-14);
  border: var(--border-thin) solid var(--rule);
  border-radius: var(--radius-lg);
  background: var(--paper-raised);
}

.theme-card.is-active {
  border-color: color-mix(in oklch, var(--accent) 48%, var(--rule));
  background: color-mix(in oklch, var(--accent-soft) 20%, var(--paper-raised));
}

.theme-card.is-preview {
  outline: 2px solid color-mix(in oklch, var(--accent) 32%, transparent);
  outline-offset: 2px;
}

.theme-card__preview {
  position: relative;
  width: 100%;
  aspect-ratio: 16 / 10;
  display: block;
  padding: 0;
  overflow: hidden;
  border: var(--border-thin) solid var(--rule);
  border-radius: var(--radius);
  background: var(--paper-bg);
  cursor: pointer;
}

.theme-card__preview img,
.theme-detail__image {
  width: 100%;
  height: 100%;
  display: block;
  object-fit: cover;
}

.theme-card__preview:hover,
.theme-card__preview:focus-visible {
  border-color: color-mix(in oklch, var(--accent) 46%, var(--rule));
}

.theme-card__fallback {
  height: 100%;
  display: grid;
  grid-template-columns: 0.22fr 1fr 0.28fr;
  gap: var(--space-8);
  padding: var(--space-10);
}

.theme-card__fallback span {
  border-radius: var(--radius-sm);
  background: color-mix(in oklch, var(--paper-raised) 72%, var(--rule));
}

.theme-card__copy {
  min-width: 0;
  display: grid;
  gap: var(--space-8);
}

.theme-card__title-row {
  justify-content: space-between;
  align-items: flex-start;
}

.theme-card h4 {
  min-width: 0;
  overflow-wrap: anywhere;
  font-size: var(--text-lg);
  line-height: var(--lh-heading);
}

.theme-card p {
  min-height: calc(var(--text-sm) * 1.55 * 2);
  display: -webkit-box;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.theme-card__meta {
  flex-wrap: wrap;
  gap: var(--space-6);
  color: var(--ink-muted);
  font-size: var(--text-xs);
}

.theme-card__meta span,
.theme-token-list span {
  padding: var(--space-3) var(--space-8);
  border-radius: var(--radius-pill);
  background: var(--surface-hover);
}

.theme-card__actions {
  flex-wrap: wrap;
  gap: var(--space-8);
}

.theme-pill {
  flex: 0 0 auto;
  padding: var(--space-3) var(--space-9);
  border: var(--border-thin) solid color-mix(in oklch, var(--accent) 34%, var(--rule));
  border-radius: var(--radius-pill);
  color: var(--accent);
  font-size: var(--text-xs);
  line-height: var(--lh-ui);
  white-space: nowrap;
}

.theme-action {
  min-width: 72px;
  min-height: 36px;
  padding: 0 var(--space-14);
  border: var(--border-thin) solid var(--rule);
  border-radius: var(--radius);
  background: var(--paper-surface);
  color: var(--ink-secondary);
  font: inherit;
  font-size: var(--text-sm);
  line-height: var(--lh-ui);
  white-space: nowrap;
  cursor: pointer;
}

.theme-action:disabled {
  cursor: not-allowed;
  opacity: 0.58;
}

.theme-action:focus-visible,
.theme-action:hover:not(:disabled) {
  border-color: color-mix(in oklch, var(--accent) 42%, var(--rule));
  background: var(--surface-hover);
  color: var(--ink-primary);
}

.theme-action--primary {
  border-color: color-mix(in oklch, var(--accent) 46%, var(--rule));
  background: var(--accent-soft);
  color: var(--accent);
  font-weight: var(--fw-semibold);
}

.theme-action--wide {
  width: 100%;
}

.theme-detail,
.theme-import {
  align-self: start;
  padding: var(--space-16);
  border: var(--border-thin) solid var(--rule);
  border-radius: var(--radius-lg);
  background: var(--paper-raised);
}

.theme-detail__image {
  aspect-ratio: 16 / 10;
  height: auto;
  margin-bottom: var(--space-14);
  overflow: hidden;
  border: var(--border-thin) solid var(--rule);
  border-radius: var(--radius);
  object-fit: cover;
}

.theme-detail__head,
.theme-detail__group {
  display: grid;
  gap: var(--space-8);
  margin-bottom: var(--space-16);
}

.theme-detail__group h4 {
  font-size: var(--text-sm);
}

.theme-token-list {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-6);
  color: var(--ink-secondary);
  font-size: var(--text-xs);
}

.theme-detail ul {
  display: grid;
  gap: var(--space-6);
  margin: 0;
  padding-left: var(--space-18);
  color: var(--ink-secondary);
  font-size: var(--text-sm);
  line-height: var(--lh-body);
}

.theme-detail__facts {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--space-8);
}

.theme-detail__facts div {
  min-width: 0;
  display: grid;
  gap: var(--space-4);
  padding: var(--space-10);
  border: var(--border-thin) solid var(--rule);
  border-radius: var(--radius);
  background: var(--paper-surface);
}

.theme-detail__facts span,
.theme-installed span,
.theme-empty {
  color: var(--ink-muted);
  font-size: var(--text-xs);
}

.theme-detail__facts strong {
  color: var(--ink-primary);
  font-size: var(--text-xs);
}

.theme-center__file {
  display: none;
}

.theme-center__message {
  margin: 0;
  color: var(--ink-secondary);
  font-size: var(--text-sm);
}

.theme-center__message--error {
  color: var(--signal-error);
}

.theme-import__list {
  display: grid;
  gap: var(--space-8);
}

.theme-installed {
  justify-content: space-between;
  padding: var(--space-10);
  border: var(--border-thin) solid var(--rule);
  border-radius: var(--radius);
  background: var(--paper-surface);
}

.theme-installed div {
  display: grid;
  gap: var(--space-2);
}

.theme-installed strong {
  color: var(--ink-primary);
}

@media (width <= 900px) {
  .theme-center__body {
    grid-template-columns: 1fr;
  }

  .theme-center__status,
  .theme-section__head {
    align-items: flex-start;
    flex-direction: column;
  }
}

@media (width <= 620px) {
  .theme-center {
    width: calc(100vw - var(--space-16));
    max-height: calc(100vh - var(--space-16));
  }

  .theme-center__header,
  .theme-center__status,
  .theme-center__body {
    padding-inline: var(--space-16);
  }

  .theme-grid {
    grid-template-columns: 1fr;
  }
}
</style>
