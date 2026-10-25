import JSZip from 'jszip';
import type {
  InstalledThemePack,
  ThemeActionId,
  ThemeManifestV2,
  ThemePackageInput,
  ThemePrimitiveNode,
  ThemeUxRecipeMap,
  ThemeValidationIssue,
} from '@/types/theme-pack';
import { APP_THEME_VERSION, getAllRegistryThemePacks } from './ThemeRegistry';
import { findUnscopedCssSelector } from './theme-css-scope';
import { isSemVerAtLeast } from '@/utils/semver';
import { translate } from '@/i18n';
import { createUserMessageError } from './command-errors';

const STORAGE_KEY = 'jotluck:themes:installed:v2';
const MAX_THEME_PACKAGE_BYTES = 8 * 1024 * 1024;
const MAX_CSS_BYTES = 256 * 1024;
const ALLOWED_ASSET_RE = /\.(png|jpe?g|webp|gif|svg)$/i;
const CHECKSUM_RE = /^sha256-[a-f0-9]{64}$/i;
const ALLOWED_DEFAULT_PERMISSIONS = [
  'shell-layout',
  'component-replace',
  'visual-effects',
  'theme-storage',
  'network',
  'filesystem-read',
  'filesystem-write',
];
const THEME_SLOT_IDS = new Set<string>([
  'app-shell',
  'topbar',
  'left-wing',
  'right-wing',
  'editor-control',
  'status-bar',
  'home',
  'workflow-canvas',
  'editor-surface',
  'reader-workbench',
  'file-drawer',
  'command-palette',
  'export-dialog',
  'template-dialog',
  'settings-dialog',
  'share-dialog',
  'new-file-dialog',
  'delete-confirm-dialog',
  'external-edit-dialog',
  'scratch-exit-dialog',
  'external-reader',
  'markdown-cheat-sheet',
  'toast-container',
  'update-notification',
  'dialogs.theme',
]);
const THEME_PRIMITIVE_TYPES = new Set([
  'Stack',
  'Grid',
  'Panel',
  'Text',
  'ActionList',
  'ActionButton',
  'NoteList',
  'HeadingTree',
  'TagCloud',
  'EditorStatus',
  'ThemePreview',
  'Slot',
]);
const THEME_ACTION_IDS = new Set<ThemeActionId>([
  'new-note',
  'file-drawer',
  'search',
  'template',
  'export',
  'share',
  'theme',
  'settings',
  'view-toggle',
]);

interface StoredThemePackage {
  manifest: ThemeManifestV2;
  css: string;
  ux?: ThemeUxRecipeMap;
  codeBundles?: Record<string, string>;
  installedAt: number;
}

type ThemeZipInput = Blob | ArrayBuffer | Uint8Array;

/** registry（内置 + 本地市场）主题 id 集合：导入包不得冒用（劫持官方槽位）。 */
function registryThemeIds(): Set<string> {
  return new Set(getAllRegistryThemePacks().map((pack) => pack.manifest.id));
}

/**
 * 包内相对资源判定（L18）：仅接受 preview/ 或 assets/ 开头、无反斜杠/.. 逃逸
 * 的相对路径。http(s)/data:/blob: 协议、绝对路径（/x、C:\x）与目录逃逸一律
 * 拒绝——previewImages 会原样进 <img src>，外链值违背本地离线网络口径。
 */
function isPackageRelativeAssetPath(value: string): boolean {
  return (
    /^(preview|assets)\//i.test(value) &&
    !value.includes('\\') &&
    !value.includes('..') &&
    !/^[a-z]+:/i.test(value)
  );
}

/** 剥离仍带外链/越界值的 previewImages（防修复前已落盘的存量包回流 img src）。 */
function sanitizePreviewImages(values: string[] | undefined): string[] | undefined {
  const safe = (values ?? []).filter(
    (value) => typeof value === 'string' && isPackageRelativeAssetPath(value),
  );
  return safe.length > 0 ? safe : undefined;
}

