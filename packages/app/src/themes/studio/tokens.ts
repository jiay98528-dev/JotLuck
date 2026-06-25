import type { ThemeTokenSet } from '@/types/theme-pack';

/**
 * 工坊轨道 — OKLCH 色值覆盖。
 *
 * 紧凑生产桌面 + 暖橙操作强调
 */
export const tokens: ThemeTokenSet = {
  light: {
    '--paper-bg': 'oklch(0.965 0.004 215)',
    '--paper-left': 'oklch(0.94 0.008 220)',
    '--paper-surface': 'oklch(0.985 0.002 215)',
    '--paper-right': 'oklch(0.948 0.007 210)',
    '--ink-primary': 'oklch(0.16 0.006 220)',
    '--accent': 'oklch(0.5 0.12 28)',
    '--accent-hover': 'oklch(0.45 0.13 28)',
    '--accent-soft': 'oklch(0.92 0.045 28 / 0.55)',
    '--editor-max-width': '640px',
    '--topbar-height': '40px',
    '--statusbar-height': '26px',
    '--radius': '5px',
  },
  dark: {
    '--paper-bg': 'oklch(0.145 0.006 220)',
    '--paper-left': 'oklch(0.12 0.008 220)',
    '--paper-surface': 'oklch(0.18 0.006 220)',
    '--paper-right': 'oklch(0.14 0.008 210)',
    '--ink-primary': 'oklch(0.9 0.004 220)',
    '--accent': 'oklch(0.66 0.13 28)',
    '--accent-hover': 'oklch(0.72 0.13 28)',
    '--accent-soft': 'oklch(0.25 0.05 28 / 0.72)',
    '--editor-max-width': '640px',
    '--topbar-height': '40px',
    '--statusbar-height': '26px',
    '--radius': '5px',
  },
};
