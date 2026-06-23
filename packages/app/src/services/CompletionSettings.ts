export type CompletionAggressiveness = 'balanced';

export interface CompletionSettings {
  enabled: boolean;
  aggressiveness: CompletionAggressiveness;
  backgroundTraining: boolean;
  maxSuggestionLength: number;
  minConfidence: number;
  showDebugStats: boolean;
}

export const COMPLETION_SETTINGS_KEY = 'markluck:autocomplete:settings';
export const LEGACY_AUTOCOMPLETE_ENABLED_KEY = 'markluck:autocomplete:enabled';
export const COMPLETION_SETTINGS_EVENT = 'markluck:completion-settings-changed';

export const DEFAULT_COMPLETION_SETTINGS: CompletionSettings = {
  enabled: true,
  aggressiveness: 'balanced',
  backgroundTraining: true,
  maxSuggestionLength: 12,
  minConfidence: 0.18,
  showDebugStats: false,
};

export function getCompletionSettings(): CompletionSettings {
  const base = { ...DEFAULT_COMPLETION_SETTINGS };
  try {
    const raw = localStorage.getItem(COMPLETION_SETTINGS_KEY);
    const legacyEnabled = localStorage.getItem(LEGACY_AUTOCOMPLETE_ENABLED_KEY);
    const stored = raw ? (JSON.parse(raw) as Partial<CompletionSettings>) : {};
    return normalizeSettings({
      ...base,
      ...stored,
      enabled:
        stored.enabled ?? (legacyEnabled === null ? base.enabled : legacyEnabled !== 'false'),
    });
  } catch {
    return base;
  }
}

export function saveCompletionSettings(settings: CompletionSettings): void {
  const normalized = normalizeSettings(settings);
  localStorage.setItem(COMPLETION_SETTINGS_KEY, JSON.stringify(normalized));
  localStorage.setItem(LEGACY_AUTOCOMPLETE_ENABLED_KEY, String(normalized.enabled));
  emitCompletionSettingsChanged(normalized);
}

export function updateCompletionSettings(partial: Partial<CompletionSettings>): CompletionSettings {
  const next = normalizeSettings({ ...getCompletionSettings(), ...partial });
  saveCompletionSettings(next);
  return next;
}

export function subscribeCompletionSettings(
  listener: (settings: CompletionSettings) => void,
): () => void {
  const handler = (event: Event) => {
    const custom = event as CustomEvent<CompletionSettings>;
    listener(custom.detail ?? getCompletionSettings());
  };
  window.addEventListener(COMPLETION_SETTINGS_EVENT, handler);
  const storageHandler = (event: StorageEvent) => {
    if (event.key === COMPLETION_SETTINGS_KEY || event.key === LEGACY_AUTOCOMPLETE_ENABLED_KEY) {
      listener(getCompletionSettings());
    }
  };
  window.addEventListener('storage', storageHandler);
  return () => {
    window.removeEventListener(COMPLETION_SETTINGS_EVENT, handler);
    window.removeEventListener('storage', storageHandler);
  };
}

export function emitCompletionSettingsChanged(settings: CompletionSettings): void {
  window.dispatchEvent(new CustomEvent(COMPLETION_SETTINGS_EVENT, { detail: settings }));
}

function normalizeSettings(settings: CompletionSettings): CompletionSettings {
  return {
    enabled: settings.enabled !== false,
    aggressiveness: 'balanced',
    backgroundTraining: settings.backgroundTraining !== false,
    maxSuggestionLength: clampInt(settings.maxSuggestionLength, 4, 24, 12),
    minConfidence: clampNumber(settings.minConfidence, 0.05, 0.8, 0.18),
    showDebugStats: import.meta.env.DEV && settings.showDebugStats === true,
  };
}

function clampInt(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.round(value)));
}

function clampNumber(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}
