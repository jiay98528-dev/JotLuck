import { describe, expect, it, vi } from 'vitest';
import { computed, nextTick, ref } from 'vue';
import type { EditorView } from '@codemirror/view';

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
    // 签名带 path 形参：主流程用例以 mockImplementation 改写换笔记语义
    onShellSelectNote: vi.fn(async (_path: string) => {}),
    currentBacklinks: ref<BacklinkEntry[]>([]),
    // 外部会话全域（readonly + edit-shell）：wiki 点击守卫统一拦截的注入位
    isExternalSession: ref(false),
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

describe('useDocumentNavigation navigateDocument 主流程', () => {
  /** 编辑器视图桩：composing 关闭、dispatch/focus 打点（revealLivePreviewSourceAt 只读 state.doc.length） */
  function createEditorViewStub() {
    return {
      composing: false,
      compositionStarted: false,
      state: { doc: { length: 40 } },
      dispatch: vi.fn(),
      focus: vi.fn(),
    };
  }

  it('跨笔记切换 + heading 定位：先 onShellSelectNote 换笔记，read 分支驱动渐进预览滚动到标题', async () => {
    const { nav, deps, analysisStub } = createNavigationHarness();
    // 目标笔记内容已就绪：分析结果与 displayContent 同源 → awaitNavigationAnalysis 立即命中
    analysisStub.result = {
      ast: {
        source: deps.currentContent.value,
        blocks: [
          { type: 'heading', id: 'h-target', range: { from: 8, to: 14 }, text: '目标' },
          { type: 'paragraph', id: 'p-1', range: { from: 14, to: 30 }, text: '正文' },
        ],
      },
      wikiLinks: [],
    } as unknown as DocumentAnalysisResult;
    // 页面 onShellSelectNote 语义：换笔记后 activePath 落到目标路径
    deps.onShellSelectNote.mockImplementation(async (path: string) => {
      deps.activePath.value = path;
    });
    const progressive = {
      cancelNavigation: vi.fn(),
      scrollToHeading: vi.fn(),
      navigateToRange: vi.fn(),
    };
    deps.progressivePreviewRef.value = progressive as unknown as ProgressivePreviewNavigation;

    await nav.navigateDocument({ path: '/root/notes/b.md', headingId: 'h-target' });
    await nextTick();

    expect(deps.onShellSelectNote).toHaveBeenCalledWith('/root/notes/b.md');
    expect(deps.activePath.value).toBe('/root/notes/b.md');
    expect(nav.activeDocumentPosition.value).toBe(8);
    expect(nav.activeLocationPane.value).toBe('preview'); // read 分支
    expect(progressive.scrollToHeading).toHaveBeenCalledWith('h-target');
    expect(progressive.navigateToRange).not.toHaveBeenCalled();
  });

  it('live 分支 + backlink 定位：重定位成功后驱动编辑器选区；引用迁空则 toast 并放弃', async () => {
    const { nav, deps, analysisStub } = createNavigationHarness();
    deps.viewMode.value = 'live';
    // 先让 viewMode watch（切 pane + 取消在途导航）flush 完，再发起导航，
    // 避免其异步回调在导航途中 abort 刚登记的请求
    await nextTick();
    const view = createEditorViewStub();
    deps.editorRef.value = {
      getEditorView: () => view as unknown as EditorView,
    };
    const occurrence = {
      target: 'A',
      alias: null,
      anchor: null,
      from: 5,
      to: 9,
      lineNumber: 1,
      raw: '[[A]]',
      before: '',
      after: '',
    };
    analysisStub.result = {
      ast: { source: deps.currentContent.value, blocks: [] },
      wikiLinks: [occurrence],
    } as unknown as DocumentAnalysisResult;
    deps.onShellSelectNote.mockImplementation(async (path: string) => {
      deps.activePath.value = path;
    });
    const backlink = {
      notePath: '/root/notes/b.md',
      noteTitle: 'A',
      context: '',
      lineNumber: 1,
      location: { from: 5, to: 9, target: 'A', raw: '[[A]]', before: '', after: '', revision: 1 },
    };

    await nav.navigateDocument({ path: '/root/notes/b.md', backlink });

    expect(deps.onShellSelectNote).toHaveBeenCalledTimes(1);
    expect(nav.activeDocumentPosition.value).toBe(5);
    expect(nav.activeLocationPane.value).toBe('editor'); // live 分支
    // revealLivePreviewSourceAt 一次 + 选区/滚动 dispatch 一次
    expect(view.dispatch).toHaveBeenCalledTimes(2);
    expect(view.focus).toHaveBeenCalledTimes(1);

    // 引用已迁移且无法重定位：toast referenceMoved，不再触编辑器
    const moved = {
      ...backlink,
      location: {
        from: 55,
        to: 59,
        target: 'B',
        raw: '[[B]]',
        before: 'x',
        after: 'y',
        revision: 1,
      },
    };
    await nav.navigateDocument({ path: '/root/notes/b.md', backlink: moved });
    expect(deps.toast.show).toHaveBeenCalledWith('navigation.referenceMoved', 'info', 3500);
    expect(view.dispatch).toHaveBeenCalledTimes(2); // 未新增
    expect(deps.onShellSelectNote).toHaveBeenCalledTimes(1); // 同笔记不再切换
  });
});

describe('useDocumentNavigation 外部会话 wiki 点击守卫', () => {
  it('外部 readonly 会话：wiki 点击统一 wikiRestricted 提示，不查主索引不导航', async () => {
    // L6：守卫此前只拦 edit-shell（isExternalEditing）——外部 readonly 点击会
    // 落入 resolveWikiLink 拿无关笔记本索引误导航。注入位已扩为外部会话全域
    // （readonly + edit-shell），本用例锁定 readonly 态同样拦截。
    const { nav, deps } = createNavigationHarness();
    deps.isExternalSession.value = true;

    await nav.onLivePreviewWikiLinkClick('无关笔记', null);

    expect(deps.toast.show).toHaveBeenCalledWith('notebook.external.wikiRestricted', 'info', 3500);
    expect(deps.onShellSelectNote).not.toHaveBeenCalled();
  });

  it('工作区会话：wiki 点击不受守卫影响，正常落入解析/miss 提示链', async () => {
    const { nav, deps } = createNavigationHarness();
    deps.isExternalSession.value = false;

    await nav.onLivePreviewWikiLinkClick('不存在的笔记', null);

    // indexStore 无索引服务：落 noteNotFound miss 提示（未被 wikiRestricted 截胡）。
    expect(deps.toast.show).toHaveBeenCalledWith('notebook.error.noteNotFound', 'warning', 3000);
  });
});
