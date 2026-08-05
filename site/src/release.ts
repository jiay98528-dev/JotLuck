/** 站点级常量：发布状态、外部链接、部署域。诚实约束的唯一事实源。 */
export const SITE_URL = 'https://jotluck.com';

export const RELEASE = {
  /** 首个公开 Windows x64 版本的预计日期（用户裁决：沿用 2026-08-15 + 保守估计俏皮注） */
  dateISO: '2026-08-15',
  platform: 'Windows x64',
  /** prelaunch = GitHub Releases 尚无任何公开资产，下载按钮不点亮 */
  state: 'prelaunch' as const,
};

export const EXTERNAL = {
  githubRepo: 'https://github.com/jiay98528-dev/JotLuck',
  githubReleases: 'https://github.com/jiay98528-dev/JotLuck/releases',
  githubIssues: 'https://github.com/jiay98528-dev/JotLuck/issues/new/choose',
  supportMail: 'official@leankom.com',
  studioMail: 'carrie@leankom.com',
};

/** 全局默认社卡片（宣传片/02-视觉素材/社交预览/social-preview.png 转正，1280×640 中英双语） */
export const SOCIAL_CARD = '/assets/brand/social-preview.png';

/** 社卡片无障碍描述（og:image:alt；卡面本身为中英双语，alt 统一英文） */
export const SOCIAL_CARD_ALT =
  'JotLuck social card: brand mark and editor screenshot with the tagline "Files are notes. Folders are notebooks."';

/** 法律主体（页脚 copyright 与 JSON-LD Organization.name 的唯一事实源）；品牌呈现方 = LeankomStudio */
export const LEGAL_ENTITY = '鸰湖科技（深圳）有限公司';
export const STUDIO_NAME = 'LeankomStudio';