export async function installThemePack(input: ThemeZipInput): Promise<InstalledThemePack> {
  return installLocalThemePackage(await parseThemePack(input));
}

export async function importThemePackFromFile(input: ThemeZipInput): Promise<InstalledThemePack> {
  return installThemePack(input);
}

export async function parseThemePack(input: ThemeZipInput): Promise<ThemePackageInput> {
  const zip = await JSZip.loadAsync(input);
  await validateZipEntries(zip);

  const manifestFile = zip.file('manifest.json');
  if (!manifestFile) throw createUserMessageError('theme.validation.missingManifest');

  const manifest = JSON.parse(await manifestFile.async('string')) as ThemeManifestV2;
  const cssFile = zip.file('theme.css');
  const cssBytes = cssFile ? await cssFile.async('uint8array') : new Uint8Array();
  if (cssBytes.byteLength > MAX_CSS_BYTES)
    throw createUserMessageError('theme.validation.cssTooLarge');

  if (cssFile && manifest.checksums?.['theme.css']) {
    await verifyChecksum('theme.css', cssBytes, manifest.checksums['theme.css']);
  }

  const entrypoints = Array.isArray(manifest.entrypoints) ? manifest.entrypoints : [];
  for (const entrypoint of entrypoints) {
    const moduleFile = zip.file(entrypoint.module);
    if (!moduleFile)
      throw createUserMessageError('theme.validation.missingEntrypoint', {
        path: entrypoint.module,
      });
    await verifyChecksum(
      entrypoint.module,
      await moduleFile.async('uint8array'),
      entrypoint.checksum,
    );
  }

  const codeBundles: Record<string, string> = {};
  for (const entrypoint of entrypoints) {
    const moduleFile = zip.file(entrypoint.module);
    if (moduleFile) codeBundles[entrypoint.module] = await moduleFile.async('string');
  }

  const uxFile = zip.file('ux.json');
  const ux = uxFile ? (JSON.parse(await uxFile.async('string')) as ThemeUxRecipeMap) : undefined;
  const inputPackage: ThemePackageInput = {
    manifest,
    css: cssFile ? new TextDecoder().decode(cssBytes) : '',
    ux,
    codeBundles,
  };
  const issues = validateThemePackage(inputPackage);
  if (issues.length > 0) {
    throw createUserMessageError('theme.validation.packageIssues', {
      issues: issues.map((issue) => issue.message).join('\n'),
    });
  }
  return inputPackage;
}

