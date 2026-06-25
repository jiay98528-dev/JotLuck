import type { OfficialThemeModule } from '@/types/theme-pack';
import archivePreview from '@/assets/theme-assets/archive-preview.webp';
import { recipe } from './recipe';
import { tokens, css } from './tokens';

const archiveModule: OfficialThemeModule = {
  id: 'markluck.archive',
  name: '档案馆',
  tags: ['archive', 'research', 'workflow'],
  capabilities: ['tokens', 'animations', 'layout-preset', 'markdown', 'codemirror'],
  meta: {
    role: 'workflow',
    headline: '资料优先的研究台',
    story:
      '侧栏更厚重，文件抽屉和右侧参考区更像档案柜。它不是更花，而是把检索、标签和反链放到更高优先级。',
    bestFor: ['资料整理', '研究笔记', '多文件对照', '标签和反链密集场景'],
    visualFeatures: ['加宽右翼', '厚重侧栏', '档案纸色', '检索面板权重提升'],
    uiProfile: {
      toolbarDensity: 'productive',
      sidebarMode: 'research',
      drawerEmphasis: 'high',
      readingWidth: 'wide',
      motionIntensity: 'low',
    },
    performanceLevel: 2,
    effectProfile: 'subtle',
    previewImage: archivePreview,
  },
  recipe,
  tokens,
  css,
};

export default archiveModule;
