import type { OfficialThemeModule } from '@/types/theme-pack';
import studioPreview from '@/assets/theme-assets/studio-preview.webp';
import { recipe } from './recipe';
import { tokens } from './tokens';

const studioModule: OfficialThemeModule = {
  meta: {
    role: 'workflow',
    headline: '更紧凑的生产轨道',
    story: '顶部工具和状态栏更紧凑，版心更窄，操作密度提升。适合把笔记快速整理、导出和分发。',
    bestFor: ['模板复用', '批量整理', '导出交付', '窗口较小的工作场景'],
    visualFeatures: ['紧凑工具轨', '更短状态栏', '暖橙操作强调', '生产面板优先'],
    uiProfile: {
      toolbarDensity: 'compact',
      sidebarMode: 'rail',
      drawerEmphasis: 'high',
      readingWidth: 'compact',
      motionIntensity: 'low',
    },
    performanceLevel: 2,
    effectProfile: 'subtle',
    previewImage: studioPreview,
  },
  recipe,
  tokens,
};

export default studioModule;
