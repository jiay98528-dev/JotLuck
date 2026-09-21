import type { ShellRecipe } from '@/types/theme-pack';

/**
 * Constellation 群星 — deck 驾驶甲板布局。
 *
 * 全宽指挥栏（顶）+ 全宽遥测栏（底）+ 中间三列仪表面板，
 * 编辑区是蚀刻进甲板的屏幕井。文件左、编辑中、大纲右、状态底，
 * 与既有编辑习惯保持一致。
 */
export const recipe: ShellRecipe = {
  layoutPreset: 'deck',
  workspaceIntent: 'studio',
  defaultViewMode: 'live',
  topBar: { variant: 'studio', layout: 'workbench' },
  leftWing: { mode: 'navigator', layout: 'navigator' },
  editorControl: { layout: 'toolbar', density: 'productive' },
  statusBar: { layout: 'dashboard', density: 'productive' },
  rightWing: {
    mode: 'atlas',
    policy: 'outline',
    sections: ['outline', 'backlinks', 'tags'],
    defaultOpenSections: ['outline', 'backlinks', 'tags'],
  },
  readingWidth: 'standard',
  drawerEmphasis: 'low',
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
