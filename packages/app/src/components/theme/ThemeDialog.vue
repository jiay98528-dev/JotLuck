<template>
  <Teleport to="body">
    <div v-if="visible" class="modal-overlay" @click.self="close">
      <div
        class="modal-card theme-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="theme-dialog-title"
      >
        <div class="modal-header">
          <div>
            <span class="theme-dialog__eyebrow">本地主题中心</span>
            <h2 id="theme-dialog-title">UX Shell 主题</h2>
          </div>
          <button class="theme-dialog__close" aria-label="关闭" @click="close">×</button>
        </div>

        <div class="theme-dialog__current">
          <span>当前启用</span>
          <strong>{{ theme.activeThemeLabel }}</strong>
          <small v-if="theme.previewThemeId">正在预览，启用前不会写入设置</small>
        </div>

        <div class="modal-body theme-dialog__body">
          <section class="theme-dialog__section">
            <div class="theme-dialog__section-head">
              <h3>本地市场</h3>
              <p>来自应用内置 catalog；未来远程市场复用同一 manifest 结构。</p>
            </div>
            <div class="theme-grid">
              <article
                v-for="pack in catalogThemes"
                :key="pack.manifest.id"
                class="theme-card"
                :class="{ 'is-active': pack.manifest.id === theme.activeThemeId }"
              >
                <div class="theme-card__preview" aria-hidden="true">
                  <span class="theme-card__rail" />
                  <span class="theme-card__sheet" />
                  <span class="theme-card__panel" />
                </div>
                <div class="theme-card__copy">
                  <div class="theme-card__title-row">
                    <h4>{{ pack.manifest.name }}</h4>
                    <span class="theme-pill">{{ runtimeLabel(pack.manifest.runtime) }}</span>
                  </div>
                  <p>{{ pack.manifest.description || '声明 Shell 布局、动作路由和 UX 区域。' }}</p>
                  <div class="theme-card__meta">
                    <span>{{ pack.manifest.layoutPreset }}</span>
                    <span>{{ pack.manifest.author }}</span>
                  </div>
                  <div class="theme-card__permissions">
                    <span v-for="permission in pack.manifest.permissions" :key="permission">
                      {{ permission }}
                    </span>
                  </div>
                  <p v-if="pack.manifest.runtime === 'trusted-code'" class="theme-card__risk">
                    此主题包含可信代码入口，启用前需要显式授权。
                  </p>
                </div>
                <div class="theme-card__actions">
                  <button class="theme-action" @click="preview(pack.manifest.id)">预览</button>
                  <button
                    v-if="theme.previewThemeId === pack.manifest.id"
                    class="theme-action"
                    @click="theme.clearPreview()"
                  >
                    取消预览
                  </button>
                  <button class="theme-action theme-action--primary" @click="activate(pack)">
                    {{ pack.manifest.id === theme.activeThemeId ? '已启用' : '启用' }}
                  </button>
                </div>
              </article>
            </div>
          </section>

          <section class="theme-dialog__section">
            <div class="theme-dialog__section-head">
              <h3>已安装</h3>
              <p>本地 `.mltheme` 包会在这里出现；本轮保留导入接口，文件选择器后续接入。</p>
            </div>
            <div v-if="theme.importedThemes.length === 0" class="theme-empty">
              尚未安装外部主题包。声明式主题和可信代码主题会先经过 manifest、权限和入口校验。
            </div>
            <article
              v-for="pack in theme.importedThemes"
              :key="pack.manifest.id"
              class="theme-installed"
            >
              <div>
                <strong>{{ pack.manifest.name }}</strong>
                <span>{{ pack.manifest.id }}</span>
              </div>
              <button class="theme-action" @click="theme.uninstallTheme(pack.manifest.id)">
                卸载
              </button>
            </article>
          </section>

          <section class="theme-dialog__section theme-dialog__section--security">
            <h3>安全边界</h3>
            <p>
              声明式主题只能通过 DSL 控制 Shell UX。可信代码主题只能通过 ThemeHostApi 派发白名单
              action、注册受控组件、写入主题私有 storage；网络和文件系统权限当前默认关闭。
            </p>
          </section>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useThemeStore } from '@/stores/theme';
import type { InstalledThemePack, ThemeRuntime } from '@/types/theme-pack';

defineProps<{
  visible: boolean;
}>();

const emit = defineEmits<{
  'update:visible': [visible: boolean];
}>();

const theme = useThemeStore();

const catalogThemes = computed(() =>
  theme.themes.filter((pack) => pack.source === 'builtin' || pack.source === 'market'),
);

function close(): void {
  theme.clearPreview();
  emit('update:visible', false);
}

function runtimeLabel(runtime: ThemeRuntime): string {
  if (runtime === 'declarative') return '声明式';
  if (runtime === 'official-code') return '官方代码';
  return '可信代码';
}

function preview(themeId: string): void {
  theme.previewThemeById(themeId);
}

function activate(pack: InstalledThemePack): void {
  if (pack.manifest.runtime === 'trusted-code' && !pack.trustedCodeAuthorized) {
    theme.authorizeTrustedCode(pack.manifest.id);
  }
  theme.activateTheme(pack.manifest.id);
}
</script>

<style scoped>
.theme-dialog {
  width: min(920px, calc(100vw - var(--space-32)));
  max-height: min(760px, calc(100vh - var(--space-32)));
  overflow: hidden;
}

.theme-dialog__eyebrow {
  display: block;
  margin-bottom: var(--space-4);
  color: var(--ink-muted);
  font-size: var(--text-xs);
  font-weight: var(--fw-semibold);
  letter-spacing: var(--ls-wide);
  line-height: var(--lh-ui);
}

