/**
 * 编辑器设置（设置页「编辑器 / 自动保存」六控件：字号/行高/Tab 宽度/自动换行/
 * 启用自动保存/保存延迟）。
 * 存储范式仿 reink-settings：localStorage + 自定义事件 + storage 事件跨窗口同步。
 * 键名带 :v1 版本位，载荷为 { version, settings } 结构化信封——结构演进时在
 * migrateEditorSettingsEnvelope 补迁移分支，不得原地改写旧字段语义。
 */

export interface EditorSettings {
  fontSize: number;
  lineHeight: number;
  tabSize: number;
  wordWrap: boolean;
  autoSaveEnabled: boolean;
  autoSaveDelay: number;
}

export const EDITOR_SETTINGS_KEY = 'jotluck:editor-settings:v1';
export const EDITOR_SETTINGS_EVENT = 'jotluck:editor-settings-changed';
/** 存储信封版本位（当前唯一版本；读到更高版本按损坏回落默认） */
export const EDITOR_SETTINGS_VERSION = 1;

/** 钳制边界与设置页滑杆/分段控件同源（min/max/step 保持一致） */
export const EDITOR_FONT_SIZE_MIN = 12;
export const EDITOR_FONT_SIZE_MAX = 24;
export const EDITOR_LINE_HEIGHT_MIN = 1.2;
export const EDITOR_LINE_HEIGHT_MAX = 2.5;
export const AUTOSAVE_DELAY_MIN = 500;
export const AUTOSAVE_DELAY_MAX = 10000;
export const AUTOSAVE_DELAY_DEFAULT = 600;

export const DEFAULT_EDITOR_SETTINGS: EditorSettings = {
  // 默认值对齐接线前实际行为，接线即生效但零突变：CM6 主题 16px、--lh-body 1.8、
  // indentUnit 默认 2 空格、lineWrapping 常开、自动保存常开且调度点 600ms 硬编码。
  fontSize: 16,
  lineHeight: 1.8,
  tabSize: 2,
  wordWrap: true,
  autoSaveEnabled: true,
  autoSaveDelay: AUTOSAVE_DELAY_DEFAULT,
};

/** 本地存储信封：version 位留给后续结构迁移 */
interface EditorSettingsEnvelope {
  version: number;
  settings: Partial<EditorSettings>;
}

export function getEditorSettings(): EditorSettings {
  const base = { ...DEFAULT_EDITOR_SETTINGS };
  try {
    const raw = localStorage.getItem(EDITOR_SETTINGS_KEY);
    if (!raw) return base;
    const migrated = migrateEditorSettingsEnvelope(JSON.parse(raw));
    return normalizeEditorSettings({ ...base, ...migrated });
  } catch {
    return base;
  }
}

export function saveEditorSettings(settings: EditorSettings): void {
  const normalized = normalizeEditorSettings(settings);
  localStorage.setItem(
    EDITOR_SETTINGS_KEY,
    JSON.stringify({ version: EDITOR_SETTINGS_VERSION, settings: normalized } satisfies {
      version: number;
      settings: EditorSettings;
    }),
  );
  emitEditorSettingsChanged(normalized);
}

export function updateEditorSettings(partial: Partial<EditorSettings>): EditorSettings {
  const next = normalizeEditorSettings({ ...getEditorSettings(), ...partial });
  saveEditorSettings(next);
  return next;
}

export function subscribeEditorSettings(listener: (settings: EditorSettings) => void): () => void {
  const handler = (event: Event) => {
    const custom = event as CustomEvent<EditorSettings>;
    listener(custom.detail ?? getEditorSettings());
  };
  window.addEventListener(EDITOR_SETTINGS_EVENT, handler);
  const storageHandler = (event: StorageEvent) => {
    if (event.key === EDITOR_SETTINGS_KEY) {
      listener(getEditorSettings());
    }
  };
  window.addEventListener('storage', storageHandler);
  return () => {
    window.removeEventListener(EDITOR_SETTINGS_EVENT, handler);
    window.removeEventListener('storage', storageHandler);
  };
}

export function emitEditorSettingsChanged(settings: EditorSettings): void {
  window.dispatchEvent(new CustomEvent(EDITOR_SETTINGS_EVENT, { detail: settings }));
}

/**
 * 版本迁移位：当前仅 v1。读到未知/更高版本（降级安装或手改损坏）时按
 * 无法解释处理，返回空对象回落默认值，绝不带着未理解的结构继续下发。
 */
function migrateEditorSettingsEnvelope(raw: unknown): Partial<EditorSettings> {
  if (typeof raw !== 'object' || raw === null) return {};
  const envelope = raw as Partial<EditorSettingsEnvelope>;
  if (envelope.version !== EDITOR_SETTINGS_VERSION) return {};
  const settings = envelope.settings;
  return typeof settings === 'object' && settings !== null ? settings : {};
}

/** 越界/非法输入一律钳回边界或默认，类型宽进严出 */
function normalizeEditorSettings(settings: EditorSettings): EditorSettings {
  return {
    fontSize: clampInt(settings.fontSize, EDITOR_FONT_SIZE_MIN, EDITOR_FONT_SIZE_MAX, 16),
    lineHeight: round1(
      clampNum(settings.lineHeight, EDITOR_LINE_HEIGHT_MIN, EDITOR_LINE_HEIGHT_MAX, 1.8),
    ),
    // 设置页仅提供 2/4 两档；其它值（缺省/非法）回落 2（接线前 Tab 实际宽度）
    tabSize: settings.tabSize === 4 ? 4 : 2,
    wordWrap: settings.wordWrap !== false,
    autoSaveEnabled: settings.autoSaveEnabled !== false,
    autoSaveDelay: clampInt(
      settings.autoSaveDelay,
      AUTOSAVE_DELAY_MIN,
      AUTOSAVE_DELAY_MAX,
      AUTOSAVE_DELAY_DEFAULT,
    ),
  };
}

function clampNum(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function clampInt(value: number, min: number, max: number, fallback: number): number {
  const clamped = clampNum(value, min, max, fallback);
  return Math.round(clamped);
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