export function validateThemePackage(input: ThemePackageInput): ThemeValidationIssue[] {
  const issues: ThemeValidationIssue[] = [];
  const { manifest } = input;
  if (!manifest.id || !/^[a-z0-9][a-z0-9._-]+$/i.test(manifest.id)) {
    issues.push({
      code: 'invalid-id',
      message: translate('theme.validation.invalidId'),
      path: 'manifest.id',
    });
  }
  // 内置/本地市场 id 保留校验（L17）：主题合并列表里 installed 后写会顶替同 id
  // 的 registry 包——导入包冒用 'paper' 等 id 即可劫持官方主题槽位，须拒绝。
  if (manifest.id && registryThemeIds().has(manifest.id)) {
    issues.push({
      code: 'reserved-id',
      message: translate('theme.validation.reservedId', { id: manifest.id }),
      path: 'manifest.id',
    });
  }
  // previewImages 仅放行包内相对资源（L18）：http(s)/data:/blob: 协议、绝对
  // 路径与 .. 逃逸值会原样进 <img src> 外联任意域，违背本地离线网络口径。
  const previewImages = manifest.previewImages;
  if (previewImages !== undefined) {
    if (!Array.isArray(previewImages)) {
      issues.push({
        code: 'invalid-preview-images',
        message: translate('theme.validation.invalidPreviewImages'),
        path: 'manifest.previewImages',
      });
    } else {
      for (const image of previewImages) {
        if (typeof image !== 'string' || !isPackageRelativeAssetPath(image)) {
          issues.push({
            code: 'invalid-preview-image',
            message: translate('theme.validation.invalidPreviewImage', {
              value: String(image),
            }),
            path: 'manifest.previewImages',
          });
        }
      }
    }
  }
  if (manifest.themeApi !== 2) {
    issues.push({
      code: 'invalid-api',
      message: translate('theme.validation.invalidApi'),
      path: 'manifest.themeApi',
    });
  }
  if (!['declarative', 'trusted-code', 'official-code'].includes(manifest.runtime)) {
    issues.push({
      code: 'invalid-runtime',
      message: translate('theme.validation.invalidRuntime'),
      path: 'manifest.runtime',
    });
  }
  if (manifest.runtime === 'trusted-code' && (manifest.entrypoints?.length ?? 0) === 0) {
    issues.push({
      code: 'missing-code-entrypoint',
      message: translate('theme.validation.missingCodeEntrypoint'),
      path: 'manifest.entrypoints',
    });
  }
  if (!manifest.checksums || typeof manifest.checksums !== 'object') {
    issues.push({
      code: 'invalid-checksums',
      message: translate('theme.validation.invalidChecksums'),
      path: 'manifest.checksums',
    });
  }
  for (const permission of Array.isArray(manifest.permissions) ? manifest.permissions : []) {
    if (
      !ALLOWED_DEFAULT_PERMISSIONS.includes(permission) &&
      (permission === 'network' ||
        permission === 'filesystem-read' ||
        permission === 'filesystem-write')
    ) {
      issues.push({
        code: 'unknown-permission-declaration',
        message: translate('theme.validation.permissionUnavailable', { permission }),
        path: 'manifest.permissions',
      });
    }
  }
  if (!isSemVerAtLeast(APP_THEME_VERSION, manifest.minAppVersion)) {
    issues.push({
      code: 'min-app-version',
      message: translate('theme.validation.minAppVersion', { version: manifest.minAppVersion }),
      path: 'manifest.minAppVersion',
    });
  }
  if (manifest.slots !== undefined && !Array.isArray(manifest.slots)) {
    issues.push({
      code: 'invalid-slots',
      message: translate('theme.validation.invalidSlots'),
      path: 'manifest.slots',
    });
  }
  for (const slot of Array.isArray(manifest.slots) ? manifest.slots : []) {
    if (!THEME_SLOT_IDS.has(slot)) {
      issues.push({
        code: 'unknown-slot',
        message: translate('theme.validation.unknownSlot', { slot: String(slot) }),
        path: 'manifest.slots',
      });
    }
  }
  const entrypoints = Array.isArray(manifest.entrypoints) ? manifest.entrypoints : [];
  for (const [index, entrypoint] of entrypoints.entries()) {
    if (!entrypoint || typeof entrypoint !== 'object') {
      issues.push({
        code: 'invalid-entrypoint',
        message: translate('theme.validation.invalidEntrypoint'),
        path: `manifest.entrypoints[${index}]`,
      });
      continue;
    }
    if (!THEME_SLOT_IDS.has(entrypoint.slot)) {
      issues.push({
        code: 'unknown-slot',
        message: translate('theme.validation.unknownSlot', { slot: String(entrypoint.slot) }),
        path: `manifest.entrypoints[${index}].slot`,
      });
    }
    if (typeof entrypoint.module !== 'string' || !entrypoint.module.trim()) {
      issues.push({
        code: 'invalid-entrypoint',
        message: translate('theme.validation.missingModule'),
        path: `manifest.entrypoints[${index}].module`,
      });
    }
    if (Array.isArray(manifest.slots) && !manifest.slots.includes(entrypoint.slot)) {
      issues.push({
        code: 'slot-not-declared',
        message: translate('theme.validation.slotNotDeclared', {
          slot: String(entrypoint.slot),
        }),
        path: `manifest.entrypoints[${index}].slot`,
      });
    }
  }
  validateUxRecipeMap(input.ux, manifest, issues);
  const unscopedSelector = findUnscopedCssSelector(input.css ?? '', manifest.id);
  if (unscopedSelector) {
    issues.push({
      code: 'unscoped-css-selector',
      message: translate('theme.validation.unscopedCss', {
        id: manifest.id,
        selector: unscopedSelector,
      }),
      path: 'theme.css',
    });
  }
  return issues;
}

