#!/usr/bin/env node
/** Publish one explicitly prepared Mac preview using an existing Git credential.
 * Credentials stay in memory and are never printed, persisted, or put in URLs.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

const repo = 'jiay98528-dev/JotLuck';
const tag = 'v0.15.0-preview';
const [operation, file, commit] = process.argv.slice(2);
if (!['draft', 'publish'].includes(operation) || !file || !/^[a-f0-9]{40}$/.test(commit ?? ''))
  throw new Error('Usage: publish-macos-preview.mjs draft|publish DMG EXACT_SOURCE_COMMIT');
const name = path.basename(file);
if (name !== 'JotLuck_0.15.0-preview_aarch64.dmg') throw new Error('Unexpected Mac package name');
const bytes = readFileSync(file);
const sha256 = createHash('sha256').update(bytes).digest('hex');
const manifest = JSON.parse(readFileSync('site/public/updates/v1.json', 'utf8'));
const release = manifest.channels.preview.release;
if (
  release.tag !== tag ||
  release.assets.length !== 1 ||
  release.assets[0].os !== 'macos' ||
  release.assets[0].name !== name ||
  release.assets[0].size !== bytes.length ||
  release.assets[0].sha256 !== sha256
)
  throw new Error('The Mac package does not match the prepared public manifest');
const credential = spawnSync('git', ['credential', 'fill'], {
  input: 'protocol=https\nhost=github.com\n\n',
  encoding: 'utf8',
  env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
});
const token = credential.stdout
  ?.split('\n')
  .find((line) => line.startsWith('password='))
  ?.slice(9);
if (!token) throw new Error('No existing GitHub credential is available');
const headers = {
  Authorization: `Bearer ${token}`,
  Accept: 'application/vnd.github+json',
  'Content-Type': 'application/json',
};
async function api(endpoint, method = 'GET', data) {
  const response = await fetch(`https://api.github.com/repos/${repo}${endpoint}`, {
    method,
    headers,
    redirect: 'error',
    signal: AbortSignal.timeout(30_000),
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  if (response.status === 404 && method === 'GET') return null;
  if (!response.ok) throw new Error(`GitHub ${method} failed with HTTP ${response.status}`);
  return response.json();
}
const body = [
  '# JotLuck V0.15 Preview — macOS Apple Silicon',
  '',
  'This is a **Mac-only pre-release**. Windows x64 and Linux x86_64 downloads remain at v0.14.0-preview.',
  '',
  '## What changed',
  '- Opening an existing .md file on cold start creates only its read-only preview. Direct app-icon launches open the editor.',
  '- Opt-in background update information cross-checks the official website manifest and the matching GitHub Release.',
  '- A new first-screen welcome choice introduces automatic checks. Existing users see it once; previous preferences are preserved.',
  '- No note content, paths or device identifiers are uploaded. Updates are not downloaded, installed or restarted automatically.',
  '',
  '## Mac package',
  `- File: \`${name}\``,
  `- Size: ${bytes.length.toLocaleString('en-US')} bytes`,
  `- SHA-256: \`${sha256}\``,
  '- Architecture: Apple Silicon / arm64. Intel Mac, Windows and Linux packages are not included in this release.',
  '- Signing: complete ad-hoc signature; no Apple Developer identity and no notarization. macOS may require right-click → Open.',
  '- Install: mount the DMG and drag JotLuck to Applications. Quit the old application before replacing it.',
  '',
  '## Verification',
  '- Native Mac smoke: default-off welcome setting, immediate preference persistence, preference retention and Finder Markdown cold-start preview verified in an isolated application profile.',
  '- Full app signature and disk-image checks passed. Update-service tests passed; existing unrelated repository-wide environment/path/i18n failures are not claimed as passing.',
  `- Source commit: \`${commit}\``,
  '- Website: https://jotluck.com/zh/download',
  '- Website package mirror: https://jotluck.com/downloads/' + name,
  '- Version manifest: https://jotluck.com/updates/v1.json',
].join('\n');
let record = await api(`/releases/tags/${tag}`);
// GitHub's by-tag endpoint may omit drafts. Locate the owner's draft through
// the authenticated list instead of creating a second empty release.
if (!record) {
  const records = await api('/releases?per_page=100');
  const drafts = records.filter((item) => item.tag_name === tag && item.draft);
  record =
    drafts.find((item) =>
      item.assets.some((asset) => asset.name === name && asset.digest === `sha256:${sha256}`),
    ) ??
    drafts[0] ??
    null;
}
if (record && !record.draft)
  throw new Error('This release is already published; refusing to overwrite it');
if (!record && operation === 'publish')
  throw new Error('No verified draft exists for this preview');
if (!record)
  record = await api('/releases', 'POST', {
    tag_name: tag,
    target_commitish: commit,
    name: 'JotLuck V0.15 Preview — macOS Apple Silicon',
    body,
    draft: true,
    prerelease: true,
    make_latest: 'false',
  });
if (record.tag_name !== tag || !record.draft || !record.prerelease)
  throw new Error('Unexpected GitHub release identity');
const existing = record.assets.find((asset) => asset.name === name);
if (existing) {
  if (existing.size !== bytes.length || existing.digest !== `sha256:${sha256}`)
    throw new Error('A different package already exists in this draft; refusing to replace it');
} else {
  if (operation !== 'draft')
    throw new Error('Upload the verified package to the draft before publication');
  const response = await fetch(
    `https://uploads.github.com/repos/${repo}/releases/${record.id}/assets?name=${encodeURIComponent(name)}`,
    {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/x-apple-diskimage' },
      body: bytes,
      redirect: 'error',
      signal: AbortSignal.timeout(240_000),
    },
  );
  if (!response.ok) throw new Error(`Mac package upload failed with HTTP ${response.status}`);
  const asset = await response.json();
  if (asset.size !== bytes.length || asset.digest !== `sha256:${sha256}`)
    throw new Error('The uploaded Mac package failed GitHub digest verification');
}
if (operation === 'publish')
  record = await api(`/releases/${record.id}`, 'PATCH', {
    body,
    draft: false,
    prerelease: true,
    make_latest: 'false',
  });
console.log(
  JSON.stringify({
    status: record.draft ? 'draft-ready' : 'published',
    id: record.id,
    tag,
    url: record.html_url,
    publishedAt: record.published_at,
    name,
    size: bytes.length,
    sha256,
  }),
);
