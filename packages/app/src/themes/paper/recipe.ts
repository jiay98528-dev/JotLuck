import type { ShellRecipe } from '@/types/theme-pack';

/**
 * 羽翼布局 (baseline) — 默认三栏写作桌
 *
 * workspaceIntent: baseline
 * defaultViewMode: live
 * 完整三栏布局 + classic TopBar + 书签左翼 + outline 右翼
 */
export const recipe: ShellRecipe = {
  layoutPreset: 'winged',
  workspaceIntent: 'baseline',
  defaultViewMode: 'live',
  topBar: { variant: 'balanced', layout: 'classic' },
  leftWing: { mode: 'default', layout: 'bookmarks' },
  editorControl: { layout: 'toolbar', density: 'calm' },
  statusBar: { layout: 'full', density: 'calm' },
  rightWing: {
    mode: 'balanced',
    policy: 'outline',
    sections: ['outline', 'backlinks', 'tags'],
    defaultOpenSections: ['outline', 'tags'],
  },
  readingWidth: 'standard',
  drawerEmphasis: 'medium',
  motionIntensity: 'none',
  actionPlacements: {
    'new-note': 'left-wing',
    'file-drawer': 'topbar-left',
    search: 'topbar-right',
    template: 'editor-control',
    export: 'topbar-right',
    share: 'topbar-right',
    theme: 'topbar-right',
    settings: 'left-wing',
    'view-toggle': 'editor-control',
  },
};
