/**
 * 截图目检工具：pnpm preview + Playwright 截屏。
 * 用法：node scripts/shoot.mjs [逗号语言列表，默认 zh,en,ja,ko,fr] [页面，默认 ''=首页，可填 home,download,themes,studio,gate]
 * 产物：shots/{locale}-{page}-{viewport}.png（门页为 shots/gate-{viewport}.png）
 * gate = `/` 语言门页：禁 JS 拍摄（否则客户端重定向会跳走），即爬虫/no-JS 视角。
 * 注意：'home' 会归一化为 ''（/zh/home 不存在，SPA 回退会经门页重定向拍出错版首页——2026-08-04 实测 en 拍出 zh）
 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { chromium } from '@playwright/test';

const PORT = Number(process.env.SHOOT_PORT ?? 4173);
const base = `http://localhost:${PORT}`;
const isGate = process.argv[3] === 'gate';
const locales = isGate ? ['gate'] : (process.argv[2] ?? 'zh,en,ja,ko,fr').split(',');
const rawPage = isGate ? '' : (process.argv[3] ?? '');
const page = rawPage === 'home' ? '' : rawPage;

// preview 服务的是 dist：截图前必须先构建，否则拍到的是旧产物；连拍多页时用 SKIP_BUILD=1 跳过后续构建
if (!process.env.SKIP_BUILD) {
  const build = spawnSync('pnpm', ['build'], { stdio: 'inherit', shell: true });
  if (build.status !== 0) {
    console.error('build failed, aborting shoot');
    process.exit(build.status ?? 1);
  }
}

mkdirSync('shots', { recursive: true });

const server = spawn('pnpm', ['preview', '--port', String(PORT), '--strictPort'], {
  stdio: 'ignore',
  shell: true,
});
process.on('exit', () => server.kill());

async function waitForServer(timeout = 30_000) {
  const start = Date.now();
  for (;;) {
    try {
      const res = await fetch(base);
      if (res.ok) return;
    } catch {
      /* retry */
    }
    if (Date.now() - start > timeout) throw new Error('preview server timeout');
    await new Promise((r) => setTimeout(r, 400));
  }
}

await waitForServer();
const browser = await chromium.launch();
try {
  for (const locale of locales) {
    const url = isGate ? base : `${base}/${locale}/${page}`;
    const stem = isGate ? 'gate' : `${locale}-${page || 'home'}`;
    const ctxOpts = isGate ? { javaScriptEnabled: false } : {};
    const desktop = await browser.newPage({
      viewport: { width: 1440, height: 900 },
      reducedMotion: 'reduce',
      ...ctxOpts,
    });
    await desktop.goto(url, { waitUntil: 'networkidle' });
    await desktop.waitForTimeout(400);
    await desktop.screenshot({ path: `shots/${stem}-1440.png`, fullPage: true });
    await desktop.close();
    const mobile = await browser.newPage({
      viewport: { width: 390, height: 844 },
      reducedMotion: 'reduce',
      ...ctxOpts,
    });
    await mobile.goto(url, { waitUntil: 'networkidle' });
    await mobile.waitForTimeout(400);
    await mobile.screenshot({ path: `shots/${stem}-390.png`, fullPage: true });
    await mobile.close();
    console.log(`shot ${stem}`);
  }
} finally {
  await browser.close();
  server.kill();
}
