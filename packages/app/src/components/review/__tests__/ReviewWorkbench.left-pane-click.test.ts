import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, type VueWrapper } from '@vue/test-utils';
import type { IFileSystemService } from '@/types/file-system';
import type { RemoteImagePolicy } from '@jotluck/renderer';
import MarkdownEditor from '@/components/editor/MarkdownEditor.vue';

// ReviewWorkbench 的锚点收口依赖 openExternalUrl / useToast 两枚外部入口；
// 部分 mock（保留模块其余导出），点击断言只认这两枚 spy。
const openExternalUrlMock = vi.hoisted(() => vi.fn());
const toastShowMock = vi.hoisted(() => vi.fn());
vi.mock('@/utils/urlUtils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/urlUtils')>();
  return { ...actual, openExternalUrl: openExternalUrlMock };
});
vi.mock('@/components/common/Toast.vue', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useToast: () => ({
      show: toastShowMock,
      success: vi.fn(),
      warning: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      dismiss: vi.fn(),
    }),
  };
});

import ReviewWorkbench from '../ReviewWorkbench.vue';

/** 左栏源稿：外链/裸域名/wiki/标签/相对路径/#锚点（含空锚）各类锚点各占一段。 */
const SOURCE = [
  '# 改稿标题',
  '',
  '外链：[示例站](https://example.com) 与裸域名 [裸](example.com)',
  '',
  '维基：[[其他笔记]] 收尾，标签 #标签一',
  '',
  '相对路径：[相对](notes/other.md)',
  '',
  '站内锚点：[到标题](#改稿标题)、[失配锚](#不存在的标题) 与 [空锚](#)',
].join('\n');

const LINK_RESTRICTED_ZH = '改稿模式下不能跳转链接；请退出改稿后再使用。';
const HEADING_NOT_FOUND_ZH = '未找到对应标题，无法跳转。';

/**
 * 全文件共享单次挂载：Workbench 含双栏编辑器（CM6）等重子树，逐用例
 * 重挂 6 次会显著抬高并行测试池负载（实测拖慢同批 CPU 大户致假性超时）。
 * 点击用例均走 mock 出口、不改组件状态，共享挂载安全；断言逐条不变。
 */
let wrapper: VueWrapper | null = null;

// jsdom 无 scrollIntoView 实现：原型级 mock 供 # 锚点命中分支断言（afterAll
// 用 Reflect.deleteProperty 删净还原，防原型污染外溢）。
const scrollIntoViewMock = vi.fn();
const prototypeWithScroll = HTMLElement.prototype as HTMLElement & {
  scrollIntoView?: (options?: ScrollIntoViewOptions) => void;
};

beforeAll(() => {
  prototypeWithScroll.scrollIntoView = scrollIntoViewMock;
  wrapper = mount(ReviewWorkbench, {
    props: {
      fs: {} as IFileSystemService,
      root: 'click-test-root',
      path: 'notes/click.md',
      initialSnapshot: { content: SOURCE, revision: 'r1' },
    },
  });
});

afterAll(() => {
  wrapper?.unmount();
  wrapper = null;
  // Reflect.deleteProperty 绕开 TS2790（lib.dom 的 Element.scrollIntoView 为必选
  // 方法，delete 操作数类型不合法）；jsdom 原型本无该属性，删净防外溢。
  Reflect.deleteProperty(prototypeWithScroll, 'scrollIntoView');
  document.body.replaceChildren();
});

/** 在左栏 v-html 容器内派发真实冒泡点击，返回事件以断言 defaultPrevented。 */
function clickAnchor(selector: string): MouseEvent {
  if (!wrapper) throw new Error('共享挂载未就绪');
  const anchor = wrapper.find(`.review-left-render ${selector}`);
  expect(anchor.exists(), `左栏应含锚点 ${selector}`).toBe(true);
  const event = new MouseEvent('click', { bubbles: true, cancelable: true });
  anchor.element.dispatchEvent(event);
  return event;
}

