/**
 * useConversionAssets — 文档导入资产图的 object URL 生命周期收口。
 *
 * 链路：readAsset（Rust 二进制回流 → Uint8Array，见 windowSession
 * readDocumentConversionAssetBytes）→ Blob 包装（零拷贝）→
 * URL.createObjectURL 短引用 → 页面渲染时只拼接短串；换代（重转）/卸载时
 * reset() 统一 revokeObjectURL。落盘 markdown 仍是 jotluck-asset:// 占位符。
 *
 * 关注点刻意收拢于此：世代守卫（晚到读写不污染）、在飞去重、pending 队列
 * （conversionId 就位前的 asset 事件缓存）、失败登记与 revision 信号（固定
 * 窗口合并：资产各自独立 IPC 回流、跨微任务落定，Vue watch 无法跨 flush
 * 合并，逐资产 bump 即逐资产全量重渲染 O(assets×content)），页面只保留
 * 「占位符替换 + 失败转警告」的呈现职责。
 */

/** revision 合并窗口（毫秒）：窗口内任意多次就绪/失败登记只 bump 一次。
 *  固定窗口而非防抖后移——资产流持续到达时防抖会无限推迟首图渲染。 */
const REVISION_COALESCE_WINDOW_MS = 150;
import { ref, type Ref } from 'vue';

/** worker asset 事件的页面侧关注面（与 DocumentConversionEvent asset 分支同形）。 */
export interface ConversionAssetEvent {
  assetId: string;
  fileName: string;
  mediaType: string;
  bytes: number;
}

/**
 * 读取资产字节的服务收口（注入 windowSession.readDocumentConversionAssetBytes）。
 * ArrayBuffer-backed：object URL 的 Blob 包装依赖 BlobPart 不收 SAB 视图。
 */
export type ConversionAssetReader = (
  conversionId: string,
  assetId: string,
) => Promise<Uint8Array<ArrayBuffer>>;

export interface UseConversionAssetsOptions {
  readAsset: ConversionAssetReader;
  /** 当前转换世代读取器（页面闭包读 conversionGeneration；晚到的读写据此丢弃）。 */
  getGeneration: () => number;
  /** 当前世代内读取失败回调（页面推 warnings；晚到失败不触发）。 */
  onAssetFailed: (assetId: string, fileName: string, error: unknown) => void;
}

export interface ConversionAssetsSession {
  /** URL 集修订号：资产就绪/失败登记经 150ms 固定窗口合并后自增（窗口内
   *  多次登记只加一），页面据此触发重渲染。 */
  revision: Ref<number>;
  /** 资产 id → object URL；未就绪/已失败/已撤销返回 null。 */
  resolve: (assetId: string) => string | null;
  /** 该资产是否读取失败（loading 占位与失败占位分流）。 */
  hasFailed: (assetId: string) => boolean;
  /** conversionId 未就位时缓存 asset 事件（worker 事件可能先于 IPC 返回到达）。 */
  enqueueAsset: (event: ConversionAssetEvent) => void;
  /** conversionId 就位后批量发起缓存队列的读取。 */
  flushPendingAssets: (conversionId: string) => void;
  /** 读字节 → Blob → objectURL → 登记；含世代守卫与在飞/已就绪去重。 */
  loadAsset: (event: ConversionAssetEvent, conversionId: string) => Promise<void>;
  /** 撤销全部 object URL 并清空状态（重转/卸载）；幂等。 */
  reset: () => void;
}

/**
 * URL API 调用点动态读 globalThis：不在模块加载期捕获引用，宿主差异与
 * 测试注桩（jsdom 29.1.1 实证缺失 createObjectURL/revokeObjectURL）都以
 * 调用时取值为准。
 */
function mintObjectUrl(bytes: Uint8Array<ArrayBuffer>, mediaType: string): string {
  const api = (globalThis as { URL?: typeof URL }).URL;
  if (!api || typeof api.createObjectURL !== 'function') {
    throw new Error('URL.createObjectURL unavailable in this host.');
  }
  return api.createObjectURL(new Blob([bytes], { type: mediaType }));
}

function revokeObjectUrl(url: string): void {
  // 缺失时无从撤销（该宿主也无从 mint）；不因 teardown 路径抛错阻断页面。
  const api = (globalThis as { URL?: { revokeObjectURL?: (url: string) => void } }).URL;
  api?.revokeObjectURL?.(url);
}

export function useConversionAssets(options: UseConversionAssetsOptions): ConversionAssetsSession {
  const revision = ref(0);
  const urls = new Map<string, string>();
  const failed = new Set<string>();
  const inflight = new Set<string>();
  const pending: ConversionAssetEvent[] = [];
  let revisionTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * revision 的固定窗口 trailing 合并：首个就绪/失败开窗，窗口到期统一 bump
   * 一次（渲染时 resolve() 直读 urls Map，故窗口内已 mint 的 URL 会被本次
   * bump 全部捞起；末次 bump 兜底最终一致）。reset() 取消未决 bump，避免
   * 卸载/换代后触发多余渲染。
   */
  function scheduleRevisionBump(): void {
    if (revisionTimer !== null) return;
    revisionTimer = setTimeout(() => {
      revisionTimer = null;
      revision.value += 1;
    }, REVISION_COALESCE_WINDOW_MS);
  }

  async function loadAsset(event: ConversionAssetEvent, conversionId: string): Promise<void> {
    const { assetId } = event;
    // 在飞去重（双事件并发）与已就绪去重（同 id 重复事件不再 mint，防旧 URL 泄漏）；
    // 失败资产不拦：重试语义保留。
    if (urls.has(assetId) || inflight.has(assetId)) return;
    inflight.add(assetId);
    const startedGeneration = options.getGeneration();
    try {
      const bytes = await options.readAsset(conversionId, assetId);
      // bytes 在手即 mint（短串），世代守卫在其后：翻页后到达的成功必须立即
      // 撤销刚 mint 的引用，防止 object URL 泄漏；不写集、不触发失败回调。
      const url = mintObjectUrl(bytes, event.mediaType);
      if (startedGeneration !== options.getGeneration()) {
        revokeObjectUrl(url);
        return;
      }
      urls.set(assetId, url);
      failed.delete(assetId);
      scheduleRevisionBump();
    } catch (error) {
      // 世代守卫：失败属于已被弃用的转换（重转/取消/卸载竞态）时，不得污染当前预览。
      if (startedGeneration !== options.getGeneration()) return;
      failed.add(assetId);
      options.onAssetFailed(assetId, event.fileName, error);
      scheduleRevisionBump();
    } finally {
      inflight.delete(assetId);
    }
  }

  return {
    revision,
    resolve(assetId) {
      return urls.get(assetId) ?? null;
    },
    hasFailed(assetId) {
      return failed.has(assetId);
    },
    enqueueAsset(event) {
      pending.push(event);
    },
    flushPendingAssets(conversionId) {
      for (const event of pending.splice(0)) void loadAsset(event, conversionId);
    },
    loadAsset,
    reset() {
      // 未决 bump 随世代一并作废：晚到的定时器触发只会在卸载/换代后引发
      // 一次多余渲染（页面 watch 虽有 content 守卫，仍应在此源头掐断）。
      if (revisionTimer !== null) {
        clearTimeout(revisionTimer);
        revisionTimer = null;
      }
      for (const url of urls.values()) revokeObjectUrl(url);
      urls.clear();
      failed.clear();
      inflight.clear();
      pending.splice(0);
    },
  };
}
