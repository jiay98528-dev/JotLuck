export function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function displayNameFromPath(path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '');
  return normalized.split('/').pop() || normalized || 'Notebook';
}

export function normalizeOsPath(path: string): string {
  const normalized = (path || '').replace(/\\/g, '/');
  if (/^[A-Za-z]:\/$/.test(normalized)) return normalized;
  if (normalized === '/') return '/';
  return normalized.replace(/\/+$/, '');
}

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
