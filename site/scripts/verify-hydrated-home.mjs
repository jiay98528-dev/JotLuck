#!/usr/bin/env node
import { spawn } from 'node:child_process';
import process from 'node:process';
import { chromium } from '@playwright/test';

const PORT = Number(process.env.HYDRATION_VERIFY_PORT ?? 4174);
const base = `http://localhost:${PORT}`;
const locales = ['zh', 'en', 'ja', 'ko', 'fr'];

const server = spawn('pnpm', ['preview', '--port', String(PORT), '--strictPort'], {
  stdio: 'ignore',
  shell: true,
});
process.on('exit', () => server.kill());

async function waitForServer(timeout = 30_000) {
  const start = Date.now();
  while (Date.now() - start <= timeout) {
    try {
      if ((await fetch(base)).ok) return;
    } catch {
      // Preview is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error('preview server timeout');
}

function normalize(text) {
  return text.replace(/\s+/g, ' ').trim();
}

await waitForServer();
const browser = await chromium.launch();
try {
  for (const locale of locales) {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const response = await page.goto(`${base}/${locale}/`, { waitUntil: 'networkidle' });
    if (!response?.ok()) throw new Error(`${locale}: page returned ${response?.status()}`);
    await page.waitForFunction(() => document.documentElement.classList.contains('fonts-ready'));

    const result = await page.locator('h1.statement').evaluate((heading) => ({
      visibleText: heading.textContent ?? '',
      accessibleName: heading.getAttribute('aria-label'),
      namedLines: heading.querySelectorAll('.display-line[aria-label]').length,
      animatedChars: heading.querySelectorAll('.ch[aria-hidden="true"]').length,
      hiddenCopies: heading.querySelectorAll('.sr-only').length,
    }));
    const visible = normalize(result.visibleText);
    const accessible = normalize(result.accessibleName ?? '');
    if (
      !visible ||
      visible !== accessible ||
      result.namedLines !== 0 ||
      result.animatedChars === 0 ||
      result.hiddenCopies !== 0
    ) {
      throw new Error(`${locale}: hydrated heading contract failed: ${JSON.stringify(result)}`);
    }
    console.log(`[hydration] ${locale} PASS: ${accessible}`);

    if (locale === 'en') {
      await page.locator('.site-nav-link[href="/en/download"]').click();
      await page.waitForURL(`${base}/en/download`);
      const routeStyle = await page.locator('.download-page').evaluate((element) => ({
        heading: element.querySelector('h1')?.textContent?.trim() ?? '',
        paddingBottom: getComputedStyle(element).paddingBottom,
      }));
      if (!routeStyle.heading || routeStyle.paddingBottom !== '120px') {
        throw new Error(`lazy route CSS contract failed: ${JSON.stringify(routeStyle)}`);
      }
      console.log('[hydration] lazy /en/download route PASS');
    }
    await page.close();
  }
} finally {
  await browser.close();
  server.kill();
}

console.log('[hydration] all locales PASS');
