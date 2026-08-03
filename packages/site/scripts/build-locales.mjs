import { execFileSync } from 'node:child_process';
import { readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = fileURLToPath(new URL('..', import.meta.url));
const locales = [
  ['en', 'www.jotluck.com'],
  ['ja', 'ja.jotluck.com'],
  ['zh-hans', 'zh-hans.jotluck.com'],
  ['zh-hant', 'zh-hant.jotluck.com'],
  ['ko', 'ko.jotluck.com'],
  ['fr', 'fr.jotluck.com'],
];
const expectedRoutes = [
  '/',
  '/product/',
  '/download/',
  '/themes/',
  '/support/',
  '/services/',
  '/studio/',
  '/privacy/',
];
const reviewDeadline = new Date('2026-08-15T23:59:59+08:00');
const pnpmCli = process.env.npm_execpath;

if (new Date() > reviewDeadline) {
  throw new Error(
    'The site is still prelaunch after 2026-08-15. Review the release state and public copy before building.',
  );
}

if (!pnpmCli) {
  throw new Error('Run this build through pnpm so the pnpm CLI entry point is available.');
}

for (const [locale, domain] of locales) {
  execFileSync(process.execPath, [pnpmCli, 'exec', 'vite-ssg', 'build'], {
    cwd: packageRoot,
    env: { ...process.env, SITE_LOCALE: locale },
    stdio: 'inherit',
  });

  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${expectedRoutes
    .map((path) => `  <url><loc>https://${domain}${path}</loc></url>`)
    .join('\n')}\n</urlset>\n`;
  writeFileSync(join(packageRoot, 'dist', locale, 'sitemap.xml'), sitemap, 'utf8');
}

const htmlCount = locales.reduce((total, [locale]) => {
  const walk = (directory) =>
    readdirSync(directory, { withFileTypes: true }).reduce(
      (count, entry) =>
        count +
        (entry.isDirectory()
          ? walk(join(directory, entry.name))
          : Number(entry.name === 'index.html')),
      0,
    );
  return total + walk(join(packageRoot, 'dist', locale));
}, 0);

if (htmlCount !== 48) throw new Error(`Expected 48 generated HTML pages, found ${htmlCount}.`);
console.log(`Generated ${htmlCount} localized static pages.`);