describe('ReviewWorkbench 左栏 v-html 点击收口', () => {
  beforeEach(() => {
    openExternalUrlMock.mockReset();
    toastShowMock.mockReset();
    scrollIntoViewMock.mockReset();
  });

  it('渲染态左栏注入 v-html 且五类锚点齐备', () => {
    if (!wrapper) throw new Error('共享挂载未就绪');
    expect(wrapper.find('.review-left-render').exists()).toBe(true);
    for (const selector of [
      'a[href="https://example.com"]',
      'a[href="example.com"]',
      'a[data-note="其他笔记"]',
      'a[data-tag="标签一"]',
      'a[href="notes/other.md"]',
    ]) {
      expect(wrapper.find(`.review-left-render ${selector}`).exists()).toBe(true);
    }
  });

  it('绝对外链：preventDefault 后移交 openExternalUrl，不弹受限提示', () => {
    const event = clickAnchor('a[href="https://example.com"]');

    expect(event.defaultPrevented, '外链必须被 preventDefault（WebView 不接管）').toBe(true);
    expect(openExternalUrlMock).toHaveBeenCalledOnce();
    expect(openExternalUrlMock).toHaveBeenCalledWith('https://example.com');
    expect(toastShowMock).not.toHaveBeenCalled();
  });

  it('无协议裸域名：preventDefault 后同样移交 openExternalUrl（normalizeUrl 补头）', () => {
    const event = clickAnchor('a[href="example.com"]');

    expect(event.defaultPrevented).toBe(true);
    expect(openExternalUrlMock).toHaveBeenCalledOnce();
    expect(openExternalUrlMock).toHaveBeenCalledWith('example.com');
    expect(toastShowMock).not.toHaveBeenCalled();
  });

  it('wiki 链接（data-note）：preventDefault 且给受限 toast，不外抛不导航', () => {
    const event = clickAnchor('a[data-note="其他笔记"]');

    expect(event.defaultPrevented).toBe(true);
    expect(toastShowMock).toHaveBeenCalledOnce();
    expect(toastShowMock).toHaveBeenCalledWith(LINK_RESTRICTED_ZH, 'info', 3500);
    expect(openExternalUrlMock).not.toHaveBeenCalled();
  });

  it('标签（data-tag）：preventDefault 且给受限 toast，不外抛不导航', () => {
    const event = clickAnchor('a[data-tag="标签一"]');

    expect(event.defaultPrevented).toBe(true);
    expect(toastShowMock).toHaveBeenCalledOnce();
    expect(toastShowMock).toHaveBeenCalledWith(LINK_RESTRICTED_ZH, 'info', 3500);
    expect(openExternalUrlMock).not.toHaveBeenCalled();
  });

  it('相对路径链接：preventDefault 后不动作——无任何放行路径', () => {
    const event = clickAnchor('a[href="notes/other.md"]');

    expect(event.defaultPrevented).toBe(true);
    expect(openExternalUrlMock).not.toHaveBeenCalled();
    expect(toastShowMock).not.toHaveBeenCalled();
  });

  // marked 18 对 href 做 encodeURI：中文锚点变百分号编码（同 cm6 测试注释）
  const headingHref = `#${encodeURI('改稿标题')}`;
  const missingHref = `#${encodeURI('不存在的标题')}`;

  it('# 锚点命中：左栏容器内三形态归一滚动（preventDefault，不外抛不 toast）', () => {
    if (!wrapper) throw new Error('共享挂载未就绪');
    const heading = wrapper.find('.review-left-render [id="heading-改稿标题"]');
    expect(heading.exists(), '左栏应渲染出标题锚点 id').toBe(true);
    const event = clickAnchor(`a[href="${headingHref}"]`);

    expect(event.defaultPrevented).toBe(true);
    expect(scrollIntoViewMock).toHaveBeenCalledOnce();
    expect(scrollIntoViewMock).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });
    expect(openExternalUrlMock).not.toHaveBeenCalled();
    expect(toastShowMock).not.toHaveBeenCalled();
  });

  it('# 锚点三形态 miss：headingNotFound 轻反馈（不再纯静默 no-op）', () => {
    const event = clickAnchor(`a[href="${missingHref}"]`);

    expect(event.defaultPrevented).toBe(true);
    expect(scrollIntoViewMock).not.toHaveBeenCalled();
    expect(openExternalUrlMock).not.toHaveBeenCalled();
    expect(toastShowMock).toHaveBeenCalledOnce();
    expect(toastShowMock).toHaveBeenCalledWith(HEADING_NOT_FOUND_ZH, 'info', 3500);
  });

  it('# 空锚（href="#"）：L3 空锚短路恒 miss → headingNotFound，不误滚纯标点标题', () => {
    const event = clickAnchor('a[href="#"]');

    expect(event.defaultPrevented).toBe(true);
    expect(scrollIntoViewMock).not.toHaveBeenCalled();
    expect(toastShowMock).toHaveBeenCalledOnce();
    expect(toastShowMock).toHaveBeenCalledWith(HEADING_NOT_FOUND_ZH, 'info', 3500);
  });

  it('右栏 #tag 点击回调（L5 透传）：与左栏 data-tag 同口径受限 toast', () => {
    if (!wrapper) throw new Error('共享挂载未就绪');
    const editor = wrapper.findComponent(MarkdownEditor);
    expect(editor.exists()).toBe(true);
    const handler = editor.props('onLivePreviewTagClick');
    expect(typeof handler, '右栏应透传 onLivePreviewTagClick（缺省时点击被静默吞掉）').toBe(
      'function',
    );

    (handler as (tag: string) => void)('标签一');
    expect(toastShowMock).toHaveBeenCalledOnce();
    expect(toastShowMock).toHaveBeenCalledWith(LINK_RESTRICTED_ZH, 'info', 3500);
    expect(openExternalUrlMock).not.toHaveBeenCalled();
  });
});

