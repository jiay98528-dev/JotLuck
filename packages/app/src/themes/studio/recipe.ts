import type { ShellRecipe } from '@/types/theme-pack';

/**
 * 工坊轨道 (studio) — 生产工作流主题
 *
 * workspaceIntent: studio
 * defaultViewMode: split
 * StudioRail 侧轨 + compact TopBar + production RightWing
 */
export const recipe: ShellRecipe = {
  layoutPreset: 'studio',
  workspaceIntent: 'studio',
  defaultViewMode: 'split',
  topBar: { variant: 'studio', layout: 'compact' },
  leftWing: { mode: 'rail', layout: 'studio-rail' },
  editorControl: { layout: 'studio-rail', density: 'compact' },
  statusBar: { layout: 'compact', density: 'compact' },
  rightWing: {
    mode: 'rail',
    policy: 'production',
    sections: ['outline', 'tags', 'backlinks'],
    defaultOpenSections: ['outline', 'backlinks', 'tags'],
  },
  readingWidth: 'compact',
  drawerEmphasis: 'high',
  motionIntensity: 'low',
  actionPlacements: {
    'new-note': 'studio-rail',
    'file-drawer': 'studio-rail',
    search: 'topbar-right',
    template: 'studio-rail',
    export: 'studio-rail',
    share: 'studio-rail',
    settings: 'left-wing',
    'theme-toggle': 'topbar-right',
    'view-toggle': 'studio-rail',
  },
};
