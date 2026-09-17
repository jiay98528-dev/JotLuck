import manifestJson from '../public/updates/v1.json';
import archivedPreviewJson from '../public/updates/archive/v0.14.0-preview.json';

/** 站点级常量：发布状态、外部链接、部署域。版本事实来自更新清单。 */
export const SITE_URL = 'https://jotluck.com';

export type UpdateChannel = 'stable' | 'preview';
export type UpdateOs = 'windows' | 'macos' | 'linux';
export type UpdateArch = 'x86_64' | 'aarch64';
export type UpdatePackageType = 'nsis' | 'dmg' | 'deb' | 'appimage';

export interface UpdateAsset {
  os: UpdateOs;
  arch: UpdateArch;
  packageType: UpdatePackageType;
  name: string;
  url: string;
  size: number;
  sha256: string;
}

export interface UpdateRelease {
  version: string;
  tag: string;
  publishedAt: string;
  notes: string;
  releaseUrl: string;
  assets: UpdateAsset[];
}

export interface UpdateManifest {
  schemaVersion: 1;
  channels: Record<UpdateChannel, { enabled: boolean; release: UpdateRelease | null }>;
}

export interface ReleaseViewAsset {
  asset: UpdateAsset;
  version: string;
  releaseUrl: string;
  isCurrent: boolean;
}

export const UPDATE_MANIFEST = manifestJson as UpdateManifest;

function enabledRelease(channel: UpdateChannel): UpdateRelease | null {
  const entry = UPDATE_MANIFEST.channels[channel];
  return entry.enabled ? entry.release : null;
}

const previewRelease = enabledRelease('preview');
const stableRelease = enabledRelease('stable');
const currentChannel: UpdateChannel | null = stableRelease
  ? 'stable'
  : previewRelease
    ? 'preview'
    : null;
const currentRelease = stableRelease ?? previewRelease;
function releaseView(release: UpdateRelease | null) {
  if (!release) return null;
  const windowsAsset = release.assets.find(
    (asset) => asset.os === 'windows' && asset.arch === 'x86_64' && asset.packageType === 'nsis',
  );
  const linuxAsset = release.assets.find(
    (asset) => asset.os === 'linux' && asset.arch === 'x86_64' && asset.packageType === 'deb',
  );
  const macosAsset = release.assets.find(
    (asset) => asset.os === 'macos' && asset.arch === 'aarch64' && asset.packageType === 'dmg',
  );
  return {
    version: release.version,
    dateISO: release.publishedAt.slice(0, 10),
    downloadUrl: windowsAsset?.url,
    tagUrl: release.releaseUrl,
    sha256: windowsAsset?.sha256,
    linuxDeb: linuxAsset ? { downloadUrl: linuxAsset.url, sha256: linuxAsset.sha256 } : undefined,
    macosDmg: macosAsset ? { downloadUrl: macosAsset.url, sha256: macosAsset.sha256 } : undefined,
    assets: release.assets,
  };
}

const archivePreviewRelease = (archivedPreviewJson as UpdateManifest).channels.preview.release;
const platformSpecs = [
  { key: 'windows', os: 'windows' as const, arch: 'x86_64' as const, packageType: 'nsis' as const },
  { key: 'macos', os: 'macos' as const, arch: 'aarch64' as const, packageType: 'dmg' as const },
  { key: 'linux', os: 'linux' as const, arch: 'x86_64' as const, packageType: 'deb' as const },
] as const;

/**
 * 每个平台独立选择可下载产物。新 preview 只发布 macOS 时，Windows/Linux
 * 明确回退到归档的 0.14 事实，避免把旧产物冒充成当前版本。
 */
const platformReleases: Array<ReleaseViewAsset | null> = platformSpecs.map((spec) => {
  const currentAsset = currentRelease?.assets.find(
    (asset) =>
      asset.os === spec.os && asset.arch === spec.arch && asset.packageType === spec.packageType,
  );
  if (currentAsset && currentRelease) {
    return {
      asset: currentAsset,
      version: currentRelease.version,
      releaseUrl: currentRelease.releaseUrl,
      isCurrent: true,
    };
  }
  const archivedAsset = archivePreviewRelease?.assets.find(
    (asset) =>
      asset.os === spec.os && asset.arch === spec.arch && asset.packageType === spec.packageType,
  );
  if (archivedAsset && archivePreviewRelease) {
    return {
      asset: archivedAsset,
      version: archivePreviewRelease.version,
      releaseUrl: archivePreviewRelease.releaseUrl,
      isCurrent: false,
    };
  }
  return null;
});

export const RELEASE = {
  platform: 'macOS Apple Silicon (current preview) · Windows x64 / Linux x86_64 (previous preview)',
  /** 发布状态由 public/updates/v1.json 的已启用渠道派生。 */
  state: currentChannel ?? ('withdrawn' as const),
  manifest: UPDATE_MANIFEST,
  current: releaseView(currentRelease),
  preview: releaseView(previewRelease),
  platforms: platformReleases,
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
