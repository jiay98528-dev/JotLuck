<template>
  <Teleport to="body">
    <div v-if="visible" class="dialog-overlay" @click.self="cancel">
      <div class="template-dialog">
        <div class="dialog-header">
          <h2>选择模板</h2>
          <button class="dialog-close" @click="cancel">×</button>
        </div>

        <div class="dialog-body">
          <!-- Built-in templates -->
          <p class="section-label">内置模板</p>
          <div class="template-list">
            <button
              v-for="tpl in builtInTemplates"
              :key="tpl.path"
              class="template-card"
              :class="{ 'template-card--selected': selectedPath === tpl.path }"
              @click="selectTemplate(tpl)"
            >
              <div class="template-info">
                <span class="template-name">{{ tpl.name }}</span>
                <span class="template-desc">{{ tpl.description }}</span>
              </div>
            </button>
          </div>

          <!-- Custom templates (M4-04) -->
          <template v-if="customTemplates.length > 0">
            <p class="section-label">自定义模板</p>
            <div class="template-list">
              <button
                v-for="tpl in customTemplates"
                :key="tpl.path"
                class="template-card"
                :class="{ 'template-card--selected': selectedPath === tpl.path }"
                @click="selectTemplate(tpl)"
              >
                <div class="template-info">
                  <span class="template-name">{{ tpl.name }}</span>
                  <span class="template-desc">{{ tpl.description }}</span>
                </div>
                <button class="template-delete" title="删除模板" @click.stop="deleteTemplate(tpl)">
                  ×
                </button>
              </button>
            </div>
          </template>

          <!-- Save current note as template (M4-04) -->
          <div v-if="currentContent !== undefined" class="save-as-template">
            <p class="section-label">保存当前笔记为模板</p>
            <template v-if="!showSaveForm">
              <button class="btn btn--secondary btn--small" @click="showSaveForm = true">
                + 保存为自定义模板
              </button>
            </template>
            <template v-else>
              <div class="save-form">
                <input
                  v-model="saveName"
                  class="save-form-input"
                  placeholder="模板名称"
                  maxlength="30"
                />
                <input
                  v-model="saveDesc"
                  class="save-form-input"
                  placeholder="模板描述（可选）"
                  maxlength="60"
                />
                <div class="save-form-actions">
                  <button class="btn btn--secondary btn--small" @click="showSaveForm = false">
                    取消
                  </button>
                  <button
                    class="btn btn--primary btn--small"
                    :disabled="!saveName.trim()"
                    @click="doSaveAsTemplate"
                  >
                    保存
                  </button>
                </div>
              </div>
            </template>
          </div>

          <!-- Preview -->
          <div v-if="previewContent" class="template-preview">
            <p class="section-label">预览（占位符已替换）</p>
            <pre class="preview-box"><code>{{ previewContent }}</code></pre>
          </div>
        </div>

        <div class="dialog-footer">
          <button class="btn btn--secondary" @click="createBlank">空白笔记</button>
          <button class="btn btn--secondary" @click="cancel">取消</button>
          <button class="btn btn--primary" :disabled="!selectedPath" @click="confirmTemplate">
            使用模板
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
/**
 * TemplateDialog.vue — 模板选择对话框
 *
 * M4-03: 选择模板 + 预览 + 创建。
 *
 * @see components.md §27
 */
import { ref, watch } from 'vue';
import {
  getBuiltInTemplates,
  getBuiltInTemplateContent,
  getCustomTemplates,
  getCustomTemplateContent,
  saveCustomTemplate,
  deleteCustomTemplate,
  previewTemplate,
} from '@/services/TemplateEngine';
import type { TemplateItem } from '@/types';

const props = defineProps<{
  visible: boolean;
  currentContent?: string;
}>();

const emit = defineEmits<{
  'update:visible': [value: boolean];
  select: [template: TemplateItem, content: string];
  'create-blank': [];
  cancel: [];
}>();

const builtInTemplates = getBuiltInTemplates();
const customTemplates = ref<TemplateItem[]>([]);
const selectedPath = ref('');
const previewContent = ref('');
const showSaveForm = ref(false);
const saveName = ref('');
const saveDesc = ref('');

watch(
  () => props.visible,
  (v) => {
    if (v) {
      selectedPath.value = '';
      previewContent.value = '';
      showSaveForm.value = false;
      saveName.value = '';
      saveDesc.value = '';
      customTemplates.value = getCustomTemplates();
    }
  },
);

function selectTemplate(tpl: TemplateItem): void {
  selectedPath.value = tpl.path;
  const raw = tpl.path.startsWith('_custom_/')
    ? getCustomTemplateContent(tpl.path)
    : getBuiltInTemplateContent(tpl.path);
  previewContent.value = previewTemplate(raw);
}

function confirmTemplate(): void {
  const allTemplates = [...builtInTemplates, ...customTemplates.value];
  const tpl = allTemplates.find((t) => t.path === selectedPath.value);
  if (!tpl) return;
  const raw = tpl.path.startsWith('_custom_/')
    ? getCustomTemplateContent(tpl.path)
    : getBuiltInTemplateContent(tpl.path);
  const rendered = previewTemplate(raw);
  emit('update:visible', false);
  emit('select', tpl, rendered);
}

function deleteTemplate(tpl: TemplateItem): void {
  deleteCustomTemplate(tpl.path);
  if (selectedPath.value === tpl.path) {
    selectedPath.value = '';
    previewContent.value = '';
  }
  customTemplates.value = getCustomTemplates();
}

function doSaveAsTemplate(): void {
  if (!saveName.value.trim() || props.currentContent === undefined) return;
  saveCustomTemplate(saveName.value.trim(), saveDesc.value.trim(), props.currentContent);
  customTemplates.value = getCustomTemplates();
  showSaveForm.value = false;
  saveName.value = '';
  saveDesc.value = '';
}

