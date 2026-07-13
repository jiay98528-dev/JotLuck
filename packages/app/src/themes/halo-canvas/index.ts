import type { OfficialThemeModule } from '@/types/theme-pack';
import haloCanvasPreview from '@/assets/theme-assets/halo-canvas-preview.png';
// `?inline` keeps the stylesheet as a module string for both Vite and Vitest.
// ThemeRegistry is the sole injector, so the asset must not be auto-mounted.
import haloCanvasCss from './halo-canvas.css?inline';
import { plugin } from './plugin';
import { recipe } from './recipe';
import { tokens } from './tokens';

const haloCanvasModule: OfficialThemeModule = {
  id: 'jotluck.halo-canvas',
  name: '光环画布（Halo Canvas）',
  tags: ['local-market', 'atelier', 'light', 'liquid-glass', 'writing', 'immersive'],
  capabilities: ['tokens', 'layout-preset', 'ux-components', 'animations', 'trusted-code'],
  meta: {
    role: 'workflow',
    headline: '一张安静画布，置于明亮的玻璃驾驶舱中。',
    story:
      '银白云母环境将导航、命令与知识检查器化为克制的玻璃工具舱；正文画布保持稳定、不透明且易读，让所有层级服务于持续写作。',
    bestFor: ['日间写作', '研究整理', '长文编辑', '高密度知识工作'],
    visualFeatures: [
      '云母银白环境场',
      '悬浮玻璃工具舱',
      '蓝紫焦点折射',
      '原生命令工具组',
      '安静正文画布',
    ],
    uiProfile: {
      toolbarDensity: 'productive',
      sidebarMode: 'research',
      drawerEmphasis: 'medium',
      readingWidth: 'immersive',
      motionIntensity: 'medium',
    },
    performanceLevel: 4,
    effectProfile: 'immersive',
    previewImage: haloCanvasPreview,
  },
  recipe,
  tokens,
  plugin,
  css: haloCanvasCss,
};

export default haloCanvasModule;
