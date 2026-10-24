/**
 * object-urls — object URL mint/revoke 单点小工具。
 *
 * URL API 调用点动态读 globalThis：不在模块加载期捕获引用，宿主差异与
 * 测试注桩（jsdom 29.1.1 实证缺失 createObjectURL/revokeObjectURL）都以
 * 调用时取值为准（先例 useConversionAssets，现收拢单点供两条资产链共用）。
 */

/**
 * bytes → Blob（零拷贝收编 ArrayBuffer-backed 视图，TS 5.7+ BlobPart 不收
 * SAB 视图）→ URL.createObjectURL 短引用。宿主缺失 API 时抛错（fail-fast，
 * 调用方按读取失败处理，不产出半成品 URL）。
 */
export function mintObjectUrl(bytes: Uint8Array<ArrayBuffer>, mediaType: string): string {
  const api = (globalThis as { URL?: typeof URL }).URL;
  if (!api || typeof api.createObjectURL !== 'function') {
    throw new Error('URL.createObjectURL unavailable in this host.');
  }
  return api.createObjectURL(new Blob([bytes], { type: mediaType }));
}

/** 撤销 object URL；缺失时无从撤销（该宿主也无从 mint），不因 teardown 抛错。 */
export function revokeObjectUrl(url: string): void {
  const api = (globalThis as { URL?: { revokeObjectURL?: (url: string) => void } }).URL;
  api?.revokeObjectURL?.(url);
}
