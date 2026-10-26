import { beforeEach } from 'vitest';
import { config } from '@vue/test-utils';
import { getI18nPlugin, setLocale } from '@/i18n';

config.global.plugins = [getI18nPlugin()];

// jsdom 不实现 ResizeObserver：整页挂载经异步组件拉起 MarkdownCheatSheet 等
// 裸用 new ResizeObserver 的组件时，异常落在 post-flush 微任务边界上，以未
// 处理 rejection 打红整轮 vitest。全局补最小 stub，真实测量由浏览器承担；
// 文件内 vi.stubGlobal 仍可按需覆盖（restore 后回到本 stub）。
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof ResizeObserver;
}

beforeEach(async () => {
  await setLocale('zh-CN', { persist: false });
});
