<template>
  <Teleport to="body">
    <div v-if="visible" ref="overlayRef" tabindex="-1" class="modal-overlay" @click.self="cancel" @keydown.escape="cancel">
      <div class="modal-card" role="dialog" aria-labelledby="template-dialog-title">
        <!-- Header -->
        <div class="modal-header">
          <h2 id="template-dialog-title">新建笔记</h2>
          <button class="modal-close" aria-label="关闭" @click="cancel">&times;</button>
        </div>

        <!-- Body: Two-column layout -->
        <div class="modal-body">
          <!-- Left: Template list -->
          <div class="tpl-list">
            <!-- Blank note option -->
            <button class="tpl-card blank-card" @click="emitCreateBlank">
              <span class="tpl-card-icon">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.5"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                  <line x1="12" y1="18" x2="12" y2="12" />
                  <line x1="9" y1="15" x2="15" y2="15" />
                </svg>
              </span>
              <span class="tpl-card-title">空白笔记</span>
              <span class="tpl-card-desc">从空白页面开始</span>
            </button>

            <!-- Built-in templates -->
            <button
              v-for="tpl in templates"
              :key="tpl.id"
              class="tpl-card"
              :class="{ active: selectedId === tpl.id }"
              @click="selectTemplate(tpl)"
            >
              <span class="tpl-card-title">{{ tpl.name }}</span>
              <span class="tpl-card-desc">{{ tpl.description }}</span>
            </button>

            <!-- Custom templates -->
            <button
              v-for="tpl in customTemplates"
              :key="tpl.id"
              class="tpl-card custom-tpl"
              :class="{ active: selectedId === tpl.id }"
              @click="selectTemplate(tpl)"
            >
              <span class="tpl-card-title">{{ tpl.name }}</span>
              <span class="tpl-card-desc">{{ tpl.description }}</span>
              <button class="template-delete" title="删除模板" @click.stop="deleteTemplate(tpl.id)">
                &times;
              </button>
            </button>

            <!-- Save as template -->
            <div v-if="currentContent" class="save-as-template">
              <button class="save-toggle" @click="showSaveForm = !showSaveForm">
                + 保存为自定义模板
              </button>
              <div v-if="showSaveForm" class="save-form">
                <input v-model="tplName" class="save-form-input" placeholder="模板名称" />
                <input v-model="tplDesc" class="save-form-input" placeholder="模板描述（可选）" />
                <div class="save-form-actions">
                  <Button variant="secondary" size="sm" @click="showSaveForm = false">
                    取消
                  </Button>
                  <Button variant="default" size="sm" :disabled="!tplName" @click="doSaveTemplate">
                    保存
                  </Button>
                </div>
              </div>
            </div>
          </div>

          <!-- Right: Preview pane -->
          <div class="tpl-preview">
            <template v-if="selectedTpl">
              <div class="preview-header">
                <span class="preview-label">预览</span>
                <span class="preview-name">{{ selectedTpl.name }}</span>
              </div>
              <div class="preview-content">
                <pre class="preview-text">{{ renderedPreview }}</pre>
              </div>
              <Button variant="default" style="width: 100%" @click="emitSelect">使用此模板</Button>
            </template>
            <template v-else>
              <div class="preview-empty">
                <svg
                  class="preview-empty-icon"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.5"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                  <line x1="16" y1="13" x2="8" y2="13" />
                  <line x1="16" y1="17" x2="8" y2="17" />
                </svg>
                <span class="preview-empty-text">选择一个模板以预览</span>
              </div>
            </template>
          </div>
        </div>

        <!-- Footer -->
        <div class="modal-footer">
          <Button variant="secondary" @click="cancel">取消</Button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue';
import {
  getBuiltInTemplates,
  getCustomTemplates,
  saveCustomTemplate,
  deleteCustomTemplate,
  previewTemplate,
} from '@/services/TemplateEngine';
import type { TemplateItem } from '@/types';
import Button from '@/components/common/Button.vue';