function validateUxRecipeMap(
  ux: ThemeUxRecipeMap | undefined,
  manifest: ThemeManifestV2,
  issues: ThemeValidationIssue[],
): void {
  if (ux === undefined) return;
  if (!ux || typeof ux !== 'object' || Array.isArray(ux)) {
    issues.push({
      code: 'invalid-ux',
      message: translate('theme.validation.invalidUx'),
      path: 'ux.json',
    });
    return;
  }
  for (const [slotKey, recipe] of Object.entries(ux)) {
    if (!THEME_SLOT_IDS.has(slotKey)) {
      issues.push({
        code: 'unknown-slot',
        message: translate('theme.validation.unknownSlot', { slot: slotKey }),
        path: `ux.${slotKey}`,
      });
      continue;
    }
    if (!recipe || typeof recipe !== 'object' || Array.isArray(recipe)) {
      issues.push({
        code: 'invalid-ux-recipe',
        message: translate('theme.validation.invalidUxRecipe', { slot: slotKey }),
        path: `ux.${slotKey}`,
      });
      continue;
    }
    if (recipe.slot !== slotKey) {
      issues.push({
        code: 'slot-mismatch',
        message: translate('theme.validation.slotMismatch', { slot: slotKey }),
        path: `ux.${slotKey}.slot`,
      });
    }
    if (Array.isArray(manifest.slots) && !manifest.slots.includes(recipe.slot)) {
      issues.push({
        code: 'slot-not-declared',
        message: translate('theme.validation.slotNotDeclared', { slot: slotKey }),
        path: `ux.${slotKey}`,
      });
    }
    validatePrimitiveNode(recipe.root, `ux.${slotKey}.root`, issues);
  }
}

function validatePrimitiveNode(
  node: unknown,
  nodePath: string,
  issues: ThemeValidationIssue[],
): node is ThemePrimitiveNode {
  if (!node || typeof node !== 'object' || Array.isArray(node)) {
    issues.push({
      code: 'invalid-primitive',
      message: translate('theme.validation.invalidPrimitive', { path: nodePath }),
      path: nodePath,
    });
    return false;
  }
  const candidate = node as Partial<ThemePrimitiveNode>;
  if (typeof candidate.type !== 'string' || !THEME_PRIMITIVE_TYPES.has(candidate.type)) {
    issues.push({
      code: 'unknown-primitive',
      message: translate('theme.validation.unknownPrimitive', { path: nodePath }),
      path: `${nodePath}.type`,
    });
  }
  if (candidate.action !== undefined) {
    const action = candidate.action as { actionId?: unknown };
    if (
      !action ||
      typeof action.actionId !== 'string' ||
      !THEME_ACTION_IDS.has(action.actionId as ThemeActionId)
    ) {
      issues.push({
        code: 'unknown-action',
        message: translate('theme.validation.unknownAction', { path: nodePath }),
        path: `${nodePath}.action.actionId`,
      });
    }
  }
  if (candidate.children !== undefined) {
    if (!Array.isArray(candidate.children)) {
      issues.push({
        code: 'invalid-primitive-children',
        message: translate('theme.validation.invalidChildren', { path: nodePath }),
        path: `${nodePath}.children`,
      });
    } else {
      candidate.children.forEach((child, index) =>
        validatePrimitiveNode(child, `${nodePath}.children[${index}]`, issues),
      );
    }
  }
  return true;
}

