import { isDesktopRuntime } from './runtime';

/**
 * 桌面 WebView 默认上下文菜单分区禁用。
 *
 * WebView2 的默认右键菜单（后退/刷新/另存为等）在 Tauri custom-protocol
 * 环境下大多是无效动作，弹出即误导用户。全局在捕获阶段拦截：可编辑表面
 * （编辑器正文、输入框）放行原生菜单以保留右键复制/粘贴；其余表面仅
 * preventDefault，不 stopPropagation，文件树等自定义右键菜单不受影响。
 * Web 运行时不安装——浏览器原生菜单本就是有效功能。
 */
const EDITABLE_SURFACE_SELECTOR = [
  'input',
  'textarea',
  '[contenteditable]:not([contenteditable="false"])',
  '.cm-content',
].join(', ');

export function installDesktopContextMenuGuard(): () => void {
  if (!isDesktopRuntime()) return () => {};
  const onContextMenu = (event: Event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.closest(EDITABLE_SURFACE_SELECTOR)) return;
    event.preventDefault();
  };
  window.addEventListener('contextmenu', onContextMenu, { capture: true });
  return () => window.removeEventListener('contextmenu', onContextMenu, { capture: true });
}
