import type { OfficialThemeModule } from '@/types/theme-pack';
import { plugin } from './plugin';
import { recipe } from './recipe';
import { tokens } from './tokens';
import lumenFieldPreview from '@/assets/theme-assets/lumen-field-preview.webp';

const lumenFieldModule: OfficialThemeModule = {
  id: 'markluck.lumen-field',
  name: '光场知识舱',
  tags: ['local-market', 'single-page', 'drawer-shell', 'dark', 'next-generation'],
  capabilities: ['tokens', 'layout-preset', 'ux-components', 'animations', 'trusted-code'],
  meta: {
    role: 'workflow',
    headline: '单页写作与三向知识抽屉',
    story:
      '深色低眩光的单页面主题。文件、知识和命令默认收进左、右、底三个动态抽屉，写作区保持单页聚焦，固定抽屉后让出版心。',
    bestFor: ['深夜写作', '研究整理', '沉浸编辑', '大屏工作区'],
    visualFeatures: [
      '单页面编辑器',
      '三向动态抽屉',
      '信标式文件导航',
      '知识雷达面板',
      '低眩光光场配色',
    ],
    uiProfile: {
      toolbarDensity: 'productive',
      sidebarMode: 'rail',
      drawerEmphasis: 'high',
      readingWidth: 'immersive',
      motionIntensity: 'medium',
    },
    performanceLevel: 4,
    effectProfile: 'ambient',
    previewImage: lumenFieldPreview,
  },
  recipe,
  tokens,
  plugin,
  css: `
[data-theme-id='markluck.lumen-field'] .single-page-drawer-shell {
  background:
    linear-gradient(90deg, color-mix(in oklch, var(--rule-strong) 18%, transparent) 1px, transparent 1px),
    linear-gradient(180deg, color-mix(in oklch, var(--rule-strong) 12%, transparent) 1px, transparent 1px),
    var(--paper-bg);
  background-size: 36px 36px;
}

[data-theme-id='markluck.lumen-field'] .single-page-drawer-shell__main {
  background:
    linear-gradient(180deg, color-mix(in oklch, var(--accent-soft) 18%, transparent), transparent 34%),
    var(--paper-surface);
}

[data-theme-id='markluck.lumen-field'] .single-page-drawer {
  border-color: color-mix(in oklch, var(--link) 34%, var(--rule));
  background:
    linear-gradient(180deg, color-mix(in oklch, var(--link) 8%, transparent), transparent 42%),
    var(--paper-raised);
}

[data-theme-id='markluck.lumen-field'] .single-page-drawer__chrome {
  border-bottom-color: color-mix(in oklch, var(--link) 28%, var(--rule));
  background: color-mix(in oklch, var(--paper-bg) 42%, transparent);
}

[data-theme-id='markluck.lumen-field'] .single-page-drawer-handle {
  border-color: color-mix(in oklch, var(--link) 58%, var(--rule));
  background: color-mix(in oklch, var(--paper-raised) 94%, transparent);
  color: var(--link);
}

[data-theme-id='markluck.lumen-field'] .lumen-left,
[data-theme-id='markluck.lumen-field'] .lumen-radar,
[data-theme-id='markluck.lumen-field'] .lumen-command-deck,
[data-theme-id='markluck.lumen-field'] .lumen-status {
  color: var(--ink-primary);
}

[data-theme-id='markluck.lumen-field'] .lumen-left,
[data-theme-id='markluck.lumen-field'] .lumen-radar {
  min-height: 100%;
  display: flex;
  flex-direction: column;
  gap: var(--space-16);
  padding: var(--space-16);
}

[data-theme-id='markluck.lumen-field'] .lumen-left__header,
[data-theme-id='markluck.lumen-field'] .lumen-radar__header,
[data-theme-id='markluck.lumen-field'] .lumen-command-deck__actions {
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-12);
}

[data-theme-id='markluck.lumen-field'] .lumen-left__header strong,
[data-theme-id='markluck.lumen-field'] .lumen-radar__header span:first-child,
[data-theme-id='markluck.lumen-field'] .lumen-command-deck__actions strong {
  color: var(--accent);
  font-size: var(--text-sm);
  font-weight: var(--fw-semibold);
}

[data-theme-id='markluck.lumen-field'] .lumen-left__header span,
[data-theme-id='markluck.lumen-field'] .lumen-radar__header span:last-child {
  color: var(--ink-muted);
  font-size: var(--text-xs);
}

[data-theme-id='markluck.lumen-field'] .lumen-action-strip {
  min-width: 0;
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-8);
  align-items: center;
}

[data-theme-id='markluck.lumen-field'] .lumen-left > .lumen-action-strip {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  align-items: stretch;
}

[data-theme-id='markluck.lumen-field'] .lumen-action,
[data-theme-id='markluck.lumen-field'] .lumen-note,
[data-theme-id='markluck.lumen-field'] .lumen-radar-row,
[data-theme-id='markluck.lumen-field'] .lumen-tag {
  border: var(--border-thin) solid color-mix(in oklch, var(--link) 24%, var(--rule));
  border-radius: var(--radius-sm);
  background: color-mix(in oklch, var(--paper-surface) 72%, transparent);
  color: var(--ink-secondary);
  font: inherit;
  cursor: pointer;
}

[data-theme-id='markluck.lumen-field'] .lumen-action {
  min-width: 0;
  min-height: 34px;
  padding: 0 var(--space-12);
  overflow: hidden;
  font-size: var(--text-xs);
  line-height: var(--lh-ui);
  text-overflow: ellipsis;
  white-space: nowrap;
}

[data-theme-id='markluck.lumen-field'] .lumen-action--compact {
  min-width: 0;
  padding-inline: var(--space-10);
}

[data-theme-id='markluck.lumen-field'] .lumen-action:focus-visible,
[data-theme-id='markluck.lumen-field'] .lumen-note:focus-visible,
[data-theme-id='markluck.lumen-field'] .lumen-radar-row:focus-visible,
[data-theme-id='markluck.lumen-field'] .lumen-tag:focus-visible {
  outline: 2px solid var(--focus-ring);
  outline-offset: 2px;
}

[data-theme-id='markluck.lumen-field'] .lumen-action:hover,
[data-theme-id='markluck.lumen-field'] .lumen-action.is-active,
[data-theme-id='markluck.lumen-field'] .lumen-note:hover,
[data-theme-id='markluck.lumen-field'] .lumen-note.is-active,
[data-theme-id='markluck.lumen-field'] .lumen-radar-row:hover,
[data-theme-id='markluck.lumen-field'] .lumen-tag:hover {
  border-color: var(--accent);
  color: var(--accent);
  background: color-mix(in oklch, var(--accent-soft) 62%, var(--paper-raised));
}

[data-theme-id='markluck.lumen-field'] .lumen-note-list,
[data-theme-id='markluck.lumen-field'] .lumen-radar__body {
  min-width: 0;
  display: grid;
  gap: var(--space-8);
}

[data-theme-id='markluck.lumen-field'] .lumen-note {
  min-height: 42px;
  display: grid;
  grid-template-columns: 34px minmax(0, 1fr);
  align-items: center;
  gap: var(--space-10);
  padding: 0 var(--space-12);
  text-align: left;
}

[data-theme-id='markluck.lumen-field'] .lumen-note__index {
  color: var(--link);
  font-family: var(--ff-mono);
  font-size: var(--text-xs);
}

[data-theme-id='markluck.lumen-field'] .lumen-note__title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

[data-theme-id='markluck.lumen-field'] .lumen-radar__section {
  display: grid;
  gap: var(--space-10);
  padding: var(--space-12);
  border: var(--border-thin) solid color-mix(in oklch, var(--link) 18%, var(--rule));
  border-radius: var(--radius-md);
  background: color-mix(in oklch, var(--paper-surface) 68%, transparent);
}

[data-theme-id='markluck.lumen-field'] .lumen-radar__section header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-10);
  color: var(--ink-muted);
  font-size: var(--text-xs);
}

[data-theme-id='markluck.lumen-field'] .lumen-radar__section header strong {
  color: var(--ink-secondary);
  font-size: var(--text-xs);
}

[data-theme-id='markluck.lumen-field'] .lumen-radar-row {
  min-height: 32px;
  padding: 0 var(--space-10);
  overflow: hidden;
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
}

[data-theme-id='markluck.lumen-field'] .lumen-radar-row--level-2 {
  margin-left: var(--space-8);
}

[data-theme-id='markluck.lumen-field'] .lumen-radar-row--level-3,
[data-theme-id='markluck.lumen-field'] .lumen-radar-row--level-4,
[data-theme-id='markluck.lumen-field'] .lumen-radar-row--level-5,
[data-theme-id='markluck.lumen-field'] .lumen-radar-row--level-6 {
  margin-left: var(--space-16);
}

[data-theme-id='markluck.lumen-field'] .lumen-tag {
  min-height: 30px;
  padding: 0 var(--space-10);
  text-align: left;
}

[data-theme-id='markluck.lumen-field'] .lumen-empty {
  margin: 0;
  padding: var(--space-6) var(--space-2);
  color: var(--ink-muted);
  font-size: var(--text-xs);
  line-height: var(--lh-ui);
}

[data-theme-id='markluck.lumen-field'] .lumen-command-deck {
  display: grid;
  gap: var(--space-10);
  padding: var(--space-12) var(--space-14);
}

[data-theme-id='markluck.lumen-field'] .lumen-command-deck__actions {
  flex-wrap: wrap;
}

[data-theme-id='markluck.lumen-field'] .lumen-command-deck__format .editor-control-strip {
  padding: 0;
  border: 0;
  background: transparent;
}

[data-theme-id='markluck.lumen-field'] .lumen-status {
  min-height: 38px;
  display: grid;
  grid-template-columns: minmax(72px, auto) auto auto minmax(0, 1fr);
  align-items: center;
  gap: var(--space-12);
  padding: 0 var(--space-14);
  border-top: var(--border-thin) solid color-mix(in oklch, var(--link) 26%, var(--rule));
  color: var(--ink-muted);
  font-size: var(--text-xs);
}

[data-theme-id='markluck.lumen-field'] .lumen-status .lumen-action-strip {
  justify-content: flex-end;
}

[data-theme-id='markluck.lumen-field'] .lumen-status__state {
  color: var(--signal-success);
  font-weight: var(--fw-semibold);
}

[data-theme-id='markluck.lumen-field'] .lumen-status__state.is-error {
  color: var(--signal-error);
}

[data-theme-id='markluck.lumen-field'] .lumen-slot-frame {
  min-width: 0;
  min-height: 0;
}

[data-theme-id='markluck.lumen-field'] .lumen-slot-frame--workflow-canvas,
[data-theme-id='markluck.lumen-field'] .lumen-slot-frame--editor-surface {
  height: 100%;
}

[data-theme-id='markluck.lumen-field'] .workflow-canvas {
  background: transparent;
}

[data-theme-id='markluck.lumen-field'] .workflow-canvas[data-workspace-intent='studio'] {
  background: transparent;
}

[data-theme-id='markluck.lumen-field'] .workflow-canvas[data-workspace-intent='studio'] .workflow-canvas__main {
  border-left: 0;
  background:
    linear-gradient(90deg, color-mix(in oklch, var(--link) 8%, transparent), transparent 24%),
    var(--editor-bg);
}

[data-theme-id='markluck.lumen-field'] .cm-editor,
[data-theme-id='markluck.lumen-field'] .markdown-body {
  background: var(--editor-bg);
  color: var(--ink-primary);
}

[data-theme-id='markluck.lumen-field'] .cm-editor .cm-content,
[data-theme-id='markluck.lumen-field'] .markdown-body {
  font-family:
    'Segoe UI', 'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif;
}

[data-theme-id='markluck.lumen-field'] .markdown-body pre,
[data-theme-id='markluck.lumen-field'] .markdown-body code,
[data-theme-id='markluck.lumen-field'] .cm-editor .cm-line {
  border-color: var(--rule);
}

@media (prefers-reduced-motion: reduce) {
  [data-theme-id='markluck.lumen-field'] .lumen-action,
  [data-theme-id='markluck.lumen-field'] .lumen-note,
  [data-theme-id='markluck.lumen-field'] .lumen-radar-row,
  [data-theme-id='markluck.lumen-field'] .lumen-tag {
    transition: none;
  }
}
`,
};

export default lumenFieldModule;
