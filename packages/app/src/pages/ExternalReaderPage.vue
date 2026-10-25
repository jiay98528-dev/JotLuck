<template>
  <ExternalReaderSlotBoundary theme-id="jotluck.builtin-reader" :slot-props="slotProps">
    <main class="external-reader" data-testid="external-file-session">
      <header
        class="external-reader__topbar"
        :class="{ 'external-reader__topbar--document': isDocumentImport }"
      >
        <div class="external-reader__identity">
          <img
            class="external-reader__logo"
            :src="appLogoUrl"
            alt="JotLuck"
            width="34"
            height="34"
          />
          <div class="external-reader__title-group">
            <p class="external-reader__kicker">{{ readerModeLabel }}</p>
            <h1>{{ fileName }}</h1>
            <p class="external-reader__path" :title="displayPath">
              {{ displayPath }}
            </p>
          </div>
        </div>

        <div v-if="!loading" class="external-reader__actions">
          <span class="external-reader__stats">{{ readStats }}</span>
          <template v-if="isDocumentImport">
            <Button
              class="external-reader__professional-edit"
              size="md"
              :disabled="!canStartDocumentEdit"
              :loading="editorCandidatePending"
              data-testid="document-edit-button"
              @click="openEditChoices"
            >
              {{ professionalEditLabel }}
            </Button>
          </template>
          <template v-else-if="!errorMessage">
            <!-- 动作失败（如授权过期）只降级为行内提示：按钮必须保留，充当重试入口。 -->
            <p
              v-if="actionError"
              class="external-reader__action-error"
              role="alert"
              data-testid="external-reader-action-error"
            >
              {{ actionError }}
            </p>
            <Button variant="secondary" size="sm" :loading="actionPending" @click="promote">
              {{ t('externalReader.addToNotes') }}
            </Button>
            <Button v-if="!isEditing" size="sm" :disabled="actionPending" @click="enableEdit">
              {{ t('externalReader.enableEdit') }}
            </Button>
          </template>
        </div>
      </header>

      <div class="external-reader__workspace">
        <section
          ref="documentScroller"
          class="external-reader__document-scroll"
          aria-live="polite"
          tabindex="0"
          @scroll.passive="updateActiveHeading"
        >
          <p v-if="loading" class="external-reader__state">
            {{ t('externalReader.opening') }}
          </p>
          <div
            v-else-if="errorMessage && !isDocumentImport"
            class="external-reader__state external-reader__state--error"
            role="alert"
          >
            <strong>{{ t('externalReader.openFailed') }}</strong>
            <span>{{ errorMessage }}</span>
          </div>
          <template v-else>
            <section
              v-if="isDocumentImport"
              class="document-import__status"
              :class="`document-import__status--${conversionStatus}`"
              :aria-live="
                conversionStatus === 'error' || conversionStatus === 'stale'
                  ? 'assertive'
                  : 'polite'
              "
            >
              <div v-if="conversionStatus === 'running'" class="document-import__progress-copy">
                <div>
                  <strong>{{ t('documentImport.converting') }}</strong>
                  <span>{{ progressLabel }}</span>
                </div>
                <Button variant="ghost" size="sm" @click="cancelConversion">
                  {{ t('common.cancel') }}
                </Button>
              </div>
              <div
                v-if="conversionStatus === 'running'"
                class="document-import__progress"
                :class="{ 'document-import__progress--indeterminate': !hasDeterminateProgress }"
                role="progressbar"
                :aria-label="t('documentImport.progressAria')"
                :aria-valuemin="hasDeterminateProgress ? 0 : undefined"
                :aria-valuemax="hasDeterminateProgress ? progressTotal : undefined"
                :aria-valuenow="hasDeterminateProgress ? progressCompleted : undefined"
                :aria-valuetext="progressLabel"
              >
                <span
                  :style="hasDeterminateProgress ? { width: `${progressPercent}%` } : undefined"
                />
              </div>

              <div
                v-else-if="conversionStatus === 'stale'"
                class="document-import__message"
                role="alert"
              >
                <div>
                  <strong>{{ t('documentImport.staleTitle') }}</strong>
                  <span>{{ t('documentImport.staleBody') }}</span>
                </div>
                <Button size="sm" @click="startDocumentConversion">
                  {{ t('documentImport.reconvert') }}
                </Button>
              </div>

              <div
                v-else-if="conversionStatus === 'error'"
                class="document-import__message"
                role="alert"
              >
                <div>
                  <strong>{{ t('documentImport.failedTitle') }}</strong>
                  <span>{{ errorMessage }}</span>
                </div>
                <Button size="sm" @click="startDocumentConversion">
                  {{ t('common.retry') }}
                </Button>
              </div>

              <div
                v-else-if="conversionStatus === 'cancelled'"
                class="document-import__message"
                role="status"
              >
                <span>{{ t('documentImport.cancelled') }}</span>
                <Button size="sm" @click="startDocumentConversion">
                  {{ t('common.retry') }}
                </Button>
              </div>

              <div
                v-else-if="conversionStatus === 'complete'"
                class="document-import__complete"
                role="status"
              >
                <span>{{ t('documentImport.complete') }}</span>
                <span>{{ t('documentImport.sourceUntouched') }}</span>
              </div>
            </section>

            <details v-if="isDocumentImport && warnings.length" class="document-import__warnings">
              <summary>{{ t('documentImport.warningCount', { count: warnings.length }) }}</summary>
              <ul>
                <li
                  v-for="(warning, index) in warnings"
                  :key="`${index}:${warning.code}:${warning.context ?? ''}`"
                >
                  {{ localizedWarning(warning) }}
                </li>
              </ul>
            </details>

            <p v-if="readerNotice" class="external-reader__notice" role="status">
              {{ readerNotice }}
            </p>
            <p
              v-if="isDocumentImport && documentActionError"
              class="external-reader__notice external-reader__notice--error"
              role="alert"
            >
              {{ documentActionError }}
            </p>
            <p
              v-if="isDocumentImport && !content && conversionStatus === 'running'"
              class="external-reader__state"
            >
              {{ t('documentImport.waitingForContent') }}
            </p>
            <pre v-else-if="isPlainText" class="external-reader__plain">{{ content }}</pre>
            <!-- eslint-disable vue/no-v-html -->
            <article
              v-else-if="content"
              ref="markdownElement"
              class="markdown-body external-reader__markdown"
              @click="onMarkdownClick"
              @load.capture="remoteImages.handleLoad"
              @error.capture="remoteImages.handleError"
              v-html="html"
            />
            <!-- eslint-enable vue/no-v-html -->
          </template>
        </section>

        <div v-if="showSidePanel" class="external-reader__divider" />
        <RightWing
          v-if="showSidePanel"
          :headings="headings"
          :backlinks="backlinks"
          :tags="tags"
          :active-heading-id="activeHeadingId"
          :region="readerRegion"
          :backlinks-empty-text="t('externalReader.backlinksAfterAdd')"
          @navigate-heading="scrollHeading"
          @navigate-backlink="onBacklinkNavigate"
          @select-tag="onTagSelect"
        />
      </div>

      <footer class="external-reader__statusbar">
        <span>{{ footerModeLabel }}</span>
        <span v-if="!loading">{{ readStats }}</span>
      </footer>

      <Teleport to="body">
        <div
          v-if="editDialogOpen"
          ref="editDialogRef"
          class="document-edit-dialog__overlay"
          @click.self="closeEditDialog"
          @keydown.escape.prevent.stop="closeEditDialog"
        >
          <section
            class="document-edit-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="document-edit-dialog-title"
          >
            <template v-if="editDialogStep === 'choices'">
              <header>
                <div>
                  <p>{{ t('documentImport.readonlyPreview') }}</p>
                  <h2 id="document-edit-dialog-title">{{ t('documentImport.editDialogTitle') }}</h2>
                </div>
                <button
                  class="document-edit-dialog__close"
                  :aria-label="t('common.close')"
                  @click="closeEditDialog"
                >
                  &times;
                </button>
              </header>
              <p class="document-edit-dialog__intro">{{ t('documentImport.editDialogBody') }}</p>
              <div class="document-edit-dialog__choices">
                <button
                  class="document-edit-dialog__choice"
                  :disabled="actionPending"
                  @click="editOriginalInProfessionalApp"
                >
                  <strong>{{ sourceEditorChoiceLabel }}</strong>
                  <span class="document-edit-dialog__choice-description">
                    {{ t('documentImport.editSourceDescription') }}
                  </span>
                </button>
                <button
                  class="document-edit-dialog__choice"
                  :disabled="actionPending"
                  @click="editDialogStep = 'confirm-save'"
                >
                  <strong>{{ t('documentImport.editMarkdownCopy') }}</strong>
                  <span class="document-edit-dialog__choice-description">
                    {{ t('documentImport.editMarkdownDescription') }}
                  </span>
                </button>
              </div>
            </template>
            <template v-else>
              <header>
                <div>
                  <p>{{ t('documentImport.saveAsMarkdown') }}</p>
                  <h2 id="document-edit-dialog-title">
                    {{ t('documentImport.confirmSourceUntouchedTitle') }}
                  </h2>
                </div>
                <button
                  class="document-edit-dialog__close"
                  :aria-label="t('common.close')"
                  @click="closeEditDialog"
                >
                  &times;
                </button>
              </header>
              <p class="document-edit-dialog__intro">
                {{ t('documentImport.confirmSourceUntouchedBody', { file: fileName }) }}
              </p>
              <div class="document-edit-dialog__footer">
                <Button variant="secondary" @click="editDialogStep = 'choices'">
                  {{ t('common.back') }}
                </Button>
                <Button :loading="actionPending" @click="saveMarkdownCopy">
                  {{ t('documentImport.confirmAndSave') }}
                </Button>
              </div>
            </template>
          </section>
        </div>
      </Teleport>
      <!-- Toast：已收敛至 App.vue 全局单挂载（原 3f78a0b 为阅读窗口补挂载，全局挂载后撤销） -->
    </main>
  </ExternalReaderSlotBoundary>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { Channel } from '@tauri-apps/api/core';
