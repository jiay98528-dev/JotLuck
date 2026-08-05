/**
 * useImageUpload — 图片上传 composable
 *
 * 本地优先策略：图片写入笔记本目录下的 assets/ 子目录，
 * 在 Markdown 中使用相对路径引用。
 *
 * 每个任务在入队时固定工作区、笔记、编辑器和插入位置。文件读取或
 * 写入期间即使用户切换笔记，迟到任务也不会向旧编辑器或新笔记串写。
 *
 * @see migration-map.md §5
 */
import { computed, ref } from 'vue';
import { translate } from '@/i18n';
import { createUserMessageError, localizeUserError } from '@/services/command-errors';
import type { IFileSystemService } from '@/types';
import type { EditorView } from '@codemirror/view';

/** 支持的图片 MIME 类型 */
const IMAGE_MIMES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/svg+xml',
  'image/bmp',
]);

/** 图片存放目录（相对于笔记本根目录） */
const ASSETS_DIR = 'assets';
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export interface ImageUploadOwner {
  workspaceEpoch: number;
  notePath: string;
  view: EditorView;
}

export interface ImageUploadOwnerSnapshot extends ImageUploadOwner {
  selection: {
    from: number;
    to: number;
    head: number;
  };
}

export interface ImageUploadCleanupFailure {
  path: string;
  message: string;
  cause: unknown;
  owner: ImageUploadOwnerSnapshot;
}

interface ImageUploadJob {
  file: File;
  owner: ImageUploadOwnerSnapshot;
}

type ImageUploadedCallback = (
  path: string,
  owner: ImageUploadOwnerSnapshot,
) => void | Promise<void>;

type OrphanCleanupFailedCallback = (failure: ImageUploadCleanupFailure) => void;

/** 根据 MIME 类型获取扩展名 */
function extForMime(mime: string): string {
  const map: Record<string, string> = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/gif': '.gif',
    'image/webp': '.webp',
    'image/svg+xml': '.svg',
    'image/bmp': '.bmp',
  };
  return map[mime] ?? '.png';
}

/** 生成唯一文件名：时间戳 + 随机后缀 */
function uniqueName(mime: string): string {
  const ts = Date.now();
  const rand = Math.random().toString(36).slice(2, 6);
  return `img_${ts}_${rand}${extForMime(mime)}`;
}

/** 在任务开始时捕获的位置插入 Markdown 图片语法。 */
function insertImageMarkdown(
  owner: ImageUploadOwnerSnapshot,
  alt: string,
  relPath: string,
  cursor: number,
): number {
  const md = `![${alt}](${relPath})`;
  owner.view.dispatch({
    changes: { from: cursor, to: cursor, insert: md },
    selection: { anchor: cursor + md.length },
  });
  owner.view.focus();
  return cursor + md.length;
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(createUserMessageError('program.imageReadFailed'));
    reader.onload = () => {
      const result = String(reader.result ?? '');
      const comma = result.indexOf(',');
      resolve(comma === -1 ? result : result.slice(comma + 1));
    };
    reader.readAsDataURL(file);
  });
}

function dirname(path: string): string {
  const normalized = path.replace(/\\/g, '/');
  const lastSlash = normalized.lastIndexOf('/');
  return lastSlash <= 0 ? '/' : normalized.slice(0, lastSlash);
}

function segments(path: string): string[] {
  return path.split('/').filter(Boolean);
}

function relativeMarkdownPath(fromFile: string, targetPath: string): string {
  const from = segments(dirname(fromFile));
  const target = segments(targetPath);
  let common = 0;
  while (common < from.length && common < target.length && from[common] === target[common]) {
    common++;
  }

  const up = from.slice(common).map(() => '..');
  const down = target.slice(common);
  const rel = [...up, ...down].join('/');
  return up.length === 0 ? `./${rel}` : rel;
}

function errorMessage(error: unknown): string {
  return localizeUserError(error);
}

