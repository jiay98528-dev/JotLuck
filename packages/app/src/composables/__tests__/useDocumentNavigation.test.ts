import { describe, expect, it, vi } from 'vitest';
import { computed, nextTick, ref } from 'vue';

import {
  useDocumentNavigation,
  type DocumentNavigationEditorHandle,
  type NavigationRequest,
  type ProgressivePreviewNavigation,
} from '../useDocumentNavigation';
import type { DocumentAnalysis, DocumentAnalysisResult } from '@/services/document-analysis';
import type { GuidedSampleSession } from '@/services/GuidedSampleSession';
import type { BacklinkEntry } from '@/types';
import type { DocumentLocation } from '@/utils/document-location';

type NavigationDeps = Parameters<typeof useDocumentNavigation>[0];

/** DocumentAnalysis 注入桩：version/result 可变，subscribe/update 打点 */
function createAnalysisStub() {
  return {
    version: 1,
    result: null as DocumentAnalysisResult | null,
    subscribe: vi.fn(() => vi.fn()),
    update: vi.fn(),
  };
}

/**
 * 组装最小注入集（照 useReviewSession.test.ts 的 mock 风格：
 * 纯桩对象 + 局部 as unknown as 收窄到注入类型）。
 */
function createNavigationHarness() {
  const analysisStub = createAnalysisStub();
  const currentContent = ref('# 标题\n\n正文');
  const editorStats = { cursorLine: null as number | null, cursorCol: null as number | null };
  const deps = {
    renderedPreviewSource: ref<string | null>(null),
    staticPreviewRef: ref<HTMLElement | null>(null),
    progressivePreviewRef: ref<ProgressivePreviewNavigation | null>(null),
    displayContent: computed(() => currentContent.value),
    documentAnalysis: analysisStub as unknown as DocumentAnalysis,
    headingIndex: {
      ordered: ref([]),
      mapChanges: vi.fn(),
    } as unknown as NavigationDeps['headingIndex'],
    editorStats,
    editorRef: ref<DocumentNavigationEditorHandle | null>(null),
    viewMode: ref('read'),
    currentContent,
    activeNotebookRoot: ref('/root/'),
    activePath: ref('/root/notes/a.md'),
    notebookDataGeneration: () => 7,
    indexStore: { getIndexService: () => null } as unknown as NavigationDeps['indexStore'],
    toast: { show: vi.fn() } as unknown as NavigationDeps['toast'],
    t: (key: string) => key,
    onShellSelectNote: vi.fn(async () => {}),
    currentBacklinks: ref<BacklinkEntry[]>([]),
    isExternalEditing: ref(false),
    guidedSampleSession: ref<GuidedSampleSession | null>(null),
  };
  const nav = useDocumentNavigation(deps);
  return { nav, deps, analysisStub, editorStats };
}

function locationOf(analysis: unknown, position: number, revision = 1): DocumentLocation {
  return { analysis, revision, position, reason: 'cursor' } as unknown as DocumentLocation;
}

describe('useDocumentNavigation 交互入口', () => {
  it('onDocumentInteraction 切 pane、abort 在途请求并派发 document-activity', () => {
    const { nav } = createNavigationHarness();
    const controller = new AbortController();
    const aborted = vi.fn();
    controller.signal.addEventListener('abort', aborted);
    const request: NavigationRequest = {
      controller,
      path: '/root/notes/a.md',
      workspace: '/root/',
      generation: 7,
    };
    nav.navigationRequest.value = request;

    const activity = vi.fn();
    document.addEventListener('jotluck-document-activity', activity);
    nav.onDocumentInteraction('preview');
    expect(nav.activeLocationPane.value).toBe('preview');
    expect(aborted).toHaveBeenCalledTimes(1);
    expect(nav.navigationRequest.value).toBeNull();
    expect(activity).toHaveBeenCalledTimes(1);

    nav.onDocumentInteraction('editor');
    document.removeEventListener('jotluck-document-activity', activity);
    expect(nav.activeLocationPane.value).toBe('editor');
    expect(activity).toHaveBeenCalledTimes(2);
  });

  it('onEditorPosition 仅在 pane=editor 时推进 activeDocumentPosition', () => {
    const { nav, analysisStub, editorStats } = createNavigationHarness();

    nav.onDocumentInteraction('preview');
    nav.onEditorPosition(locationOf(analysisStub, 42));
    expect(nav.activeDocumentPosition.value).toBe(0);

    nav.onDocumentInteraction('editor');
    nav.onEditorPosition({ ...locationOf(analysisStub, 42), line: 3, column: 5 });
    expect(nav.activeDocumentPosition.value).toBe(42);
    expect(editorStats.cursorLine).toBe(3);
    expect(editorStats.cursorCol).toBe(5);

    // revision 失配守卫：非当前分析版本一律忽略
    nav.onEditorPosition(locationOf(analysisStub, 99, 999));
    expect(nav.activeDocumentPosition.value).toBe(42);
  });
});

describe('useDocumentNavigation 静态预览导航', () => {
  it('navigateStaticPreview 等渲染源/容器就绪后经 watch-resolve 滚动并高亮', async () => {
    vi.useFakeTimers();
    try {
      const { nav, deps, analysisStub } = createNavigationHarness();
      const root = document.createElement('div');
      root.innerHTML = '<a data-note>引用</a>';
      analysisStub.result = { wikiLinks: [{ from: 5, to: 9 }] } as DocumentAnalysisResult;

      const request: NavigationRequest = {
        controller: new AbortController(),
        path: '/root/notes/a.md',
        workspace: '/root/',
        generation: 7,
        source: deps.displayContent.value,
      };
      nav.navigationRequest.value = request;

      let settled = false;
      const pending = nav.navigateStaticPreview(request, 5, 9).then(() => {
        settled = true;
      });

      // 渲染源与容器均未就绪：等待分支挂起（5000ms 兜底计时器不推进）
      await nextTick();
      await nextTick();
      expect(settled).toBe(false);

      deps.renderedPreviewSource.value = request.source ?? null;
      deps.staticPreviewRef.value = root;
      await nextTick(); // watch([renderedPreviewSource, staticPreviewRef]) 触发 done()
      await pending;
      expect(settled).toBe(true);

      const anchor = root.querySelector<HTMLElement>('a[data-note]')!;
      expect(nav.staticNavigationScroll.value).toBe(true);
      expect(anchor.classList.contains('preview-navigation-target')).toBe(true);

      vi.advanceTimersByTime(1600); // 高亮 1600ms 后自动摘除
      expect(anchor.classList.contains('preview-navigation-target')).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
