import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { parseThemePack, ThemePackError, validateThemeCss } from '../ThemePackInstaller';

const encoder = new TextEncoder();

describe('ThemePackInstaller', () => {
  it('parses a valid css-v1 theme pack and rewrites local assets', async () => {
    const pack = await createThemePack({
      css: `
[data-theme-id='local.test'] {
  --theme-bg-image: url("./assets/bg.png");
  --accent: oklch(0.5 0.1 120);
}
`,
      files: {
        'assets/bg.png': new Uint8Array([137, 80, 78, 71]),
      },
    });

    const result = await parseThemePack(pack);

    expect(result.pack.manifest.id).toBe('local.test');
    expect(result.pack.manifest.layoutPreset).toBe('archive');
    expect(result.pack.css).toContain('data:image/png;base64');
  });

  it('rejects unsupported plugin runtimes in v1', async () => {
    const pack = await createThemePack({
      manifest: { runtime: 'sandboxed-plugin-v2' },
    });

    await expect(parseThemePack(pack)).rejects.toMatchObject({
      issues: [expect.objectContaining({ code: 'manifest-runtime' })],
    });
  });

  it('rejects remote URLs and @import rules', () => {
    expect(() => validateThemeCss('@import url("theme.css");')).toThrow(ThemePackError);
    expect(() =>
      validateThemeCss(
        '[data-theme-id="x"] { --theme-bg-image: url("https://example.com/a.png"); }',
      ),
    ).toThrow(ThemePackError);
  });

  it('rejects path traversal entries', async () => {
    const zip = new JSZip();
    zip.file('../escape.png', new Uint8Array([1]));
    zip.file('theme.css', '');
    zip.file(
      'manifest.json',
      JSON.stringify({
        ...baseManifest(),
        checksums: { 'theme.css': await checksumBytes(encoder.encode('')) },
      }),
    );

    await expect(
      zip.generateAsync({ type: 'arraybuffer' }).then(parseThemePack),
    ).rejects.toMatchObject({
      issues: [expect.objectContaining({ code: 'unsafe-path' })],
    });
  });

  it('rejects checksum mismatch', async () => {
    const pack = await createThemePack({
      manifest: {
        checksums: { 'theme.css': 'sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' },
      },
    });

    await expect(parseThemePack(pack)).rejects.toMatchObject({
      issues: [expect.objectContaining({ code: 'checksum-mismatch' })],
    });
  });

  it('rejects attempts to hide critical controls or focus rings', () => {
    expect(() => validateThemeCss('.topbar { display: none; }')).toThrow(ThemePackError);
    expect(() => validateThemeCss('button:focus-visible { outline: none; }')).toThrow(
      ThemePackError,
    );
  });

  it('rejects local theme attempts to control official deep chrome', () => {
    expect(() =>
      validateThemeCss("[data-theme-id='local.test'] { --wing-left-width: 96px; }"),
    ).toThrow(ThemePackError);
    expect(() =>
      validateThemeCss("[data-theme-id='local.test'] { --editor-max-width: 960px; }"),
    ).toThrow(ThemePackError);
    expect(() =>
      validateThemeCss("[data-effect-profile='immersive'] .topbar { opacity: 0.9; }"),
    ).toThrow(ThemePackError);
    expect(() =>
      validateThemeCss("[data-theme-id='local.test'] { --theme-workflow-mode: reader; }"),
    ).toThrow(ThemePackError);
    expect(() =>
      validateThemeCss("[data-theme-id='local.test'] { --theme-action-search-region: topbar; }"),
    ).toThrow(ThemePackError);
    expect(() =>
      validateThemeCss("[data-workspace-intent='studio'] .topbar { opacity: 0.9; }"),
    ).toThrow(ThemePackError);
    expect(() =>
      validateThemeCss("[data-editor-control-layout='studio-rail'] .format-toolbar { gap: 0; }"),
    ).toThrow(ThemePackError);
  });
});

async function createThemePack(options?: {
  css?: string;
  manifest?: Record<string, unknown>;
  files?: Record<string, Uint8Array>;
}): Promise<ArrayBuffer> {
  const css = options?.css ?? '[data-theme-id="local.test"] { --accent: oklch(0.5 0.1 120); }';
  const files = options?.files ?? {};
  const zip = new JSZip();
  zip.file('theme.css', css);
  for (const [path, content] of Object.entries(files)) {
    zip.file(path, content);
  }
  const manifest = {
    ...baseManifest(),
    checksums: {
      'theme.css': await checksumBytes(encoder.encode(css)),
    },
    ...options?.manifest,
  };
  zip.file('manifest.json', JSON.stringify(manifest));
  return zip.generateAsync({ type: 'arraybuffer' });
}

function baseManifest(): Record<string, unknown> {
  return {
    id: 'local.test',
    version: '1.0.0',
    themeApi: 1,
    runtime: 'css-v1',
    minAppVersion: '0.15.0',
    name: 'Local Test',
    author: 'Test',
    capabilities: ['tokens', 'assets', 'layout-preset'],
    layoutPreset: 'archive',
    checksums: {},
  };
}

async function checksumBytes(bytes: Uint8Array): Promise<string> {
  const digestSource = new Uint8Array(bytes);
  const digest = await crypto.subtle.digest('SHA-256', digestSource.buffer);
  return `sha256-${bytesToBase64(new Uint8Array(digest))}`;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}