import { useRouter } from 'vue-router';
import Button from '@/components/common/Button.vue';
import RightWing from '@/components/layout/RightWing.vue';
import ExternalReaderSlotBoundary from '@/components/theme/ExternalReaderSlotBoundary.vue';
import { useHeadings } from '@/composables/useHeadings';
import appLogoUrl from '../../src-tauri/icons/128x128.png';
import type {
  BacklinkEntry,
  DocumentConversionEvent,
  DocumentEditorCandidate,
  DocumentImportBootstrapPayload,
  DocumentProgressUnit,
  ExternalOpenedFile,
  SaveConvertedDocumentDialogRequest,
  TagEntry,
} from '@/types';
import type { RightWingRegion } from '@/types/theme-pack';
import { openExternalUrl } from '@/utils/urlUtils';
import { findHeadingElement as findHeadingAnchor } from '@/utils/heading-anchor';
import { useI18n } from 'vue-i18n';
import { normalizeCommandError } from '@/services/command-errors';
import {
  cancelDocumentConversion,
  enableExternalEdit,
  getWindowBootstrap,
  promoteExternalFileToNotebook,
  readDocumentConversionAssetBytes,
  readExternalNoteFile,
  refreshDocumentSourceRevision,
  saveConvertedDocumentAs,
  // 本地同名编排函数（页面转换流程）遮蔽风险：服务命令以 Ipc 后缀别名导入。
  startDocumentConversion as startDocumentConversionIpc,
} from '@/services/windowSession';
import {
  getDocumentEditorCandidate,
  openDocumentSourceInEditor,
} from '@/services/windowsIntegrationService';
import { useDialogFocus } from '@/composables/useDialogFocus';
import { useConversionAssets } from '@/composables/useConversionAssets';
import { useRemoteImageSession } from '@/composables/useRemoteImageSession';

