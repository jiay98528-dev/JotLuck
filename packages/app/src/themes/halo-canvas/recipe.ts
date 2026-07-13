import type { ShellRecipe } from '@/types/theme-pack';

/**
 * Halo Canvas — 常驻的悬浮工作台，而非 Lumen 的三向抽屉。
 */
export const recipe: ShellRecipe = {
  layoutPreset: 'atelier',
  workspaceIntent: 'atelier',
  defaultViewMode: 'live',
  topBar: { variant: 'atelier', layout: 'workbench' },
  leftWing: { mode: 'navigator', layout: 'navigator' },
  editorControl: { layout: 'toolbar', density: 'calm' },
  statusBar: { layout: 'dashboard', density: 'productive' },
  rightWing: {
    mode: 'atlas',
    policy: 'outline',
    sections: ['outline', 'backlinks', 'tags'],
    defaultOpenSections: ['outline', 'backlinks', 'tags'],
  },
  readingWidth: 'immersive',
  drawerEmphasis: 'medium',
  motionIntensity: 'medium',
  actionPlacements: {
    'new-note': 'topbar-left',
    'file-drawer': 'topbar-left',
    search: 'topbar-center',
    template: 'editor-control',
    export: 'status-right',
    share: 'status-right',
    theme: 'topbar-right',
    settings: 'topbar-right',
    'view-toggle': 'reader-bar',
  },
};