// ── Internal: rich template shape as returned by the engine ─
interface RichTemplateItem extends TemplateItem {
  id: string;
  content: string;
  isBuiltin: boolean;
}

// ── Props ──────────────────────────────────────────────
const props = defineProps<{
  visible: boolean;
  currentContent?: string;
}>();

// ── Emits ──────────────────────────────────────────────
const emit = defineEmits<{
  'update:visible': [boolean];
  select: [template: RichTemplateItem, content: string];
  'create-blank': [];
  cancel: [];
}>();

const overlayRef = ref<HTMLDivElement | null>(null);

// ── State ──────────────────────────────────────────────
const templates = getBuiltInTemplates() as RichTemplateItem[];
const customTemplates = ref<RichTemplateItem[]>(getCustomTemplates() as RichTemplateItem[]);
const selectedId = ref<string | null>(null);
const selectedTpl = ref<RichTemplateItem | null>(null);

// Save form state
const showSaveForm = ref(false);
const tplName = ref('');
const tplDesc = ref('');

// ── Computed ───────────────────────────────────────────
const renderedPreview = computed<string>(() => {
  if (!selectedTpl.value) return '';
  const content = selectedTpl.value.content;
  if (!content) return '';
  const rendered = previewTemplate(content);
  // Show first 6 lines for preview
  return rendered.split('\n').slice(0, 6).join('\n');
});

// ── Methods ────────────────────────────────────────────
function cancel(): void {
  emit('cancel');
  emit('update:visible', false);
}

function emitCreateBlank(): void {
  emit('create-blank');
}

function selectTemplate(tpl: RichTemplateItem): void {
  selectedId.value = tpl.id;
  selectedTpl.value = tpl;
}

function emitSelect(): void {
  if (!selectedTpl.value) return;
  const content = previewTemplate(selectedTpl.value.content);
  emit('select', selectedTpl.value, content);
}

function doSaveTemplate(): void {
  const name = tplName.value.trim();
  if (!name) return;
  const desc = tplDesc.value.trim();
  const content = props.currentContent || '';
  const tpl = saveCustomTemplate(name, desc, content) as RichTemplateItem;
  customTemplates.value.push(tpl);
  showSaveForm.value = false;
  tplName.value = '';
  tplDesc.value = '';
}

function deleteTemplate(id: string): void {
  deleteCustomTemplate(id);
  customTemplates.value = customTemplates.value.filter((t) => t.id !== id);
  if (selectedId.value === id) {
    selectedId.value = null;
    selectedTpl.value = null;
  }
}

function resetState(): void {
  selectedId.value = null;
  selectedTpl.value = null;
  showSaveForm.value = false;
  tplName.value = '';
  tplDesc.value = '';
  // Reload custom templates on each open
  customTemplates.value = getCustomTemplates() as RichTemplateItem[];
}

// ── Watch visible to reset on open ─────────────────────
watch(
  () => props.visible,
  (val) => {
    if (val) {
      resetState();
      nextTick().then(() => overlayRef.value?.focus());
    }
  },
);
</script>

<style scoped>
/* ===== Card (width override only — skeleton in dialog.css) ===== */
.modal-card {
  width: 520px;
}

/* ===== Body: Two-column ===== */
.modal-body {
  display: flex;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

/* ===== Left: Template List (200px) ===== */
.tpl-list {
  width: 200px;
  flex-shrink: 0;
  padding: var(--space-12);
  overflow-y: auto;
  border-right: var(--border-thin) solid var(--rule);
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
}

/* ===== Template Card ===== */
.tpl-card {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-10) var(--space-12);
  border: var(--border-thin) solid var(--rule);
  border-radius: var(--radius);
  background: var(--paper-surface);
  cursor: pointer;
  text-align: left;
  transition: all var(--dur-micro) var(--ease-fade);
  user-select: none;
}

.tpl-card:hover {
  border-color: var(--accent);
  background: var(--accent-soft);
}

.tpl-card.active {
  border-color: var(--accent);
  border-width: var(--border-medium);
  background: var(--accent-soft);
}

