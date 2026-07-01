#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2));

const defaultInstallerPath = path.join(
  rootDir,
  'packages',
  'app',
  'src-tauri',
  'target',
  'release',
  'bundle',
  'nsis',
  'MarkLuck_0.15.0_x64-setup.exe',
);

const installerPath = path.resolve(rootDir, process.env.MARKLUCK_INSTALLER_PATH ?? defaultInstallerPath);
const allowDirty = process.env.MARKLUCK_RELEASE_ALLOW_DIRTY === '1';
const reportPath = resolveReportPath();

const requiredMarkers = [
  'L4-GIT-BEFORE',
  'L4-GIT-AFTER',
  'L4-WINDOWS-VERSION',
  'L4-INSTALLER-PATH',
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

console.log('[release:rc-gate] MarkLuck real installer RC gate');
console.log(`[release:rc-gate] installer: ${installerPath}`);
console.log(`[release:rc-gate] report: ${reportPath ?? '(not found)'}`);

const status = getGitStatus();
console.log('\n== git status --short ==');
console.log(status || '(clean)');

if (status && !allowDirty) {
  fail(
    2,
    '工作区存在未提交或未跟踪文件。发布 RC 闸门必须在执行前后记录并解释 git status；如需临时审计脏树，设置 MARKLUCK_RELEASE_ALLOW_DIRTY=1。',
  );
}

if (!existsSync(installerPath)) {
  fail(
    3,
    '未找到真实安装包。默认要求 MarkLuck_0.15.0_x64-setup.exe；可用 MARKLUCK_INSTALLER_PATH 指向实际 RC 安装包。',
  );
}

if (!reportPath || !existsSync(reportPath)) {
  fail(
    4,
    '未找到安装版 L4 人工验收记录。请复制 doc/release-installed-l4-template.md 填写后，用 MARKLUCK_L4_REPORT 指向该记录。',
  );
}

const report = readFileSync(reportPath, 'utf8');
const missingMarkers = requiredMarkers.filter((marker) => !report.includes(marker));

if (missingMarkers.length > 0) {
  fail(5, `安装版 L4 记录缺少必填标记：${missingMarkers.join(', ')}`);
}

if (!/L4-CONCLUSION:\s*PASS\b/i.test(report)) {
  fail(6, '安装版 L4 记录未声明 L4-CONCLUSION: PASS。未完成前只能称为“自动化候选通过”。');
}

const blockingStatusPattern = /状态\s*[:：]\s*(TODO|FAIL|BLOCKED|PENDING|未测|失败|阻塞)/i;
if (blockingStatusPattern.test(report)) {
  fail(7, '安装版 L4 记录仍包含 TODO/FAIL/BLOCKED/PENDING/未测/失败/阻塞 状态。');
}

if (!/(pnpm audit:rust|cargo audit|CI\s*job|https?:\/\/\S+)/i.test(report)) {
  fail(8, '安装版 L4 记录必须包含本机 pnpm audit:rust/cargo audit 结果，或明确的 CI job URL 与通过状态。');
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
  if (process.env.MARKLUCK_L4_REPORT) {
    return path.resolve(rootDir, process.env.MARKLUCK_L4_REPORT);
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

function fail(code, message) {
  console.error(`\n[release:rc-gate] FAIL: ${message}`);
  process.exit(code);
}

function printHelp() {
  console.log(`MarkLuck real installer RC gate

Usage:
  pnpm release:rc-gate

Environment:
  MARKLUCK_INSTALLER_PATH        Path to MarkLuck_0.15.0_x64-setup.exe.
  MARKLUCK_L4_REPORT            Path to the completed installed-app L4 report.
  MARKLUCK_RELEASE_ALLOW_DIRTY=1 Allows auditing a dirty tree, but the report must explain git status.

Helpers:
  node scripts/release-rc-gate.mjs --print-report-template

Default installer:
  ${path.relative(rootDir, defaultInstallerPath)}
`);
}
