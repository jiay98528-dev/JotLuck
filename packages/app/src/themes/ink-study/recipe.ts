import type { ShellRecipe } from '@/types/theme-pack';

/**
 * 墨线书房 (focus / writing) — 日间长文写作主题
 *
 * workspaceIntent: writing
 * defaultViewMode: live
 * 居中写作 Canvas + writing-strip 工具栏 + 折叠右翼
 */
export const recipe: ShellRecipe = {
  layoutPreset: 'focus',
  workspaceIntent: 'writing',
  defaultViewMode: 'live',
  topBar: { variant: 'writing', layout: 'title-first' },
  leftWing: { mode: 'quiet', layout: 'quiet-bookmarks' },
  editorControl: { layout: 'writing-strip', density: 'calm' },
  statusBar: { layout: 'quiet', density: 'calm' },
  rightWing: {
    mode: 'quiet',
    policy: 'collapsed',
    sections: ['outline', 'backlinks', 'tags'],
    defaultOpenSections: ['outline'],
  },
  readingWidth: 'standard',
  drawerEmphasis: 'low',
  motionIntensity: 'medium',
  actionPlacements: {
    'new-note': 'left-wing',
    'file-drawer': 'topbar-left',
    search: 'topbar-right',
    template: 'editor-control',
    export: 'topbar-right',
    share: 'hidden',
    settings: 'left-wing',
    'theme-toggle': 'topbar-right',
    'view-toggle': 'editor-control',
  },
};
