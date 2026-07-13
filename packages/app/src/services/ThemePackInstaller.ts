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
import { APP_THEME_VERSION } from './ThemeRegistry';
import { findUnscopedCssSelector } from './theme-css-scope';

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
  trustedCodeAuthorized?: boolean;
}

type ThemeZipInput = Blob | ArrayBuffer | Uint8Array;

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
  if (!manifestFile) throw new Error('主题包缺少 manifest.json');

  const manifest = JSON.parse(await manifestFile.async('string')) as ThemeManifestV2;
  const cssFile = zip.file('theme.css');
  const cssBytes = cssFile ? await cssFile.async('uint8array') : new Uint8Array();
  if (cssBytes.byteLength > MAX_CSS_BYTES) throw new Error('theme.css 超过大小限制');

  if (cssFile && manifest.checksums?.['theme.css']) {
    await verifyChecksum('theme.css', cssBytes, manifest.checksums['theme.css']);
  }

  const entrypoints = Array.isArray(manifest.entrypoints) ? manifest.entrypoints : [];
  for (const entrypoint of entrypoints) {
    const moduleFile = zip.file(entrypoint.module);
    if (!moduleFile) throw new Error(`主题代码入口不存在: ${entrypoint.module}`);
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
  if (issues.length > 0) throw new Error(issues.map((issue) => issue.message).join('\n'));
  return inputPackage;
}

