import type { ShellRecipe } from '@/types/theme-pack';

/**
 * 档案馆 (archive) — 资料研究工作流主题
 *
 * workspaceIntent: archive
 * defaultViewMode: split
 * 搜索优先 TopBar + 研究栈左翼 + 标签/反链优先右翼
 */
export const recipe: ShellRecipe = {
  layoutPreset: 'archive',
  workspaceIntent: 'archive',
  defaultViewMode: 'split',
  topBar: { variant: 'archive', layout: 'search-first' },
  leftWing: { mode: 'research', layout: 'research-stack' },
  editorControl: { layout: 'toolbar', density: 'productive' },
  statusBar: { layout: 'full', density: 'productive' },
  rightWing: {
    mode: 'research',
    policy: 'research',
    sections: ['backlinks', 'tags', 'outline'],
    defaultOpenSections: ['backlinks', 'tags'],
  },
  readingWidth: 'wide',
  drawerEmphasis: 'high',
  motionIntensity: 'low',
  actionPlacements: {
    'new-note': 'left-wing',
    'file-drawer': 'topbar-left',
    search: 'topbar-center',
    template: 'hidden',
    export: 'topbar-right',
    share: 'topbar-right',
    settings: 'left-wing',
    'theme-toggle': 'topbar-right',
    'view-toggle': 'editor-control',
  },
};
