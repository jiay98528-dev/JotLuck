import type { ThemeTokenSet } from '@/types/theme-pack';

/**
 * 墨线书房 — OKLCH 色值覆盖。
 *
 * 日间暖青纸 + 墨绿结构线 + 冷青强调色
 */
export const tokens: ThemeTokenSet = {
  light: {
    '--paper-bg': 'oklch(0.968 0.006 205)',
    '--paper-left': 'oklch(0.932 0.011 198)',
    '--paper-surface': 'oklch(0.989 0.003 190)',
    '--paper-right': 'oklch(0.948 0.008 186)',
    '--paper-raised': 'oklch(0.996 0.002 190)',
    '--ink-primary': 'oklch(0.18 0.018 205)',
    '--ink-secondary': 'oklch(0.42 0.016 198)',
    '--ink-muted': 'oklch(0.58 0.012 196)',
    '--accent': 'oklch(0.44 0.075 190)',
    '--accent-hover': 'oklch(0.38 0.085 190)',
    '--accent-soft': 'oklch(0.9 0.032 190 / 0.62)',
    '--rule': 'oklch(0.79 0.018 190)',
    '--rule-strong': 'oklch(0.67 0.024 190)',
    '--rule-wing': 'oklch(0.76 0.02 196)',
    '--editor-bg': 'oklch(0.985 0.003 190)',
    '--editor-line-highlight': 'oklch(0.95 0.012 190)',
    '--editor-max-width': '720px',
    '--lh-body': '1.82',
    '--radius': '3px',
    '--radius-md': '5px',
    '--shadow-sheet': '0 12px 30px oklch(0.42 0.025 190 / 0.1)',
  },
  dark: {
    '--paper-bg': 'oklch(0.14 0.012 210)',
    '--paper-left': 'oklch(0.115 0.014 208)',
    '--paper-surface': 'oklch(0.17 0.01 208)',
    '--paper-right': 'oklch(0.13 0.012 198)',
    '--paper-raised': 'oklch(0.205 0.011 205)',
    '--ink-primary': 'oklch(0.9 0.005 198)',
    '--ink-secondary': 'oklch(0.68 0.008 198)',
    '--ink-muted': 'oklch(0.52 0.008 198)',
    '--accent': 'oklch(0.68 0.08 184)',
    '--accent-hover': 'oklch(0.74 0.08 184)',
    '--accent-soft': 'oklch(0.28 0.038 184 / 0.74)',
    '--rule': 'oklch(0.29 0.014 205)',
    '--rule-strong': 'oklch(0.38 0.016 198)',
    '--rule-wing': 'oklch(0.25 0.014 205)',
    '--editor-bg': 'oklch(0.158 0.01 208)',
    '--editor-line-highlight': 'oklch(0.21 0.012 205)',
    '--editor-max-width': '720px',
    '--lh-body': '1.82',
    '--radius': '3px',
    '--radius-md': '5px',
    '--shadow-sheet': '0 18px 36px oklch(0.02 0.01 210 / 0.38)',
  },
};

/** 超出 Token 可表达的 CSS（选择器级样式） */
export const css = `
[data-theme-id='markluck.ink-study'] .app-shell {
  box-shadow:
    inset 1px 0 0 var(--rule-wing),
    inset -1px 0 0 var(--rule-wing);
}
[data-theme-id='markluck.ink-study'] .topbar {
  border-bottom-color: var(--rule-strong);
}
[data-theme-id='markluck.ink-study'] .markdown-body blockquote {
  border-color: var(--accent);
  background: var(--accent-soft);
}
[data-theme-id='markluck.ink-study'] .markdown-body table {
  border-color: var(--rule-strong);
}
[data-theme-id='markluck.ink-study'] .cm-editor .cm-cursor {
  border-left-color: var(--accent);
}
`;
