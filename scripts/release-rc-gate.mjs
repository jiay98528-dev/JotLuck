#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  inspectV2SArchitectureStop,
  inspectAutocompletePublicState,
  verifyAutocompleteV2SEvidence,
} from './verify-autocomplete-v2s-evidence.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2));
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

fail(
  11,
  '通用 RC 独立证据协议 v2 尚未实现，旧的自报 machine-evidence v1 已永久禁用。正式放行必须由候选 commit、独立只读原始报告、结构化二次转录和安装包哈希组成两阶段不可变证据链。',
);

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
  node scripts/release-rc-gate.mjs --autocomplete-only
  node scripts/release-rc-gate.mjs --print-report-template

State:
  - Autocomplete quality remains an independently recomputed fail-closed gate.
  - Generic installed-app RC PASS is disabled until independent evidence protocol v2 exists.
  - Self-attested machine-evidence v1 and commit-self-referential manifests are rejected.

Expected installer identity for the future v2 protocol:
  ${productName}_${appVersion}_x64-setup.exe
`);
}
