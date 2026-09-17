#!/usr/bin/env node
/**
 * Generate the public update manifest from release facts.
 *
 * Local assets must be supplied with --asset and are hashed here. Remote asset
 * metadata is accepted only with --remote-asset when it was read from the
 * GitHub Releases API (the script never invents a size or checksum).
 *
 * Example:
 * node scripts/release/generate-update-manifest.mjs \
 *   --channel preview --version 0.14.0-preview --tag v0.14.0-preview \
 *   --published-at 2026-09-08T14:00:11Z \
 *   --release-url https://github.com/jiay98528-dev/JotLuck/releases/tag/v0.14.0-preview \
 *   --notes-file RELEASE_NOTES.md \
 *   --remote-asset windows:x86_64:nsis:JotLuck_0.14.0_x64-setup.exe:22508308:d78... \
 *   --asset macos:aarch64:dmg:release-staging-20260911/JotLuck_0.14.0_aarch64.dmg
 */
import { createHash } from 'node:crypto';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { isStrictSemVer } from './semver.mjs';

const ROOT = path.resolve(import.meta.dirname, '../..');
const REPOSITORY = 'jiay98528-dev/JotLuck';
const CHANNELS = ['stable', 'preview'];
const OS = ['windows', 'macos', 'linux'];
const ARCH = ['x86_64', 'aarch64'];
const PACKAGE_TYPES = ['nsis', 'dmg', 'deb', 'appimage'];
const SHA256 = /^[a-f0-9]{64}$/u;

export function assetFromFile({ os, arch, packageType, filePath, baseUrl }) {
  assertAssetIdentity({ os, arch, packageType });
  const absolute = path.resolve(ROOT, filePath);
  const stat = statSync(absolute, { throwIfNoEntry: false });
  if (!stat?.isFile()) throw new Error(`release asset is not a regular file: ${filePath}`);
  const bytes = readFileSync(absolute);
  return {
    os,
    arch,
    packageType,
    name: path.basename(absolute),
    url: `${baseUrl.replace(/\/$/u, '')}/${encodeURIComponent(path.basename(absolute))}`,
    size: bytes.byteLength,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}

export function assetFromRemote({ os, arch, packageType, name, size, sha256, url }) {
  assertAssetIdentity({ os, arch, packageType });
  if (!name || /[/\\]/u.test(name)) throw new Error(`remote asset name is invalid: ${name}`);
  if (!Number.isSafeInteger(Number(size)) || Number(size) <= 0)
    throw new Error(`remote asset size is invalid: ${name}`);
  if (!SHA256.test(String(sha256))) throw new Error(`remote asset SHA-256 is invalid: ${name}`);
  const releaseTag = process.env.JOTLUCK_RELEASE_TAG;
  if (!releaseTag) throw new Error('JOTLUCK_RELEASE_TAG is required for remote asset validation');
  assertGitHubReleaseUrl(url, `/releases/download/${releaseTag}/${name}`);
  return { os, arch, packageType, name, url, size: Number(size), sha256 };
}

export function buildManifest({
  channel,
  version,
  tag,
  publishedAt,
  notes,
  releaseUrl,
  assets,
  enabled = true,
  existingManifest = null,
}) {
  if (!CHANNELS.includes(channel)) throw new Error(`unsupported channel: ${channel}`);
  if (!isStrictSemVer(version)) throw new Error(`version is not strict SemVer: ${version}`);
  if (channel === 'stable' && version.includes('-'))
    throw new Error('stable channel cannot publish a pre-release version');
  if (tag !== `v${version}`) throw new Error(`tag must be v${version}: ${tag}`);
  if (!publishedAt || Number.isNaN(Date.parse(publishedAt)))
    throw new Error('published-at must be an ISO timestamp');
  if (typeof notes !== 'string' || notes.trim().length === 0) throw new Error('notes are required');
  assertGitHubReleaseUrl(releaseUrl, `/releases/tag/${tag}`);
  if (!Array.isArray(assets) || assets.length === 0)
    throw new Error('at least one release asset is required');
  const seen = new Set();
  for (const asset of assets) {
    assertAssetIdentity(asset);
    const key = `${asset.os}/${asset.arch}/${asset.packageType}`;
    if (seen.has(key)) throw new Error(`duplicate asset target: ${key}`);
    seen.add(key);
    if (!Number.isSafeInteger(asset.size) || asset.size <= 0 || !SHA256.test(asset.sha256))
      throw new Error(`asset facts are invalid: ${asset.name}`);
    assertGitHubReleaseUrl(asset.url, `/releases/download/${tag}/${asset.name}`);
  }
  const emptyChannel = { enabled: false, release: null };
  const preserved = existingManifest?.channels ?? {};
  return {
    schemaVersion: 1,
    channels: {
      stable:
        channel === 'stable'
          ? { enabled, release: enabled ? createRelease() : null }
          : (preserved.stable ?? emptyChannel),
      preview:
        channel === 'preview'
          ? { enabled, release: enabled ? createRelease() : null }
          : (preserved.preview ?? emptyChannel),
    },
  };

  function createRelease() {
    return { version, tag, publishedAt, notes: notes.trim(), releaseUrl, assets };
  }
}

function assertAssetIdentity({ os, arch, packageType }) {
  if (!OS.includes(os) || !ARCH.includes(arch) || !PACKAGE_TYPES.includes(packageType))
    throw new Error(`unsupported asset target: ${os}/${arch}/${packageType}`);
  if (
    (os === 'windows' && packageType !== 'nsis') ||
    (os === 'macos' && packageType !== 'dmg') ||
    (os === 'linux' && !['deb', 'appimage'].includes(packageType))
  )
    throw new Error(`package type does not match operating system: ${os}/${packageType}`);
}

function assertGitHubReleaseUrl(value, expectedPath) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`invalid HTTPS URL: ${value}`);
  }
  if (
    url.protocol !== 'https:' ||
    url.hostname !== 'github.com' ||
    url.pathname !== `/jiay98528-dev/JotLuck${expectedPath}` ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  )
    throw new Error(`URL must be the exact public JotLuck GitHub release path: ${value}`);
}

