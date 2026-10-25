/**
 * useDocumentNavigation — 文档位置状态与导航编排
 *
 * 自 NotebookHome.vue 导航块原样迁出（工单 B3 / Phase2）：
 *  - 位置状态 activeDocumentPosition / activeLocationPane（原 let 升格为 ref，
 *    供页面残留消费点——路径切换 watch 与 onStaticPreviewScroll 守卫——按原名解构）；
 *  - NavigationRequest 单例与 cancelDocumentNavigation 取消链（abort 在途请求、
 *    渐进预览取消、静态预览高亮清理）；
 *  - onDocumentInteraction / onEditorPosition / onPreviewPosition 三入口 +
 *    viewMode / currentContent 两个 watch；
 *  - currentNavigation 请求时效校验、awaitNavigationAnalysis 分析等待、
 *    navigateStaticPreview 静态预览滚动（staticNavigationScroll / Timer 闭包化）；
 *  - navigateDocument 主流程及 onNavTreeNavigate / onBacklinkNavigate /
 *    onLivePreviewWikiLinkClick 调用包装。
 *
 * 依赖全部经参数注入（照 usePublicDecoderSetup / useReviewSession 风格）；
 * document.dispatchEvent('jotluck-document-activity') 等 DOM 副作用原样保留。
 */
import { nextTick, ref, shallowRef, watch } from 'vue';
import type { Ref } from 'vue';
import { EditorView } from '@codemirror/view';
import type { BacklinkEntry } from '@/types';
import type { DocumentAnalysis, DocumentAnalysisResult } from '@/services/document-analysis';
import type ProgressivePreview from '@/components/editor/ProgressivePreview.vue';
import type { useHeadings } from '@/composables/useHeadings';
import type { useIndexStore } from '@/stores/notebookIndex';
import {
  findGuidedSampleNoteByTitle,
  type GuidedSampleSession,
} from '@/services/GuidedSampleSession';
import type { ToastAPI } from '@/components/common/Toast.vue';
import { editorSource } from '@/utils/editor-source';
import { relocateBacklink, type DocumentLocation } from '@/utils/document-location';
import { revealLivePreviewSourceAt } from '@/utils/cm6-live-preview';
import { headingAnchorCandidates } from '@/utils/heading-anchor';
import { normalizePath } from '@/utils/notebook-paths';

/** 编辑器实例导航句柄（页面 MarkdownEditorExposed 的导航子集，注入方保持不变） */
export interface DocumentNavigationEditorHandle {
  getEditorView(): EditorView | null;
}

/** 渐进预览实例类型（与页面 progressivePreviewRef 声明同源） */
export type ProgressivePreviewNavigation = InstanceType<typeof ProgressivePreview>;

export interface NavigationRequest {
  controller: AbortController;
  path: string;
  workspace: string | null;
  generation: number;
  source?: string;
}

export interface UseDocumentNavigationOptions {
  /** 静态预览当前渲染源（页面渲染管线写入，null = 尚未渲染） */
  renderedPreviewSource: Ref<string | null>;
  /** 静态预览根元素（模板 ref 注入） */
  staticPreviewRef: Ref<HTMLElement | null>;
  /** 渐进预览实例（模板 ref 注入） */
  progressivePreviewRef: Ref<ProgressivePreviewNavigation | null>;
  /** 编辑器显示内容（editorSource 投影） */
  displayContent: Ref<string>;
  documentAnalysis: DocumentAnalysis;
  headingIndex: ReturnType<typeof useHeadings>;
  /** 光标行列统计（页面 reactive 对象，按引用就地写入） */
  editorStats: { cursorLine: number | null; cursorCol: number | null };
  editorRef: Ref<DocumentNavigationEditorHandle | null>;
  viewMode: Ref<string>;
  currentContent: Ref<string>;
  activeNotebookRoot: Ref<string>;
  activePath: Ref<string>;
  /** 工作区代次（页面 let 变量，经 getter 读取实时值） */
  notebookDataGeneration: () => number;
  indexStore: ReturnType<typeof useIndexStore>;
  toast: ToastAPI;
  t: (key: string, params?: Record<string, unknown>) => string;
  onShellSelectNote: (path: string) => Promise<void>;
  currentBacklinks: Ref<BacklinkEntry[]>;
  /** 外部会话全域（readonly + edit-shell 两种态）：wiki 点击守卫统一拦截 */
  isExternalSession: Ref<boolean>;
  guidedSampleSession: Ref<GuidedSampleSession | null>;
}

