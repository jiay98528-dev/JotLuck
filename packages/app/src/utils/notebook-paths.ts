export function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function displayNameFromPath(path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '');
  return normalized.split('/').pop() || normalized || 'Notebook';
}

/**
 * 归一化 OS 路径供比较与派生使用：反斜杠统一为正斜杠、去尾部多余斜杠。
 * 契约特例：Windows 盘符根（`C:/`）与 posix 根（`/`）原样保留，不裁剪；
 * 其余路径（含空串）至少返回去掉尾斜杠的形式（`''` → `''`）。
 */
export function normalizeOsPath(path: string): string {
  const normalized = (path || '').replace(/\\/g, '/');
  if (/^[A-Za-z]:\/$/.test(normalized)) return normalized;
  if (normalized === '/') return '/';
  return normalized.replace(/\/+$/, '');
}

/**
 * 判定两个笔记本根路径是否指向同一根，语义按平台分流：
 * 任一侧形如 `X:/` 的 Windows 盘符路径 → toLocaleLowerCase 后比较
 * （Windows 文件系统大小写不敏感，`c:/Notes` 与 `C:\notes\` 视为同根）；
 * 双侧均为 posix 风格路径 → 严格区分大小写（`/Notes` ≠ `/notes`）。
 * 行为契约见 utils/__tests__/notebook-paths.test.ts「notebookRootsEqual」组。
 */
export function notebookRootsEqual(left: string, right: string): boolean {
  const normalizedLeft = normalizeOsPath(left);
  const normalizedRight = normalizeOsPath(right);
  const isWindowsPath = /^[A-Za-z]:\//.test(normalizedLeft) || /^[A-Za-z]:\//.test(normalizedRight);
  return isWindowsPath
    ? normalizedLeft.toLocaleLowerCase() === normalizedRight.toLocaleLowerCase()
    : normalizedLeft === normalizedRight;
}

export function ensureMarkdownExtension(path: string): string {
  return /\.[^\\/]+$/.test(path) ? path : `${path}.md`;
}

/**
 * 把绝对文件路径拆为「父目录 root + 带前导斜杠的 relativePath」：
 * `C:/notes/a/b.md` → `{ root: 'C:/notes/a', relativePath: '/b.md' }`。
 * root 经 normalizeOsPath 二次归一（去尾斜杠、盘符根保留）；
 * 路径不含斜杠时（顶层文件形态）root 兜底为 posix 根 `'/'`。
 * 行为契约见 utils/__tests__/notebook-paths.test.ts「splitAbsoluteFilePath」组。
 */
export function splitAbsoluteFilePath(path: string): { root: string; relativePath: string } {
  const normalized = normalizeOsPath(path);
  const slash = normalized.lastIndexOf('/');
  if (slash < 0) return { root: '/', relativePath: `/${normalized}` };
  const root = normalizeOsPath(normalized.slice(0, slash) || '/');
  return { root, relativePath: `/${normalized.slice(slash + 1)}` };
}

export function encodeContentSize(content: string): number {
  return new TextEncoder().encode(content).length;
}

export function parentDirFromPath(path: string): string {
  const normalized = normalizePath(path);
  const slash = normalized.lastIndexOf('/');
  return slash > 0 ? normalized.slice(0, slash) : '/';
}

export function basenameFromPath(path: string): string {
  return normalizePath(path).split('/').pop() ?? '';
}

export function normalizePath(path: string): string {
  const normalized = (path || '').replace(/\\/g, '/');
  if (normalized === '/') return '/';
  return normalized.endsWith('/') ? normalized.slice(0, -1) : normalized;
}

export function normalizeDir(dir: string): string {
  const normalized = normalizePath(dir);
  return normalized === '' ? '/' : normalized;
}

export function joinPath(dir: string, name: string): string {
  const base = normalizeDir(dir);
  return base === '/' ? `/${name}` : `${base}/${name}`;
}

export function downloadMarkdownFile(content: string, fileName: string): void {
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
