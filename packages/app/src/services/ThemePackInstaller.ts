import JSZip from 'jszip';
import {
  THEME_API_VERSION,
  THEME_CAPABILITIES,
  THEME_LAYOUT_PRESETS,
  type InstalledThemePack,
  type ThemeCapability,
  type ThemeLayoutPreset,
  type ThemePackInstallResult,
  type ThemePackManifest,
  type ThemeValidationIssue,
} from '@/types/theme-pack';
import { APP_THEME_VERSION, saveInstalledThemePack } from './ThemeRegistry';

const MAX_CSS_BYTES = 256 * 1024;
const MAX_ASSET_BYTES = 2 * 1024 * 1024;
const MAX_TOTAL_BYTES = 8 * 1024 * 1024;

const SAFE_ID_RE = /^[a-z0-9][a-z0-9._-]{1,80}$/;
const SEMVER_RE = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const CHECKSUM_RE = /^sha256-[A-Za-z0-9+/=]{32,}$/;
const ALLOWED_ASSET_RE = /\.(png|jpe?g|webp|gif)$/i;

export class ThemePackError extends Error {
  readonly issues: ThemeValidationIssue[];

  constructor(message: string, issues: ThemeValidationIssue[] = []) {
    super(message);
    this.name = 'ThemePackError';
    this.issues = issues;
  }
}

type ZipInput = Blob | ArrayBuffer | Uint8Array;

export async function installThemePack(input: ZipInput): Promise<ThemePackInstallResult> {
  const result = await parseThemePack(input);
  saveInstalledThemePack(result.pack);
  return result;
}

export async function parseThemePack(input: ZipInput): Promise<ThemePackInstallResult> {
  const zip = await JSZip.loadAsync(input);
  const totalBytes = await validateZipEntries(zip);
  if (totalBytes > MAX_TOTAL_BYTES) {
    throw issue('package-too-large', `主题包解压后超过 ${formatBytes(MAX_TOTAL_BYTES)}。`);
  }

  const manifestFile = zip.file('manifest.json');
  const cssFile = zip.file('theme.css');
  if (!manifestFile || !cssFile) {
    throw issue('missing-entry', '主题包必须包含 manifest.json 和 theme.css。');
  }

  const manifest = validateManifest(JSON.parse(await manifestFile.async('string')) as unknown);
  const cssBytes = await cssFile.async('uint8array');
  if (cssBytes.byteLength > MAX_CSS_BYTES) {
    throw issue('css-too-large', `theme.css 超过 ${formatBytes(MAX_CSS_BYTES)}。`, 'theme.css');
  }

  await validateChecksum('theme.css', cssBytes, manifest.checksums['theme.css']);
  const decoder = new TextDecoder();
  const rawCss = decoder.decode(cssBytes);
  validateThemeCss(rawCss);

  const assetMap = await readAssets(zip, manifest);
  const css = rewriteAssetUrls(rawCss, assetMap);
  const previewImages = collectPreviewImages(manifest, assetMap);

  const pack: InstalledThemePack = {
    manifest,
    css,
    source: 'imported',
    installedAt: Date.now(),
    assetMap,
    previewImages,
    readonly: false,
  };

  return { pack, warnings: [] };
}

