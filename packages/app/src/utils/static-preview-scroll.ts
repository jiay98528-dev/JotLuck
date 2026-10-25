/**
 * static-preview-scroll — 静态 v-html 预览的切笔记滚动复位（E6）
 *
 * 渐进路径（ProgressivePreview）经 :key 重挂载天然回顶；静态路径容器复用
 * 不重建——读视图滚容器为 .reader-workbench、分栏滚容器为 .split-preview
 * 自身，切笔记须复位其 scrollTop 对齐渐进行为。仅静态路径调用（渐进路径
 * 自身 install→scrollToPosition 会定位回顶，无需宿主干预）。
 */

/** 复位静态预览两滚容器（读视图工作台 / 分栏预览自身）到顶部。 */
export function resetStaticPreviewScroll(
  readerWorkbench: HTMLElement | null,
  staticPreview: HTMLElement | null,
): void {
  if (readerWorkbench) readerWorkbench.scrollTop = 0;
  if (staticPreview) staticPreview.scrollTop = 0;
}
