import type { OfficialThemeModule } from '@/types/theme-pack';
import { plugin } from './plugin';
import { recipe } from './recipe';
import { tokens } from './tokens';

const superWorkbenchModule: OfficialThemeModule = {
  id: 'markluck.super-workbench',
  name: '超级工作台',
  catalogVisibility: 'developer',
  tags: ['local-market', 'p0', 'full-ux-plugin', 'slot-takeover'],
  capabilities: ['tokens', 'layout-preset', 'ux-components', 'animations', 'trusted-code'],
  meta: {
    role: 'workflow',
    headline: '验证主题能接管 MarkLuck Shell 级 UX',
    story:
      'P0 全权限 UX Theme Plugin 验收主题。它通过官方代码插件注册多个 slot 组件，重排 TopBar、LeftWing、RightWing、StatusBar、EditorControl、Workflow、EditorSurface 和主题中心入口。',
    bestFor: ['主题系统验收', 'UX 插件能力验证', '热插拔回归测试'],
    visualFeatures: [
      '插件化 TopBar',
      '数字导航 LeftWing',
      'Atlas RightWing',
      'Dashboard StatusBar',
      '包裹式编辑器接管',
      '主题中心入口接管',
    ],
    uiProfile: {
      toolbarDensity: 'productive',
      sidebarMode: 'research',
      drawerEmphasis: 'high',
      readingWidth: 'wide',
      motionIntensity: 'high',
    },
    performanceLevel: 5,
    effectProfile: 'immersive',
  },
  recipe,
  tokens,
  plugin,
  css: `
[data-theme-id='markluck.super-workbench'] .app-shell {
  background:
    radial-gradient(circle at 12% 8%, color-mix(in oklch, var(--accent) 18%, transparent), transparent 28%),
    linear-gradient(135deg, color-mix(in oklch, var(--paper-left) 64%, transparent), transparent 42%),
    var(--paper-bg);
}

[data-theme-id='markluck.super-workbench'] .super-topbar {
  min-height: var(--topbar-height);
  display: grid;
  grid-template-columns: auto minmax(180px, 0.8fr) minmax(220px, 1fr) auto;
  gap: var(--space-12);
  align-items: center;
  padding: var(--space-8) var(--space-18);
  border-bottom: var(--border-thin) solid color-mix(in oklch, var(--accent) 30%, var(--rule));
  background: color-mix(in oklch, var(--paper-raised) 90%, transparent);
}

[data-theme-id='markluck.super-workbench'] .super-kicker {
  display: block;
  color: var(--ink-muted);
  font-size: var(--text-xs);
  line-height: var(--lh-ui);
}

[data-theme-id='markluck.super-workbench'] .super-topbar__title strong {
  color: var(--ink-primary);
  font-size: var(--text-lg);
  line-height: var(--lh-heading);
}

[data-theme-id='markluck.super-workbench'] .super-action-strip {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-6);
  align-items: center;
}

[data-theme-id='markluck.super-workbench'] .super-action {
  min-height: 30px;
  padding: 0 var(--space-10);
  border: var(--border-thin) solid color-mix(in oklch, var(--accent) 28%, var(--rule));
  border-radius: var(--radius-full);
  background: color-mix(in oklch, var(--paper-surface) 88%, transparent);
  color: var(--ink-secondary);
  font: inherit;
  font-size: var(--text-xs);
  cursor: pointer;
}

[data-theme-id='markluck.super-workbench'] .super-action:hover,
[data-theme-id='markluck.super-workbench'] .super-action.is-active {
  background: var(--accent);
  color: var(--paper-bg);
}

[data-theme-id='markluck.super-workbench'] .super-action--compact {
  min-width: 34px;
  padding-inline: var(--space-8);
}

[data-theme-id='markluck.super-workbench'] .super-left-wing {
  width: 72px;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  gap: var(--space-12);
  padding: var(--space-12) var(--space-8);
  border-right: var(--border-thin) solid color-mix(in oklch, var(--accent) 24%, var(--rule));
  background: color-mix(in oklch, var(--paper-left) 92%, transparent);
}

[data-theme-id='markluck.super-workbench'] .super-left-wing__brand {
  width: 46px;
  height: 46px;
  display: grid;
  place-items: center;
  border-radius: var(--radius-md);
  background: var(--accent);
  color: var(--paper-bg);
  font-weight: var(--fw-bold);
}

[data-theme-id='markluck.super-workbench'] .super-left-wing__brand span {
  font-size: 9px;
  letter-spacing: var(--ls-wide);
}

[data-theme-id='markluck.super-workbench'] .super-left-wing__notes,
[data-theme-id='markluck.super-workbench'] .super-left-wing__actions {
  display: grid;
  justify-items: center;
  gap: var(--space-8);
}

[data-theme-id='markluck.super-workbench'] .super-note-dot {
  width: 36px;
  height: 36px;
  border: var(--border-thin) solid var(--rule);
  border-radius: 12px;
  background: var(--paper-surface);
  color: var(--ink-secondary);
  cursor: pointer;
}

[data-theme-id='markluck.super-workbench'] .super-note-dot.is-active {
  border-color: var(--accent);
  background: var(--accent-soft);
  color: var(--accent);
}

[data-theme-id='markluck.super-workbench'] .super-atlas {
  width: 292px;
  overflow: hidden auto;
  padding: var(--space-16);
  border-left: var(--border-thin) solid color-mix(in oklch, var(--accent) 24%, var(--rule));
  background: color-mix(in oklch, var(--paper-right) 92%, transparent);
}

[data-theme-id='markluck.super-workbench'] .super-atlas__header {
  display: flex;
  justify-content: space-between;
  margin-bottom: var(--space-16);
  color: var(--ink-primary);
}

[data-theme-id='markluck.super-workbench'] .super-atlas__section {
  display: grid;
  gap: var(--space-8);
  margin-bottom: var(--space-16);
}

[data-theme-id='markluck.super-workbench'] .super-atlas__section h3 {
  display: flex;
  justify-content: space-between;
  margin: 0;
  color: var(--ink-secondary);
  font-size: var(--text-sm);
}

[data-theme-id='markluck.super-workbench'] .super-atlas__body {
  display: grid;
  gap: var(--space-6);
}

[data-theme-id='markluck.super-workbench'] .super-heading,
[data-theme-id='markluck.super-workbench'] .super-backlink,
[data-theme-id='markluck.super-workbench'] .super-tag {
  border: 0;
  background: transparent;
  color: var(--ink-secondary);
  font: inherit;
  font-size: var(--text-xs);
  text-align: left;
  cursor: pointer;
}

[data-theme-id='markluck.super-workbench'] .super-heading:hover,
[data-theme-id='markluck.super-workbench'] .super-backlink:hover,
[data-theme-id='markluck.super-workbench'] .super-tag:hover {
  color: var(--accent);
}

[data-theme-id='markluck.super-workbench'] .super-heading--level-2 {
  padding-left: var(--space-8);
}

[data-theme-id='markluck.super-workbench'] .super-heading--level-3,
[data-theme-id='markluck.super-workbench'] .super-heading--level-4,
[data-theme-id='markluck.super-workbench'] .super-heading--level-5,
[data-theme-id='markluck.super-workbench'] .super-heading--level-6 {
  padding-left: var(--space-16);
}

[data-theme-id='markluck.super-workbench'] .super-status {
  min-height: 38px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-12);
  padding: 0 var(--space-16);
  border-top: var(--border-thin) solid color-mix(in oklch, var(--accent) 24%, var(--rule));
  background: color-mix(in oklch, var(--paper-raised) 92%, transparent);
  color: var(--ink-secondary);
  font-size: var(--text-xs);
}

[data-theme-id='markluck.super-workbench'] .super-status__state {
  color: var(--accent);
  font-weight: var(--fw-semibold);
}

[data-theme-id='markluck.super-workbench'] .super-slot-shell {
  min-height: 0;
  height: 100%;
  display: flex;
  flex-direction: column;
  border: var(--border-thin) solid color-mix(in oklch, var(--accent) 20%, var(--rule));
  background: color-mix(in oklch, var(--paper-surface) 94%, transparent);
}

[data-theme-id='markluck.super-workbench'] .super-slot-shell__label {
  flex: 0 0 auto;
  padding: var(--space-6) var(--space-12);
  border-bottom: var(--border-thin) solid color-mix(in oklch, var(--accent) 18%, var(--rule));
  color: var(--accent);
  font-size: var(--text-xs);
}

[data-theme-id='markluck.super-workbench'] .super-slot-shell > :not(.super-slot-shell__label) {
  flex: 1;
  min-height: 0;
}

[data-theme-id='markluck.super-workbench'] .super-editor-control {
  border-bottom: var(--border-thin) solid color-mix(in oklch, var(--accent) 24%, var(--rule));
  background: color-mix(in oklch, var(--accent-soft) 40%, var(--paper-raised));
}

[data-theme-id='markluck.super-workbench'] .super-editor-control__rail {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-12);
  padding: var(--space-8) var(--space-14);
  color: var(--ink-primary);
}

[data-theme-id='markluck.super-workbench'] .super-dialog-beacon {
  position: fixed;
  right: var(--space-16);
  bottom: var(--space-16);
  z-index: calc(var(--z-modal) + 1);
  padding: var(--space-8) var(--space-12);
  border-radius: var(--radius-full);
  background: var(--accent);
  color: var(--paper-bg);
  font-size: var(--text-xs);
  box-shadow: var(--shadow-float);
}
`,
};

export default superWorkbenchModule;