const router = useRouter();
const { t, te } = useI18n();
const openedFile = ref<ExternalOpenedFile | null>(null);
const importedDocument = ref<DocumentImportBootstrapPayload['source'] | null>(null);
const content = ref('');
const html = ref('');
const loading = ref(true);
const errorMessage = ref('');
// 顶栏动作（加入笔记/启用编辑）失败与载入失败分流：动作失败保留按钮重试，
// 载入失败才隐藏操作区。
const actionError = ref('');
const documentActionError = ref('');
type ReaderNoticeKey =
  | 'externalReader.wikiNavigation'
  | 'externalReader.tagFilter'
  | 'externalReader.relativeNavigation'
  | 'externalReader.backlinkNavigation'
  | 'navigation.headingNotFound';
interface ReaderNoticeSpec {
  key: ReaderNoticeKey;
  args?: Record<string, string>;
}
const readerNoticeSpec = ref<ReaderNoticeSpec | null>(null);
const readerNotice = computed(() => {
  const spec = readerNoticeSpec.value;
  if (!spec) return '';
  // 标题未找到是站内事实反馈，不套「需要笔记本上下文」能力包装文案
  if (spec.key === 'navigation.headingNotFound') return t(spec.key);
  // i18n-dynamic-key: ReaderNoticeKey is a closed union of catalog keys.
  return t('externalReader.capability', { subject: t(spec.key, spec.args ?? {}) });
});

function userErrorMessage(error: unknown): string {
  return normalizeCommandError(error).message;
}
const actionPending = ref(false);
const isEditing = ref(false);
type ConversionStatus = 'idle' | 'running' | 'complete' | 'stale' | 'cancelled' | 'error';
const conversionStatus = ref<ConversionStatus>('idle');
const conversionId = ref('');
const conversionGeneration = ref(0);
const expectedChunkSequence = ref(1);
const progressPhase = ref('queued');
const progressCompleted = ref<number | undefined>();
const progressTotal = ref<number | undefined>();
const progressUnit = ref<DocumentProgressUnit | undefined>();
const warnings = ref<Array<Extract<DocumentConversionEvent, { type: 'warning' }>>>([]);
const editorCandidate = ref<DocumentEditorCandidate | null>(null);
const editorCandidatePending = ref(false);
const editDialogOpen = ref(false);
const editDialogStep = ref<'choices' | 'confirm-save'>('choices');
const editDialogRef = ref<HTMLElement | null>(null);
let renderRevision = 0;

/**
 * 资产图链路（零拷贝）：Rust 二进制回流（tauri::ipc::Response → ArrayBuffer，
 * 1x）→ Blob 包装 → URL.createObjectURL 短引用 → 渲染时只拼短串；重转/卸载
 * 时 reset() 统一 revokeObjectURL。落盘 markdown 仍是 jotluck-asset:// 占位符。
 * 渲染清洗器默认剥除 blob:，本页经 allowBlobImageSources 显式放行 img src
 * （sanitize 钩子做字符类校验；javascript: 等协议同通道无论开关均仍拒）。
 */
const conversionAssets = useConversionAssets({
  readAsset: (conversionId, assetId) => readDocumentConversionAssetBytes(conversionId, assetId),
  getGeneration: () => conversionGeneration.value,
  onAssetFailed: (_assetId, fileName, error) => {
    warnings.value.push({
      type: 'warning',
      code: 'asset-read-failed',
      message: userErrorMessage(error),
      context: fileName,
    });
  },
});

/** 转换产物引用的完整图片语法（worker 生成形态：内联图 + 可选标题段）。 */
const ASSET_IMAGE_PATTERN = /!\[([^\]]*)\]\(jotluck-asset:\/\/([^\s)]+)(\s+"[^"]*")?\)/g;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 未就绪资产的中性 loading 占位；失败资产换成本地化「资源读取失败」占位。 */
function assetPlaceholderHtml(alt: string, failed: boolean): string {
  const stateLabel = failed ? t('documentImport.assetFailed') : t('documentImport.assetLoading');
  const stateClass = failed ? 'failed' : 'loading';
  const title = escapeHtml(alt);
  const label = escapeHtml(stateLabel);
  return `<span class="document-import__asset-placeholder document-import__asset-placeholder--${stateClass}" role="img" aria-label="${label}">${title ? `${title} · ` : ''}${label}</span>`;
}

let rendererModule: typeof import('@jotluck/renderer') | null = null;
const markdownElement = ref<HTMLElement | null>(null);
const documentScroller = ref<HTMLElement | null>(null);
const activeHeadingId = ref<string | null>(null);
const backlinks = ref<BacklinkEntry[]>([]);
const { headings, update: updateHeadings } = useHeadings();
const remoteImages = useRemoteImageSession();
const remoteImagePolicy = computed(() => {
  void remoteImages.revision.value;
  return remoteImages.createPolicy({
    blocked: t('notebook.remoteImages.blocked'),
    source: t('notebook.remoteImages.source'),
    loadAll: t('notebook.remoteImages.loadAll'),
    loading: t('notebook.remoteImages.loading'),
    failed: t('notebook.remoteImages.failed'),
    retry: t('notebook.remoteImages.retry'),
    insecure: t('notebook.remoteImages.insecure'),
    unnamed: t('notebook.remoteImages.unnamed'),
  });
});

useDialogFocus({
  visible: () => editDialogOpen.value,
  containerRef: editDialogRef,
  initialFocus: '.document-edit-dialog__choices button',
});

const readerRegion: RightWingRegion = {
  mode: 'balanced',
  policy: 'outline',
  sections: ['outline', 'backlinks', 'tags'],
  defaultOpenSections: ['outline', 'backlinks'],
};

