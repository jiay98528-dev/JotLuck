/** 站点级常量：发布状态、外部链接、部署域。诚实约束的唯一事实源。 */
export const SITE_URL = 'https://jotluck.com';

export const RELEASE = {
  platform: 'Windows x64',
  /** preview = 预览版已上架 GitHub Releases（当前 2026-08-12 v0.11.2-preview，公开 Pre-release）；下载按钮点亮 */
  state: 'preview' as const,
  /** Preview 事实（裁决 33）：版本/链接/校验的唯一事实源，下载页模板引用；事实值不进五语 content */
  preview: {
    version: '0.11.2-preview',
    dateISO: '2026-08-12',
    downloadUrl:
      'https://github.com/jiay98528-dev/JotLuck/releases/download/v0.11.2-preview/JotLuck_0.11.2-preview_x64-setup.exe',
    tagUrl: 'https://github.com/jiay98528-dev/JotLuck/releases/tag/v0.11.2-preview',
    sha256: '1df93e6426aa0b14d1dec3ddacc2c236880d26598d0d7a1c8968c378a75702c5',
  },
};

export const EXTERNAL = {
  githubRepo: 'https://github.com/jiay98528-dev/JotLuck',
  githubReleases: 'https://github.com/jiay98528-dev/JotLuck/releases',
  githubIssues: 'https://github.com/jiay98528-dev/JotLuck/issues/new/choose',
  /** 代码签名政策（仓库内公开政策文件；官网下载页 Preview 区链接，SignPath 审查披露项） */
  codeSigning: 'https://github.com/jiay98528-dev/JotLuck/blob/main/CODE_SIGNING.md',
  supportMail: 'official@leankom.com',
  studioMail: 'carriechan@leankom.com',
};

/** 全局默认社卡片（宣传片/02-视觉素材/社交预览/social-preview.png 转正，1280×640 中英双语） */
export const SOCIAL_CARD = '/assets/brand/social-preview.png';

/** 社卡片无障碍描述（og:image:alt；卡面本身为中英双语，alt 统一英文） */
export const SOCIAL_CARD_ALT =
  'JotLuck social card: brand mark and editor screenshot with the tagline "Files are notes. Folders are notebooks."';

/** 法律主体（JSON-LD Organization.name 的唯一事实源；页脚 copyright 在五语 content 维护，后续可统一至此） */
export const LEGAL_ENTITY = '鸰湖科技（深圳）有限公司';
/** 工作室品牌（JSON-LD Organization.alternateName） */
export const STUDIO_NAME = 'LeankomStudio';
