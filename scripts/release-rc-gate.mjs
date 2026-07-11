#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyAutocompleteEvidence } from './verify-autocomplete-evidence.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2));
const packageJson = JSON.parse(readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
const appVersion = String(packageJson.version ?? '');
const autocompleteModels = [
  {
    asset: path.join(rootDir, 'packages/app/public/baseline-ngram.web-local.compact.txt'),
    manifest: path.join(
      rootDir,
      'packages/app/public/baseline-ngram.web-local.compact.manifest.json',
    ),
  },
  {
    asset: path.join(rootDir, 'packages/app/public/baseline-ngram.v1.compact.txt'),
    manifest: path.join(rootDir, 'packages/app/public/baseline-ngram.v1.compact.manifest.json'),
  },
];

const defaultInstallerPath = path.join(
  rootDir,
  'packages',
  'app',
  'src-tauri',
  'target',
  'release',
  'bundle',
  'nsis',
  'JotLuck_0.15.0_x64-setup.exe',
);

const installerPath = path.resolve(
  rootDir,
  process.env.JotLuck_INSTALLER_PATH ?? defaultInstallerPath,
);
const allowDirty = process.env.JotLuck_RELEASE_ALLOW_DIRTY === '1';
const reportPath = resolveReportPath();

const requiredMarkers = [
  'L4-GIT-BEFORE',
  'L4-GIT-AFTER',
  'L4-WINDOWS-VERSION',
  'L4-INSTALLER-PATH',
  'L4-INSTALLER-SHA256',
  'L4-APP-VERSION',
  'L4-RUST-AUDIT',
  'L4-01-INSTALL-START-CRUD',
  'L4-02-REAL-FOLDER',
  'L4-03-EXTERNAL-FILE',
  'L4-04-SEARCH-EDIT',
  'L4-05-LIVE-PREVIEW',
  'L4-06-SETTINGS-PERSISTENCE',
  'L4-07-EXPORT-READBACK',
  'L4-08-IMAGE-ASSETS',
  'L4-09-UNINSTALL-CLEANUP',
  'L4-EVIDENCE',
];

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

console.log('[release:rc-gate] JotLuck real installer RC gate');
console.log(`[release:rc-gate] installer: ${installerPath}`);
console.log(`[release:rc-gate] report: ${reportPath ?? '(not found)'}`);

const status = getGitStatus();
console.log('\n== git status --short ==');
console.log(status || '(clean)');

if (status && !allowDirty) {
  fail(
    2,
    '工作区存在未提交或未跟踪文件。发布 RC 闸门必须在执行前后记录并解释 git status；如需临时审计脏树，设置 JotLuck_RELEASE_ALLOW_DIRTY=1。',
  );
}

if (!existsSync(installerPath)) {
  fail(
    3,
    '未找到真实安装包。默认要求 JotLuck_0.15.0_x64-setup.exe；可用 JotLuck_INSTALLER_PATH 指向实际 RC 安装包。',
  );
}

const installerStat = statSync(installerPath);
const installerSha256 = sha256File(installerPath);
console.log(`[release:rc-gate] installer sha256: ${installerSha256}`);

if (!reportPath || !existsSync(reportPath)) {
  fail(
    4,
    '未找到安装版 L4 人工验收记录。请复制 doc/release-installed-l4-template.md 填写后，用 JotLuck_L4_REPORT 指向该记录。',
  );
}

const report = readFileSync(reportPath, 'utf8');
const reportStat = statSync(reportPath);
const missingMarkers = requiredMarkers.filter((marker) => !report.includes(marker));

if (missingMarkers.length > 0) {
  fail(5, `安装版 L4 记录缺少必填标记：${missingMarkers.join(', ')}`);
}

if (!/L4-CONCLUSION:\s*PASS\b/i.test(report)) {
  fail(6, '安装版 L4 记录未声明 L4-CONCLUSION: PASS。未完成前只能称为“自动化候选通过”。');
}

const reportInstallerPath = readMarkerValue(report, 'L4-INSTALLER-PATH');
const reportInstallerSha256 = readMarkerValue(report, 'L4-INSTALLER-SHA256')
  .replace(/[^a-fA-F0-9]/g, '')
  .toLowerCase();
const reportAppVersion = readMarkerValue(report, 'L4-APP-VERSION');
const normalizedReportInstallerPath = normalizeReportPath(reportInstallerPath);

if (normalizedReportInstallerPath !== path.normalize(installerPath)) {
  fail(
    7,
    `安装版 L4 记录中的安装包路径不匹配。记录=${normalizedReportInstallerPath} 当前=${path.normalize(installerPath)}`,
  );
}

if (!reportAppVersion.includes(appVersion)) {
  fail(7, `安装版 L4 记录中的版本不匹配。记录=${reportAppVersion || '(empty)'} 当前=${appVersion}`);
}

if (reportInstallerSha256 !== installerSha256) {
  fail(
    7,
    `安装版 L4 记录中的 SHA256 不匹配。记录=${reportInstallerSha256 || '(empty)'} 当前=${installerSha256}`,
  );
}

if (reportStat.mtimeMs + 1000 < installerStat.mtimeMs) {
  fail(7, '安装版 L4 记录早于当前安装包生成时间，可能是旧报告，必须重新验收并记录。');
}

const blockingStatusPattern = /状态\s*[:：]\s*(TODO|FAIL|BLOCKED|PENDING|未测|失败|阻塞)/i;
if (blockingStatusPattern.test(report)) {
  fail(8, '安装版 L4 记录仍包含 TODO/FAIL/BLOCKED/PENDING/未测/失败/阻塞 状态。');
}

if (!/(pnpm audit:rust|cargo audit|CI\s*job|https?:\/\/\S+)/i.test(report)) {
  fail(
    9,
    '安装版 L4 记录必须包含本机 pnpm audit:rust/cargo audit 结果，或明确的 CI job URL 与通过状态。',
  );
}

console.log('\n[release:rc-gate] PASS: 真实安装包 L4 记录和安装包路径已满足 RC 闸门。');

function getGitStatus() {
  return execFileSync('git', ['status', '--short'], {
    cwd: rootDir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function resolveReportPath() {
  if (process.env.JotLuck_L4_REPORT) {
    return path.resolve(rootDir, process.env.JotLuck_L4_REPORT);
  }

  const reportDir = path.join(rootDir, '验收报告');
  if (!existsSync(reportDir)) {
    return null;
  }

  const candidates = readdirSync(reportDir)
    .filter((name) => /\.md$/i.test(name) && /(L4|安装包|installer|installed|RC)/i.test(name))
    .map((name) => {
      const fullPath = path.join(reportDir, name);
      return { fullPath, mtimeMs: statSync(fullPath).mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  return candidates[0]?.fullPath ?? null;
}

function sha256File(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

function verifyAutocompleteReleaseModels() {
  try {
    const verified = verifyAutocompleteEvidence({ rootDir, mode: 'rc' });
    if (verified.models.length === autocompleteModels.length) return;
  } catch (error) {
    fail(
      10,
      `Autocomplete release evidence verification failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  for (const model of autocompleteModels) {
    if (!existsSync(model.asset) || !existsSync(model.manifest)) {
      fail(10, `文字补全发布模型或 manifest 缺失：${path.relative(rootDir, model.asset)}`);
    }

    let manifest;
    try {
      manifest = JSON.parse(readFileSync(model.manifest, 'utf8'));
    } catch (error) {
      fail(
        10,
        `文字补全 manifest 无法解析：${path.relative(rootDir, model.manifest)} (${error instanceof Error ? error.message : String(error)})`,
      );
    }

    const bytes = statSync(model.asset).size;
    const sha256 = sha256File(model.asset);
    const modelText = readFileSync(model.asset, 'utf8');
    const serializedEntryCount = modelText
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter(
        (line) =>
          line && line !== '# jotluck-baseline-v4' && line !== '[character]' && line !== '[word]',
      ).length;
    if (
      manifest.verifiedOnly !== true ||
      manifest.modelBytes !== bytes ||
      !Number.isInteger(manifest.entryCount) ||
      manifest.entryCount <= 0 ||
      manifest.entryCount !== serializedEntryCount ||
      manifest.sha256 !== sha256 ||
      bytes > 6 * 1024 * 1024
    ) {
      fail(10, `文字补全模型完整性校验失败：${path.relative(rootDir, model.asset)}`);
    }
    if (
      manifest.schemaVersion !== 2 ||
      manifest.serialization !== 'sectioned-jsonl-hex-v4' ||
      manifest.order !== 'section-profile-context-hex'
    ) {
      fail(
        10,
        `文字补全模型仍为 legacy 格式：${path.relative(rootDir, model.asset)}。必须用 verified-only 管线重建 v4 sectioned 模型，禁止恢复旧污染模型。`,
      );
    }
    if (
      !Number.isInteger(manifest.characterEntryCount) ||
      manifest.characterEntryCount <= 0 ||
      !Number.isInteger(manifest.wordEntryCount) ||
      manifest.wordEntryCount < 0 ||
      manifest.characterEntryCount + manifest.wordEntryCount !== manifest.entryCount ||
      manifest.ngramN !== 4 ||
      manifest.minNgramN !== 2 ||
      !Array.isArray(manifest.wordNgramOrders) ||
      manifest.wordNgramOrders.join(',') !== '1,2' ||
      manifest.countScale !== 1000 ||
      !modelText.startsWith('# jotluck-baseline-v4\n[character]\n')
    ) {
      fail(10, `文字补全模型完整性校验失败：${path.relative(rootDir, model.asset)}`);
    }
    if (manifest.runtimeEligible !== true) {
      fail(
        10,
        `文字补全模型未取得运行时资格：${path.relative(rootDir, model.asset)}。不得由应用静默加载。`,
      );
    }
    if (manifest.qualityGatePassed !== true || manifest.releaseEligible !== true) {
      fail(
        10,
        `文字补全模型尚未达到正式发布门槛：${path.relative(rootDir, model.asset)}。请先通过绑定模型哈希的独立 holdout。`,
      );
    }
    const evidenceHashes = [
      ['holdoutSha256', manifest.holdoutSha256],
      ['qualityEvidenceSha256', manifest.qualityEvidenceSha256],
      ['learningCurveSha256', manifest.learningCurveSha256],
    ];
    const invalidEvidence = evidenceHashes
      .filter(([, value]) => !/^[a-f0-9]{64}$/u.test(String(value ?? '')))
      .map(([key]) => key);
    const invalidBindings = [
      ...(manifest.evaluatorVersion === 'offline-completion-evaluator-v2'
        ? []
        : ['evaluatorVersion']),
      ...invalidEvidence,
    ];
    if (invalidBindings.length > 0) {
      fail(
        10,
        `文字补全模型缺少绑定的 V2 质量证据：${path.relative(rootDir, model.manifest)} ` +
          `(invalid: ${invalidBindings.join(', ')})`,
      );
    }
  }
}

function readMarkerValue(report, marker) {
  const escaped = marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = report.match(new RegExp(`${escaped}\\s*:\\s*(.+)`, 'i'));
  return match?.[1]?.trim() ?? '';
}

function normalizeReportPath(value) {
  if (!value) return '';
  const cleaned = value.replace(/^["'`]+|["'`]+$/g, '');
  return path.normalize(path.isAbsolute(cleaned) ? cleaned : path.resolve(rootDir, cleaned));
}

function fail(code, message) {
  console.error(`\n[release:rc-gate] FAIL: ${message}`);
  process.exit(code);
}

function printHelp() {
  console.log(`JotLuck real installer RC gate

Usage:
  pnpm release:rc-gate

Environment:
  JotLuck_INSTALLER_PATH        Path to JotLuck_0.15.0_x64-setup.exe.
  JotLuck_L4_REPORT            Path to the completed installed-app L4 report.
  JotLuck_RELEASE_ALLOW_DIRTY=1 Allows auditing a dirty tree, but the report must explain git status.

Helpers:
  node scripts/release-rc-gate.mjs --print-report-template
  node scripts/release-rc-gate.mjs --autocomplete-only

Default installer:
  ${path.relative(rootDir, defaultInstallerPath)}
`);
}
