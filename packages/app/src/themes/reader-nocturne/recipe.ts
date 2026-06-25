import type { ShellRecipe } from '@/types/theme-pack';

/**
 * 夜读星幕 (reader) — 夜间沉浸阅读主题
 *
 * workspaceIntent: reader
 * defaultViewMode: read
 * 最小化 Chrome + 宽阅读版心 + 隐匿编辑器控件
 */
export const recipe: ShellRecipe = {
  layoutPreset: 'reader',
  workspaceIntent: 'reader',
  defaultViewMode: 'read',
  topBar: { variant: 'reader', layout: 'reader' },
  leftWing: { mode: 'quiet', layout: 'quiet-bookmarks' },
  editorControl: { layout: 'hidden', density: 'calm' },
  statusBar: { layout: 'save-only', density: 'calm' },
  rightWing: {
    mode: 'quiet',
    policy: 'collapsed',
    sections: ['outline', 'backlinks', 'tags'],
    defaultOpenSections: ['outline'],
  },
  readingWidth: 'immersive',
  drawerEmphasis: 'low',
  motionIntensity: 'high',
  actionPlacements: {
    'new-note': 'hidden',
    'file-drawer': 'topbar-left',
    search: 'topbar-right',
    template: 'hidden',
    export: 'topbar-right',
    share: 'hidden',
    settings: 'topbar-right',
    'theme-toggle': 'hidden',
    'view-toggle': 'reader-bar',
  },
};
