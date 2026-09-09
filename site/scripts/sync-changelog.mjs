/**
 * GitHub Releases → 站点更新日志数据同步。
 * 用法:node scripts/sync-changelog.mjs(或 pnpm sync:changelog)
 * 拉取 JotLuck 的 GitHub Releases,写入 src/content/changelog.data.json(提交入库)。
 * 构建不联网:页面只消费提交后的数据文件;每次发行后重跑本脚本即完成同步。
 */
import { writeFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const OUT = join(ROOT, 'src', 'content', 'changelog.data.json');
const API = 'https://api.github.com/repos/jiay98528-dev/JotLuck/releases?per_page=100';

const res = await fetch(API, {
  headers: {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'jotluck-site-sync',
  },
});
if (!res.ok) {
  console.error(`GitHub API ${res.status}: ${await res.text().then((t) => t.slice(0, 200))}`);
  process.exit(1);
}
const raw = await res.json();
if (!Array.isArray(raw) || raw.length === 0) {
  console.error('GitHub API 返回空发行列表,拒绝写入空数据');
  process.exit(1);
}

const releases = raw
  .map((r) => ({
    tag: r.tag_name,
    name: r.name || r.tag_name,
    dateISO: r.published_at,
    url: r.html_url,
    prerelease: r.prerelease === true,
    bodyMD: (r.body ?? '').replace(/\r\n/g, '\n').trim(),
  }))
  .filter((r) => r.tag && r.dateISO)
  .sort((a, b) => (a.dateISO < b.dateISO ? 1 : -1));

if (releases.length === 0) {
  console.error('过滤后无可发行条目,拒绝写入');
  process.exit(1);
}

const prev = (() => {
  try {
    return JSON.parse(readFileSync(OUT, 'utf8'));
  } catch {
    return null;
  }
})();
const data = {
  syncedAt: new Date().toISOString(),
  source: 'https://github.com/jiay98528-dev/JotLuck/releases',
  releases,
};
writeFileSync(OUT, JSON.stringify(data, null, 2) + '\n');
console.log(
  `同步完成:${releases.length} 个发行 → src/content/changelog.data.json` +
    (prev ? `(上次 ${prev.releases?.length ?? '?'} 个;最新 ${releases[0].tag})` : ''),
);
