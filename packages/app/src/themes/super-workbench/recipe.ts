import type { ShellRecipe } from '@/types/theme-pack';

export const recipe: ShellRecipe = {
  layoutPreset: 'atelier',
  workspaceIntent: 'atelier',
  defaultViewMode: 'split',
  topBar: { variant: 'atelier', layout: 'workbench' },
  leftWing: { mode: 'navigator', layout: 'navigator' },
  editorControl: { layout: 'stacked', density: 'productive' },
  statusBar: { layout: 'dashboard', density: 'productive' },
  rightWing: {
    mode: 'atlas',
    policy: 'atlas',
    sections: ['outline', 'tags', 'backlinks'],
    defaultOpenSections: ['outline', 'backlinks'],
  },
  readingWidth: 'wide',
  drawerEmphasis: 'high',
  motionIntensity: 'high',
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
