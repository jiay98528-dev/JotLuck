/**
 * useImageUpload — 图片上传三通道 composable
 *
 * P2-1: 支持三种图片插入方式:
 *   A. 工具栏按钮 → 文件选择器
 *   B. OS 拖拽文件到编辑器
 *   C. 从文件树侧栏拖入
 *   + 剪贴板粘贴图片
 *
 * @module useImageUpload
 * @see milestones.md M4-06, M4-07
 */

import { ref } from 'vue';
import type { IFileSystemService } from '@/types';
import type { EditorView } from '@codemirror/view';

/** 支持的图片 MIME 类型 */
const IMAGE_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/svg+xml',
  'image/webp',
  'image/bmp',
];

/** 从 dataTransfer 中提取图片文件 */
function getImageFiles(dataTransfer: DataTransfer): File[] {
  const files: File[] = [];
  for (let i = 0; i < dataTransfer.files.length; i++) {
    const file = dataTransfer.files[i];
    if (file && IMAGE_MIME_TYPES.includes(file.type)) {
      files.push(file);
    }
  }
  return files;
}

/** 从剪贴板中提取图片 Blob */
function getImageFromClipboard(data: DataTransfer): { blob: Blob; type: string } | null {
  for (let i = 0; i < data.items.length; i++) {
    const item = data.items[i];
    if (item && item.kind === 'file' && item.type.startsWith('image/')) {
      return { blob: item.getAsFile()!, type: item.type };
    }
  }
  return null;
}

/** 读取文件为 base64 data URI */
function readFileAsBase64(file: File | Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('文件读取失败'));
    reader.readAsDataURL(file);
  });
}

