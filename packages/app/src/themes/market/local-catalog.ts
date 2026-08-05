import createAbilityLabModule from '../ability-lab';
import createHaloCanvasModule from '../halo-canvas';
import createLumenFieldModule from '../lumen-field';
import createSuperWorkbenchModule from '../super-workbench';
import type { OfficialThemeModule } from '@/types/theme-pack';

export function getLocalMarketModules(): OfficialThemeModule[] {
  return [
    createAbilityLabModule(),
    createHaloCanvasModule(),
    createLumenFieldModule(),
    createSuperWorkbenchModule(),
  ];
}
