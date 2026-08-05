import type { OfficialThemeModule } from '@/types/theme-pack';
import { recipe } from './recipe';
import { tokens } from './tokens';
import { createOfficialThemeCopy } from '@/themes/official-copy';
import { translate } from '@/i18n';

export function createAbilityLabModule(): OfficialThemeModule {
  const copy = createOfficialThemeCopy('abilityLab');
  return {
    id: 'jotluck.ability-lab',
    name: copy.name,
    catalogVisibility: 'developer',
    tags: ['local-market', 'ux-components', 'trusted-ready'],
    capabilities: ['tokens', 'layout-preset', 'ux-components', 'animations', 'trusted-code'],
    meta: {
      role: 'workflow',
      headline: copy.headline,
      story: copy.story,
      bestFor: copy.bestFor,
      visualFeatures: copy.visualFeatures,
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
        name: copy.name,
        root: {
          type: 'Stack',
          className: 'ux-topbar-lab',
          children: [
            { type: 'ActionList', props: { region: 'topbar-left' } },
            { type: 'Text', text: copy.name, props: { tone: 'strong' } },
            { type: 'ActionList', props: { region: 'topbar-center' } },
            { type: 'ActionList', props: { region: 'topbar-right' } },
          ],
        },
      },
      'status-bar': {
        slot: 'status-bar',
        name: translate('theme.plugin.ready'),
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
}

export default createAbilityLabModule;
