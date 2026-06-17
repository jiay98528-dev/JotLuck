/**
 * useThemeStore — 纸张主题状态管理
 *
 * 单主题体系：仅亮/暗色方案切换。
 * 通过 data-color-scheme 属性在 <html> 上切换。
 *
 * @see migration-map.md §3
 */
import { defineStore } from 'pinia';
import { ref, computed } from 'vue';

export type ColorScheme = 'light' | 'dark';

const STORAGE_KEY = 'markluck-theme';

export const useThemeStore = defineStore('theme', () => {
  const colorScheme = ref<ColorScheme>('light');
  const initialized = ref(false);

  const schemeLabel = computed(() => (colorScheme.value === 'light' ? '亮色' : '暗色'));

  function init(): void {
    if (initialized.value) return;

    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as { c?: string };
        if (parsed.c === 'light' || parsed.c === 'dark') {
          colorScheme.value = parsed.c;
        }
      }
    } catch {
      // corrupted storage
    }

    if (!localStorage.getItem(STORAGE_KEY)) {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      if (mq.matches) colorScheme.value = 'dark';
    }

    apply();
    initialized.value = true;
  }

  function apply(): void {
    document.documentElement.setAttribute('data-color-scheme', colorScheme.value);
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ c: colorScheme.value }));
  }

  function setColorScheme(c: ColorScheme): void {
    colorScheme.value = c;
    apply();
  }

  function toggleColorScheme(): void {
    colorScheme.value = colorScheme.value === 'light' ? 'dark' : 'light';
    apply();
  }

  return { colorScheme, schemeLabel, initialized, init, apply, setColorScheme, toggleColorScheme };
});
