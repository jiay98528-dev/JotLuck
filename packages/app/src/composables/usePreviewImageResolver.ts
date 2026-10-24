import { ref } from 'vue';
import type { IFileSystemService } from '@/types';
import { mintObjectUrl, revokeObjectUrl } from '@/utils/object-urls';

const IMAGE_MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
};

const EXTERNAL_SOURCE_RE = /^[a-z][a-z\d+.-]*:/i;
const PASSTHROUGH_SOURCE_RE = /^(?:https?:|data:|blob:)/i;

export interface ResolvedPreviewImagePath {
  path: string;
  mime: string;
}

/** 外部会话（外链文件/升级笔记本）图片读取上下文：走 read_external_note_asset。 */
export interface ExternalPreviewImageSession {
  accessToken: string;
}

const WINDOWS_DRIVE_PREFIX_RE = /^([A-Za-z]:)(?:\/|$)/;

export function resolvePreviewImagePath(
  notePath: string,
  source: string,
): ResolvedPreviewImagePath | null {
  const trimmed = source.trim();
  if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('//')) return null;
  if (EXTERNAL_SOURCE_RE.test(trimmed)) return null;

  const pathOnly = trimmed.split(/[?#]/, 1)[0] ?? '';
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathOnly).replace(/\\/g, '/');
  } catch {
    return null;
  }
  if (!decoded) return null;

  const normalizedNote = notePath.replace(/\\/g, '/');
  const noteSegments = normalizedNote.split('/').filter(Boolean);
  noteSegments.pop();
  // Windows 绝对 notePath（带盘符）时把盘符视作根段：相对引用在真实父目录下
  // 解析，根引用落到盘根；避免把 “D:/docs” 拼成 “/D:/docs” 畸形路径。
  const drivePrefix = WINDOWS_DRIVE_PREFIX_RE.exec(normalizedNote)?.[1] ?? '';
  const resolvedSegments = decoded.startsWith('/')
    ? drivePrefix
      ? [drivePrefix]
      : []
    : noteSegments;

  for (const segment of decoded.split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      // 盘符段是解析地板：越过盘根即拒绝（其余场景空段即拒绝）。
      if (resolvedSegments.length === 0 || (drivePrefix && resolvedSegments.length === 1)) {
        return null;
      }
      resolvedSegments.pop();
      continue;
    }
    if (segment.includes('\0')) return null;
    resolvedSegments.push(segment);
  }

  if (resolvedSegments.length === 0) return null;
  // 盘符开头（D:/…）不再补前导斜杠；笔记本相对路径维持 “/…” 根标记。
  const rooted = /^[A-Za-z]:$/.test(resolvedSegments[0] ?? '');
  const path = rooted ? resolvedSegments.join('/') : `/${resolvedSegments.join('/')}`;
  const filename = resolvedSegments.at(-1) ?? '';
  const dot = filename.lastIndexOf('.');
  const mime = dot >= 0 ? IMAGE_MIME_BY_EXTENSION[filename.slice(dot).toLowerCase()] : undefined;
  return mime ? { path, mime } : null;
}

export function usePreviewImageResolver(fs: IFileSystemService) {
  const imageRevision = ref(0);
  const cache = new Map<string, string>();
  const failed = new Set<string>();
  const pending = new Map<string, Promise<void>>();
  let currentNotePath = '';
  let currentScopeKey = '';
  let externalSession: ExternalPreviewImageSession | null = null;
  let generation = 0;

  function setNotePath(
    notePath: string,
    scopeKey = '',
    external: ExternalPreviewImageSession | null = null,
  ): void {
    const normalized = notePath.replace(/\\/g, '/');
    const normalizedScope = scopeKey.replace(/\\/g, '/');
    const nextExternal = external?.accessToken ? { accessToken: external.accessToken } : null;
    if (
      normalized === currentNotePath &&
      normalizedScope === currentScopeKey &&
      (nextExternal?.accessToken ?? '') === (externalSession?.accessToken ?? '')
    ) {
      return;
    }
    currentNotePath = normalized;
    currentScopeKey = normalizedScope;
    externalSession = nextExternal;
    generation++;
    // 缓存里可能持有 blob: object URL（外部会话分支）——换代前统一撤销，
    // 防 object URL 泄漏；data: URL 撤销是无害 no-op（data: URL 无此需求）。
    for (const url of cache.values()) revokeObjectUrl(url);
    cache.clear();
    failed.clear();
    pending.clear();
    imageRevision.value++;
  }

  function load(path: string, mime: string): Promise<void> {
    const existing = pending.get(path);
    if (existing) return existing;

    // 外部会话 svg 预拒：桌面闸门（fs_ops.rs resolve_asset 位图白名单）刻意
    // 排除可携带脚本的 svg——不预拒则每次引用必发必败 IPC 后静默裂图（load
    // catch 无占位通道）。视同 unsupported 直接登记失败，不发必败请求；工作
    // 区分支（readBinary 无白名单）svg 合法渲染不受影响。
    if (externalSession && mime === 'image/svg+xml') {
      failed.add(path);
      imageRevision.value++;
      return Promise.resolve();
    }

    const expectedGeneration = generation;
    // 会话分流：外部会话图片走授权命令（grant 目录内解析；IPC 二进制回流 →
    // Blob 零拷贝 objectURL，无 base64 33% 膨胀——read_document_conversion_asset
    // 同构链路）；工作区走 readBinary（base64 → data: URL 维持原状，无泄漏面）。
    const read: Promise<Uint8Array<ArrayBuffer> | string> = externalSession
      ? fs.readExternalAsset(externalSession.accessToken, path)
      : fs.readBinary(path);
    const task = read
      .then((payload) => {
        if (typeof payload === 'string') {
          if (expectedGeneration !== generation) return;
          cache.set(path, `data:${mime};base64,${payload}`);
        } else {
          // bytes 在手即 mint（短串），世代守卫在其后：换代后到达的成功必须
          // 立即撤销刚 mint 的引用防泄漏（useConversionAssets 同构先例）。
          const url = mintObjectUrl(payload, mime);
          if (expectedGeneration !== generation) {
            revokeObjectUrl(url);
            return;
          }
          cache.set(path, url);
        }
        failed.delete(path);
        imageRevision.value++;
      })
      .catch(() => {
        if (expectedGeneration === generation) failed.add(path);
      })
      .finally(() => {
        if (pending.get(path) === task) pending.delete(path);
      });
    pending.set(path, task);
    return task;
  }

  function resolveImageSrc(source: string): string | null {
    const trimmed = source.trim();
    if (
      trimmed.startsWith('#') ||
      trimmed.startsWith('//') ||
      PASSTHROUGH_SOURCE_RE.test(trimmed)
    ) {
      return source;
    }
    if (!currentNotePath) return null;
    const resolved = resolvePreviewImagePath(currentNotePath, source);
    if (!resolved) return null;

    const cached = cache.get(resolved.path);
    if (cached) return cached;
    if (!failed.has(resolved.path)) void load(resolved.path, resolved.mime);
    return null;
  }

  async function prime(path: string): Promise<void> {
    if (!currentNotePath) return;
    const resolved = resolvePreviewImagePath(currentNotePath, path);
    if (!resolved) return;
    const inFlight = pending.get(resolved.path);
    if (inFlight) await inFlight;
    if (cache.has(resolved.path)) return;
    failed.delete(resolved.path);
    await load(resolved.path, resolved.mime);
  }

  function reset(): void {
    setNotePath('', '');
  }

  return {
    imageRevision,
    setNotePath,
    resolveImageSrc,
    prime,
    reset,
  };
}
