/**
 * Reink-1.0 引擎设置（本机接入，暂不进安装器）。
 * 存储范式仿 CompletionSettings：localStorage + 自定义事件 + storage 事件跨窗口同步。
 */

export type ReinkTier = '32m' | '64m';
/** fast = 宿主侧设置 suggestion_generator.N_CAND=8 / MAX_NEW=3（质量档还原 24/4）。 */
export type ReinkMode = 'fast' | 'quality';

export interface ReinkSettings {
  enabled: boolean;
  pythonPath: string;
  runtimeDir: string;
  tier: ReinkTier;
  mode: ReinkMode;
}

export const REINK_SETTINGS_KEY = 'jotluck:reink:settings';
export const REINK_SETTINGS_EVENT = 'jotluck:reink-settings-changed';

export const DEFAULT_REINK_SETTINGS: ReinkSettings = {
  // 装机默认关闭：Reink 依赖本机 python + 运行包，默认接管会造成
  // 「配置不可用却抢占公共槽位」的静默降级；用户显式开启才接管。
  enabled: false,
  pythonPath: 'python',
  // runtimeDir 不设装机默认（去个人路径）：留空由用户显式配置；
  // 空值 + 用户开启 → reink_configure 报错 → recoverWithDefault 兜底。
  runtimeDir: '',
  tier: '32m',
  mode: 'fast',
};

export function getReinkSettings(): ReinkSettings {
  const base = { ...DEFAULT_REINK_SETTINGS };
  try {
    const raw = localStorage.getItem(REINK_SETTINGS_KEY);
    const stored = raw ? (JSON.parse(raw) as Partial<ReinkSettings>) : {};
    return normalizeReinkSettings({ ...base, ...stored });
  } catch {
    return base;
  }
}

export function saveReinkSettings(settings: ReinkSettings): void {
  const normalized = normalizeReinkSettings(settings);
  localStorage.setItem(REINK_SETTINGS_KEY, JSON.stringify(normalized));
  emitReinkSettingsChanged(normalized);
}

export function updateReinkSettings(partial: Partial<ReinkSettings>): ReinkSettings {
  const next = normalizeReinkSettings({ ...getReinkSettings(), ...partial });
  saveReinkSettings(next);
  return next;
}

export function subscribeReinkSettings(listener: (settings: ReinkSettings) => void): () => void {
  const handler = (event: Event) => {
    const custom = event as CustomEvent<ReinkSettings>;
    listener(custom.detail ?? getReinkSettings());
  };
  window.addEventListener(REINK_SETTINGS_EVENT, handler);
  const storageHandler = (event: StorageEvent) => {
    if (event.key === REINK_SETTINGS_KEY) {
      listener(getReinkSettings());
    }
  };
  window.addEventListener('storage', storageHandler);
  return () => {
    window.removeEventListener(REINK_SETTINGS_EVENT, handler);
    window.removeEventListener('storage', storageHandler);
  };
}

export function emitReinkSettingsChanged(settings: ReinkSettings): void {
  window.dispatchEvent(new CustomEvent(REINK_SETTINGS_EVENT, { detail: settings }));
}

function normalizeReinkSettings(settings: ReinkSettings): ReinkSettings {
  const tier: ReinkTier = settings.tier === '64m' ? '64m' : '32m';
  const mode: ReinkMode = settings.mode === 'quality' ? 'quality' : 'fast';
  return {
    // 与 DEFAULT_REINK_SETTINGS.enabled=false 对齐：仅显式 true 视为开启，
    // 缺省/非法值一律回落关闭（缺省不得恒真接管）。
    enabled: settings.enabled === true,
    pythonPath:
      typeof settings.pythonPath === 'string' && settings.pythonPath.trim().length > 0
        ? settings.pythonPath
        : DEFAULT_REINK_SETTINGS.pythonPath,
    // 空串不回填默认值：runtimeDir 无装机默认，空值保留为空串，
    // 由 reink_configure 的报错链兜底（见 useReinkEngineSetup 的 recoverWithDefault）。
    runtimeDir:
      typeof settings.runtimeDir === 'string' && settings.runtimeDir.trim().length > 0
        ? settings.runtimeDir
        : '',
    tier,
    mode,
  };
}