.theme-dialog__close {
  width: 34px;
  height: 34px;
  border: var(--border-thin) solid transparent;
  border-radius: var(--radius);
  background: transparent;
  color: var(--ink-muted);
  font: inherit;
  font-size: var(--text-xl);
  line-height: var(--lh-none);
  cursor: pointer;
}

.theme-dialog__close:hover {
  border-color: var(--rule);
  background: var(--surface-hover);
  color: var(--ink-primary);
}

.theme-dialog__current {
  display: flex;
  gap: var(--space-10);
  align-items: center;
  padding: var(--space-12) var(--space-20);
  border-top: var(--border-thin) solid var(--rule);
  border-bottom: var(--border-thin) solid var(--rule);
  background: color-mix(in oklch, var(--accent-soft) 36%, var(--paper-raised));
  color: var(--ink-secondary);
  font-size: var(--text-sm);
}

.theme-dialog__current strong {
  color: var(--ink-primary);
}

.theme-dialog__current small {
  margin-left: auto;
  color: var(--accent);
}

.theme-dialog__body {
  display: grid;
  gap: var(--space-18);
  max-height: calc(100vh - 190px);
  padding: var(--space-20);
  overflow: auto;
}

.theme-dialog__section {
  display: grid;
  gap: var(--space-12);
}

.theme-dialog__section-head h3,
.theme-dialog__section h3 {
  margin: 0;
  color: var(--ink-primary);
  font-size: var(--text-lg);
  line-height: var(--lh-heading);
}

.theme-dialog__section-head p,
.theme-dialog__section p {
  margin: var(--space-4) 0 0;
  color: var(--ink-secondary);
  font-size: var(--text-sm);
  line-height: var(--lh-body);
}

.theme-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: var(--space-14);
}

.theme-card,
.theme-installed,
.theme-empty,
.theme-dialog__section--security {
  border: var(--border-thin) solid var(--rule);
  border-radius: var(--radius-md);
  background: var(--paper-raised);
}

.theme-card {
  display: grid;
  grid-template-columns: 104px minmax(0, 1fr);
  gap: var(--space-14);
  padding: var(--space-14);
}

.theme-card.is-active {
  border-color: var(--accent);
  box-shadow: var(--shadow-focus);
}

.theme-card__preview {
  position: relative;
  height: 92px;
  border: var(--border-thin) solid var(--rule);
  border-radius: var(--radius);
  background: var(--paper-bg);
  overflow: hidden;
}

.theme-card__rail,
.theme-card__sheet,
.theme-card__panel {
  position: absolute;
  display: block;
}

.theme-card__rail {
  inset: 0 auto 0 0;
  width: 24px;
  background: var(--paper-left);
  border-right: var(--border-thin) solid var(--rule);
}

.theme-card__sheet {
  left: 34px;
  top: 13px;
  width: 42px;
  height: 64px;
  border-radius: var(--radius-sm);
  background: var(--paper-surface);
  box-shadow: var(--shadow-paper);
}

.theme-card__panel {
  right: 10px;
  top: 16px;
  width: 14px;
  height: 58px;
  border-radius: var(--radius-sm);
  background: color-mix(in oklch, var(--accent) 20%, var(--paper-right));
}

.theme-card__copy {
  min-width: 0;
}

.theme-card__title-row {
  display: flex;
  gap: var(--space-8);
  align-items: center;
  justify-content: space-between;
}

.theme-card h4 {
  margin: 0;
  color: var(--ink-primary);
  font-size: var(--text-base);
  line-height: var(--lh-heading);
}

.theme-pill,
.theme-card__permissions span {
  display: inline-flex;
  align-items: center;
  height: 20px;
  padding: 0 var(--space-7);
  border-radius: var(--radius-full);
  background: var(--accent-soft);
  color: var(--accent);
  font-size: var(--text-xs);
  font-weight: var(--fw-semibold);
  white-space: nowrap;
}

.theme-card__meta,
.theme-card__permissions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-6);
  margin-top: var(--space-8);
  color: var(--ink-muted);
  font-size: var(--text-xs);
}

.theme-card__risk {
  color: var(--warning, var(--accent));
}

.theme-card__actions {
  grid-column: 1 / -1;
  display: flex;
  justify-content: flex-end;
  gap: var(--space-8);
}

.theme-action {
  min-height: 30px;
  border: var(--border-thin) solid var(--rule);
  border-radius: var(--radius);
  padding: 0 var(--space-10);
  background: var(--paper-surface);
  color: var(--ink-secondary);
  font: inherit;
  font-size: var(--text-sm);
  cursor: pointer;
}

.theme-action:hover {
  border-color: var(--accent);
  color: var(--accent);
}

.theme-action--primary {
  border-color: var(--accent);
  background: var(--accent);
  color: var(--paper-bg);
}

.theme-installed,
.theme-empty,
.theme-dialog__section--security {
  padding: var(--space-14);
}

.theme-installed {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-12);
}

.theme-installed div {
  display: grid;
  gap: var(--space-4);
}

.theme-installed span,
.theme-empty {
  color: var(--ink-muted);
  font-size: var(--text-sm);
}

@media (width <= 620px) {
  .theme-card {
    grid-template-columns: 1fr;
  }

  .theme-dialog__current {
    align-items: flex-start;
    flex-direction: column;
  }

  .theme-dialog__current small {
    margin-left: 0;
  }
}
</style>
