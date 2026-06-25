import type { ThemeTokenSet } from '@/types/theme-pack';

/**
 * 档案馆 — OKLCH 色值覆盖。
 *
 * 暖黄档案纸 + 绿色强调 + 宽面板
 */
export const tokens: ThemeTokenSet = {
  light: {
    '--paper-bg': 'oklch(0.965 0.006 76)',
    '--paper-left': 'oklch(0.94 0.014 82)',
    '--paper-surface': 'oklch(0.982 0.004 78)',
    '--paper-right': 'oklch(0.953 0.006 108)',
    '--paper-raised': 'oklch(0.995 0.002 78)',
    '--ink-primary': 'oklch(0.19 0.01 72)',
    '--ink-secondary': 'oklch(0.42 0.012 80)',
    '--accent': 'oklch(0.48 0.1 155)',
    '--accent-hover': 'oklch(0.43 0.11 155)',
    '--accent-soft': 'oklch(0.9 0.04 155 / 0.55)',
    '--editor-max-width': '740px',
    '--wing-right-width': '284px',
    '--drawer-width': '380px',
    '--radius': '4px',
    '--radius-md': '6px',
  },
  dark: {
    '--paper-bg': 'oklch(0.16 0.009 80)',
    '--paper-left': 'oklch(0.13 0.012 84)',
    '--paper-surface': 'oklch(0.19 0.008 78)',
    '--paper-right': 'oklch(0.16 0.01 120)',
    '--paper-raised': 'oklch(0.23 0.008 78)',
    '--ink-primary': 'oklch(0.88 0.006 78)',
    '--ink-secondary': 'oklch(0.66 0.008 86)',
    '--accent': 'oklch(0.66 0.11 155)',
    '--accent-hover': 'oklch(0.72 0.11 155)',
    '--accent-soft': 'oklch(0.28 0.045 155 / 0.7)',
    '--editor-max-width': '740px',
    '--wing-right-width': '284px',
    '--drawer-width': '380px',
    '--radius': '4px',
    '--radius-md': '6px',
  },
};

export const css = `
[data-theme-id='markluck.archive'] .app-shell {
  box-shadow: inset 64px 0 0 oklch(0.48 0.04 104 / 0.065);
}
`;
