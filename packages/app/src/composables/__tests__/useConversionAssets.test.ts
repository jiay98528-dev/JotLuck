import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useConversionAssets, type ConversionAssetEvent } from '../useConversionAssets';
import { installObjectUrlStub, type ObjectUrlStub } from '../../test/object-url-stub';

function makeAssetEvent(assetId: string, fileName = `${assetId}.png`): ConversionAssetEvent {
  return { assetId, fileName, mediaType: 'image/png', bytes: 4 };
}

function makeSession() {
  let generation = 1;
  const readAsset = vi.fn(async () => new Uint8Array([1, 2, 3]));
  const onAssetFailed = vi.fn();
  const session = useConversionAssets({
    readAsset,
    getGeneration: () => generation,
    onAssetFailed,
  });
  return {
    session,
    readAsset,
    onAssetFailed,
    bumpGeneration: () => {
      generation += 1;
    },
  };
}

describe('useConversionAssets', () => {
  let urlStub: ObjectUrlStub;

  beforeEach(() => {
    // jsdom 29.1.1 实证缺失 URL.createObjectURL/revokeObjectURL：必须显式注桩。
    urlStub = installObjectUrlStub();
  });

  afterEach(() => {
    urlStub.restore();
  });

  it('mints one object URL and bumps revision once for duplicate asset events', async () => {
    const { session, readAsset } = makeSession();
    const event = makeAssetEvent('asset-1');

    // 并发双事件：在飞去重。
    const first = session.loadAsset(event, 'conv-1');
    const second = session.loadAsset(makeAssetEvent('asset-1'), 'conv-1');
    await Promise.all([first, second]);
    // 已就绪后的重复事件：不再 mint（旧 URL 不得被覆盖泄漏）。
    await session.loadAsset(makeAssetEvent('asset-1'), 'conv-1');

    expect(readAsset).toHaveBeenCalledTimes(1);
    expect(urlStub.created).toEqual(['blob:mock-1']);
    expect(session.resolve('asset-1')).toBe('blob:mock-1');
    expect(urlStub.live).toEqual(new Set(['blob:mock-1']));
    // revision 经合并窗口异步自增：重复事件最终仍只 bump 一次。
    await vi.waitFor(() => expect(session.revision.value).toBe(1));
  });

  it('revokes every object URL on reset (generation change) and clears resolution', async () => {
    const { session } = makeSession();
    await session.loadAsset(makeAssetEvent('asset-1'), 'conv-1');
    await session.loadAsset(makeAssetEvent('asset-2'), 'conv-1');
    expect(urlStub.created).toEqual(['blob:mock-1', 'blob:mock-2']);

    session.reset();

    expect(urlStub.revoked).toEqual(['blob:mock-1', 'blob:mock-2']);
    expect(urlStub.live).toEqual(new Set());
    expect(session.resolve('asset-1')).toBeNull();
    expect(session.resolve('asset-2')).toBeNull();
  });

  it('reset is idempotent along the onBeforeUnmount path', async () => {
    const { session } = makeSession();
    await session.loadAsset(makeAssetEvent('asset-1'), 'conv-1');

    session.reset();
    session.reset();

    // 幂等：同一 URL 只 revoke 一次，无重复撤销副作用。
    expect(urlStub.revoked).toEqual(['blob:mock-1']);
    expect(urlStub.createSpy).toHaveBeenCalledTimes(1);
  });

  it('revokes a late-minted URL immediately when the generation flipped mid-read', async () => {
    const { session, readAsset, onAssetFailed, bumpGeneration } = makeSession();
    let resolveRead: ((bytes: Uint8Array<ArrayBuffer>) => void) | undefined;
    readAsset.mockImplementation(
      () =>
        new Promise<Uint8Array<ArrayBuffer>>((resolve) => {
          resolveRead = resolve;
        }),
    );

    const pending = session.loadAsset(makeAssetEvent('asset-1'), 'conv-1');
    expect(resolveRead).toBeDefined();
    // 读取未决时世代翻页（用户取消/重转）：读取完成后才到达的结果属于弃用世代。
    bumpGeneration();
    resolveRead?.(new Uint8Array([1]));
    await pending;

    // 刚 mint 的 URL 被立即 revoke；不写 URL 集、revision 不动、失败回调不触发。
    expect(urlStub.created).toEqual(['blob:mock-1']);
    expect(urlStub.revoked).toEqual(['blob:mock-1']);
    expect(urlStub.live).toEqual(new Set());
    expect(session.resolve('asset-1')).toBeNull();
    expect(session.revision.value).toBe(0);
    expect(onAssetFailed).not.toHaveBeenCalled();
  });

  it('marks failures and reports them through onAssetFailed', async () => {
    const { session, readAsset, onAssetFailed } = makeSession();
    const failure = new Error('asset gone');
    readAsset.mockRejectedValue(failure);

    await session.loadAsset(makeAssetEvent('asset-1', 'image1.png'), 'conv-1');

    expect(session.hasFailed('asset-1')).toBe(true);
    expect(session.resolve('asset-1')).toBeNull();
    expect(onAssetFailed).toHaveBeenCalledTimes(1);
    expect(onAssetFailed).toHaveBeenCalledWith('asset-1', 'image1.png', failure);
  });

  it('swallows late failures from a superseded generation without notifying the host', async () => {
    const { session, readAsset, onAssetFailed, bumpGeneration } = makeSession();
    let rejectRead: ((error: Error) => void) | undefined;
    readAsset.mockImplementation(
      () =>
        new Promise<Uint8Array<ArrayBuffer>>((_resolve, reject) => {
          rejectRead = reject;
        }),
    );

    const pending = session.loadAsset(makeAssetEvent('asset-1'), 'conv-1');
    bumpGeneration();
    rejectRead?.(new Error('late failure'));
    await pending;

    expect(onAssetFailed).not.toHaveBeenCalled();
    expect(session.hasFailed('asset-1')).toBe(false);
    expect(session.revision.value).toBe(0);
  });

  it('buffers asset events until flush and then starts the reads in batch', async () => {
    const { session, readAsset } = makeSession();

    session.enqueueAsset(makeAssetEvent('asset-1'));
    session.enqueueAsset(makeAssetEvent('asset-2'));
    expect(readAsset).not.toHaveBeenCalled();

    session.flushPendingAssets('conv-9');
    await vi.waitFor(() => expect(urlStub.created).toHaveLength(2));

    expect(readAsset).toHaveBeenCalledWith('conv-9', 'asset-1');
    expect(readAsset).toHaveBeenCalledWith('conv-9', 'asset-2');
    expect(session.resolve('asset-1')).toBe('blob:mock-1');
    expect(session.resolve('asset-2')).toBe('blob:mock-2');
    // 批量 flush 的读取同窗完成：合并为一次 revision bump（全量重渲染收敛点）。
    await vi.waitFor(() => expect(session.revision.value).toBe(1));
  });

  it('coalesces bursts inside one window and reopens the window for later assets', async () => {
    vi.useFakeTimers();
    try {
      const { session } = makeSession();
      await session.loadAsset(makeAssetEvent('asset-1'), 'conv-1');
      expect(session.revision.value).toBe(0);
      // 同窗内第二个资产就绪：不重开窗、不提前 bump。
      await session.loadAsset(makeAssetEvent('asset-2'), 'conv-1');
      expect(session.revision.value).toBe(0);
      vi.advanceTimersByTime(149);
      expect(session.revision.value).toBe(0);
      vi.advanceTimersByTime(1);
      // 两个就绪合并为一次 bump；渲染时 resolve() 直读 urls，两个 URL 均可捞起。
      expect(session.revision.value).toBe(1);
      expect(session.resolve('asset-1')).toBe('blob:mock-1');
      expect(session.resolve('asset-2')).toBe('blob:mock-2');

      // 窗口关闭后的新就绪重新开窗，再次 bump。
      await session.loadAsset(makeAssetEvent('asset-3'), 'conv-1');
      vi.advanceTimersByTime(150);
      expect(session.revision.value).toBe(2);
      expect(session.resolve('asset-3')).toBe('blob:mock-3');
    } finally {
      vi.useRealTimers();
    }
  });

  it('cancels the pending revision bump on reset so teardown fires no extra render', async () => {
    vi.useFakeTimers();
    try {
      const { session } = makeSession();
      await session.loadAsset(makeAssetEvent('asset-1'), 'conv-1');
      expect(session.revision.value).toBe(0);

      session.reset();
      vi.advanceTimersByTime(1000);

      expect(session.revision.value).toBe(0);
      expect(urlStub.revoked).toEqual(['blob:mock-1']);
    } finally {
      vi.useRealTimers();
    }
  });
});
