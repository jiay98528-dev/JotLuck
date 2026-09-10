import { ref } from 'vue';

export type PlatformOS = 'windows' | 'macos' | 'linux';

/**
 * 平台信号（响应式镜像，默认 windows）。独立成零依赖模块（不触碰
 * @tauri-apps/api）：i18n postTranslation 与 vitest setupFiles 会在平台
 * mock 注册前加载本模块——保持纯 vue 依赖可让 setup 链不固化桌面 API
 * 绑定（测试文件级 vi.mock 依然生效）。由 utils/platform.ts 的
 * initializePlatform() 解析后写入。
 */
export const currentPlatformOS = ref<PlatformOS>('windows');
