/**
 * useThemeStore — 主题状态管理（单纸张主题：仅亮/暗色方案）
 *
 * M5-05: 颜色方案切换 (data-color-scheme)
 *
 * @see milestones.md M5-05
 */

import { defineStore } from 'pinia';
import { ref, computed } from 'vue';

export type ColorScheme = 'light' | 'dark';

/** LocalStorage key for theme persistence */
const STORAGE_KEY = 'markluck-theme';

export const useThemeStore = defineStore('theme', () => {
  const colorScheme = ref<ColorScheme>('light');

  // --- Computed ---

  /** Human-readable scheme label */
  const schemeLabel = computed(() => (colorScheme.value === 'light' ? '亮色' : '暗色'));

  // --- Actions ---

  /** Initialize color scheme from localStorage or system preference */
  function init(): void {
    // Try loading persisted color scheme from legacy or new storage
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as { c?: string };
        if (parsed.c === 'light' || parsed.c === 'dark') {
          colorScheme.value = parsed.c;
        }
      } catch {
        // Corrupted storage — fall through to system preference
      }
    }

    // If no saved preference, detect system color scheme
    if (!saved) {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      if (mq.matches) {
        colorScheme.value = 'dark';
      }
    }

    apply();
  }

  /** Apply current color scheme to DOM */
  function apply(): void {
    const root = document.documentElement;
    root.setAttribute('data-color-scheme', colorScheme.value);

    // Persist
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ c: colorScheme.value }));
  }

  /** Switch color scheme (light or dark) */
  function setColorScheme(c: ColorScheme): void {
    colorScheme.value = c;
    apply();
  }

  /** Toggle between light and dark */
  function toggleColorScheme(): void {
    colorScheme.value = colorScheme.value === 'light' ? 'dark' : 'light';
    apply();
  }

  // --- Initialization ---
  // init() called explicitly from ThemeSelector onMounted

  return {
    colorScheme,
    schemeLabel,
    init,
    apply,
    setColorScheme,
    toggleColorScheme,
  };
});