.tpl-card:active {
  transform: scale(0.98);
}

.tpl-card-icon {
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--ink-muted);
  margin-bottom: var(--space-2);
}

.tpl-card-icon :deep(svg) {
  width: 18px;
  height: 18px;
  display: block;
}

.tpl-card-title {
  font-size: var(--text-base);
  font-weight: var(--fw-semibold);
  color: var(--ink-primary);
  line-height: var(--lh-none);
}

.tpl-card-desc {
  font-size: var(--text-sm);
  color: var(--ink-muted);
  line-height: var(--lh-compact);
}

/* Blank card variant */
.blank-card {
  border-style: dashed;
  border-color: var(--rule-strong);
}

.blank-card:hover {
  border-style: solid;
  border-color: var(--accent);
}

/* ===== Right: Preview Pane ===== */
.tpl-preview {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  padding: var(--space-16);
  overflow: hidden;
}

.preview-header {
  display: flex;
  align-items: center;
  gap: var(--space-8);
  margin-bottom: var(--space-12);
  padding-bottom: var(--space-8);
  border-bottom: var(--border-thin) solid var(--rule);
}

.preview-label {
  font-size: var(--text-xs);
  color: var(--ink-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  font-weight: var(--fw-semibold);
}

.preview-name {
  font-size: var(--text-sm);
  font-weight: var(--fw-medium);
  color: var(--ink-primary);
}

.preview-content {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  margin-bottom: var(--space-12);
}

.preview-text {
  font-family: var(--ff-mono);
  font-size: var(--text-xs);
  color: var(--ink-secondary);
  background: var(--code-bg);
  padding: var(--space-12);
  border-radius: var(--radius);
  white-space: pre-wrap;
  overflow-wrap: break-word;
  line-height: var(--lh-compact);
  margin: 0;
}

/* ===== Empty preview state ===== */
.preview-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-8);
  color: var(--ink-muted);
}

.preview-empty-icon {
  width: 36px;
  height: 36px;
  opacity: 0.5;
}

.preview-empty-text {
  font-size: var(--text-sm);
  color: var(--ink-muted);
}

/* ===== Save-as-Template ===== */
.save-as-template {
  margin-top: var(--space-8);
  padding-top: var(--space-8);
  border-top: var(--border-thin) solid var(--rule);
}

.save-toggle {
  width: 100%;
  padding: var(--space-8) var(--space-12);
  border: var(--border-thin) dashed var(--rule);
  border-radius: var(--radius);
  background: transparent;
  color: var(--ink-muted);
  font-size: var(--text-sm);
  cursor: pointer;
  text-align: left;
  transition: all var(--dur-micro) var(--ease-fade);
}

.save-toggle:hover {
  border-color: var(--accent);
  color: var(--accent);
  background: var(--accent-soft);
}

.save-form {
  margin-top: var(--space-8);
  display: flex;
  flex-direction: column;
  gap: var(--space-8);
}

.save-form-input {
  padding: var(--space-6) var(--space-8);
  border: var(--border-thin) solid var(--rule);
  border-radius: var(--radius);
  background: var(--paper-surface);
  color: var(--ink-primary);
  font-size: var(--text-sm);
  font-family: var(--ff-body);
  outline: none;
  transition: border-color var(--dur-micro) var(--ease-fade);
}

.save-form-input:focus {
  border-color: var(--accent);
}

.save-form-input::placeholder {
  color: var(--ink-muted);
}

.save-form-actions {
  display: flex;
  gap: var(--space-8);
  justify-content: flex-end;
}

/* Custom template delete button */
.custom-tpl {
  position: relative;
}

.template-delete {
  position: absolute;
  top: 50%;
  right: var(--space-8);
  transform: translateY(-50%);
  width: 20px;
  height: 20px;
  border: none;
  border-radius: var(--radius);
  background: transparent;
  color: var(--ink-muted);
  font-size: 16px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all var(--dur-micro) var(--ease-fade);
}

.template-delete:hover {
  color: var(--signal-error);
  background: var(--signal-error-soft);
}
</style>
