export type LocaleId = 'en' | 'ja' | 'zh-hans' | 'zh-hant' | 'ko' | 'fr';

export type SiteRouteId =
  | 'home'
  | 'product'
  | 'download'
  | 'themes'
  | 'support'
  | 'services'
  | 'studio'
  | 'privacy';

export type ReleaseState =
  | {
      kind: 'prelaunch';
      targetPlatform: 'Windows x64';
      reviewDate: '2026-08-15';
    }
  | {
      kind: 'available';
      version: string;
      platform: string;
      assetUrl: `https://github.com/${string}`;
      checksum: string;
    };

export interface PageCopy {
  eyebrow: string;
  title: string;
  lead: string;
  note?: string;
}

export interface SiteContent {
  locale: LocaleId;
  htmlLang: string;
  domain: string;
  localeLabel: string;
  nav: Record<'product' | 'download' | 'themes' | 'support', string>;
  common: {
    releaseProgress: string;
    sourceCode: string;
    prelaunch: string;
    notAvailable: string;
    footerTruth: string;
    language: string;
  };
  hero: {
    voice: string;
    emphasis: string;
    releaseNote: string;
  };
  pages: Record<Exclude<SiteRouteId, 'home'>, PageCopy>;
}