const isDocumentImport = computed(() => importedDocument.value !== null);
const fileName = computed(() =>
  isDocumentImport.value
    ? importedDocument.value?.fileName || t('externalReader.unnamedFile')
    : openedFile.value?.absolutePath.split(/[\\/]/).pop() || t('externalReader.unnamedFile'),
);
const isPlainText = computed(() => !isDocumentImport.value && /\.txt$/i.test(fileName.value));
const displayPath = computed(() =>
  isDocumentImport.value
    ? t('documentImport.semanticPreview', { format: importedDocument.value?.kind.toUpperCase() })
    : (openedFile.value?.absolutePath ?? ''),
);
const readerModeLabel = computed(() => {
  if (isDocumentImport.value) {
    return `${t('documentImport.importedDocument')} · ${t('documentImport.readonlyPreview')}`;
  }
  return `${t('externalReader.externalFile')} · ${
    isEditing.value ? t('externalReader.singleFileEdit') : t('externalReader.readonlyPreview')
  }`;
});
const footerModeLabel = computed(() => {
  if (isDocumentImport.value) return t('documentImport.markdownSemanticPreview');
  return isPlainText.value ? t('externalReader.plainText') : t('externalReader.safeMarkdown');
});
const readStats = computed(() => {
  const lineCount = content.value === '' ? 0 : content.value.split('\n').length;
  return t('externalReader.stats', { lines: lineCount, chars: content.value.length });
});
const showSidePanel = computed(
  () =>
    !loading.value && (!errorMessage.value || isDocumentImport.value) && content.value.length > 0,
);
const hasDeterminateProgress = computed(
  () =>
    typeof progressCompleted.value === 'number' &&
    typeof progressTotal.value === 'number' &&
    progressTotal.value > 0,
);
const progressPercent = computed(() =>
  hasDeterminateProgress.value
    ? Math.min(
        100,
        Math.max(0, ((progressCompleted.value ?? 0) / (progressTotal.value ?? 1)) * 100),
      )
    : 0,
);
const progressLabel = computed(() => {
  const phaseKey = `documentImport.phases.${progressPhase.value}`;
  // i18n-dynamic-key: phaseKey is constrained to the worker protocol phase catalog.
  const phase = te(phaseKey) ? t(phaseKey) : t('documentImport.phases.converting');
  if (!hasDeterminateProgress.value) return phase;
  const unitKey = `documentImport.units.${progressUnit.value ?? 'items'}`;
  // i18n-dynamic-key: unitKey is constrained by DocumentProgressUnit plus the items fallback.
  const unit = te(unitKey) ? t(unitKey) : t('documentImport.units.items');
  return t('documentImport.progressValue', {
    phase,
    completed: progressCompleted.value,
    total: progressTotal.value,
    unit,
  });
});
const canStartDocumentEdit = computed(
  () =>
    conversionStatus.value === 'complete' && Boolean(editorCandidate.value) && !actionPending.value,
);
const professionalEditLabel = computed(() => {
  const candidate = editorCandidate.value;
  if (!candidate) return t('documentImport.preparingEditor');
  return candidate.available
    ? t('documentImport.editInApp', { app: candidate.displayName })
    : t('documentImport.editInProfessionalApp');
});
const sourceEditorChoiceLabel = computed(() => {
  const candidate = editorCandidate.value;
  return candidate?.available
    ? t('documentImport.editSourceWith', { app: candidate.displayName })
    : t('documentImport.chooseAppForSource');
});
const tags = computed<TagEntry[]>(() => {
  if (isPlainText.value) return [];
  const counts = new Map<string, number>();
  for (const line of content.value.split('\n')) {
    if (/^\s{0,3}#{1,6}\s/u.test(line)) continue;
    for (const match of line.matchAll(/(?:^|[\s(])#([^\s#)]+)/gu)) {
      const name = match[1]?.replace(/[.,!?;:，。！？；：]+$/u, '');
      if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
    }
  }
  return [...counts].map(([name, count]) => ({ name, count }));
});
const slotProps = computed(() => ({
  fileName: fileName.value,
  filePath: openedFile.value?.absolutePath ?? '',
  stats: readStats.value,
  headings: headings.value,
  loading: loading.value,
  error: errorMessage.value,
  enableEdit,
  openParentAsNotebook: promote,
  scrollHeading,
}));

async function load(): Promise<void> {
  loading.value = true;
  errorMessage.value = '';
  actionError.value = '';
  documentActionError.value = '';
  try {
    const bootstrap = await getWindowBootstrap();
    if (bootstrap.mode === 'workspace') {
      await router.replace('/workspace');
      return;
    }
    if (bootstrap.mode === 'document-import-readonly') {
      importedDocument.value = bootstrap.source;
      remoteImages.setScope(
        'document-import',
        `${bootstrap.source.fileName}:${bootstrap.source.revision.sha256}`,
      );
      document.title = `${fileName.value} · JotLuck`;
      loading.value = false;
      await startDocumentConversion();
      performance.mark('jotluck:reader-ready');
      return;
    }
    openedFile.value = bootstrap.openedFile;
    remoteImages.setScope('external-file', bootstrap.openedFile.absolutePath);
    isEditing.value = bootstrap.mode === 'external-edit';
    content.value = await readExternalNoteFile(
      bootstrap.openedFile.accessToken,
      bootstrap.openedFile.relativePath,
    );
    document.title = `${fileName.value} · JotLuck`;
    if (!isPlainText.value) {
      updateHeadings(content.value);
      await renderCurrentMarkdown();
    }
    performance.mark('jotluck:reader-ready');
  } catch (error) {
    errorMessage.value = userErrorMessage(error);
  } finally {
    loading.value = false;
  }
}

async function startDocumentConversion(): Promise<void> {
  if (!isDocumentImport.value) return;
  conversionGeneration.value += 1;
  const generation = conversionGeneration.value;
  // 换代起点：撤销上一代全部 object URL 并清空 pending/failed 状态（幂等）。
  conversionAssets.reset();
  conversionId.value = '';
  expectedChunkSequence.value = 1;
  content.value = '';
  html.value = '';
  warnings.value = [];
  errorMessage.value = '';
  documentActionError.value = '';
  progressPhase.value = 'queued';
  progressCompleted.value = undefined;
  progressTotal.value = undefined;
  progressUnit.value = undefined;
  editorCandidate.value = null;
  conversionStatus.value = 'running';
  const channel = new Channel<DocumentConversionEvent>();
  channel.onmessage = (event) => {
    if (generation !== conversionGeneration.value) return;
    void handleConversionEvent(event);
  };
  try {
    const startedConversionId = await startDocumentConversionIpc(channel);
    if (generation !== conversionGeneration.value) {
      try {
        await cancelDocumentConversion(startedConversionId);
      } catch {
        // A generation change already detached this UI from the worker.
      }
      return;
    }
    conversionId.value = startedConversionId;
    conversionAssets.flushPendingAssets(startedConversionId);
  } catch (error) {
    if (generation !== conversionGeneration.value) return;
    conversionStatus.value = 'error';
    errorMessage.value = userErrorMessage(error);
  }
}

async function handleConversionEvent(event: DocumentConversionEvent): Promise<void> {
  switch (event.type) {
    case 'phase':
      progressPhase.value = event.phase;
      progressCompleted.value = event.completed;
      progressTotal.value = event.total;
      progressUnit.value = event.unit;
      break;
    case 'chunk':
      if (event.sequence !== expectedChunkSequence.value) {
        conversionStatus.value = 'error';
        errorMessage.value = t('documentImport.outOfOrder');
        if (conversionId.value) {
          try {
            await cancelDocumentConversion(conversionId.value);
          } catch {
            // Preserve the protocol error; the window cleanup path still terminates the worker.
          }
        }
        return;
      }
      expectedChunkSequence.value += 1;
      content.value += event.markdown;
      await renderCurrentMarkdown();
      break;
    case 'asset':
      // conversionId 未就位（IPC 未返回）时先入队，就位后由 startDocumentConversion
      // 统一 flush；读取完成的重渲染由 conversionAssets.revision 驱动。
      if (!conversionId.value) conversionAssets.enqueueAsset(event);
      else void conversionAssets.loadAsset(event, conversionId.value);
      break;
    case 'warning':
      warnings.value.push(event);
      break;
    case 'complete':
      conversionId.value = event.conversionId;
      conversionStatus.value = 'complete';
      await renderCurrentMarkdown();
      await detectEditorCandidate();
      break;
    case 'stale':
      conversionStatus.value = 'stale';
      editorCandidate.value = null;
      editDialogOpen.value = false;
      break;
    case 'cancelled':
      conversionStatus.value = 'cancelled';
      break;
    case 'error':
      conversionStatus.value = 'error';
      errorMessage.value = localizedConversionError(event.code, event.message);
      break;
  }
}

async function renderCurrentMarkdown(): Promise<void> {
  if (isPlainText.value || !content.value) return;
  const revision = ++renderRevision;
  rendererModule ??= await import('@jotluck/renderer');
  // 资产占位符单趟换装：就绪 → object URL 短引用（保留可选标题段）；未就绪/
  // 已失败 → 中性占位，避免未知 scheme 落进远程图片策略被渲染成「远程图片已阻止」。
  const previewMarkdown = content.value.replace(
    ASSET_IMAGE_PATTERN,
    (_match, alt: string, assetId: string, title?: string) => {
      const url = conversionAssets.resolve(assetId);
      if (url !== null) return `![${alt}](${url}${title ?? ''})`;
      return assetPlaceholderHtml(alt, conversionAssets.hasFailed(assetId));
    },
  );
  const rendered = rendererModule.renderMarkdown(previewMarkdown, {
    remoteImages: remoteImagePolicy.value,
    allowBlobImageSources: true,
    // 外部文件游离于任何笔记本索引之外，存在性无从判定：不传 resolver 时
    // 渲染扩展会把全部 wiki 链染成 wikilink--dead 死链。与 NotebookHome 外部
    // 会话「一律活链样式、点击侧 wikiNavigation 提示兜底」口径对齐。
    wikiLinkExists: () => true,
  });
  if (revision !== renderRevision) return;
  html.value = rendered;
  updateHeadings(content.value);
  await nextTick();
  if (revision === renderRevision && markdownElement.value) {
    rendererModule.highlightCodeBlocks(markdownElement.value);
  }
}

async function cancelConversion(): Promise<void> {
  if (conversionStatus.value !== 'running') return;
  const activeConversionId = conversionId.value;
  conversionGeneration.value += 1;
  conversionStatus.value = 'cancelled';
  // 取消不 reset：已 mint 的 object URL 保留展示已转换部分；未 flush 的队列
  // 事件随世代守卫失效（重转时 startDocumentConversion 开头的 reset 会清空）。
  if (!activeConversionId) return;
  try {
    await cancelDocumentConversion(activeConversionId);
  } catch {
    // The detached worker is also terminated by the window cleanup path.
  }
}

async function detectEditorCandidate(): Promise<void> {
  editorCandidatePending.value = true;
  try {
    editorCandidate.value = await getDocumentEditorCandidate();
  } catch {
    editorCandidate.value = {
      displayName: t('documentImport.professionalApp'),
      available: false,
      fallbackToOpenWith: true,
    };
  } finally {
    editorCandidatePending.value = false;
  }
}

function localizedWarning(warning: Extract<DocumentConversionEvent, { type: 'warning' }>): string {
  const key = `documentImport.warnings.${warning.code}`;
  // i18n-dynamic-key: worker warning codes use catalog entries and fall back to worker text.
  return te(key) ? t(key, { context: warning.context ?? '' }) : warning.message;
}

function localizedConversionError(code: string, fallback: string): string {
  const key = `documentImport.errors.${code}`;
  // i18n-dynamic-key: worker error codes use catalog entries and fall back to worker text.
  return te(key) ? t(key) : fallback;
}

function openEditChoices(): void {
  if (!canStartDocumentEdit.value) return;
  documentActionError.value = '';
  editDialogStep.value = 'choices';
  editDialogOpen.value = true;
}

function closeEditDialog(): void {
  if (actionPending.value) return;
  editDialogOpen.value = false;
}

async function editOriginalInProfessionalApp(): Promise<void> {
  actionPending.value = true;
  documentActionError.value = '';
  try {
    await openDocumentSourceInEditor(editorCandidate.value?.handlerId);
    editDialogOpen.value = false;
  } catch (error) {
    documentActionError.value = userErrorMessage(error);
    editDialogOpen.value = false;
  } finally {
    actionPending.value = false;
  }
}

async function saveMarkdownCopy(): Promise<void> {
  if (!conversionId.value) return;
  actionPending.value = true;
  documentActionError.value = '';
  try {
    const request: SaveConvertedDocumentDialogRequest = {
      defaultFileName: `${fileName.value.replace(/\.[^.]+$/u, '')}.md`,
      dialogTitle: t('documentImport.saveDialogTitle'),
      filterName: t('documentImport.markdownFile'),
      originalPreservationConfirmed: true,
    };
    const saved = await saveConvertedDocumentAs(conversionId.value, request);
    if (!saved) return;
    editDialogOpen.value = false;
    await router.replace('/workspace');
  } catch (error) {
    const message = userErrorMessage(error);
    if (message.toLowerCase().includes('stale')) {
      conversionStatus.value = 'stale';
      editorCandidate.value = null;
      editDialogOpen.value = false;
    } else {
      documentActionError.value = message;
      editDialogOpen.value = false;
    }
  } finally {
    actionPending.value = false;
  }
}

async function refreshSourceOnFocus(): Promise<void> {
  if (!isDocumentImport.value || !conversionId.value || conversionStatus.value !== 'complete') {
    return;
  }
  try {
    const current = await refreshDocumentSourceRevision(conversionId.value);
    if (!current) {
      conversionStatus.value = 'stale';
      editorCandidate.value = null;
    }
  } catch {
    // The file watcher remains the primary signal; focus revalidation is best effort.
  }
}

function scrollHeading(id: string): void {
  // 三形态归一查找（原文/heading-原文/headingIdFromText 形态），root 为阅读区
  const target = markdownElement.value ? findHeadingAnchor(markdownElement.value, id) : undefined;
  if (!target) {
    // miss 不再纯静默：站内轻反馈（onMarkdownClick 已先行 preventDefault）
    showNotebookCapabilityNotice('navigation.headingNotFound');
    return;
  }
  activeHeadingId.value = id;
  target.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function updateActiveHeading(): void {
  const scroller = documentScroller.value;
  const article = markdownElement.value;
  if (!scroller || !article) return;
  const threshold = scroller.getBoundingClientRect().top + 96;
  let active: string | null = null;
  for (const heading of article.querySelectorAll<HTMLElement>(
    'h1[id],h2[id],h3[id],h4[id],h5[id],h6[id]',
  )) {
    if (heading.getBoundingClientRect().top <= threshold) active = heading.id;
    else break;
  }
  activeHeadingId.value = active;
}

function showNotebookCapabilityNotice(key: ReaderNoticeKey, args?: Record<string, string>): void {
  readerNoticeSpec.value = { key, args };
}

function onMarkdownClick(event: MouseEvent): void {
  if (remoteImages.handleClick(event)) {
    return;
  }
  const target = event.target;
  if (!(target instanceof Element)) return;
  const anchor = target.closest('a');
  if (!anchor || !markdownElement.value?.contains(anchor)) return;

  if (anchor.hasAttribute('data-note')) {
    event.preventDefault();
    const note = anchor.getAttribute('data-note');
    if (note) {
      showNotebookCapabilityNotice('externalReader.wikiNavigation', { note });
      return;
    }
    // 空 note = 同页锚点（[[#锚]]）：与 #fragment 同路径滚动定位，不出文档，
    // 不算跨库导航，不走 wikiNavigation 能力提示。
    const samePageAnchor = anchor.getAttribute('data-anchor');
    if (samePageAnchor) scrollHeading(samePageAnchor);
    return;
  }
  const tag = anchor.getAttribute('data-tag');
  if (tag) {
    event.preventDefault();
    showNotebookCapabilityNotice('externalReader.tagFilter', { tag });
    return;
  }

  const href = anchor.getAttribute('href');
  if (!href) return;
  event.preventDefault();
  if (href.startsWith('#')) {
    // 直传原始 id：headingAnchorCandidates 内置安全单次解码（decode 失败回退
    // 原文）——外层再 decodeURIComponent 属多余且对 #100% 类畸形锚点会裸抛
    // URIError（此处是全库唯一无防护的调用点）；改直传后畸形锚点降级为
    // headingNotFound 轻提示（scrollHeading 既有 miss 路径），良构锚点逐字节等价。
    scrollHeading(href.slice(1));
    return;
  }
  if (/^(?:https?:\/\/|mailto:|tel:|ftp:|www\.)/i.test(href)) {
    void openExternalUrl(href);
    return;
  }
  showNotebookCapabilityNotice('externalReader.relativeNavigation', { href });
}

function onTagSelect(tagName: string): void {
  showNotebookCapabilityNotice('externalReader.tagFilter', { tag: tagName });
}

function onBacklinkNavigate(): void {
  showNotebookCapabilityNotice('externalReader.backlinkNavigation');
}

async function enableEdit(): Promise<void> {
  actionPending.value = true;
  actionError.value = '';
  try {
    // 成功即失效冷启动缓存（收口层内完成），避免工作台初始化读到只读旧态。
    await enableExternalEdit();
    await router.replace('/workspace');
  } catch (error) {
    // 动作失败不得写 errorMessage：那会让顶栏操作整块消失、失去重试入口。
    actionError.value = userErrorMessage(error);
  } finally {
    actionPending.value = false;
  }
}

async function promote(): Promise<void> {
  actionPending.value = true;
  actionError.value = '';
  try {
    // 成功即失效冷启动缓存（收口层内完成），避免工作台初始化读到只读旧态。
    await promoteExternalFileToNotebook();
    await router.replace('/workspace');
  } catch (error) {
    actionError.value = userErrorMessage(error);
  } finally {
    actionPending.value = false;
  }
}

onMounted(() => {
  window.addEventListener('focus', refreshSourceOnFocus);
  void load();
});

watch([remoteImages.revision, conversionAssets.revision], () => {
  if (!isPlainText.value && content.value) void renderCurrentMarkdown();
});

onBeforeUnmount(() => {
  conversionGeneration.value += 1;
  window.removeEventListener('focus', refreshSourceOnFocus);
  // 卸载路径统一撤销 object URL（幂等）；在飞读取的晚到结果由世代守卫丢弃。
  conversionAssets.reset();
  if (conversionStatus.value === 'running' && conversionId.value) {
    void cancelDocumentConversion(conversionId.value);
  }
});
</script>

<style scoped>
.external-reader {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  width: 100%;
  height: 100vh;
  height: 100dvh;
  overflow: hidden;
  background: var(--paper-bg);
  color: var(--ink-primary);
}

.external-reader__topbar {
  position: relative;
  z-index: 2;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-16);
  min-height: var(--topbar-height);
  padding: var(--space-8) var(--space-16);
  border-bottom: var(--border-thin) solid var(--rule);
  background: var(--paper-raised);
}

.external-reader__identity {
  display: flex;
  align-items: center;
  gap: var(--space-12);
  min-width: 0;
}

.external-reader__logo {
  flex: 0 0 34px;
  width: 34px;
  height: 34px;
  border-radius: var(--radius);
  object-fit: cover;
}

.external-reader__title-group {
  min-width: 0;
}

.external-reader__kicker,
.external-reader__path,
.external-reader__stats {
  margin: 0;
  color: var(--ink-muted);
  font-size: var(--text-xs);
  line-height: var(--lh-ui);
}

.external-reader h1 {
  margin: 1px 0;
  overflow: hidden;
  color: var(--ink-primary);
  font-family: var(--ff-heading);
  font-size: var(--text-base);
  font-weight: var(--fw-semibold);
  line-height: var(--lh-heading);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.external-reader__path {
  max-width: min(52vw, 680px);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.external-reader__actions {
  display: flex;
  align-items: center;
  gap: var(--space-8);
  flex-shrink: 0;
}

.external-reader__stats {
  margin-right: var(--space-4);
}

.external-reader__action-error {
  margin: 0;
  max-width: min(40vw, 420px);
  color: var(--signal-error);
  font-size: var(--text-xs);
  line-height: var(--lh-ui);
}

.external-reader__professional-edit {
  min-height: var(--touch-target-min);
  box-shadow: var(--shadow-sheet);
}

.external-reader__workspace {
  display: flex;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.external-reader__document-scroll {
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: hidden auto;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
  background: color-mix(in oklch, var(--paper-bg) 72%, var(--paper-surface));
}

.external-reader__document-scroll:focus-visible {
  outline: var(--focus-ring-width) solid var(--accent);
  outline-offset: calc(-1 * var(--focus-ring-offset));
}

.external-reader__divider {
  flex: 0 0 var(--border-thin);
  background: var(--rule-wing);
}

.external-reader__state,
.external-reader__notice,
.external-reader__plain,
.external-reader__markdown,
.document-import__status,
.document-import__warnings {
  width: min(var(--editor-max-width), calc(100% - var(--space-48)));
  margin-inline: auto;
}

.external-reader__state {
  display: grid;
  gap: var(--space-8);
  padding-top: var(--space-48);
  color: var(--ink-secondary);
}

.external-reader__state--error {
  color: var(--signal-error);
}

.external-reader__notice {
  box-sizing: border-box;
  margin-top: var(--space-16);
  margin-bottom: calc(-1 * var(--space-16));
  padding: var(--space-8) var(--space-12);
  border: var(--border-thin) solid var(--rule);
  border-radius: var(--radius);
  background: var(--accent-soft);
  color: var(--ink-secondary);
  font-size: var(--text-sm);
  line-height: var(--lh-ui);
}

.external-reader__notice--error {
  border-color: var(--signal-error);
  background: var(--signal-error-soft);
  color: var(--signal-error);
}

.external-reader__plain {
  box-sizing: border-box;
  min-height: 100%;
  margin-top: 0;
  margin-bottom: 0;
  padding-top: var(--editor-top-pad);
  padding-bottom: var(--space-96);
  overflow-wrap: anywhere;
  white-space: pre-wrap;
  color: var(--ink-primary);
  font-family: var(--ff-body);
  font-size: var(--text-base);
  line-height: var(--lh-body);
}

.external-reader__markdown {
  box-sizing: border-box;
}

.document-import__status {
  box-sizing: border-box;
  margin-top: var(--space-16);
  padding: var(--space-12) var(--space-16);
  border: var(--border-thin) solid var(--rule);
  border-radius: var(--radius-md);
  background: var(--paper-raised);
  box-shadow: var(--shadow-sheet);
  color: var(--ink-secondary);
  font-size: var(--text-sm);
  line-height: var(--lh-ui);
}

.document-import__status--stale,
.document-import__status--error {
  border-color: color-mix(in oklch, var(--signal-warning) 48%, var(--rule));
  background: var(--signal-warning-soft);
}

.document-import__status--error {
  border-color: color-mix(in oklch, var(--signal-error) 48%, var(--rule));
  background: var(--signal-error-soft);
}

.document-import__progress-copy,
.document-import__message,
.document-import__complete,
.document-edit-dialog__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-16);
}

.document-import__progress-copy > div,
.document-import__message > div {
  display: grid;
  gap: var(--space-4);
}

.document-import__progress-copy strong,
.document-import__message strong {
  color: var(--ink-primary);
  font-weight: var(--fw-semibold);
}

.document-import__progress {
  height: var(--space-4);
  margin-top: var(--space-12);
  overflow: hidden;
  border-radius: var(--radius-full);
  background: var(--rule);
}

.document-import__progress > span {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--accent);
  transition: width var(--dur-release) var(--ease-back);
}

.document-import__progress--indeterminate > span {
  width: 34%;
  animation: document-progress var(--dur-breathe) var(--ease-fade) infinite;
}

.document-import__complete span:last-child {
  color: var(--ink-muted);
}

.document-import__warnings {
  box-sizing: border-box;
  margin-top: var(--space-8);
  padding: var(--space-8) var(--space-12);
  border: var(--border-thin) solid var(--rule);
  border-radius: var(--radius);
  background: color-mix(in oklch, var(--signal-warning-soft) 72%, var(--paper-raised));
  color: var(--ink-secondary);
  font-size: var(--text-sm);
  line-height: var(--lh-ui);
}

.document-import__asset-placeholder {
  display: inline-flex;
  align-items: center;
  gap: var(--space-8);
  max-width: 100%;
  padding: var(--space-4) var(--space-12);
  border: var(--border-thin) dashed var(--rule);
  border-radius: var(--radius);
  background: var(--paper-surface);
  color: var(--ink-secondary);
  font-size: var(--text-sm);
  line-height: var(--lh-ui);
}

.document-import__asset-placeholder--failed {
  border-color: color-mix(in oklch, var(--signal-error) 48%, var(--rule));
  background: var(--signal-error-soft);
  color: var(--signal-error);
}

.document-import__warnings summary {
  color: var(--ink-primary);
  font-weight: var(--fw-medium);
  cursor: pointer;
}

.document-import__warnings ul {
  display: grid;
  gap: var(--space-4);
  margin: var(--space-8) 0 0;
  padding-inline-start: var(--space-24);
}

.document-edit-dialog__overlay {
  position: fixed;
  z-index: var(--z-modal);
  inset: 0;
  display: grid;
  place-items: center;
  padding: var(--space-16);
  background: color-mix(in oklch, var(--ink-primary) 28%, transparent);
}

.document-edit-dialog {
  width: min(560px, calc(100vw - var(--space-32)));
  padding: var(--space-24);
  border: var(--border-thin) solid var(--rule-strong);
  border-radius: var(--radius-lg);
  background: var(--paper-raised);
  box-shadow: var(--shadow-float);
  color: var(--ink-primary);
}

.document-edit-dialog header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-16);
}

.document-edit-dialog header p,
.document-edit-dialog header h2,
.document-edit-dialog__intro {
  margin: 0;
}

.document-edit-dialog header p {
  margin-bottom: var(--space-4);
  color: var(--ink-muted);
  font-size: var(--text-xs);
  line-height: var(--lh-ui);
}

.document-edit-dialog header h2 {
  font-family: var(--ff-heading);
  font-size: var(--text-lg);
  line-height: var(--lh-heading);
}

.document-edit-dialog__close {
  display: inline-grid;
  flex: 0 0 var(--touch-target-min);
  width: var(--touch-target-min);
  height: var(--touch-target-min);
  padding: 0;
  place-items: center;
  border: 0;
  border-radius: var(--radius);
  background: transparent;
  color: var(--ink-secondary);
  font-size: var(--text-lg);
  cursor: pointer;
}

.document-edit-dialog__close:hover {
  background: var(--paper-surface);
}

.document-edit-dialog__intro {
  margin-top: var(--space-12);
  color: var(--ink-secondary);
  font-size: var(--text-sm);
  line-height: var(--lh-body);
}

.document-edit-dialog__choices {
  display: grid;
  gap: var(--space-12);
  margin-top: var(--space-20);
}

.document-edit-dialog__choice {
  display: grid;
  gap: var(--space-4);
  min-height: var(--space-80);
  padding: var(--space-12) var(--space-16);
  border: var(--border-thin) solid var(--rule);
  border-radius: var(--radius-md);
  background: var(--paper-surface);
  color: var(--ink-primary);
  text-align: start;
  cursor: pointer;
  transition:
    border-color var(--dur-micro) var(--ease-fade),
    background var(--dur-micro) var(--ease-fade),
    transform var(--dur-press) var(--ease-press);
}

.document-edit-dialog__close:focus-visible,
.document-edit-dialog__choice:focus-visible {
  outline: var(--focus-ring-width) solid var(--accent);
  outline-offset: var(--focus-ring-offset);
}

.document-edit-dialog__choice:hover {
  border-color: var(--accent);
  background: var(--accent-soft);
}

.document-edit-dialog__choice:active {
  transform: translateY(1px);
}

.document-edit-dialog__choice:disabled {
  opacity: 0.58;
  cursor: wait;
}

.document-edit-dialog__choice strong {
  font-size: var(--text-base);
  font-weight: var(--fw-semibold);
  line-height: var(--lh-ui);
}

.document-edit-dialog__choice-description {
  color: var(--ink-muted);
  font-size: var(--text-sm);
  line-height: var(--lh-ui);
}

.document-edit-dialog__footer {
  margin-top: var(--space-24);
  justify-content: flex-end;
}

@keyframes document-progress {
  from {
    transform: translateX(-110%);
  }

  to {
    transform: translateX(300%);
  }
}

.external-reader__statusbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: var(--statusbar-height);
  padding: 0 var(--space-12);
  border-top: var(--border-thin) solid var(--rule);
  background: var(--paper-raised);
  color: var(--ink-muted);
  font-size: var(--text-xs);
  line-height: var(--lh-ui);
}