export function validateManifest(value: unknown): ThemePackManifest {
  if (!value || typeof value !== 'object') {
    throw issue('manifest-invalid', 'manifest.json 必须是对象。');
  }
  const manifest = value as Partial<ThemePackManifest>;
  const issues: ThemeValidationIssue[] = [];

  if (!manifest.id || typeof manifest.id !== 'string' || !SAFE_ID_RE.test(manifest.id)) {
    issues.push({ code: 'manifest-id', message: 'id 必须是安全的小写主题标识。' });
  }
  if (
    !manifest.version ||
    typeof manifest.version !== 'string' ||
    !SEMVER_RE.test(manifest.version)
  ) {
    issues.push({ code: 'manifest-version', message: 'version 必须是语义化版本。' });
  }
  if (manifest.themeApi !== THEME_API_VERSION) {
    issues.push({ code: 'manifest-api', message: `themeApi 必须是 ${THEME_API_VERSION}。` });
  }
  if (manifest.runtime !== 'css-v1') {
    issues.push({ code: 'manifest-runtime', message: 'Theme Pack v1 只接受 runtime: css-v1。' });
  }
  if (
    !manifest.minAppVersion ||
    typeof manifest.minAppVersion !== 'string' ||
    !SEMVER_RE.test(manifest.minAppVersion)
  ) {
    issues.push({ code: 'manifest-min-app', message: 'minAppVersion 必须是语义化版本。' });
  } else if (compareSemver(manifest.minAppVersion, APP_THEME_VERSION) > 0) {
    issues.push({
      code: 'manifest-app-too-old',
      message: `该主题要求 MarkLuck ${manifest.minAppVersion} 或更高版本。`,
    });
  }
  if (!manifest.name || typeof manifest.name !== 'string') {
    issues.push({ code: 'manifest-name', message: 'name 不能为空。' });
  }
  if (!manifest.author || typeof manifest.author !== 'string') {
    issues.push({ code: 'manifest-author', message: 'author 不能为空。' });
  }
  if (!Array.isArray(manifest.capabilities)) {
    issues.push({ code: 'manifest-capabilities', message: 'capabilities 必须是数组。' });
  } else {
    for (const capability of manifest.capabilities) {
      if (!THEME_CAPABILITIES.includes(capability as ThemeCapability)) {
        issues.push({
          code: 'manifest-capability',
          message: `未知 capability: ${String(capability)}。`,
        });
      }
    }
  }
  if (!THEME_LAYOUT_PRESETS.includes(manifest.layoutPreset as ThemeLayoutPreset)) {
    issues.push({ code: 'manifest-layout', message: 'layoutPreset 不受支持。' });
  }
  if (!manifest.checksums || typeof manifest.checksums !== 'object') {
    issues.push({ code: 'manifest-checksums', message: 'checksums 必须声明 theme.css。' });
  } else if (!manifest.checksums['theme.css']) {
    issues.push({ code: 'manifest-css-checksum', message: 'checksums.theme.css 不能为空。' });
  } else if (!CHECKSUM_RE.test(manifest.checksums['theme.css'])) {
    issues.push({
      code: 'manifest-checksum-format',
      message: 'theme.css checksum 必须使用 sha256- 前缀。',
    });
  }

  if (issues.length > 0) {
    throw new ThemePackError('主题 manifest 校验失败。', issues);
  }

  return {
    id: manifest.id!,
    version: manifest.version!,
    themeApi: THEME_API_VERSION,
    runtime: 'css-v1',
    minAppVersion: manifest.minAppVersion!,
    name: manifest.name!,
    author: manifest.author!,
    description: normalizeOptionalString(manifest.description),
    homepage: normalizeOptionalString(manifest.homepage),
    license: normalizeOptionalString(manifest.license),
    capabilities: manifest.capabilities as ThemeCapability[],
    layoutPreset: manifest.layoutPreset as ThemeLayoutPreset,
    checksums: manifest.checksums as Record<string, string>,
    previewImages: Array.isArray(manifest.previewImages)
      ? manifest.previewImages.filter((item): item is string => typeof item === 'string')
      : undefined,
    category: normalizeOptionalString(manifest.category),
    tags: Array.isArray(manifest.tags)
      ? manifest.tags.filter((item): item is string => typeof item === 'string')
      : undefined,
    price: normalizeOptionalString(manifest.price),
  };
}

