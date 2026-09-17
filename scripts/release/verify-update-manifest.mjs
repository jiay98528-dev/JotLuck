#!/usr/bin/env node
/** Public, read-only release check. Fetches the fixed website manifest and
 * cross-checks every enabled channel against the matching GitHub Release. */
import process from 'node:process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { isStrictSemVer } from './semver.mjs';

export const MANIFEST_URL = 'https://jotluck.com/updates/v1.json';
export const GITHUB_API = 'https://api.github.com/repos/jiay98528-dev/JotLuck/releases/tags/';
const REPOSITORY = 'jiay98528-dev/JotLuck';
const CHANNELS = ['stable', 'preview'];
const SHA256 = /^[a-f0-9]{64}$/u;

export async function verifyPublicManifest({
  manifestUrl = MANIFEST_URL,
  githubApi = GITHUB_API,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('fetch is unavailable');
  const manifest = await fetchJson(manifestUrl, fetchImpl, 'website manifest');
  validateManifest(manifest);
  const checked = [];
  for (const channel of CHANNELS) {
    const candidate = manifest.channels[channel];
    if (!candidate.enabled || !candidate.release) continue;
    const release = await fetchJson(
      `${githubApi}${encodeURIComponent(candidate.release.tag)}`,
      fetchImpl,
      `GitHub ${channel} release`,
    );
    verifyRelease(candidate.release, release, channel);
    checked.push({ channel, tag: candidate.release.tag, assets: candidate.release.assets.length });
  }
  return { status: 'pass', manifestUrl, checked };
}

export function validateManifest(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('manifest must be an object');
  assertExactKeys(value, ['schemaVersion', 'channels'], 'manifest');
  if (value.schemaVersion !== 1) throw new Error('manifest schemaVersion must be 1');
  if (!value.channels || typeof value.channels !== 'object')
    throw new Error('manifest channels are required');
  if (Object.keys(value.channels).sort().join(',') !== 'preview,stable')
    throw new Error('manifest channels must contain exactly stable and preview');
  for (const channel of CHANNELS) {
    const entry = value.channels[channel];
    if (entry && (typeof entry !== 'object' || Array.isArray(entry)))
      throw new Error(`${channel} channel is invalid`);
    if (entry) assertExactKeys(entry, ['enabled', 'release'], `${channel} channel`);
    if (!entry || typeof entry.enabled !== 'boolean' || (!entry.release && entry.enabled))
      throw new Error(`${channel} channel is invalid`);
    if (entry.release) validateRelease(entry.release, channel);
  }
}

function validateRelease(release, channel) {
  assertExactKeys(
    release,
    ['version', 'tag', 'publishedAt', 'notes', 'releaseUrl', 'assets'],
    `${channel} release`,
  );
  if (!isStrictSemVer(release.version) || release.tag !== `v${release.version}`)
    throw new Error(`${channel} release version/tag is invalid`);
  if (channel === 'stable' && String(release.version).includes('-'))
    throw new Error('stable channel cannot contain a pre-release version');
  if (!release.publishedAt || Number.isNaN(Date.parse(release.publishedAt)))
    throw new Error(`${channel} release publishedAt is invalid`);
  if (typeof release.notes !== 'string' || release.notes.trim().length === 0)
    throw new Error(`${channel} release notes are required`);
  assertGitHubUrl(release.releaseUrl, `/releases/tag/${release.tag}`);
  if (!Array.isArray(release.assets) || release.assets.length === 0)
    throw new Error(`${channel} release must contain assets`);
  const seen = new Set();
  for (const asset of release.assets) {
    assertExactKeys(
      asset,
      ['os', 'arch', 'packageType', 'name', 'url', 'size', 'sha256'],
      'release asset',
    );
    if (
      !['windows', 'macos', 'linux'].includes(asset.os) ||
      !['x86_64', 'aarch64'].includes(asset.arch) ||
      !['nsis', 'dmg', 'deb', 'appimage'].includes(asset.packageType)
    )
      throw new Error(`unsupported asset identity: ${asset.name ?? '(unnamed)'}`);
    if (
      (asset.os === 'windows' && asset.packageType !== 'nsis') ||
      (asset.os === 'macos' && asset.packageType !== 'dmg') ||
      (asset.os === 'linux' && !['deb', 'appimage'].includes(asset.packageType))
    )
      throw new Error(`package type does not match operating system: ${asset.name}`);
    const key = `${asset.os}/${asset.arch}/${asset.packageType}`;
    if (seen.has(key)) throw new Error(`duplicate asset target: ${key}`);
    seen.add(key);
    if (
      !asset.name ||
      /[/\\]/u.test(asset.name) ||
      !Number.isSafeInteger(asset.size) ||
      asset.size <= 0 ||
      !SHA256.test(asset.sha256)
    )
      throw new Error(`invalid asset facts: ${asset.name ?? '(unnamed)'}`);
    assertGitHubUrl(asset.url, `/releases/download/${release.tag}/${asset.name}`);
  }
}

function verifyRelease(expected, actual, channel) {
  if (
    !actual ||
    typeof actual !== 'object' ||
    actual.tag_name !== expected.tag ||
    actual.draft === true
  )
    throw new Error(`${channel} GitHub Release tag/draft status does not match`);
  if ((channel === 'preview') !== (actual.prerelease === true))
    throw new Error(`${channel} GitHub Release prerelease status does not match`);
  if (actual.html_url !== expected.releaseUrl)
    throw new Error(`${channel} release URL does not match`);
  if (actual.published_at && actual.published_at !== expected.publishedAt)
    throw new Error(`${channel} release publication time does not match`);
  const byName = new Map(
    (Array.isArray(actual.assets) ? actual.assets : []).map((asset) => [asset.name, asset]),
  );
  for (const expectedAsset of expected.assets) {
    const actualAsset = byName.get(expectedAsset.name);
    if (
      !actualAsset ||
      actualAsset.size !== expectedAsset.size ||
      actualAsset.browser_download_url !== expectedAsset.url
    )
      throw new Error(`GitHub asset does not match: ${expectedAsset.name}`);
    if (actualAsset.digest && actualAsset.digest !== `sha256:${expectedAsset.sha256}`)
      throw new Error(`GitHub asset digest does not match: ${expectedAsset.name}`);
  }
}

function assertGitHubUrl(value, expectedPath) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`invalid URL: ${value}`);
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
    throw new Error(`URL is outside the fixed GitHub release path: ${value}`);
}

function assertExactKeys(value, expected, label) {
  if (Object.keys(value).sort().join(',') !== [...expected].sort().join(','))
    throw new Error(`${label} fields do not match the strict schema`);
}

async function fetchJson(url, fetchImpl, label) {
  let response;
  try {
    response = await fetchImpl(url, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'jotluck-update-manifest-check',
      },
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    throw new Error(
      `${label} request failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!response.ok) throw new Error(`${label} request failed: HTTP ${response.status}`);
  return response.json();
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href)
  verifyPublicManifest()
    .then((result) => {
      console.log(JSON.stringify(result));
    })
    .catch((error) => {
      console.error(
        `[release:verify-update-manifest] FAIL: ${error instanceof Error ? error.message : String(error)}`,
      );
      process.exitCode = 1;
    });