@media (width <= 900px) {
  .external-reader__stats {
    display: none;
  }

  .external-reader__workspace :deep(.right-wing) {
    width: 220px !important;
  }
}

@media (width <= 720px) {
  .external-reader__topbar {
    align-items: flex-start;
    flex-wrap: wrap;
  }

  .external-reader__topbar--document {
    align-items: center;
    flex-wrap: nowrap;
  }

  .external-reader__actions {
    width: 100%;
    justify-content: flex-end;
  }

  .external-reader__topbar--document .external-reader__actions {
    width: auto;
  }

  .external-reader__workspace :deep(.right-wing),
  .external-reader__divider {
    display: none;
  }

  .external-reader__path {
    max-width: calc(100vw - 80px);
  }

  .document-import__message {
    align-items: flex-start;
    flex-direction: column;
  }

  .document-edit-dialog {
    padding: var(--space-16);
  }
}

@media (width <= 480px) {
  .external-reader__topbar--document {
    align-items: flex-start;
    flex-wrap: wrap;
  }

  .external-reader__topbar--document .external-reader__actions {
    width: 100%;
  }

  .document-import__complete {
    align-items: flex-start;
    flex-direction: column;
  }
}

@media (prefers-reduced-motion: reduce) {
  .document-import__progress > span,
  .document-edit-dialog__choice {
    transition: none;
  }

  .document-import__progress--indeterminate > span {
    width: 100%;
    animation: none;
    opacity: 0.56;
  }
}
</style>
