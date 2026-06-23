/**
 * useImageUpload — 图片上传 composable
 *
 * 本地优先策略：图片写入笔记本目录下的 assets/ 子目录，
 * 在 Markdown 中使用相对路径引用。
 *
 * 支持三种输入：
 *   - 文件选择器（input[type=file]）
 *   - 拖放（drag & drop）
 *   - 剪贴板粘贴（Ctrl+V）
 *
 * @see migration-map.md §5
 */
import { ref } from 'vue';
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

/** 在光标位置插入 Markdown 图片语法 */
function insertImageMarkdown(view: EditorView, alt: string, relPath: string): void {
  const cursor = view.state.selection.main.head;
  const md = `![${alt}](${relPath})`;
  view.dispatch({
    changes: { from: cursor, to: cursor, insert: md },
    selection: { anchor: cursor + md.length },
  });
  view.focus();
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('无法读取图片文件'));
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

function relativeMarkdownPath(fromFile: string | undefined, targetPath: string): string {
  const from = segments(fromFile ? dirname(fromFile) : '/');
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

export function useImageUpload(
  fs: IFileSystemService,
  getEditorView: () => EditorView | null,
  getCurrentNotePath?: () => string,
  onImageUploaded?: (path: string) => void | Promise<void>,
) {
  const isUploading = ref(false);
  const uploadError = ref<string | null>(null);

  /** 确保 assets 目录存在 */
  async function ensureAssetsDir(): Promise<void> {
    try {
      const entries = await fs.listDirectory('/');
      if (!entries.some((e) => e.name === ASSETS_DIR && e.isDirectory)) {
        await fs.createDirectory(`/${ASSETS_DIR}`);
      }
    } catch {
      // 目录可能已存在或文件系统不支持，忽略
    }
  }

  /** 将文件写入 assets 目录，返回笔记本根目录相对路径 */
  async function writeImageFile(file: File): Promise<string> {
    await ensureAssetsDir();
    const name = uniqueName(file.type);
    const path = `/${ASSETS_DIR}/${name}`;
    const base64 = await readFileAsBase64(file);
    await fs.writeBinary(path, base64);
    return path;
  }

  /** 处理 File 对象（来自选择器或拖放），写入并插入 */
  async function handleImageFile(file: File): Promise<void> {
    const view = getEditorView();
    if (!view) return;

    if (!IMAGE_MIMES.has(file.type)) return;
    if (file.size > MAX_IMAGE_BYTES) {
      uploadError.value = '图片超过 5MB，请压缩后再插入';
      return;
    }

    isUploading.value = true;
    uploadError.value = null;
    try {
      const path = await writeImageFile(file);
      const relPath = relativeMarkdownPath(getCurrentNotePath?.(), path);
      const alt = file.name.replace(/\.[^.]+$/, '');
      insertImageMarkdown(view, alt, relPath);
      await onImageUploaded?.(path);
    } catch (e) {
      uploadError.value = `图片保存失败: ${e instanceof Error ? e.message : String(e)}`;
    } finally {
      isUploading.value = false;
    }
  }

  /** 文件选择器回调 */
  function createFilePickerHandler() {
    return async (file: File): Promise<void> => {
      await handleImageFile(file);
    };
  }

  /** 拖放进入时阻止默认行为 */
  function handleDragOver(event: DragEvent): void {
    if (event.dataTransfer?.types.includes('Files')) {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
    }
  }

  /** 拖放处理：提取图片文件并插入 */
  async function handleDrop(event: DragEvent): Promise<void> {
    const files = event.dataTransfer?.files;
    if (!files || files.length === 0) return;

    event.preventDefault();
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (file) await handleImageFile(file);
    }
  }

  /** 文件树拖放：不处理（交给文件管理器） */
  function handleFileTreeDrop(_event: DragEvent): boolean {
    return false;
  }

  /** 剪贴板粘贴：检测图片并插入 */
  async function handlePaste(event: ClipboardEvent): Promise<boolean> {
    const items = event.clipboardData?.items;
    if (!items) return false;

    let handled = false;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item?.kind === 'file') {
        const file = item.getAsFile();
        if (file && IMAGE_MIMES.has(file.type)) {
          await handleImageFile(file);
          handled = true;
        }
      }
    }
    return handled;
  }

  return {
    isUploading,
    uploadError,
    createFilePickerHandler,
    handleDragOver,
    handleDrop,
    handleFileTreeDrop,
    handlePaste,
  };
}