// ── W2 渲染 props 下沉：左栏 renderMarkdown options 消费 + 点击/装载委托 + 右栏透传 ──

/** W2 源稿：wiki 活链/死链各一、本地图一枚、https 远程图一枚。 */
const W2_SOURCE = [
  '# W2 渲染下沉',
  '',
  '本地图：![本地图](assets/pic.png)',
  '',
  '维基：[[存在笔记]] 与 [[不存在笔记]]',
  '',
  '远程图：![远程图](https://example.com/pic.png)',
].join('\n');

/** 本地图经 resolveImageSrc 重写后的 data: URL（与生产 usePreviewImageResolver 同形态） */
const RESOLVED_SRC = 'data:image/png;base64,aGVsbG8=';

const W2_LABELS = {
  blocked: '远程图已拦截',
  source: '来源',
  loadAll: '载入本笔记远程图片',
  loading: '正在载入…',
  failed: '载入失败',
  retry: '重试',
  insecure: '已拦截不安全的 HTTP 图片',
  unnamed: '未命名图片',
};

describe('ReviewWorkbench 渲染 props 下沉（W2）', () => {
  const wikiLinkExists = (note: string): boolean => note === '存在笔记';
  const resolveImageSrc = (source: string): string | null =>
    source === 'assets/pic.png' ? RESOLVED_SRC : null;
  // 显式标 RemoteImagePolicy：字面量 'blocked' 需上下文类型收窄为 RemoteImageDecision
  const remoteImagesPolicy: RemoteImagePolicy = {
    labels: W2_LABELS,
    scopeId: 'w2-scope',
    decide: () => 'blocked',
  };
  const wikiClick = vi.fn();
  // 模拟会话句柄 handleClick 语义：仅占位「载入/重试」按钮被吃掉返回 true，
  // 其余点击放行进锚点裁决；mockClear 只清计数保留实现
  const remoteClick = vi.fn(
    (event: MouseEvent) =>
      event.target instanceof Element &&
      Boolean(event.target.closest('button.remote-image-placeholder__action')),
  );
  const remoteLoad = vi.fn();
  const remoteError = vi.fn();

  let w2: VueWrapper | null = null;

  beforeAll(() => {
    w2 = mount(ReviewWorkbench, {
      props: {
        fs: {} as IFileSystemService,
        root: 'w2-props-root',
        path: 'notes/w2-props.md',
        initialSnapshot: { content: W2_SOURCE, revision: 'r1' },
        onLivePreviewWikiLinkClick: wikiClick,
        wikiLinkExists,
        wikiLinkRevision: 7,
        resolveImageSrc,
        imageRevision: 3,
        remoteImages: remoteImagesPolicy,
        remoteImageRevision: 9,
        onLivePreviewRemoteImageClick: remoteClick,
        onLivePreviewRemoteImageLoad: remoteLoad,
        onLivePreviewRemoteImageError: remoteError,
      },
    });
  });

  afterAll(() => {
    w2?.unmount();
    w2 = null;
    document.body.replaceChildren();
  });

  beforeEach(() => {
    openExternalUrlMock.mockReset();
    toastShowMock.mockReset();
    wikiClick.mockReset();
    remoteClick.mockClear();
    remoteLoad.mockClear();
    remoteError.mockClear();
  });

  /** 在 W2 挂载的左栏容器内派发真实冒泡点击，返回事件以断言 defaultPrevented。 */
  function clickInLeftPane(selector: string): MouseEvent {
    if (!w2) throw new Error('W2 挂载未就绪');
    const node = w2.find(`.review-left-render ${selector}`);
    expect(node.exists(), `左栏应含 ${selector}`).toBe(true);
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    node.element.dispatchEvent(event);
    return event;
  }

  it('左栏渲染吃满 options：wiki 死链判定 + 本地图重写 + 远程图本地化占位', () => {
    if (!w2) throw new Error('W2 挂载未就绪');
    const pane = w2.find('.review-left-render');
    // wikiLinkExists：主索引判定下沉——存在 → 活链；不存在 → 死链
    expect(pane.find('a[data-note="存在笔记"]').classes()).not.toContain('wikilink--dead');
    expect(pane.find('a[data-note="不存在笔记"]').classes()).toContain('wikilink--dead');
    // resolveImageSrc：本地图相对路径重写为 data: URL（修高危③ 改稿本地图 404）
    expect(pane.find(`img[src="${RESOLVED_SRC}"]`).exists()).toBe(true);
    // remoteImages：https 远程图渲染为带本地化 labels 与会话 scope 的占位
    const placeholder = pane.find('.remote-image-placeholder');
    expect(placeholder.exists()).toBe(true);
    expect(placeholder.text()).toContain('远程图已拦截');
    expect(placeholder.text()).toContain('来源: example.com');
    expect(pane.find('button[data-remote-image-scope="w2-scope"]').text()).toBe(
      '载入本笔记远程图片',
    );
  });

  it('wiki 链接（data-note）：透传宿主跳转回调，无受限 toast 不外抛', () => {
    const event = clickInLeftPane('a[data-note="存在笔记"]');

    expect(event.defaultPrevented).toBe(true);
    expect(wikiClick).toHaveBeenCalledOnce();
    expect(wikiClick).toHaveBeenCalledWith('存在笔记', '');
    expect(toastShowMock).not.toHaveBeenCalled();
    expect(openExternalUrlMock).not.toHaveBeenCalled();
  });

  it('远程图占位按钮：先交会话句柄裁决，返回 true 即收口', () => {
    clickInLeftPane('button[data-remote-image-scope="w2-scope"]');

    expect(remoteClick).toHaveBeenCalledOnce();
    expect(toastShowMock).not.toHaveBeenCalled();
    expect(openExternalUrlMock).not.toHaveBeenCalled();
  });

  it('load/error 不冒泡事件经捕获监听转发会话句柄', () => {
    if (!w2) throw new Error('W2 挂载未就绪');
    const img = w2.find(`.review-left-render img[src="${RESOLVED_SRC}"]`);
    img.element.dispatchEvent(new Event('load')); // 不冒泡：验证捕获态转发
    img.element.dispatchEvent(new Event('error'));

    expect(remoteLoad).toHaveBeenCalledOnce();
    expect(remoteError).toHaveBeenCalledOnce();
  });

  it('右栏 MarkdownEditor 全量透传渲染 props（与主编辑器同源）', () => {
    if (!w2) throw new Error('W2 挂载未就绪');
    const editor = w2.findComponent(MarkdownEditor);
    expect(editor.exists()).toBe(true);
    expect(editor.props('onLivePreviewWikiLinkClick')).toBe(wikiClick);
    expect(editor.props('wikiLinkExists')).toBe(wikiLinkExists);
    expect(editor.props('wikiLinkRevision')).toBe(7);
    expect(editor.props('resolveImageSrc')).toBe(resolveImageSrc);
    expect(editor.props('imageRevision')).toBe(3);
    // VTU props() 对对象值返回深响应代理（函数不被代理，故上方 toBe 可用），
    // 同一性必然丢失；toStrictEqual 走结构精确比较且 decide 仍按引用比对，语义不弱化
    expect(editor.props('remoteImages')).toStrictEqual(remoteImagesPolicy);
    expect(editor.props('remoteImageRevision')).toBe(9);
    expect(editor.props('onLivePreviewRemoteImageClick')).toBe(remoteClick);
    expect(editor.props('onLivePreviewRemoteImageLoad')).toBe(remoteLoad);
    expect(editor.props('onLivePreviewRemoteImageError')).toBe(remoteError);
    // L5：#tag 受限口径回调由 Workbench 自备（非宿主透传），与左栏 data-tag 同源
    expect(typeof editor.props('onLivePreviewTagClick')).toBe('function');
  });
});
