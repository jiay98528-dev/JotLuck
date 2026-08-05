import type { OfficialThemeModule } from '@/types/theme-pack';
import { recipe } from './recipe';
import { tokens } from './tokens';
import paperPreview from '@/assets/theme-assets/paper-preview.webp';
import { createOfficialThemeCopy } from '@/themes/official-copy';

export function createPaperModule(): OfficialThemeModule {
  const copy = createOfficialThemeCopy('paper');
  return {
    id: 'paper',
    name: copy.name,
    tags: ['default', 'writing', 'workflow'],
    capabilities: ['tokens', 'layout-preset', 'markdown', 'codemirror'],
    meta: {
      role: 'baseline',
      headline: copy.headline,
      story: copy.story,
      bestFor: copy.bestFor,
      visualFeatures: copy.visualFeatures,
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
}

export default createPaperModule;
