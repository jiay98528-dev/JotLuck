import type { OfficialThemeModule } from '@/types/theme-pack';
import { recipe } from './recipe';
import { tokens } from './tokens';
import paperPreview from '@/assets/theme-assets/paper-preview.webp';

const paperModule: OfficialThemeModule = {
  meta: {
    role: 'baseline',
    headline: '稳定的写作桌面',
    story: 'MarkLuck 的基线体验。左翼承载最近笔记，中心保留写作版心，右翼提供大纲、反链和标签。',
    bestFor: ['日常写作', '首次使用', '低性能设备', '长时间整理'],
    visualFeatures: ['三栏稳定布局', '低干扰纸面', '最少动效', '完整控件权重'],
    uiProfile: {
      toolbarDensity: 'calm',
      sidebarMode: 'balanced',
      drawerEmphasis: 'medium',
      readingWidth: 'standard',
      motionIntensity: 'none',
    },
    performanceLevel: 1,
    effectProfile: 'none',
    previewImage: paperPreview,
  },
  recipe,
  tokens,
};

export default paperModule;
