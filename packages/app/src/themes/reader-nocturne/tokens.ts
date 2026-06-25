import type { ThemeTokenSet } from '@/types/theme-pack';

/**
 * 夜读星幕 — OKLCH 色值覆盖。
 *
 * 纯深色固定 + 冷蓝强调 + 宽版心
 */
export const tokens: ThemeTokenSet = {
  light: {
    '--paper-bg': 'oklch(0.12 0.008 245)',
    '--paper-left': 'oklch(0.105 0.01 245)',
    '--paper-surface': 'oklch(0.155 0.008 250)',
    '--paper-right': 'oklch(0.12 0.01 232)',
    '--paper-raised': 'oklch(0.2 0.009 250)',
    '--ink-primary': 'oklch(0.9 0.004 250)',
    '--ink-secondary': 'oklch(0.69 0.006 245)',
    '--ink-muted': 'oklch(0.52 0.006 245)',
    '--accent': 'oklch(0.72 0.09 196)',
    '--accent-hover': 'oklch(0.78 0.09 196)',
    '--accent-soft': 'oklch(0.26 0.04 196 / 0.68)',
    '--rule': 'oklch(0.25 0.008 245)',
    '--rule-wing': 'oklch(0.22 0.009 245)',
    '--editor-bg': 'oklch(0.14 0.007 250)',
    '--editor-line-highlight': 'oklch(0.18 0.008 250)',
    '--editor-max-width': '780px',
    '--lh-body': '1.9',
  },
  dark: {
    '--paper-bg': 'oklch(0.12 0.008 245)',
    '--paper-left': 'oklch(0.105 0.01 245)',
    '--paper-surface': 'oklch(0.155 0.008 250)',
    '--paper-right': 'oklch(0.12 0.01 232)',
    '--paper-raised': 'oklch(0.2 0.009 250)',
    '--ink-primary': 'oklch(0.9 0.004 250)',
    '--ink-secondary': 'oklch(0.69 0.006 245)',
    '--ink-muted': 'oklch(0.52 0.006 245)',
    '--accent': 'oklch(0.72 0.09 196)',
    '--accent-hover': 'oklch(0.78 0.09 196)',
    '--accent-soft': 'oklch(0.26 0.04 196 / 0.68)',
    '--rule': 'oklch(0.25 0.008 245)',
    '--rule-wing': 'oklch(0.22 0.009 245)',
    '--editor-bg': 'oklch(0.14 0.007 250)',
    '--editor-line-highlight': 'oklch(0.18 0.008 250)',
    '--editor-max-width': '780px',
    '--lh-body': '1.9',
  },
};

export const css = `
[data-theme-id='markluck.reader-nocturne'] .markdown-body {
  font-size: 1.04rem;
}
`;