export function validateThemePackage(input: ThemePackageInput): ThemeValidationIssue[] {
  const issues: ThemeValidationIssue[] = [];
  const { manifest } = input;
  if (!manifest.id || !/^[a-z0-9][a-z0-9._-]+$/i.test(manifest.id)) {
    issues.push({
      code: 'invalid-id',
      message: '主题 id 必须是稳定的包名格式。',
      path: 'manifest.id',
    });
  }
  if (manifest.themeApi !== 2) {
    issues.push({
      code: 'invalid-api',
      message: '仅支持 Theme API v2。',
      path: 'manifest.themeApi',
    });
  }
  if (!['declarative', 'trusted-code', 'official-code'].includes(manifest.runtime)) {
    issues.push({
      code: 'invalid-runtime',
      message: '未知主题 runtime。',
      path: 'manifest.runtime',
    });
  }
  if (manifest.runtime === 'trusted-code' && (manifest.entrypoints?.length ?? 0) === 0) {
    issues.push({
      code: 'missing-code-entrypoint',
      message: 'trusted-code 主题必须声明代码入口。',
      path: 'manifest.entrypoints',
    });
  }
  if (!manifest.checksums || typeof manifest.checksums !== 'object') {
    issues.push({
      code: 'invalid-checksums',
      message: '主题 manifest 必须提供 checksums 对象。',
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
        message: `当前版本不默认开放 ${permission} 权限。`,
        path: 'manifest.permissions',
      });
    }
  }
  if (manifest.minAppVersion > APP_THEME_VERSION) {
    issues.push({
      code: 'min-app-version',
      message: `主题要求 JotLuck ${manifest.minAppVersion} 或更高版本。`,
      path: 'manifest.minAppVersion',
    });
  }
  if (manifest.slots !== undefined && !Array.isArray(manifest.slots)) {
    issues.push({
      code: 'invalid-slots',
      message: 'manifest.slots 必须是主题 slot id 数组。',
      path: 'manifest.slots',
    });
  }
  for (const slot of Array.isArray(manifest.slots) ? manifest.slots : []) {
    if (!THEME_SLOT_IDS.has(slot)) {
      issues.push({
        code: 'unknown-slot',
        message: `manifest 声明了未知 UX slot：${String(slot)}。`,
        path: 'manifest.slots',
      });
    }
  }
  const entrypoints = Array.isArray(manifest.entrypoints) ? manifest.entrypoints : [];
  for (const [index, entrypoint] of entrypoints.entries()) {
    if (!entrypoint || typeof entrypoint !== 'object') {
      issues.push({
        code: 'invalid-entrypoint',
        message: '主题代码入口必须是对象。',
        path: `manifest.entrypoints[${index}]`,
      });
      continue;
    }
    if (!THEME_SLOT_IDS.has(entrypoint.slot)) {
      issues.push({
        code: 'unknown-slot',
        message: `代码入口声明了未知 UX slot：${String(entrypoint.slot)}。`,
        path: `manifest.entrypoints[${index}].slot`,
      });
    }
    if (typeof entrypoint.module !== 'string' || !entrypoint.module.trim()) {
      issues.push({
        code: 'invalid-entrypoint',
        message: '主题代码入口必须提供 module 路径。',
        path: `manifest.entrypoints[${index}].module`,
      });
    }
    if (Array.isArray(manifest.slots) && !manifest.slots.includes(entrypoint.slot)) {
      issues.push({
        code: 'slot-not-declared',
        message: `代码入口 slot 未出现在 manifest.slots：${String(entrypoint.slot)}。`,
        path: `manifest.entrypoints[${index}].slot`,
      });
    }
  }
  validateUxRecipeMap(input.ux, manifest, issues);
  const unscopedSelector = findUnscopedCssSelector(input.css ?? '', manifest.id);
  if (unscopedSelector) {
    issues.push({
      code: 'unscoped-css-selector',
      message: `theme.css selector must be scoped to [data-theme-id="${manifest.id}"]: ${unscopedSelector}`,
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
    issues.push({ code: 'invalid-ux', message: 'ux.json 必须是对象。', path: 'ux.json' });
    return;
  }
  for (const [slotKey, recipe] of Object.entries(ux)) {
    if (!THEME_SLOT_IDS.has(slotKey)) {
      issues.push({
        code: 'unknown-slot',
        message: `ux.json 声明了未知 UX slot：${slotKey}。`,
        path: `ux.${slotKey}`,
      });
      continue;
    }
    if (!recipe || typeof recipe !== 'object' || Array.isArray(recipe)) {
      issues.push({
        code: 'invalid-ux-recipe',
        message: `ux.${slotKey} 必须是 recipe 对象。`,
        path: `ux.${slotKey}`,
      });
      continue;
    }
    if (recipe.slot !== slotKey) {
      issues.push({
        code: 'slot-mismatch',
        message: `ux.${slotKey}.slot 必须与 map key 一致。`,
        path: `ux.${slotKey}.slot`,
      });
    }
    if (Array.isArray(manifest.slots) && !manifest.slots.includes(recipe.slot)) {
      issues.push({
        code: 'slot-not-declared',
        message: `ux recipe slot 未出现在 manifest.slots：${slotKey}。`,
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
      message: `${nodePath} 必须是 primitive 对象。`,
      path: nodePath,
    });
    return false;
  }
  const candidate = node as Partial<ThemePrimitiveNode>;
  if (typeof candidate.type !== 'string' || !THEME_PRIMITIVE_TYPES.has(candidate.type)) {
    issues.push({
      code: 'unknown-primitive',
      message: `${nodePath}.type 不是当前 DSL 支持的 primitive。`,
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
        message: `${nodePath}.action.actionId 不是当前宿主 action。`,
        path: `${nodePath}.action.actionId`,
      });
    }
  }
  if (candidate.children !== undefined) {
    if (!Array.isArray(candidate.children)) {
      issues.push({
        code: 'invalid-primitive-children',
        message: `${nodePath}.children 必须是数组。`,
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
    if (!normalized) throw new Error(`主题包路径不安全: ${entry.name}`);
    if (entry.dir) continue;

    const bytes = await entry.async('uint8array');
    totalBytes += bytes.byteLength;
    if (totalBytes > MAX_THEME_PACKAGE_BYTES) throw new Error('主题包超过大小限制');

    const allowed =
      normalized === 'manifest.json' ||
      normalized === 'theme.css' ||
      normalized === 'ux.json' ||
      normalized.startsWith('runtime/') ||
      normalized.startsWith('assets/') ||
      normalized.startsWith('preview/');
    if (!allowed) throw new Error(`主题包包含未声明目录: ${normalized}`);
    if (
      (normalized.startsWith('assets/') || normalized.startsWith('preview/')) &&
      !ALLOWED_ASSET_RE.test(normalized)
    ) {
      throw new Error(`主题资产类型不受支持: ${normalized}`);
    }
  }
}

function normalizeZipPath(path: string): string | null {
  const normalized = path.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!normalized || normalized.includes('..') || /^[a-z]+:/i.test(normalized)) return null;
  return normalized;
}

async function verifyChecksum(path: string, bytes: Uint8Array, expected: string): Promise<void> {
  if (!CHECKSUM_RE.test(expected)) throw new Error(`checksum 格式无效: ${path}`);
  const payload = new Uint8Array(bytes.byteLength);
  payload.set(bytes);
  const digest = await crypto.subtle.digest('SHA-256', payload.buffer);
  const actual = `sha256-${Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')}`;
  if (actual.toLowerCase() !== expected.toLowerCase()) {
    throw new Error(`checksum 不匹配: ${path}`);
  }
}

export function installLocalThemePackage(input: ThemePackageInput): InstalledThemePack {
  const issues = validateThemePackage(input);
  if (issues.length > 0) {
    throw new Error(issues.map((issue) => issue.message).join('\n'));
  }

  const stored: StoredThemePackage = {
    manifest: input.manifest,
    css: input.css ?? '',
    ux: input.ux,
    codeBundles: input.codeBundles,
    installedAt: Date.now(),
    trustedCodeAuthorized: true,
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

export function authorizeTrustedCodeTheme(themeId: string): void {
  void themeId;
}

export function isTrustedCodeThemeAuthorized(themeId: string): boolean {
  void themeId;
  return true;
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
    manifest: stored.manifest,
    css: stored.css,
    source: 'imported',
    installedAt: stored.installedAt,
    previewImages: stored.manifest.previewImages,
    ux: stored.ux,
    codeBundles: stored.codeBundles,
    trustedCodeAuthorized: stored.trustedCodeAuthorized ?? true,
  };
}
