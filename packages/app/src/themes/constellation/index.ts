import type { OfficialThemeModule } from '@/types/theme-pack';
import constellationPreview from '@/assets/theme-assets/constellation-preview.webp';
// `?inline` keeps the stylesheet as a module string for both Vite and Vitest.
// ThemeRegistry is the sole injector, so the asset must not be auto-mounted.
import constellationCss from './constellation.css?inline';
import { plugin } from './plugin';
import { recipe } from './recipe';
import { tokens } from './tokens';
import { createOfficialThemeCopy } from '@/themes/official-copy';

export function createConstellationModule(): OfficialThemeModule {
  const copy = createOfficialThemeCopy('constellation');
  return {
    id: 'jotluck.constellation',
    name: copy.name,
    tags: ['builtin', 'deck', 'light', 'nasa-punk', 'mission-control', 'minimal'],
    capabilities: [
      'tokens',
      'layout-preset',
      'ux-components',
      'animations',
      'trusted-code',
      'markdown',
      'codemirror',
    ],
    meta: {
      role: 'workflow',
      headline: copy.headline,
      story: copy.story,
      bestFor: copy.bestFor,
      visualFeatures: copy.visualFeatures,
      uiProfile: {
        toolbarDensity: 'productive',
        sidebarMode: 'balanced',
        drawerEmphasis: 'low',
        readingWidth: 'standard',
        motionIntensity: 'low',
      },
      performanceLevel: 4,
      effectProfile: 'ambient',
      previewImage: constellationPreview,
    },
    recipe,
    tokens,
    plugin,
    css: constellationCss,
  };
}

export default createConstellationModule;
