import { ref } from 'vue';

export type OsPlatform = 'macos' | 'windows' | 'linux';

/**
 * 当前平台响应式镜像（默认 windows 语义）。零依赖（不触碰
 * @tauri-apps/api）：i18n postTranslation 与 vitest setupFiles 都会在
 * 平台 mock 注册前加载本模块——保持纯 vue 依赖可让 setup 链不缓存
 * 桌面 API 绑定，测试文件级 vi.mock 依然生效。由 runtime.ts 的
 * getOsPlatform() 完成解析后写入。
 */
export const currentPlatform = ref<OsPlatform>('windows');
