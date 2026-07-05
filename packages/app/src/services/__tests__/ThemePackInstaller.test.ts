import { beforeEach, describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import {
  importThemePackFromFile,
  installLocalThemePackage,
  loadInstalledThemePacks,
  parseThemePack,
  removeInstalledThemePack,
  validateThemePackage,
} from '../ThemePackInstaller';
import type { ThemeManifestV2 } from '@/types/theme-pack';

function manifest(overrides: Partial<ThemeManifestV2> = {}): ThemeManifestV2 {
  return {
    id: 'local.test-theme',
    version: '1.0.0',
    themeApi: 2,
    runtime: 'declarative',
    minAppVersion: '0.15.0',
    name: 'Test Theme',
    author: 'Tester',
    capabilities: ['tokens', 'layout-preset'],
    permissions: ['shell-layout'],
    layoutPreset: 'focus',
    checksums: { 'theme.css': 'sha256-test' },
    ...overrides,
  };
}

describe('ThemePackInstaller', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('validates declarative theme packages', () => {
    expect(validateThemePackage({ manifest: manifest() })).toEqual([]);
  });

  it('rejects unscoped theme css selectors', () => {
    const issues = validateThemePackage({
      manifest: manifest(),
      css: 'body { background: red; }',
    });

    expect(issues.map((issue) => issue.code)).toContain('unscoped-css-selector');
  });

  it('allows scoped selectors inside media rules and keyframes', () => {
    const issues = validateThemePackage({
      manifest: manifest(),
      css: `
        @media (min-width: 800px) {
          [data-theme-id="local.test-theme"] .editor-shell { opacity: 1; }
        }
        @keyframes local-fade { from { opacity: 0; } to { opacity: 1; } }
      `,
    });

    expect(issues).toEqual([]);
  });

  it('keeps network and filesystem permissions as declarations, not install blockers', () => {
    const issues = validateThemePackage({
      manifest: manifest({ permissions: ['shell-layout', 'network', 'filesystem-write'] }),
    });

    expect(issues).toEqual([]);
  });

  it('requires an entrypoint for trusted-code themes', () => {
    const issues = validateThemePackage({
      manifest: manifest({ runtime: 'trusted-code', permissions: ['component-replace'] }),
    });

    expect(issues.map((issue) => issue.code)).toContain('missing-code-entrypoint');
  });

  it('installs, loads, and removes a local theme without trusted-code authorization gates', () => {
    const pack = installLocalThemePackage({
      manifest: manifest(),
      css: "[data-theme-id='local.test-theme'] { --accent: oklch(58% 0.12 180); }",
    });

    expect(pack.source).toBe('imported');
    expect(pack.trustedCodeAuthorized).toBe(true);
    expect(loadInstalledThemePacks()).toHaveLength(1);

    removeInstalledThemePack(pack.manifest.id);
    expect(loadInstalledThemePacks()).toHaveLength(0);
  });

  it('parses a .mltheme zip package with checksum validation', async () => {
    const css = "[data-theme-id='local.test-theme'] { --accent: oklch(58% 0.12 180); }";
    const zip = new JSZip();
    const cssChecksum = await sha256(css);
    zip.file(
      'manifest.json',
      JSON.stringify(manifest({ checksums: { 'theme.css': cssChecksum } })),
    );
    zip.file('theme.css', css);
    zip.file(
      'ux.json',
      JSON.stringify({
        topbar: {
          slot: 'topbar',
          root: { type: 'Text', text: 'Local Theme' },
        },
      }),
    );

    const parsed = await parseThemePack(await zip.generateAsync({ type: 'uint8array' }));

    expect(parsed.manifest.id).toBe('local.test-theme');
    expect(parsed.css).toContain('--accent');
    expect(parsed.ux?.topbar?.slot).toBe('topbar');
  });

  it('imports a .mltheme zip through the product import API', async () => {
    const css = "[data-theme-id='local.import-theme'] { --accent: oklch(58% 0.12 180); }";
    const zip = new JSZip();
    zip.file(
      'manifest.json',
      JSON.stringify(
        manifest({
          id: 'local.import-theme',
          name: 'Local Import Theme',
          checksums: { 'theme.css': await sha256(css) },
          channel: 'imported',
          licenseKind: 'free',
          sku: 'local.import-theme@1.0.0',
        }),
      ),
    );
    zip.file('theme.css', css);

    const installed = await importThemePackFromFile(
      await zip.generateAsync({ type: 'uint8array' }),
    );

    expect(installed.manifest.id).toBe('local.import-theme');
    expect(installed.source).toBe('imported');
    expect(installed.css).toContain('--accent');
    expect(loadInstalledThemePacks()).toHaveLength(1);
  });

  it('rejects imported .mltheme zip packages with global css selectors', async () => {
    const css = 'body { color: red; }';
    const zip = new JSZip();
    zip.file(
      'manifest.json',
      JSON.stringify(manifest({ checksums: { 'theme.css': await sha256(css) } })),
    );
    zip.file('theme.css', css);

    await expect(parseThemePack(await zip.generateAsync({ type: 'uint8array' }))).rejects.toThrow(
      'selector must be scoped',
    );
  });

  it('parses trusted-code entrypoints into installed code bundles', async () => {
    const css = "[data-theme-id='local.code-theme'] { --accent: oklch(62% 0.14 210); }";
    const code = 'export default { components: {} };';
    const zip = new JSZip();
    zip.file(
      'manifest.json',
      JSON.stringify(
        manifest({
          id: 'local.code-theme',
          runtime: 'trusted-code',
          permissions: ['component-replace', 'theme-storage'],
          checksums: { 'theme.css': await sha256(css) },
          entrypoints: [
            {
              slot: 'topbar',
              module: 'runtime/theme.js',
              checksum: await sha256(code),
            },
          ],
        }),
      ),
    );
    zip.file('theme.css', css);
    zip.file('runtime/theme.js', code);

    const parsed = await parseThemePack(await zip.generateAsync({ type: 'uint8array' }));

    expect(parsed.manifest.runtime).toBe('trusted-code');
    expect(parsed.codeBundles?.['runtime/theme.js']).toBe(code);
  });
});

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return `sha256-${Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')}`;
}
