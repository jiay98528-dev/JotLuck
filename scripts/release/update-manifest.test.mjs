import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { assetFromFile, buildManifest } from './generate-update-manifest.mjs';
import { validateManifest, verifyPublicManifest } from './verify-update-manifest.mjs';
import { isStrictSemVer } from './semver.mjs';

const release = {
  version: '1.2.3-preview',
  tag: 'v1.2.3-preview',
  publishedAt: '2026-09-17T00:00:00Z',
  notes: 'Preview notes',
  releaseUrl: 'https://github.com/jiay98528-dev/JotLuck/releases/tag/v1.2.3-preview',
  assets: [
    {
      os: 'windows',
      arch: 'x86_64',
      packageType: 'nsis',
      name: 'JotLuck.exe',
      url: 'https://github.com/jiay98528-dev/JotLuck/releases/download/v1.2.3-preview/JotLuck.exe',
      size: 4,
      sha256: createHash('sha256').update('test').digest('hex'),
    },
  ],
};
const projectRoot = path.resolve(import.meta.dirname, '../..');

describe('public update manifest', () => {
  it('uses strict SemVer 2.0 validation for prerelease and build metadata', () => {
    expect(isStrictSemVer('1.2.3-01')).toBe(false);
    expect(isStrictSemVer('1.2.3+build.7')).toBe(true);
    expect(isStrictSemVer('1.2.3-alpha.01')).toBe(false);
  });
  it('hashes a local release file and derives its exact GitHub URL', () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'jotluck-release-'));
    const file = path.join(directory, 'JotLuck_1.2.3_x64-setup.exe');
    writeFileSync(file, 'installer');
    const asset = assetFromFile({
      os: 'windows',
      arch: 'x86_64',
      packageType: 'nsis',
      filePath: file,
      baseUrl: 'https://github.com/jiay98528-dev/JotLuck/releases/download/v1.2.3-preview',
    });
    rmSync(directory, { recursive: true, force: true });
    expect(asset.size).toBe(9);
    expect(asset.sha256).toBe(createHash('sha256').update('installer').digest('hex'));
    expect(asset.url).toContain('/releases/download/v1.2.3-preview/');
  });

  it('emits only stable and preview channels with null disabled channels', () => {
    const manifest = buildManifest({
      channel: 'preview',
      version: release.version,
      tag: release.tag,
      publishedAt: release.publishedAt,
      notes: release.notes,
      releaseUrl: release.releaseUrl,
      assets: release.assets,
    });
    expect(manifest.channels.stable).toEqual({ enabled: false, release: null });
    expect(manifest.channels.preview.release.tag).toBe(release.tag);
    validateManifest(manifest);
  });

  it('keeps the public manifest as the only checked-in website release source', () => {
    const publicManifest = path.join(projectRoot, 'site/public/updates/v1.json');
    expect(existsSync(publicManifest)).toBe(true);
    expect(existsSync(path.join(projectRoot, 'site/src/update-manifest.json'))).toBe(false);
    validateManifest(JSON.parse(readFileSync(publicManifest, 'utf8')));
  });

  it('keeps the previous preview assets in an explicit archive for platform fallback', () => {
    const archivePath = path.join(
      projectRoot,
      'site/public/updates/archive/v0.14.0-preview.json',
    );
    expect(existsSync(archivePath)).toBe(true);
    const archive = JSON.parse(readFileSync(archivePath, 'utf8'));
    const archivedRelease = archive.channels.preview.release;
    expect(archivedRelease.version).toBe('0.14.0-preview');
    expect(archivedRelease.assets.map((asset) => asset.os).sort()).toEqual([
      'linux',
      'macos',
      'windows',
    ]);
    validateManifest(archive);
  });

  it('preserves the other channel when generating a release', () => {
    const existing = {
      schemaVersion: 1,
      channels: {
        stable: { enabled: false, release: null },
        preview: { enabled: true, release },
      },
    };
    const stable = {
      ...release,
      version: '2.0.0',
      tag: 'v2.0.0',
      releaseUrl: 'https://github.com/jiay98528-dev/JotLuck/releases/tag/v2.0.0',
      assets: release.assets.map((asset) => ({
        ...asset,
        url: asset.url.replace('v1.2.3-preview', 'v2.0.0'),
      })),
    };
    const manifest = buildManifest({ ...stable, channel: 'stable', existingManifest: existing });
    expect(manifest.channels.preview.release.version).toBe('1.2.3-preview');
    expect(manifest.channels.stable.release.version).toBe('2.0.0');
  });

  it('cross-checks the website manifest against the matching GitHub Release', async () => {
    const manifest = buildManifest({
      channel: 'preview',
      version: release.version,
      tag: release.tag,
      publishedAt: release.publishedAt,
      notes: release.notes,
      releaseUrl: release.releaseUrl,
      assets: release.assets,
    });
    const githubRelease = {
      tag_name: release.tag,
      draft: false,
      prerelease: true,
      html_url: release.releaseUrl,
      assets: release.assets.map((asset) => ({
        name: asset.name,
        size: asset.size,
        browser_download_url: asset.url,
        digest: `sha256:${asset.sha256}`,
      })),
    };
    const fetchImpl = async (url) => ({
      ok: true,
      async json() {
        return url.includes('api.github.com') ? githubRelease : manifest;
      },
    });
    const previousFetch = globalThis.fetch;
    globalThis.fetch = fetchImpl;
    try {
      await expect(verifyPublicManifest()).resolves.toMatchObject({ status: 'pass' });
    } finally {
      globalThis.fetch = previousFetch;
    }
  });

  it('rejects an asset whose public size differs from GitHub', async () => {
    const manifest = {
      schemaVersion: 1,
      channels: { stable: { enabled: false, release: null }, preview: { enabled: true, release } },
    };
    const fetchImpl = async (url) => ({
      ok: true,
      async json() {
        return url.includes('api.github.com')
          ? {
              tag_name: release.tag,
              draft: false,
              prerelease: true,
              html_url: release.releaseUrl,
              assets: [
                { name: 'JotLuck.exe', size: 99, browser_download_url: release.assets[0].url },
              ],
            }
          : manifest;
      },
    });
    await expect(verifyPublicManifest({ fetchImpl })).rejects.toThrow(/does not match/u);
  });
});