async function validateZipEntries(zip: JSZip): Promise<void> {
  let totalBytes = 0;
  for (const entry of Object.values(zip.files)) {
    const normalized = normalizeZipPath(entry.name);
    if (!normalized)
      throw createUserMessageError('theme.validation.unsafePath', { path: entry.name });
    if (entry.dir) continue;

    const bytes = await entry.async('uint8array');
    totalBytes += bytes.byteLength;
    if (totalBytes > MAX_THEME_PACKAGE_BYTES)
      throw createUserMessageError('theme.validation.packageTooLarge');

    const allowed =
      normalized === 'manifest.json' ||
      normalized === 'theme.css' ||
      normalized === 'ux.json' ||
      normalized.startsWith('runtime/') ||
      normalized.startsWith('assets/') ||
      normalized.startsWith('preview/');
    if (!allowed)
      throw createUserMessageError('theme.validation.undeclaredPath', { path: normalized });
    if (
      (normalized.startsWith('assets/') || normalized.startsWith('preview/')) &&
      !ALLOWED_ASSET_RE.test(normalized)
    ) {
      throw createUserMessageError('theme.validation.unsupportedAsset', { path: normalized });
    }
  }
}

function normalizeZipPath(path: string): string | null {
  const normalized = path.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!normalized || normalized.includes('..') || /^[a-z]+:/i.test(normalized)) return null;
  return normalized;
}

async function verifyChecksum(path: string, bytes: Uint8Array, expected: string): Promise<void> {
  if (!CHECKSUM_RE.test(expected))
    throw createUserMessageError('theme.validation.invalidChecksum', { path });
  const payload = new Uint8Array(bytes.byteLength);
  payload.set(bytes);
  const digest = await crypto.subtle.digest('SHA-256', payload);
  const actual = `sha256-${Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')}`;
  if (actual.toLowerCase() !== expected.toLowerCase()) {
    throw createUserMessageError('theme.validation.checksumMismatch', { path });
  }
}

export function installLocalThemePackage(input: ThemePackageInput): InstalledThemePack {
  const issues = validateThemePackage(input);
  if (issues.length > 0) {
    throw createUserMessageError('theme.validation.packageIssues', {
      issues: issues.map((issue) => issue.message).join('\n'),
    });
  }

  const stored: StoredThemePackage = {
    // 存量防线：即便校验被绕过/旧版本落盘，写入与读取两侧都剥离外链
    // previewImages，保证任何路径都到不了 <img src>。
    manifest: {
      ...input.manifest,
      previewImages: sanitizePreviewImages(input.manifest.previewImages),
    },
    css: input.css ?? '',
    ux: input.ux,
    codeBundles: input.codeBundles,
    installedAt: Date.now(),
  };
  const all = loadStoredThemePackages().filter((item) => item.manifest.id !== input.manifest.id);
  all.unshift(stored);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  return storedToInstalled(stored);
}

export function loadInstalledThemePacks(): InstalledThemePack[] {
  return loadStoredThemePackages().map(storedToInstalled);
}

export function removeInstalledThemePack(themeId: string): InstalledThemePack[] {
  const next = loadStoredThemePackages().filter((item) => item.manifest.id !== themeId);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  return next.map(storedToInstalled);
}

function loadStoredThemePackages(): StoredThemePackage[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as StoredThemePackage[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function storedToInstalled(stored: StoredThemePackage): InstalledThemePack {
  return {
    // 读取侧同步剥离（含 manifest 字段）：修复前已落盘的存量包可能仍带外链
    // 值，ThemeDialog 的 previewImage() 会回落 manifest.previewImages，两处都要干净。
    manifest: {
      ...stored.manifest,
      previewImages: sanitizePreviewImages(stored.manifest.previewImages),
    },
    css: stored.css,
    source: 'imported',
    installedAt: stored.installedAt,
    previewImages: sanitizePreviewImages(stored.manifest.previewImages),
    ux: stored.ux,
    codeBundles: stored.codeBundles,
  };
}
