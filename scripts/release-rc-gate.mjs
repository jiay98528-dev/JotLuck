#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  inspectV2SArchitectureStop,
  inspectAutocompletePublicState,
  verifyAutocompleteV2SEvidence,
} from './verify-autocomplete-v2s-evidence.mjs';
import { verifyInstalledAppEvidenceV2 } from './release/verify-installed-app-evidence-v2.mjs';
import {
  readEvidenceManifest,
  verifyGitHubActionsProvenance,
} from './release/verify-github-actions-provenance.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2));
const releaseId = process.argv.slice(2).find((arg) => !arg.startsWith('-'));
const packageJson = JSON.parse(readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
const appVersion = String(packageJson.version ?? '');
const tauriConfig = JSON.parse(
  readFileSync(path.join(rootDir, 'packages/app/src-tauri/tauri.conf.json'), 'utf8'),
);
const productName = String(tauriConfig.productName ?? packageJson.name ?? 'JotLuck');

if (args.has('--help') || args.has('-h')) {
  printHelp();
  process.exit(0);
}

if (args.has('--print-report-template')) {
  console.log(path.join(rootDir, 'doc', 'release-installed-l4-template.md'));
  process.exit(0);
}

verifyAutocompleteReleaseModels();

if (args.has('--autocomplete-only')) {
  console.log('[release:rc-gate] PASS: autocomplete model quality evidence is release eligible.');
  process.exit(0);
}

if (!releaseId) {
  fail(11, '缺少 release id；installed-app evidence v2 必须以固定 release directory 验证。');
}
try {
  const manifest = readEvidenceManifest(rootDir, releaseId);
  await verifyGitHubActionsProvenance({
    manifest,
    releaseId,
    repository: process.env.GITHUB_REPOSITORY,
    token: process.env.GITHUB_TOKEN,
    apiUrl: process.env.GITHUB_API_URL,
  });
  const verified = verifyInstalledAppEvidenceV2({
    rootDir,
    releaseId,
    installerPath: process.env.JOTLUCK_INSTALLER_PATH,
    candidateApplicationPath: process.env.JOTLUCK_CANDIDATE_APPLICATION_PATH,
    executionEvidencePath: process.env.JOTLUCK_EXECUTION_EVIDENCE_PATH,
  });
  console.log(
    `[release:rc-gate] PASS: installed-app evidence v2 verified for ${verified.releaseId} (${verified.candidateCommit}).`,
  );
} catch (error) {
  fail(
    11,
    `installed-app evidence v2 verification failed: ${error instanceof Error ? error.message : String(error)}`,
  );
}

function verifyAutocompleteReleaseModels() {
  try {
    const architectureStop = inspectV2SArchitectureStop(rootDir);
    if (architectureStop) {
      fail(
        10,
        `Autocomplete V2S architecture is stopped: ${architectureStop.architectureId} (${architectureStop.reasonCode}).`,
      );
    }
  } catch (error) {
    fail(
      10,
      `Autocomplete V2S architecture-stop verification failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const publicState = inspectAutocompletePublicState(rootDir);
  if (publicState.kind === 'invalid') {
    fail(10, `Autocomplete public model state is ambiguous: ${publicState.reason}.`);
  }
  if (publicState.kind === 'v2s') {
    try {
      verifyAutocompleteV2SEvidence({ rootDir, mode: 'rc' });
      return;
    } catch (error) {
      fail(
        10,
        `Autocomplete V2S release evidence verification failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  if (publicState.kind === 'missing') {
    fail(10, 'Autocomplete public model is missing; only the canonical V2S manifest may release.');
  }
  fail(
    10,
    'Legacy v4 autocomplete is retained only as a fail-closed migration input; RC accepts only the canonical v6 manifest.',
  );
}

function fail(code, message) {
  console.error(`\n[release:rc-gate] FAIL: ${message}`);
  process.exit(code);
}

function printHelp() {
  console.log(`JotLuck release candidate gate

Usage:
  pnpm release:rc-gate
  node scripts/release-rc-gate.mjs <release-id>
  node scripts/release-rc-gate.mjs --autocomplete-only
  node scripts/release-rc-gate.mjs --print-report-template

State:
  - Autocomplete quality remains an independently recomputed fail-closed gate.
  - Generic installed-app RC PASS requires independent installed-app evidence protocol v2.
  - Installed-app verification requires JOTLUCK_INSTALLER_PATH,
    JOTLUCK_CANDIDATE_APPLICATION_PATH, and JOTLUCK_EXECUTION_EVIDENCE_PATH.
  - The candidate application must be the provenance-bound jotluck.exe downloaded by the gate.
  - Self-attested machine-evidence v1 and commit-self-referential manifests are rejected.

Expected installer identity for the future v2 protocol:
  ${productName}_${appVersion}_x64-setup.exe
`);
}