function createBlank(): void {
  emit('update:visible', false);
  emit('create-blank');
}

function cancel(): void {
  emit('update:visible', false);
  emit('cancel');
}
</script>

<style scoped>
.dialog-overlay {
  position: fixed;
  inset: 0;
  background: var(--overlay, var(--paper-bg, oklch(0.975 0.003 85)));
  z-index: 200;
  display: flex;
  align-items: center;
  justify-content: center;
}

.template-dialog {
  width: 520px;
  max-height: 80vh;
  background: var(--paper-surface, oklch(0.985 0.002 85));
  border-radius: var(--radius, 2px);
  box-shadow: var(--shadow-float, 0 4px 16px oklch(0.15 0.003 85 / 0.08));
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.dialog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--rule, oklch(0.88 0.003 85));
  background: var(--paper-raised, oklch(1 0 0));
}

.dialog-header h2 {
  margin: 0;
  font-size: var(--text-lg, 16px);
  font-weight: 600;
  color: var(--ink-primary, oklch(0.15 0.003 85));
}

.dialog-close {
  width: 28px;
  height: 28px;
  border: none;
  background: none;
  font-size: 20px;
  color: var(--ink-muted, oklch(0.6 0.002 85));
  cursor: pointer;
  border-radius: var(--radius, 2px);
}

.dialog-close:hover {
  background: var(--accent-soft, oklch(0.92 0.03 250 / 0.55));
  color: var(--ink-primary, oklch(0.15 0.003 85));
}

.dialog-body {
  padding: 20px;
  flex: 1;
  overflow-y: auto;
  background: var(--paper-surface, oklch(0.985 0.002 85));
  color: var(--ink-primary, oklch(0.15 0.003 85));
}

.section-label {
  font-size: var(--text-xs, 12px);
  font-weight: 600;
  color: var(--ink-muted, oklch(0.6 0.002 85));
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin: 0 0 8px;
}

.template-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 16px;
}

.template-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border: 2px solid var(--rule, oklch(0.88 0.003 85));
  border-radius: var(--radius, 2px);
  background: var(--paper-surface, oklch(0.985 0.002 85));
  cursor: pointer;
  text-align: left;
  transition: border-color 150ms var(--ease-fade, cubic-bezier(0.4, 0, 0.2, 1));
  color: var(--ink-primary, oklch(0.15 0.003 85));
}

.template-card:hover {
  border-color: var(--rule-strong, oklch(0.8 0.005 85));
}

.template-card--selected {
  border-color: var(--accent, oklch(0.52 0.12 250));
  background: oklch(0.55 0.13 255 / 0.05);
}

.template-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.template-name {
  font-size: var(--text-sm, 14px);
  font-weight: 600;
  color: var(--ink-primary, oklch(0.15 0.003 85));
}

.template-desc {
  font-size: var(--text-xs, 11px);
  color: var(--ink-muted, oklch(0.6 0.002 85));
}

.template-preview {
  margin-top: 16px;
}

.preview-box {
  padding: 12px;
  background: var(--code-block-bg, oklch(0.97 0.002 85));
  border: 1px solid var(--rule, oklch(0.88 0.003 85));
  border-radius: var(--radius, 2px);
  font-size: var(--text-xs, 12px);
  line-height: 1.6;
  max-height: 200px;
  overflow-y: auto;
  white-space: pre-wrap;
  font-family: var(--ff-mono, monospace);
  color: var(--ink-secondary, oklch(0.42 0.003 85));
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 20px;
  border-top: 1px solid var(--rule, oklch(0.88 0.003 85));
  background: var(--paper-surface, oklch(0.985 0.002 85));
}

.btn {
  padding: 8px 20px;
  border-radius: var(--radius, 2px);
  font-size: var(--text-sm, 13px);
  cursor: pointer;
  border: 1px solid var(--rule, oklch(0.88 0.003 85));
}

.btn--secondary {
  background: var(--paper-surface, oklch(0.985 0.002 85));
  color: var(--ink-secondary, oklch(0.42 0.003 85));
}

.btn--secondary:hover {
  background: var(--surface-hover, oklch(0 0 0 / 0.03));
}

.btn--primary {
  background: var(--accent, oklch(0.52 0.12 250));
  color: oklch(0.995 0 0);
  border-color: var(--accent, oklch(0.52 0.12 250));
}

.btn--primary:hover {
  background: var(--accent-hover, oklch(0.47 0.13 250));
}

.btn--primary:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.btn--small {
  padding: 4px 12px;
  font-size: var(--text-xs, 12px);
}

.template-delete {
  width: 24px;
  height: 24px;
  border: none;
  background: none;
  font-size: 16px;
  color: var(--ink-muted, oklch(0.6 0.002 85));
  cursor: pointer;
  border-radius: var(--radius, 2px);
  flex-shrink: 0;
  margin-left: auto;
}

.template-delete:hover {
  background: oklch(0.5 0.15 25 / 0.1);
  color: var(--signal-error, oklch(0.48 0.17 25));
}

.save-as-template {
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid var(--rule, oklch(0.88 0.003 85));
}

.save-form {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 8px;
}

.save-form-input {
  padding: 6px 10px;
  border: 1px solid var(--rule, oklch(0.88 0.003 85));
  border-radius: var(--radius, 2px);
  font-size: var(--text-sm, 13px);
  font-family: inherit;
  background: var(--paper-surface, oklch(0.985 0.002 85));
  color: var(--ink-primary, oklch(0.15 0.003 85));
}

.save-form-input::placeholder {
  color: var(--ink-muted, oklch(0.6 0.002 85));
}

.save-form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
  margin-top: 2px;
}
</style>