export function validateThemeCss(css: string): void {
  const issues: ThemeValidationIssue[] = [];
  const lower = css.toLowerCase();
  const forbidden = [
    ['css-import', /@import\b/i, '主题 CSS 不允许使用 @import。'],
    ['remote-url', /url\(\s*['"]?(?:https?:|\/\/)/i, '主题资源不允许远程 URL。'],
    ['javascript-url', /javascript\s*:/i, '主题 CSS 不允许 javascript:。'],
    ['script-html', /<\s*script/i, '主题 CSS 不允许脚本内容。'],
    ['css-expression', /expression\s*\(/i, '主题 CSS 不允许 expression()。'],
    ['css-behavior', /\bbehavior\s*:/i, '主题 CSS 不允许 behavior。'],
    [
      'html-data',
      /data\s*:\s*(?:text\/html|application\/javascript)/i,
      '主题 CSS 不允许可执行 data URL。',
    ],
  ] as const;

  for (const [code, pattern, message] of forbidden) {
    if (pattern.test(css)) issues.push({ code, message });
  }

  if (/:focus(?:-visible)?[^{]*\{[^}]*outline\s*:\s*none/ims.test(css)) {
    issues.push({ code: 'focus-hidden', message: '主题不能移除焦点轮廓。' });
  }

  const criticalHidePattern =
    /(?:\.topbar|\.left-wing|\.right-wing|\.modal-card|\.statusbar|\.format-toolbar|\.wing-settings-btn|\.topbar-btn|\[role=['"]?(?:dialog|switch|button)['"]?\])[^{}]*\{[^}]*\b(?:display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0|pointer-events\s*:\s*none)\b/ims;
  if (criticalHidePattern.test(css)) {
    issues.push({ code: 'critical-ui-hidden', message: '主题不能隐藏或禁用核心控件。' });
  }

  if (lower.includes('position: fixed') && lower.includes('z-index: 214748')) {
    issues.push({ code: 'overlay-abuse', message: '主题不能创建覆盖应用的超高层级固定遮罩。' });
  }

  if (issues.length > 0) {
    throw new ThemePackError('主题 CSS 不符合安全规则。', issues);
  }
}

async function validateZipEntries(zip: JSZip): Promise<number> {
  let total = 0;
  const entries = Object.values(zip.files);
  for (const entry of entries) {
    const normalized = normalizeZipPath(entry.name);
    if (!normalized) {
      throw issue('unsafe-path', '主题包包含不安全路径。', entry.name);
    }
    if (entry.dir) continue;
    const bytes = await entry.async('uint8array');
    total += bytes.byteLength;
    if (normalized.startsWith('assets/') || normalized.startsWith('preview/')) {
      if (!ALLOWED_ASSET_RE.test(normalized)) {
        throw issue('asset-type', '主题资源仅支持 png、jpg、jpeg、webp、gif。', normalized);
      }
      if (bytes.byteLength > MAX_ASSET_BYTES) {
        throw issue(
          'asset-too-large',
          `单个主题资源超过 ${formatBytes(MAX_ASSET_BYTES)}。`,
          normalized,
        );
      }
    }
  }
  return total;
}

async function readAssets(
  zip: JSZip,
  manifest: ThemePackManifest,
): Promise<Record<string, string>> {
  const assetMap: Record<string, string> = {};
  for (const entry of Object.values(zip.files)) {
    const normalized = normalizeZipPath(entry.name);
    if (!normalized || entry.dir) continue;
    if (!normalized.startsWith('assets/') && !normalized.startsWith('preview/')) continue;
    const checksum = manifest.checksums[normalized];
    const bytes = await entry.async('uint8array');
    if (checksum) await validateChecksum(normalized, bytes, checksum);
    assetMap[normalized] = `data:${mimeFromPath(normalized)};base64,${bytesToBase64(bytes)}`;
  }
  return assetMap;
}

function rewriteAssetUrls(css: string, assetMap: Record<string, string>): string {
  return css.replace(
    /url\(\s*(['"]?)([^'")]+)\1\s*\)/g,
    (match, _quote: string, rawUrl: string) => {
      const url = rawUrl.trim();
      if (/^data:image\/(?:png|jpeg|jpg|webp|gif);base64,/i.test(url)) return match;
      if (/^(?:https?:|\/\/|javascript:|data:)/i.test(url)) return match;
      const normalized = normalizeCssAssetPath(url);
      if (!normalized || !assetMap[normalized]) {
        throw issue('asset-missing', '主题 CSS 引用了未打包或不安全的本地资源。', url);
      }
      return `url("${assetMap[normalized]}")`;
    },
  );
}

function collectPreviewImages(
  manifest: ThemePackManifest,
  assetMap: Record<string, string>,
): string[] | undefined {
  const previews: string[] = [];
  for (const preview of manifest.previewImages ?? []) {
    const normalized = normalizeCssAssetPath(preview);
    if (normalized && assetMap[normalized]) previews.push(assetMap[normalized]);
  }
  return previews && previews.length > 0 ? previews : undefined;
}

async function validateChecksum(path: string, bytes: Uint8Array, expected?: string): Promise<void> {
  if (!expected) return;
  if (!CHECKSUM_RE.test(expected)) {
    throw issue('checksum-format', 'checksum 必须使用 sha256- 前缀。', path);
  }
  if (!globalThis.crypto?.subtle) {
    throw issue('checksum-unavailable', '当前环境无法校验主题 checksum。', path);
  }
  const digestSource = new Uint8Array(bytes);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', digestSource.buffer);
  const actual = `sha256-${bytesToBase64(new Uint8Array(digest))}`;
  if (actual !== expected) {
    throw issue('checksum-mismatch', '主题文件 checksum 不匹配。', path);
  }
}

function normalizeZipPath(path: string): string | null {
  const normalized = path.replace(/\\/g, '/').replace(/^\.\/+/, '');
  if (normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized)) return null;
  if (normalized.split('/').some((segment) => segment === '..')) return null;
  return normalized;
}

function normalizeCssAssetPath(path: string): string | null {
  const withoutFragment = path.split('#')[0] ?? '';
  const withoutQuery = withoutFragment.split('?')[0] ?? '';
  return normalizeZipPath(withoutQuery.replace(/\\/g, '/').replace(/^\.\/+/, ''));
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function mimeFromPath(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.gif')) return 'image/gif';
  return 'application/octet-stream';
}

function normalizeOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function compareSemver(a: string, b: string): number {
  const left = (a.split(/[+-]/)[0] ?? '0.0.0').split('.').map(Number);
  const right = (b.split(/[+-]/)[0] ?? '0.0.0').split('.').map(Number);
  for (let i = 0; i < 3; i += 1) {
    const delta = (left[i] ?? 0) - (right[i] ?? 0);
    if (delta !== 0) return delta;
  }
  return 0;
}

function formatBytes(value: number): string {
  if (value >= 1024 * 1024) return `${Math.round(value / 1024 / 1024)}MB`;
  return `${Math.round(value / 1024)}KB`;
}

function issue(code: string, message: string, path?: string): ThemePackError {
  return new ThemePackError(message, [{ code, message, path }]);
}
