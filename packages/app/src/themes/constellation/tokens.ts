import type { ThemeTokenSet } from '@/types/theme-pack';

/**
 * Constellation 群星 — NASA 朋克（扁平哑光）。
 *
 * 材质语言：哑光乳白高分子舱体上，所有面板都是平整的哑光平面，只靠明暗
 * 阶梯与 1px 发丝刻线分区——不用浮雕阴影、渐变或纹理。国际橙只做关键
 * 强调，冰蓝专供链接。几何语言：2/4/6px 小圆角、等宽微标签、克制留白。
 */
export const tokens: ThemeTokenSet = {
  /* ── 舱体高分子（暖白，明暗阶梯表达层级） ─────────────────── */
  '--paper-bg': 'oklch(0.925 0.008 95)',
  '--paper-left': 'oklch(0.918 0.008 95)',
  '--paper-surface': 'oklch(0.945 0.006 95)',
  '--paper-right': 'oklch(0.918 0.008 95)',
  '--paper-raised': 'oklch(0.955 0.005 95)',

  /* ── 墨色（冷调） ───────────────────────────────────────── */
  '--ink-primary': 'oklch(0.298 0.014 258)',
  '--ink-secondary': 'oklch(0.443 0.013 258)',
  '--ink-muted': 'oklch(0.588 0.011 258)',

  /* ── 国际橙（主强调 / 保存灯 / 激活态） ────────────────────── */
  '--accent': 'oklch(0.623 0.188 46.5)',
  '--accent-hover': 'oklch(0.561 0.196 43.5)',
  '--accent-soft': 'oklch(0.921 0.048 58 / 0.62)',
  '--accent-ring': 'oklch(0.623 0.188 46.5 / 0.26)',

  /* ── 信号色 ─────────────────────────────────────────────── */
  '--signal-success': 'oklch(0.572 0.124 158.5)',
  '--signal-success-soft': 'oklch(0.912 0.048 158.5 / 0.66)',
  '--signal-warning': 'oklch(0.662 0.148 77.5)',
  '--signal-warning-soft': 'oklch(0.94 0.052 77.5 / 0.66)',
  '--signal-error': 'oklch(0.552 0.188 27.5)',
  '--signal-error-hover': 'oklch(0.496 0.196 27.5)',
  '--signal-error-soft': 'oklch(0.928 0.052 27.5 / 0.64)',

  /* ── 发丝刻线（面板分区的唯一手段） ────────────────────────── */
  '--rule': 'oklch(0.772 0.012 252 / 0.55)',
  '--rule-strong': 'oklch(0.652 0.014 252 / 0.58)',
  '--rule-wing': 'oklch(0.782 0.012 252 / 0.5)',

  /* ── 代码区（冷调平底） ──────────────────────────────────── */
  '--code-bg': 'oklch(0.902 0.01 252 / 0.55)',
  '--code-text': 'oklch(0.332 0.016 258)',
  '--code-block-bg': 'oklch(0.908 0.01 252)',

  /* ── 冰蓝链接 ────────────────────────────────────────────── */
  '--link': 'oklch(0.518 0.112 251.5)',
  '--link-visited': 'oklch(0.498 0.092 284)',
  '--link-broken': 'oklch(0.552 0.188 27.5)',

  '--highlight': 'oklch(0.882 0.082 76 / 0.52)',
  '--blockquote-rule': 'oklch(0.623 0.188 46.5 / 0.62)',
  '--table-stripe': 'oklch(0.932 0.008 95 / 0.72)',
  '--scrollbar-thumb': 'oklch(0.696 0.013 252 / 0.62)',
  '--scrollbar-thumb-hover': 'oklch(0.623 0.188 46.5 / 0.72)',
  '--overlay': 'oklch(0.298 0.016 258 / 0.34)',

  /* ── 编辑屏（屏面略亮于舱体） ──────────────────────────────── */
  '--editor-bg': 'oklch(0.953 0.006 95)',
  '--editor-cursor': 'oklch(0.561 0.196 43.5)',
  '--editor-selection': 'oklch(0.722 0.098 60 / 0.3)',
  '--editor-gutter': 'oklch(0.562 0.013 252)',
  '--editor-line-highlight': 'oklch(0.922 0.01 92 / 0.62)',

  /* ── 表面交互态 ──────────────────────────────────────────── */
  '--surface-hover': 'oklch(0.6 0.05 252 / 0.07)',
  '--surface-active': 'oklch(0.6 0.1 46.5 / 0.1)',
  '--surface-selected': 'oklch(0.623 0.188 46.5 / 0.12)',

  /* ── 硬朗小圆角 ──────────────────────────────────────────── */
  '--radius': '4px',
  '--radius-sm': '2px',
  '--radius-md': '4px',
  '--radius-lg': '6px',

  /* ── 甲板几何 ────────────────────────────────────────────── */
  '--wing-left-width': '236px',
  '--wing-right-width': '252px',
  '--editor-max-width': '700px',
  '--editor-top-pad': '48px',
  '--topbar-height': '56px',
  '--statusbar-height': '36px',
  '--theme-control-density': '1',

  /* ── 扁平化：宿主浮雕投影全部归零，仅浮层保留一道柔和投影 ────── */
  '--shadow-sheet': 'none',
  '--shadow-stack': 'none',
  '--shadow-float': 'none',
  '--shadow-wing-sheet': 'none',
  '--shadow-wing-stack': 'none',
  '--shadow-wing-float': 'none',
  '--constellation-float-shadow': '0 10px 30px oklch(0.42 0.02 258 / 0.2)',

  /* ── 甲板条（平整哑光色块，无渐变无纹理） ────────────────────── */
  '--constellation-deck-bar': 'oklch(0.878 0.007 250)',
  '--constellation-deck-edge': 'oklch(0.68 0.013 250 / 0.55)',

  /* ── 状态灯（静态小圆点，不呼吸） ────────────────────────────── */
  '--constellation-led-green': 'oklch(0.62 0.15 158.5)',
  '--constellation-led-amber': 'oklch(0.68 0.15 77.5)',
  '--constellation-led-red': 'oklch(0.58 0.19 27.5)',
  '--constellation-panel-enter': '180ms',
  '--constellation-stencil-tracking': '0.14em',

  /* ── 书签点：任务面板八色 ─────────────────────────────────── */
  '--dot-0': 'oklch(0.623 0.188 46.5)',
  '--dot-1': 'oklch(0.548 0.112 251.5)',
  '--dot-2': 'oklch(0.572 0.124 158.5)',
  '--dot-3': 'oklch(0.662 0.148 77.5)',
  '--dot-4': 'oklch(0.552 0.188 27.5)',
  '--dot-5': 'oklch(0.522 0.104 302)',
  '--dot-6': 'oklch(0.598 0.098 198)',
  '--dot-7': 'oklch(0.552 0.018 258)',

  /* ── 磨砂舷窗与自发光 ── */
  '--constellation-frost-blur': '4px',
  '--constellation-panel-glass': 'oklch(0.945 0.006 95 / 0.5)',
  '--constellation-deck-bar-glass': 'oklch(0.878 0.007 250 / 0.52)',
  '--constellation-glow-accent': 'oklch(0.623 0.188 46.5 / 0.5)',
  '--constellation-glow-ice': 'oklch(0.72 0.09 251.5 / 0.45)',
  '--constellation-glow-success': 'oklch(0.62 0.15 158.5 / 0.55)',
  '--constellation-glow-warning': 'oklch(0.68 0.15 77.5 / 0.45)',

  /* ── 等宽字体栈（遥测读数 / 微标签用） ────────────────────────── */
  '--ff-mono':
    "'Cascadia Code', 'JetBrains Mono', 'SF Mono', 'Consolas', 'Source Code Pro', monospace",
};
