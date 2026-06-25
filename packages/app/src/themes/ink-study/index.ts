import type { OfficialThemeModule } from '@/types/theme-pack';
import { recipe } from './recipe';
import { tokens, css } from './tokens';
import { assets } from './assets';

const inkStudyModule: OfficialThemeModule = {
  id: 'markluck.ink-study',
  name: '墨线书房',
  tags: ['focus', 'writing', 'ink', 'collectible'],
  capabilities: ['tokens', 'assets', 'animations', 'layout-preset', 'markdown', 'codemirror'],
  meta: {
    role: 'collectible',
    headline: '纸面上的建筑线稿',
    story:
      '更窄的焦点版心配合墨绿色结构线。背景不是装饰画，而是把文件、纹章和书写网格融成一个工作台。',
    bestFor: ['长文写作', '校订', '需要轻仪式感的日间工作', '收藏主题展示'],
    visualFeatures: ['本地纸纹背景', '左侧纹章结构', '微弱脉冲线', '轻粒子层'],
    uiProfile: {
      toolbarDensity: 'calm',
      sidebarMode: 'quiet',
      drawerEmphasis: 'low',
      readingWidth: 'standard',
      motionIntensity: 'medium',
    },
    performanceLevel: 3,
    effectProfile: 'ambient',
    previewImage: assets.preview,
    backgroundAsset: assets.background,
  },
  recipe,
  tokens,
  css,
};

export default inkStudyModule;
