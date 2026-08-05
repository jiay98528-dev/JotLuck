import type { OfficialThemeModule } from '@/types/theme-pack';
import haloCanvasPreview from '@/assets/theme-assets/halo-canvas-preview.png';
// `?inline` keeps the stylesheet as a module string for both Vite and Vitest.
// ThemeRegistry is the sole injector, so the asset must not be auto-mounted.
import haloCanvasCss from './halo-canvas.css?inline';
import { plugin } from './plugin';
import { recipe } from './recipe';
import { tokens } from './tokens';
import { createOfficialThemeCopy } from '@/themes/official-copy';

export function createHaloCanvasModule(): OfficialThemeModule {
  const copy = createOfficialThemeCopy('haloCanvas');
  return {
    id: 'jotluck.halo-canvas',
    name: copy.name,
    tags: ['local-market', 'atelier', 'light', 'liquid-glass', 'writing', 'immersive'],
    capabilities: ['tokens', 'layout-preset', 'ux-components', 'animations', 'trusted-code'],
    meta: {
      role: 'workflow',
      headline: copy.headline,
      story: copy.story,
      bestFor: copy.bestFor,
      visualFeatures: copy.visualFeatures,
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
}

export default createHaloCanvasModule;
