import type { OfficialThemeModule } from '@/types/theme-pack';
import { recipe } from './recipe';
import { tokens } from './tokens';

const abilityLabModule: OfficialThemeModule = {
  id: 'jotluck.ability-lab',
  name: '能力验证台',
  catalogVisibility: 'developer',
  tags: ['local-market', 'ux-components', 'trusted-ready'],
  capabilities: ['tokens', 'layout-preset', 'ux-components', 'animations', 'trusted-code'],
  meta: {
    role: 'workflow',
    headline: '验证主题系统是否能重排 Shell UX',
    story: '用于证明主题可以控制动作位置、区域结构、状态栏承载和主题中心预览。',
    bestFor: ['主题系统验收', 'UX 组件重排', '本地市场演示'],
    visualFeatures: ['Workbench TopBar', 'Atlas 右翼', 'Dashboard 状态栏', '声明式主题中心卡片'],
    uiProfile: {
      toolbarDensity: 'productive',
      sidebarMode: 'research',
      drawerEmphasis: 'high',
      readingWidth: 'wide',
      motionIntensity: 'medium',
    },
    performanceLevel: 3,
    effectProfile: 'ambient',
  },
  recipe,
  tokens,
  ux: {
    topbar: {
      slot: 'topbar',
      name: '能力验证 TopBar',
      root: {
        type: 'Stack',
        className: 'ux-topbar-lab',
        children: [
          { type: 'ActionList', props: { region: 'topbar-left' } },
          { type: 'Text', text: '能力验证台', props: { tone: 'strong' } },
          { type: 'ActionList', props: { region: 'topbar-center' } },
          { type: 'ActionList', props: { region: 'topbar-right' } },
        ],
      },
    },
    'status-bar': {
      slot: 'status-bar',
      name: '仪表状态栏',
      root: {
        type: 'Stack',
        className: 'ux-status-lab',
        children: [
          { type: 'EditorStatus' },
          { type: 'ActionList', props: { region: 'status-right' } },
        ],
      },
    },
  },
  css: `
[data-theme-id='jotluck.ability-lab'] .app-shell {
  background:
    linear-gradient(90deg, color-mix(in oklch, var(--accent-soft) 28%, transparent), transparent 30%),
    var(--paper-bg);
}
[data-theme-id='jotluck.ability-lab'] .ux-topbar-lab {
  min-height: var(--topbar-height);
  display: grid;
  grid-template-columns: auto minmax(140px, 0.8fr) minmax(220px, 1fr) auto;
  align-items: center;
  gap: var(--space-12);
  padding-inline: var(--space-16);
  border-bottom: var(--border-thin) solid color-mix(in oklch, var(--accent) 20%, var(--rule));
  background: color-mix(in oklch, var(--paper-surface) 90%, transparent);
}
[data-theme-id='jotluck.ability-lab'] .ux-status-lab {
  min-height: 34px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-12);
  padding-inline: var(--space-12);
  border-top: var(--border-thin) solid color-mix(in oklch, var(--accent) 18%, var(--rule));
  background: color-mix(in oklch, var(--paper-raised) 92%, transparent);
}
`,
};

export default abilityLabModule;