export function useImageUpload(
  fs: IFileSystemService,
  getOwner: () => ImageUploadOwner | null,
  onImageUploaded?: ImageUploadedCallback,
  onOrphanCleanupFailed?: OrphanCleanupFailedCallback,
) {
  const pendingCount = ref(0);
  const isUploading = computed(() => pendingCount.value > 0);
  const uploadError = ref<string | null>(null);
  let queueTail: Promise<void> = Promise.resolve();
  let lastInsertion:
    | {
        workspaceEpoch: number;
        notePath: string;
        view: EditorView;
        baseHead: number;
        nextHead: number;
      }
    | undefined;

  function captureJob(file: File): ImageUploadJob | null {
    const current = getOwner();
    if (!current || !current.notePath) return null;

    const selection = current.view.state.selection.main;
    return {
      file,
      owner: {
        workspaceEpoch: current.workspaceEpoch,
        notePath: current.notePath,
        view: current.view,
        selection: {
          from: selection.from,
          to: selection.to,
          head: selection.head,
        },
      },
    };
  }

  function isOwnerCurrent(job: ImageUploadJob): boolean {
    const current = getOwner();
    if (
      !current ||
      current.workspaceEpoch !== job.owner.workspaceEpoch ||
      current.notePath !== job.owner.notePath ||
      current.view !== job.owner.view
    ) {
      return false;
    }

    return (
      job.owner.view.dom.isConnected && job.owner.selection.head <= job.owner.view.state.doc.length
    );
  }

  /** 确保 assets 目录存在。 */
  async function ensureAssetsDir(): Promise<void> {
    try {
      const entries = await fs.listDirectory('/');
      if (!entries.some((entry) => entry.name === ASSETS_DIR && entry.isDirectory)) {
        await fs.createDirectory(`/${ASSETS_DIR}`);
      }
    } catch {
      // 目录可能已存在或文件系统不支持单独创建，实际写入仍会给出明确错误。
    }
  }

  async function cleanupOrphan(
    path: string,
    job: ImageUploadJob,
    reason: 'owner-changed' | 'insert-failed',
  ): Promise<void> {
    try {
      await fs.deleteFile(path);
      uploadError.value =
        reason === 'owner-changed'
          ? translate('program.imageCancelledCleaned')
          : translate('program.imageInsertFailedCleaned');
    } catch (error) {
      const message = translate('program.imageCleanupFailed', {
        path,
        error: errorMessage(error),
      });
      uploadError.value = message;
      try {
        onOrphanCleanupFailed?.({
          path,
          message,
          cause: error,
          owner: job.owner,
        });
      } catch {
        // uploadError 已保留完整可见信息，通知回调不得破坏队列收尾。
      }
    }
  }

  async function processJob(job: ImageUploadJob): Promise<void> {
    if (!isOwnerCurrent(job)) {
      uploadError.value = translate('program.imagePositionChanged');
      return;
    }

    let path: string;
    try {
      await ensureAssetsDir();
      const base64 = await readFileAsBase64(job.file);
      if (!isOwnerCurrent(job)) {
        uploadError.value = translate('program.imagePositionChanged');
        return;
      }

      path = `/${ASSETS_DIR}/${uniqueName(job.file.type)}`;
      await fs.writeBinary(path, base64);
    } catch (error) {
      uploadError.value = translate('program.imageSaveFailed', { error: errorMessage(error) });
      return;
    }

    if (!isOwnerCurrent(job)) {
      await cleanupOrphan(path, job, 'owner-changed');
      return;
    }

    const relPath = relativeMarkdownPath(job.owner.notePath, path);
    const alt = job.file.name.replace(/\.[^.]+$/, '');
    try {
      const previousInsertion = lastInsertion;
      const cursor =
        previousInsertion &&
        previousInsertion.workspaceEpoch === job.owner.workspaceEpoch &&
        previousInsertion.notePath === job.owner.notePath &&
        previousInsertion.view === job.owner.view &&
        previousInsertion.baseHead === job.owner.selection.head
          ? previousInsertion.nextHead
          : job.owner.selection.head;
      const nextHead = insertImageMarkdown(job.owner, alt, relPath, cursor);
      lastInsertion = {
        workspaceEpoch: job.owner.workspaceEpoch,
        notePath: job.owner.notePath,
        view: job.owner.view,
        baseHead: job.owner.selection.head,
        nextHead,
      };
    } catch {
      await cleanupOrphan(path, job, 'insert-failed');
      return;
    }

    try {
      await onImageUploaded?.(path, job.owner);
    } catch (error) {
      uploadError.value = translate('program.imageRefreshFailed', { error: errorMessage(error) });
    }
  }

  /**
   * 同步接管一个图片文件并加入串行队列。
   * 返回 true 表示调用方应阻止浏览器继续处理本次粘贴/拖放。
   */
  function queueImageFile(file: File): boolean {
    if (!IMAGE_MIMES.has(file.type)) return false;
    if (file.size > MAX_IMAGE_BYTES) {
      uploadError.value = translate('program.imageTooLarge');
      return true;
    }

    const job = captureJob(file);
    if (!job) return false;

    uploadError.value = null;
    pendingCount.value++;
    queueTail = queueTail
      .then(() => processJob(job))
      .catch((error: unknown) => {
        uploadError.value = translate('program.imageProcessFailed', { error: errorMessage(error) });
      })
      .finally(() => {
        pendingCount.value--;
        if (pendingCount.value === 0) lastInsertion = undefined;
      });
    return true;
  }

  /** 等到调用期间已经排队、以及等待过程中新增的任务全部结束。 */
  async function waitForIdle(): Promise<void> {
    while (pendingCount.value > 0) {
      const observedTail = queueTail;
      await observedTail;
      if (observedTail === queueTail && pendingCount.value === 0) return;
    }
  }

  /** 拖放进入时阻止默认行为。 */
  function handleDragOver(event: DragEvent): void {
    if (event.dataTransfer?.types.includes('Files')) {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
    }
  }

  /** 拖放处理：同步接管事件，图片写入由队列完成。 */
  function handleDrop(event: DragEvent): void {
    const files = event.dataTransfer?.files;
    if (!files || files.length === 0) return;

    event.preventDefault();
    for (let index = 0; index < files.length; index++) {
      const file = files[index];
      if (file) queueImageFile(file);
    }
  }

  /** 文件树拖放：不处理（交给文件管理器）。 */
  function handleFileTreeDrop(_event: DragEvent): boolean {
    return false;
  }

  /**
   * 剪贴板粘贴：同步判断并启动队列，让编辑器可以立刻 preventDefault。
   */
  function handlePaste(event: ClipboardEvent): boolean {
    const items = event.clipboardData?.items;
    if (!items) return false;

    let handled = false;
    for (let index = 0; index < items.length; index++) {
      const item = items[index];
      if (item?.kind !== 'file') continue;
      const file = item.getAsFile();
      if (file && queueImageFile(file)) handled = true;
    }
    return handled;
  }

  return {
    pendingCount,
    isUploading,
    uploadError,
    queueImageFile,
    waitForIdle,
    handleDragOver,
    handleDrop,
    handleFileTreeDrop,
    handlePaste,
  };
}
