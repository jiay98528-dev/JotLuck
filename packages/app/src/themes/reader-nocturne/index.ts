import type { OfficialThemeModule } from '@/types/theme-pack';
import { recipe } from './recipe';
import { tokens, css } from './tokens';
import { assets } from './assets';

const readerNocturneModule: OfficialThemeModule = {
  meta: {
    role: 'collectible',
    headline: '夜间阅读的星幕桌面',
    story:
      '深色正文版心、暗纸纹和轻微星尘层共同服务夜间阅读。它更像一张安静的阅读桌，而不是终端皮肤。',
    bestFor: ['夜间阅读', '外部 Markdown 只读打开', '长文复盘', '沉浸式主题收藏'],
    visualFeatures: ['本地星幕背景', '柔和呼吸光', '弱化侧翼', '更宽阅读版心'],
    uiProfile: {
      toolbarDensity: 'calm',
      sidebarMode: 'quiet',
      drawerEmphasis: 'low',
      readingWidth: 'immersive',
      motionIntensity: 'high',
    },
    performanceLevel: 4,
    effectProfile: 'immersive',
    previewImage: assets.preview,
    backgroundAsset: assets.background,
  },
  recipe,
  tokens,
  css,
};

export default readerNocturneModule;
