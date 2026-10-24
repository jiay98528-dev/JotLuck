/**
 * object URL 测试注桩。
 *
 * jsdom 29.1.1 实证缺失 URL.createObjectURL/revokeObjectURL（Blob 存在），
 * object URL 生命周期测试必须显式注桩：替换 globalThis.URL 两个方法，URL
 * 形如 blob:mock-N（可断言，且能穿过渲染清洗器的 blob: 字符类校验）。
 * 被测代码须在调用点动态读 globalThis.URL 才能命中本桩。
 */
import { vi, type Mock } from 'vitest';

type ObjectUrlCtor = typeof URL;

export interface ObjectUrlStub {
  /** mint 调用序登记（blob:mock-N 递增）。 */
  created: string[];
  /** revoke 调用序登记。 */
  revoked: string[];
  /** 仍存活（已 mint 未 revoke）的 URL 集合。 */
  live: Set<string>;
  createSpy: Mock<() => string>;
  revokeSpy: Mock<(url: string) => void>;
  /** 恢复注桩前原状（原实现缺失则删除方法）。 */
  restore: () => void;
}

export function installObjectUrlStub(): ObjectUrlStub {
  const urlCtor = (globalThis as { URL: ObjectUrlCtor }).URL;
  const originalCreate = urlCtor.createObjectURL;
  const originalRevoke = urlCtor.revokeObjectURL;

  const created: string[] = [];
  const revoked: string[] = [];
  const live = new Set<string>();
  let counter = 0;
  const createSpy = vi.fn((): string => {
    counter += 1;
    const url = `blob:mock-${counter}`;
    created.push(url);
    live.add(url);
    return url;
  });
  const revokeSpy = vi.fn((url: string): void => {
    revoked.push(url);
    live.delete(url);
  });

  urlCtor.createObjectURL = createSpy as ObjectUrlCtor['createObjectURL'];
  urlCtor.revokeObjectURL = revokeSpy as ObjectUrlCtor['revokeObjectURL'];

  return {
    created,
    revoked,
    live,
    createSpy,
    revokeSpy,
    restore() {
      const mutable = urlCtor as {
        createObjectURL?: ObjectUrlCtor['createObjectURL'];
        revokeObjectURL?: ObjectUrlCtor['revokeObjectURL'];
      };
      if (originalCreate) urlCtor.createObjectURL = originalCreate;
      else delete mutable.createObjectURL;
      if (originalRevoke) urlCtor.revokeObjectURL = originalRevoke;
      else delete mutable.revokeObjectURL;
    },
  };
}
