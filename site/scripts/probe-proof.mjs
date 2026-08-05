/** 交互探针：验证编辑器证明反链点击切换文档（截图工具拍不到的行为）。
 * 判据：点击 .proof-backlink-btn 后 h2 文本从 docTitle 变为 altDoc.title，再点返回。
 * 产物：shots/proof-click-{before,after}.png（证明卡局部）
 */
import { spawn } from 'node:child_process';
import { chromium } from '@playwright/test';

const base = 'http://localhost:4173';
const server = spawn('pnpm', ['preview', '--port', '4173', '--strictPort'], {
  stdio: 'ignore',
  shell: true,
});
process.on('exit', () => server.kill());

for (;;) {
  try {
    if ((await fetch(base)).ok) break;
  } catch {}
  await new Promise((r) => setTimeout(r, 400));
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(`${base}/zh/`, { waitUntil: 'networkidle' });
const proof = page.locator('.proof');
await proof.scrollIntoViewIfNeeded();
await page.waitForTimeout(500);

const h2 = page.locator('.proof-rendered h2');
const before = await h2.textContent();
const chipBefore = await page.locator('.proof-bookmark-chip').textContent();
await proof.screenshot({ path: 'shots/proof-click-before.png' });

await page.locator('.proof-backlink-btn').click();
await page.waitForTimeout(600);
const after = await h2.textContent();
const chipAfter = await page.locator('.proof-bookmark-chip').textContent();
await proof.screenshot({ path: 'shots/proof-click-after.png' });

// 再点返回
await page.locator('.proof-backlink-btn').click();
await page.waitForTimeout(600);
const back = await h2.textContent();

console.log(JSON.stringify({ before, chipBefore, after, chipAfter, back }));
await browser.close();
server.kill();
if (before === after || back !== before) {
  console.error('PROOF SWITCH FAIL');
  process.exit(1);
}
console.log('PROOF SWITCH PASS');
