/** useImageUpload — 图片上传 composable (stub) @see migration-map.md §5 */
import { ref } from 'vue';
import type { IFileSystemService } from '@/types';

export function useImageUpload(_fs: IFileSystemService, _getEditorView: () => unknown) {
  const isUploading = ref(false);
  const uploadError = ref<string | null>(null);

  function createFilePickerHandler() {
    return async (_file: File): Promise<void> => {
      /* TODO: implement */
    };
  }

  function handleDragOver(_event: DragEvent): void {
    /* stub */
  }
  async function handleDrop(_event: DragEvent): Promise<void> {
    /* stub */
  }
  function handleFileTreeDrop(_event: DragEvent): boolean {
    return false;
  }
  async function handlePaste(_event: ClipboardEvent): Promise<boolean> {
    return false;
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