export interface UseDocumentNavigationReturn {
  /** 活动文档位置（编辑/预览双 pane 投影的公共游标） */
  activeDocumentPosition: Ref<number>;
  /** 活动位置来源 pane（原模块级 let；升格 ref 供页面滚动守卫按名读取） */
  activeLocationPane: Ref<'editor' | 'preview'>;
  /** 静态预览导航滚动进行中标志（原模块级 let；升格 ref 供页面滚动守卫按名读取） */
  staticNavigationScroll: Ref<boolean>;
  /** 在途导航请求单例（页面路径切换 watch 读取以判断是否需要取消） */
  navigationRequest: Ref<NavigationRequest | null>;
  /** 静态预览视口几何（页面 onStaticPreviewScroll 与导航滚动共用） */
  staticPreviewViewport(root: HTMLElement): {
    owner: HTMLElement;
    top: number;
    bottom: number;
  };
  cancelDocumentNavigation(): void;
  onDocumentInteraction(pane: 'editor' | 'preview'): void;
  onEditorPosition(location: DocumentLocation): void;
  onPreviewPosition(location: DocumentLocation): void;
  navigateStaticPreview(
    request: NavigationRequest,
    from: number,
    to: number,
    headingId?: string,
  ): Promise<void>;
  navigateDocument(target: {
    path: string;
    headingId?: string;
    headingFrom?: number;
    anchor?: string;
    backlink?: BacklinkEntry;
  }): Promise<void>;
  onNavTreeNavigate(headingId: string, lineNumber: number): void;
  onBacklinkNavigate(entry: BacklinkEntry): void;
  onLivePreviewWikiLinkClick(noteTitle: string, anchor: null | string): Promise<void>;
}