function parseArgs(argv) {
  const args = {
    assets: [],
    remoteAssets: [],
    output: 'site/public/updates/v1.json',
    mirror: null,
    input: 'site/public/updates/v1.json',
  };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key?.startsWith('--')) throw new Error(`unexpected argument: ${key}`);
    const value = argv[++i];
    if (!value) throw new Error(`missing value for ${key}`);
    if (key === '--asset') args.assets.push(value);
    else if (key === '--remote-asset') args.remoteAssets.push(value);
    else if (key === '--output') args.output = value;
    else if (key === '--mirror') args.mirror = value;
    else if (key === '--input') args.input = value;
    else if (key === '--notes-file') args.notes = readFileSync(path.resolve(ROOT, value), 'utf8');
    else if (key === '--enabled') args.enabled = value !== 'false';
    else args[key.slice(2).replaceAll('-', '_')] = value;
  }
  return args;
}

function parseTarget(value) {
  const [os, arch, packageType, ...pathParts] = value.split(':');
  const filePath = pathParts.join(':');
  if (!filePath) throw new Error(`asset must be os:arch:packageType:path: ${value}`);
  return { os, arch, packageType, filePath };
}

function parseRemote(value) {
  const [os, arch, packageType, name, size, sha256] = value.split(':');
  if (!sha256)
    throw new Error(`remote asset must be os:arch:packageType:name:size:sha256: ${value}`);
  const tag = process.env.JOTLUCK_RELEASE_TAG;
  if (!tag) throw new Error('JOTLUCK_RELEASE_TAG is required for --remote-asset URL derivation');
  return {
    os,
    arch,
    packageType,
    name,
    size: Number(size),
    sha256,
    url: `https://github.com/${REPOSITORY}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(name)}`,
  };
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (
    !args.channel ||
    !args.version ||
    !args.tag ||
    !args.published_at ||
    !args.release_url ||
    !args.notes
  )
    throw new Error(
      '--channel, --version, --tag, --published-at, --release-url and --notes-file are required',
    );
  process.env.JOTLUCK_RELEASE_TAG = args.tag;
  const buildVersion = args.build_version ?? process.env.JOTLUCK_RELEASE_VERSION;
  const buildChannel = args.build_channel ?? process.env.JOTLUCK_RELEASE_CHANNEL;
  const buildTag = args.build_tag ?? process.env.JOTLUCK_RELEASE_TAG;
  if (buildVersion !== args.version || buildChannel !== args.channel || buildTag !== args.tag)
    throw new Error(
      'build identity (JOTLUCK_RELEASE_VERSION/CHANNEL/TAG) does not match manifest identity',
    );
  const baseUrl = `https://github.com/${REPOSITORY}/releases/download/${encodeURIComponent(args.tag)}`;
  const assets = [
    ...args.assets.map((value) => assetFromFile({ ...parseTarget(value), baseUrl })),
    ...args.remoteAssets.map((value) => assetFromRemote(parseRemote(value))),
  ];
  const manifest = buildManifest({
    channel: args.channel,
    version: args.version,
    tag: args.tag,
    publishedAt: args.published_at,
    notes: args.notes,
    releaseUrl: args.release_url,
    assets,
    enabled: args.enabled,
    existingManifest: readExistingManifest(args.input),
  });
  for (const output of [args.output, args.mirror].filter(Boolean)) {
    const absolute = path.resolve(ROOT, output);
    writeFileSync(absolute, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  }
  console.log(
    JSON.stringify({
      status: 'update-manifest-generated',
      version: args.version,
      channel: args.channel,
      assets: assets.length,
    }),
  );
  return manifest;
}

function readExistingManifest(input) {
  if (!input) return null;
  try {
    const value = JSON.parse(readFileSync(path.resolve(ROOT, input), 'utf8'));
    if (value?.schemaVersion === 1 && value.channels?.stable && value.channels?.preview)
      return value;
  } catch {
    // A first release has no input yet; the generated channel starts from empty.
  }
  return null;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href)
  main().catch((error) => {
    console.error(
      `[release:update-manifest] FAIL: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  });
