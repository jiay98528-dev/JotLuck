import { translate } from '@/i18n';

export type OfficialThemeLocaleKey =
  | 'paper'
  | 'abilityLab'
  | 'haloCanvas'
  | 'lumenField'
  | 'superWorkbench';

export interface OfficialThemeCopy {
  name: string;
  headline: string;
  story: string;
  bestFor: string[];
  visualFeatures: string[];
}

export function createOfficialThemeCopy(key: OfficialThemeLocaleKey): OfficialThemeCopy {
  const prefix = `theme.official.${key}`;
  const tr = (field: 'name' | 'headline' | 'story' | 'bestFor' | 'features'): string => {
    // i18n-dynamic-key: key and field are closed literal unions for official themes.
    return translate(`${prefix}.${field}`);
  };
  return {
    name: tr('name'),
    headline: tr('headline'),
    story: tr('story'),
    bestFor: tr('bestFor').split('|'),
    visualFeatures: tr('features').split('|'),
  };
}
