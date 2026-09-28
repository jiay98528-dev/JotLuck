export interface ScreenRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export function visibleEditorRect(editor?: ScreenRect): ScreenRect {
  const viewport = window.visualViewport;
  const left = viewport?.offsetLeft ?? 0;
  const top = viewport?.offsetTop ?? 0;
  return {
    left: Math.max(left, editor?.left ?? left) + 8,
    top: Math.max(top, editor?.top ?? top) + 8,
    right: Math.min(left + (viewport?.width ?? window.innerWidth), editor?.right ?? Infinity) - 8,
    bottom:
      Math.min(top + (viewport?.height ?? window.innerHeight), editor?.bottom ?? Infinity) - 8,
  };
}

export function placeEditorOverlay(
  anchor: ScreenRect,
  width: number,
  height: number,
  bounds: ScreenRect,
) {
  const maxWidth = Math.max(0, bounds.right - bounds.left);
  const above = Math.max(0, anchor.top - bounds.top - 4);
  const below = Math.max(0, bounds.bottom - anchor.bottom - 4);
  const maxHeight = Math.max(0, Math.min(bounds.bottom - bounds.top, Math.max(above, below)));
  const actualHeight = Math.min(height, maxHeight);
  const top =
    above >= height
      ? anchor.top - actualHeight - 4
      : below >= height || below > above
        ? anchor.bottom + 4
        : anchor.top - actualHeight - 4;
  return {
    left: Math.max(bounds.left, Math.min(anchor.left, bounds.right - Math.min(width, maxWidth))),
    top: Math.max(bounds.top, Math.min(top, bounds.bottom - actualHeight)),
    maxWidth,
    maxHeight,
  };
}

/** All coordinates are CSS pixels; visualViewport.scale must not be applied again. */
export function positionEditorOverlay(
  root: HTMLElement,
  editor: HTMLElement,
  anchor: ScreenRect,
): void {
  const bounds = visibleEditorRect(editor.getBoundingClientRect());
  root.style.maxWidth = `${Math.max(0, bounds.right - bounds.left)}px`;
  root.style.maxHeight = '';
  root.style.boxSizing = 'border-box';
  const size = root.getBoundingClientRect();
  const placed = placeEditorOverlay(anchor, size.width || 280, size.height || 44, bounds);
  root.style.position = 'fixed';
  root.style.left = `${placed.left}px`;
  root.style.top = `${placed.top}px`;
  root.style.maxHeight = `${placed.maxHeight}px`;
  root.style.overflowY = 'auto';
  root.style.visibility = 'visible';
}

export function observeEditorViewport(
  update: () => void,
  followScroll = true,
): { schedule: () => void; destroy: () => void } {
  let frame: number | null = null;
  const schedule = () => {
    if (frame === null)
      frame = requestAnimationFrame(() => {
        frame = null;
        update();
      });
  };
  window.addEventListener('resize', schedule);
  if (followScroll) {
    document.addEventListener('scroll', schedule, true);
    document.addEventListener('editor-pointer-change', schedule);
  }
  window.visualViewport?.addEventListener('resize', schedule);
  window.visualViewport?.addEventListener('scroll', schedule);
  return {
    schedule,
    destroy: () => {
      if (frame !== null) cancelAnimationFrame(frame);
      window.removeEventListener('resize', schedule);
      document.removeEventListener('scroll', schedule, true);
      document.removeEventListener('editor-pointer-change', schedule);
      window.visualViewport?.removeEventListener('resize', schedule);
      window.visualViewport?.removeEventListener('scroll', schedule);
    },
  };
}
