import { afterAll, beforeAll, describe, expect, it, vi, type MockInstance } from 'vitest';
import { mount, type VueWrapper } from '@vue/test-utils';
import { createPinia } from 'pinia';
import { MockFSService } from '@/services/MockFSService';
import type { JotLuckE2EBridge, JotLuckE2EOpenedFile } from '@/utils/e2e-bridge';
import { installObjectUrlStub, type ObjectUrlStub } from '../../test/object-url-stub';
import NotebookHome from '../NotebookHome.vue';

/**
 * 外部只读壳（NotebookHome isExternalReadonly）本地图断链回归测试（修复①）。
 *
 * 缺陷形态：非大文档外部只读态消费 externalPreviewHtml（v-html），而
 * usePreviewImageResolver 的 imageRevision 翻页只触发 split 预览刷新——
 * 本地图 load 完成后外部只读面永不重渲染，且 setNotePath 清缓存后的首屏
 * 渲染发生在正确笔记路径生效前，连 load 都不发起（图恒裂）。
 *
 * 修复口径：imageRevision watch 在 isExternalReadonly 时调用 updateExternalPreview
 * （与大文档 :revision 含 imageRevision 的 ProgressivePreview 范式对齐）。
 * 本用例走真实挂载链路断言：readExternalAsset 发起（二进制 Uint8Array 回流）
 * → Blob objectURL 出现在外部只读 article 内（渲染面须显式放行 blob:）。
 * 红 = 回归（watch 分流断裂或首屏 load 链断裂或 blob 放行缺口）。
 */

// vitest MODE 非 e2e，peekJotLuckE2EBridge 原实现恒 null；部分 mock 固定回
// 测试夹具（页面经此读取 mockOpenedFile / externalFiles / mockNotebook）。
const bridgeHolder = vi.hoisted((): { bridge: JotLuckE2EBridge | null } => ({ bridge: null }));
vi.mock('@/utils/e2e-bridge', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/e2e-bridge')>();
  return {
    ...actual,
    peekJotLuckE2EBridge: () => bridgeHolder.bridge,
  };
});
const routerReplaceMock = vi.hoisted(() => vi.fn());
vi.mock('vue-router', () => ({ useRouter: () => ({ replace: routerReplaceMock }) }));

const NOTE_ABSOLUTE_PATH = 'D:/notes/外部图.md';
const NOTE_CONTENT = '# 外部图\n\n![本地图](pic.png)\n';
/** 'pix' 字节：对齐桌面端 tauri::ipc::Response 二进制回流契约。 */
const ASSET_BYTES = new Uint8Array([0x70, 0x69, 0x78]);

describe('NotebookHome 外部只读壳本地图渲染链（imageRevision → externalPreviewHtml）', () => {
  let wrapper: VueWrapper | null = null;
  let readExternalAssetSpy: MockInstance<typeof MockFSService.prototype.readExternalAsset>;
  let urlStub: ObjectUrlStub;

  beforeAll(() => {
    // jsdom 缺失 URL.createObjectURL/revokeObjectURL：外部会话资产图经 Blob
    // mint objectURL，必须显式注桩（blob:mock-1 形态可穿过清洗器字符类校验）。
    urlStub = installObjectUrlStub();
    // accessToken 不在 JotLuckE2EOpenedFile 类型面（桥接类型未声明），但页面
    // normalizeOpenedFilePayload 运行时会消费 record.accessToken——本地图经
    // usePreviewImageResolver 分流到 readExternalAsset 依赖它，交集类型保留。
    bridgeHolder.bridge = {
      mockOpenedFile: {
        absolutePath: NOTE_ABSOLUTE_PATH,
        notebookRoot: 'D:/notes/',
        relativePath: '/外部图.md',
        accessToken: 'token-1',
      } as JotLuckE2EOpenedFile & { accessToken: string },
      externalFiles: { [NOTE_ABSOLUTE_PATH]: NOTE_CONTENT },
    };
    // Web 运行时 fs 即 MockFSService；原型 spy 在页面自建实例前就位，
    // 命中即证明「首屏渲染后主动发起资产读取」这半条链路。
    readExternalAssetSpy = vi
      .spyOn(MockFSService.prototype, 'readExternalAsset')
      .mockResolvedValue(ASSET_BYTES);
    wrapper = mount(NotebookHome, {
      global: {
        plugins: [createPinia()],
        stubs: {
          // 声明全部传入 attrs 为 props，避免 fragment 根组件的落透告警噪音
          ThemeSlotBoundary: {
            props: ['slotId', 'themeId', 'recipe', 'actions', 'slotProps'],
            template: '<slot />',
          },
        },
      },
    });
  });

  afterAll(() => {
    wrapper?.unmount();
    wrapper = null;
    readExternalAssetSpy.mockRestore();
    bridgeHolder.bridge = null;
    urlStub.restore();
    document.body.replaceChildren();
  });

  it('外部只读态：资产读取发起且 imageRevision 翻页驱动 externalPreviewHtml 换出 blob:URL', async () => {
    if (!wrapper) throw new Error('挂载未就绪');
    // 启动链：mockOpenedFile → initNotebook → enterExternalFileSession → 外部只读壳渲染
    await vi.waitFor(() => {
      expect(wrapper!.find('.external-reader').exists()).toBe(true);
      expect(wrapper!.find('.external-preview').exists()).toBe(true);
    });

    // 断言一（load 发起链）：对笔记相对图 pic.png 发起 readExternalAsset——
    // 首屏渲染时 setNotePath 尚未生效，若缺失主动加载链，此处红。
    await vi.waitFor(() => {
      expect(
        readExternalAssetSpy.mock.calls.some(([, relativePath]) =>
          String(relativePath).endsWith('/pic.png'),
        ),
        '应对笔记相对图 pic.png 发起 readExternalAsset（首屏后主动加载链）',
      ).toBe(true);
    });

    // 断言二（revision 回灌链）：load 完成 → imageRevision++ → watch 分流
    // updateExternalPreview → article 换出 blob:URL src（objectURL 零拷贝形态，
    // 渲染面经 allowBlobImageSources 显式放行）。无 watch 分流或放行缺口时红。
    await vi.waitFor(() => {
      const img = wrapper!.find('.external-preview img[alt="本地图"]');
      expect(img.exists(), '外部只读 article 应渲染出本地图 <img>').toBe(true);
      expect(img.attributes('src')).toBe('blob:mock-1');
    });
  });
});