/** 清理文件名，移除路径和特殊字符 */
function sanitizeFileName(name: string): string {
  return name
    .replace(/^.*[\\/]/, '') // 去除路径前缀
    .replace(/[<>:"|?*\s]+/g, '-') // 替换 Windows 非法字符和空格
    .replace(/-+/g, '-') // 合并连字符
    .replace(/^-|-$/g, '') // 去除首尾连字符
    .toLowerCase();
}

/** 在光标位置插入 Markdown 图片语法 */
function insertImageAtCursor(view: EditorView, alt: string, path: string): void {
  const { from } = view.state.selection.main;
  const markdown = `![${alt}](${path})`;
  view.dispatch({
    changes: { from, insert: markdown },
    selection: { anchor: from + markdown.length },
  });
}

export function useImageUpload(fs: IFileSystemService, getEditorView: () => EditorView | null) {
  const isUploading = ref(false);
  const uploadError = ref<string | null>(null);

  /** 根据扩展名获取文件图标字符 */
  function getFileIcon(path: string): string {
    if (path.endsWith('.md')) return '#';
    if (path.endsWith('.txt')) return '¶';
    if (/\.(png|jpe?g|gif|svg|webp|ico|bmp)$/i.test(path)) return '▣';
    return '—';
  }

  /** 保存图片到 assets/ 并返回路径 */
  async function saveImage(base64: string, fileName: string): Promise<string> {
    const safeName = sanitizeFileName(fileName);
    const path = `/assets/${safeName}`;

    // 如果同名文件已存在，追加时间戳
    let finalPath = path;
    try {
      await fs.statFile(path);
      const ext =
        safeName.lastIndexOf('.') > 0 ? safeName.substring(safeName.lastIndexOf('.')) : '';
      const base = safeName.substring(0, safeName.lastIndexOf('.'));
      finalPath = `/assets/${base}-${Date.now()}${ext}`;
    } catch {
      // 文件不存在，使用原路径
    }

    await fs.writeBinary(finalPath, base64);
    return finalPath;
  }

  /**
   * 通道 A: 工具栏 → 文件选择器
   * 返回一个函数，调用方负责触发 <input type="file">
   */
  function createFilePickerHandler() {
    return async (file: File): Promise<void> => {
      const view = getEditorView();
      if (!view) return;

      isUploading.value = true;
      uploadError.value = null;

      try {
        const base64 = await readFileAsBase64(file);
        const savedPath = await saveImage(base64, file.name);
        const alt = file.name.replace(/\.[^.]+$/, '');
        insertImageAtCursor(view, alt, savedPath);
      } catch (e) {
        uploadError.value = e instanceof Error ? e.message : '图片上传失败';
      } finally {
        isUploading.value = false;
      }
    };
  }

  /**
   * 通道 B: OS 拖拽文件到编辑器
   * 作为 dragover + drop 事件处理器绑定到 editorView.dom
   */
  function handleDragOver(event: DragEvent): void {
    // 仅当拖拽包含文件时才拦截
    if (event.dataTransfer?.types.includes('Files')) {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
    }
  }

  async function handleDrop(event: DragEvent): Promise<void> {
    const view = getEditorView();
    if (!view) return;

    const files = event.dataTransfer ? getImageFiles(event.dataTransfer) : [];

    // 检查是否为文件树拖入（text/plain 数据 + 文件路径）
    if (files.length === 0 && event.dataTransfer) {
      const textData = event.dataTransfer.getData('text/plain');
      if (textData) {
        event.preventDefault();
        // 文件树拖入 → 插入引用路径
        if (fs.isBinaryPath(textData)) {
          const alt =
            textData
              .split('/')
              .pop()
              ?.replace(/\.[^.]+$/, '') ?? 'image';
          insertImageAtCursor(view, alt, textData);
        } else if (textData.endsWith('.md') || textData.endsWith('.txt')) {
          // 拖入笔记/文本文件 → 插入 wiki-link
          const name =
            textData
              .split('/')
              .pop()
              ?.replace(/\.[^.]+$/, '') ?? 'file';
          insertImageAtCursor(view, name, textData);
        }
        return;
      }
    }

    if (files.length === 0) return;

    event.preventDefault();
    isUploading.value = true;
    uploadError.value = null;

    try {
      for (const file of files) {
        const base64 = await readFileAsBase64(file);
        const savedPath = await saveImage(base64, file.name);
        const alt = file.name.replace(/\.[^.]+$/, '');
        insertImageAtCursor(view, alt, savedPath);
      }
    } catch (e) {
      uploadError.value = e instanceof Error ? e.message : '图片上传失败';
    } finally {
      isUploading.value = false;
    }
  }

  /**
   * 通道 C: 文件树节点拖入
   * FileTreeNode 通过 dataTransfer.setData('text/plain', path) 传递路径
   */
  function handleFileTreeDrop(event: DragEvent): boolean {
    const path = event.dataTransfer?.getData('text/plain');
    if (!path) return false;

    const view = getEditorView();
    if (!view) return false;

    event.preventDefault();

    if (fs.isBinaryPath(path)) {
      const alt =
        path
          .split('/')
          .pop()
          ?.replace(/\.[^.]+$/, '') ?? 'image';
      insertImageAtCursor(view, alt, path);
    } else if (path.endsWith('.md')) {
      const name = path.split('/').pop()?.replace(/\.md$/, '') ?? 'note';
      insertImageAtCursor(view, name, path);
    } else {
      // 通用文件：插入路径链接
      const name = path.split('/').pop() ?? 'file';
      insertImageAtCursor(view, name, path);
    }
    return true;
  }

  /**
   * 剪贴板粘贴图片处理
   * 在 paste 事件中检测图片，拦截默认行为后保存并插入
   */
  async function handlePaste(event: ClipboardEvent): Promise<boolean> {
    if (!event.clipboardData) return false;

    const imageData = getImageFromClipboard(event.clipboardData);
    if (!imageData) return false;

    const view = getEditorView();
    if (!view) return false;

    event.preventDefault();
    isUploading.value = true;
    uploadError.value = null;

    try {
      const base64 = await readFileAsBase64(imageData.blob);
      const ext = imageData.type.split('/')[1] ?? 'png';
      const savedPath = await saveImage(base64, `paste-${Date.now()}.${ext}`);
      insertImageAtCursor(view, 'pasted image', savedPath);
      return true;
    } catch (e) {
      uploadError.value = e instanceof Error ? e.message : '图片粘贴失败';
      return false;
    } finally {
      isUploading.value = false;
    }
  }

  return {
    isUploading,
    uploadError,
    getFileIcon,
    createFilePickerHandler,
    handleDragOver,
    handleDrop,
    handleFileTreeDrop,
    handlePaste,
  };
}