export function useDocumentNavigation(
  options: UseDocumentNavigationOptions,
): UseDocumentNavigationReturn {
  const {
    renderedPreviewSource,
    staticPreviewRef,
    progressivePreviewRef,
    displayContent,
    documentAnalysis,
    headingIndex,
    editorStats,
    editorRef,
    viewMode,
    currentContent,
    activeNotebookRoot,
    activePath,
    notebookDataGeneration,
    indexStore,
    toast,
    t,
    onShellSelectNote,
    currentBacklinks,
    isExternalSession,
    guidedSampleSession,
  } = options;

  const activeDocumentPosition = ref(0);
  const activeLocationPane = ref<'editor' | 'preview'>('editor');
  // shallowRef 关键：深响应 ref 读取 .value 会返回 reactive 代理，currentNavigation
  // 的 navigationRequest.value === request 身份比较将恒为 false（原 let 单例语义）
  const navigationRequest = shallowRef<NavigationRequest | null>(null);
  const staticNavigationScroll = ref(false);
  let staticNavigationTimer: ReturnType<typeof setTimeout> | null = null;

  function staticPreviewViewport(root: HTMLElement) {
    const owner = root.closest<HTMLElement>('.reader-workbench') ?? root;
    const bounds = owner.getBoundingClientRect();
    const barHeight =
      owner === root
        ? 0
        : (owner.querySelector('.reader-workbench__bar')?.getBoundingClientRect().height ?? 0);
    return { owner, top: bounds.top + barHeight, bottom: bounds.bottom };
  }

  function cancelDocumentNavigation(): void {
    navigationRequest.value?.controller.abort();
    navigationRequest.value = null;
    progressivePreviewRef.value?.cancelNavigation();
    if (staticNavigationTimer) clearTimeout(staticNavigationTimer);
    staticPreviewRef.value
      ?.querySelectorAll('.preview-navigation-target')
      .forEach((node) => node.classList.remove('preview-navigation-target'));
  }

  function onDocumentInteraction(pane: 'editor' | 'preview'): void {
    if (pane === 'preview') staticNavigationScroll.value = false;
    activeLocationPane.value = pane;
    cancelDocumentNavigation();
    document.dispatchEvent(new Event('jotluck-document-activity'));
  }

  function onEditorPosition(location: DocumentLocation): void {
    if (location.analysis !== documentAnalysis || location.revision !== documentAnalysis.version)
      return;
    if (location.changes && location.doc)
      headingIndex.mapChanges(location.changes, location.doc, location.revision);
    if (location.line !== undefined) {
      editorStats.cursorLine = location.line;
      editorStats.cursorCol = location.column ?? 1;
    }
    if (location.reason === 'cursor' && editorRef.value?.getEditorView()?.hasFocus)
      activeLocationPane.value = 'editor';
    if (activeLocationPane.value === 'editor') activeDocumentPosition.value = location.position;
  }

  function onPreviewPosition(location: DocumentLocation): void {
    if (
      location.analysis === documentAnalysis &&
      location.revision === documentAnalysis.version &&
      activeLocationPane.value === 'preview'
    )
      activeDocumentPosition.value = location.position;
  }

  watch(viewMode, (mode) => {
    activeLocationPane.value = mode === 'read' ? 'preview' : 'editor';
    cancelDocumentNavigation();
  });
  watch(currentContent, (content) => {
    if (
      navigationRequest.value?.source !== undefined &&
      navigationRequest.value.source !== editorSource(content)
    )
      cancelDocumentNavigation();
  });

  function currentNavigation(request: NavigationRequest): boolean {
    return (
      navigationRequest.value === request &&
      !request.controller.signal.aborted &&
      request.workspace === activeNotebookRoot.value &&
      request.generation === notebookDataGeneration() &&
      normalizePath(request.path) === normalizePath(activePath.value)
    );
  }

  function awaitNavigationAnalysis(
    request: NavigationRequest,
  ): Promise<DocumentAnalysisResult | null> {
    const ready = documentAnalysis.result;
    if (ready?.ast.source === displayContent.value) return Promise.resolve(ready);
    return new Promise((resolve) => {
      const finish = (result: DocumentAnalysisResult | null) => {
        unsubscribe();
        clearTimeout(timeout);
        request.controller.signal.removeEventListener('abort', aborted);
        resolve(result);
      };
      const aborted = () => finish(null);
      const unsubscribe = documentAnalysis.subscribe((result) => {
        if (currentNavigation(request) && result.ast.source === displayContent.value)
          finish(result);
      });
      const timeout = setTimeout(() => finish(null), 5000);
      request.controller.signal.addEventListener('abort', aborted, { once: true });
      documentAnalysis.update(displayContent.value);
      if (!currentNavigation(request)) finish(null);
    });
  }

  async function navigateStaticPreview(
    request: NavigationRequest,
    from: number,
    to: number,
    headingId?: string,
  ): Promise<void> {
    if (renderedPreviewSource.value !== request.source || !staticPreviewRef.value) {
      await new Promise<void>((resolve) => {
        const stop = watch([renderedPreviewSource, staticPreviewRef], () => {
          if (renderedPreviewSource.value === request.source && staticPreviewRef.value) done();
        });
        const done = () => {
          stop();
          clearTimeout(timeout);
          request.controller.signal.removeEventListener('abort', done);
          resolve();
        };
        const timeout = setTimeout(done, 5000);
        request.controller.signal.addEventListener('abort', done, { once: true });
      });
    }
    await nextTick();
    if (!currentNavigation(request) || renderedPreviewSource.value !== displayContent.value) return;
    const root = staticPreviewRef.value;
    if (!root) return;
    let target: HTMLElement | null = null;
    if (headingId) target = root.querySelector<HTMLElement>(`[id="${CSS.escape(headingId)}"]`);
    else {
      const occurrences = documentAnalysis.result?.wikiLinks ?? [];
      const index = occurrences.findIndex((item) => item.from === from && item.to === to);
      const anchors = root.querySelectorAll<HTMLElement>('a[data-note]');
      if (anchors.length === occurrences.length) target = anchors[index] ?? null;
    }
    if (target) {
      staticNavigationScroll.value = true;
      const viewport = staticPreviewViewport(root);
      const rect = target.getBoundingClientRect();
      const top = headingId
        ? viewport.top + 24
        : (viewport.top + viewport.bottom - rect.height) / 2;
      viewport.owner.scrollTop += rect.top - top;
      if (!headingId) {
        target.classList.add('preview-navigation-target');
        // 先捕获句柄、回调内比对自身再置 null：旧 timer 到期不再抹掉新句柄，
        // cancelDocumentNavigation 始终能 clearTimeout 到最新 timer（工单 B L5）
        const timer: ReturnType<typeof setTimeout> = setTimeout(() => {
          target?.classList.remove('preview-navigation-target');
          if (staticNavigationTimer === timer) staticNavigationTimer = null;
        }, 1600);
        staticNavigationTimer = timer;
      }
    } else staticPreviewViewport(root).owner.scrollTop = 0;
  }

  async function navigateDocument(target: {
    path: string;
    headingId?: string;
    headingFrom?: number;
    anchor?: string;
    backlink?: BacklinkEntry;
  }): Promise<void> {
    // 兜底 catch：导航链任一步抛错（如 awaitNavigationAnalysis 内同步 parseDocument）
    // 不再以 unhandled rejection 泄出（onNavTreeNavigate/onBacklinkNavigate 均为 void
    // 调用）；仅 console.warn 保留信号，不改写任何导航状态（工单 B L6）
    try {
      const editing = editorRef.value?.getEditorView();
      if (editing?.composing || editing?.compositionStarted) return;
      cancelDocumentNavigation();
      const request: NavigationRequest = {
        controller: new AbortController(),
        path: target.path,
        workspace: activeNotebookRoot.value,
        generation: notebookDataGeneration(),
      };
      navigationRequest.value = request;
      if (normalizePath(activePath.value) !== normalizePath(target.path))
        await onShellSelectNote(target.path);
      await nextTick();
      if (!currentNavigation(request)) return;
      request.source = displayContent.value;
      const result = await awaitNavigationAnalysis(request);
      if (!result || !currentNavigation(request)) return;
      let from = 0,
        to = 0,
        headingId: string | undefined;
      if (target.backlink) {
        const entry = target.backlink;
        const occurrences = result.wikiLinks ?? [];
        const exact =
          entry.location &&
          indexStore.getIndexService()?.isBacklinkCurrent(entry, currentContent.value)
            ? occurrences.find(
                (item) =>
                  item.from === entry.location!.from &&
                  item.to === entry.location!.to &&
                  item.raw === entry.location!.raw,
              )
            : null;
        const occurrence = exact ?? relocateBacklink(entry, occurrences);
        if (!occurrence) {
          toast.show(t('navigation.referenceMoved'), 'info', 3500);
          return;
        }
        from = occurrence.from;
        to = occurrence.to;
      } else if (target.headingId || target.anchor) {
        const items = result.ast.blocks.filter((block) => block.type === 'heading');
        // 三形态候选弥合（heading-anchor）：原文 / heading-原文 / 归一形态逐一
        // 比对标题 id 与原文——直传原文锚点（[[#基础]]）与渲染归一 id 两侧失配
        // 在此收口；headingFrom 定位（大纲树）优先级不变。
        const candidates = headingAnchorCandidates(target.headingId ?? target.anchor ?? '');
        const heading =
          target.headingFrom !== undefined
            ? items.find((item) => item.range.from === target.headingFrom)
            : (items.find(
                (item) => candidates.includes(item.id) || candidates.includes(item.text.trim()),
              ) ?? null);
        if (!heading) return;
        from = to = heading.range.from;
        headingId = heading.id;
      }
      if (!currentNavigation(request)) return;
      activeDocumentPosition.value = from;
      if (viewMode.value !== 'read') {
        const view = editorRef.value?.getEditorView();
        if (!view || view.composing || view.compositionStarted) return;
        revealLivePreviewSourceAt(view, from);
        view.dispatch({
          selection: { anchor: from, head: to },
          effects: EditorView.scrollIntoView(from, { y: 'center' }),
        });
        view.focus();
        activeLocationPane.value = 'editor';
      } else activeLocationPane.value = 'preview';
      if (viewMode.value !== 'live') {
        if (progressivePreviewRef.value) {
          if (headingId) progressivePreviewRef.value.scrollToHeading(headingId);
          else progressivePreviewRef.value.navigateToRange(from, to);
        } else await navigateStaticPreview(request, from, to, headingId);
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn('[NotebookHome] navigation failed', error);
    }
  }

  function onNavTreeNavigate(headingId: string, lineNumber: number): void {
    const item = headingIndex.ordered.value.find((heading) => heading.id === headingId);
    const view = editorRef.value?.getEditorView();
    const from =
      item?.from ??
      (view && lineNumber > 0
        ? view.state.doc.line(Math.min(lineNumber, view.state.doc.lines)).from
        : undefined);
    void navigateDocument({ path: activePath.value, headingId, headingFrom: from });
  }

  function onBacklinkNavigate(entry: BacklinkEntry): void {
    const indexed = entry.location
      ? entry
      : (currentBacklinks.value.find(
          (candidate) =>
            candidate.notePath === entry.notePath &&
            (!entry.lineNumber || candidate.lineNumber === entry.lineNumber),
        ) ?? entry);
    void navigateDocument({ path: indexed.notePath, backlink: indexed });
  }

  async function onLivePreviewWikiLinkClick(
    noteTitle: string,
    anchor: null | string,
  ): Promise<void> {
    // 空 note + 锚文本 = 同页锚点（[[#锚]] 全形态）：目标在当前文档标题集内，
    // 按 headingAnchorCandidates 三形态定位跳转，不查跨库索引、不弹
    // 「未找到笔记」；跳转不出本文档，外部会话守卫（下方）也不适用于此形态。
    if (!noteTitle && anchor) {
      await navigateDocument({ path: activePath.value, anchor });
      return;
    }
    // 外部会话全域（readonly + edit-shell）统一 wikiRestricted 提示：外部
    // readonly 点击若落入 resolveWikiLink 会拿无关笔记本索引误导航或误报
    // noteNotFound——渲染侧 4371 行注释自述的「点击侧兜底」在 readonly 不
    // 成立，故守卫在两种外部态都在此收口。
    if (isExternalSession.value) {
      toast.show(t('notebook.external.wikiRestricted'), 'info', 3500);
      return;
    }
    if (guidedSampleSession.value) {
      const guided = findGuidedSampleNoteByTitle(guidedSampleSession.value, noteTitle);
      if (!guided) {
        toast.show(t('notebook.error.noteNotFound', { title: noteTitle }), 'warning', 3000);
        return;
      }
      await navigateDocument({ path: guided.path, anchor: anchor ?? undefined });
      return;
    }
    const exact = indexStore.getIndexService()?.resolveWikiLink(noteTitle);
    if (!exact) {
      toast.show(t('notebook.error.noteNotFound', { title: noteTitle }), 'warning', 3000);
      return;
    }
    await navigateDocument({ path: exact.path, anchor: anchor ?? undefined });
  }

  return {
    activeDocumentPosition,
    activeLocationPane,
    staticNavigationScroll,
    navigationRequest,
    staticPreviewViewport,
    cancelDocumentNavigation,
    onDocumentInteraction,
    onEditorPosition,
    onPreviewPosition,
    navigateStaticPreview,
    navigateDocument,
    onNavTreeNavigate,
    onBacklinkNavigate,
    onLivePreviewWikiLinkClick,
  };
}
