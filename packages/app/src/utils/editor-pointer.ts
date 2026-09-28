/** A completed click is the only confirmation. Pointer down never changes text. */
export class TapGesture {
  private start: { id: number; x: number; y: number; time: number } | null = null;
  cancelled = false;
  begin(event: Pick<PointerEvent, 'pointerId' | 'clientX' | 'clientY' | 'timeStamp'>): void {
    if (this.start) {
      this.cancel();
      return;
    }
    this.cancelled = false;
    this.start = { id: event.pointerId, x: event.clientX, y: event.clientY, time: event.timeStamp };
  }
  move(event: Pick<PointerEvent, 'pointerId' | 'clientX' | 'clientY'>): void {
    if (
      this.start &&
      (event.pointerId !== this.start.id ||
        Math.hypot(event.clientX - this.start.x, event.clientY - this.start.y) > 10)
    )
      this.cancel();
  }
  end(event: Pick<PointerEvent, 'pointerId' | 'clientX' | 'clientY' | 'timeStamp'>): boolean {
    this.move(event);
    const valid =
      !!this.start &&
      !this.cancelled &&
      event.pointerId === this.start.id &&
      event.timeStamp - this.start.time < 600;
    this.cancelled = !valid;
    this.start = null;
    return valid;
  }
  cancel(): void {
    this.cancelled = true;
  }
  reset(): void {
    this.start = null;
  }
}

/** Protect a toolbar as a whole so a swipe across multiple buttons cannot activate one. */
export function guardPointerClicks(root: HTMLElement, capture?: () => void): () => void {
  const gesture = new TapGesture();
  let pointerClick = false;
  let touchButton: HTMLElement | null = null;
  let suppressUntil = 0;
  const down = (event: PointerEvent) => {
    if (!root.contains(event.target as Node)) {
      if (pointerClick) gesture.cancel();
      return;
    }
    pointerClick = true;
    if (event.pointerType === 'mouse') suppressUntil = 0;
    root.dataset.pointerActive = 'true';
    touchButton =
      event.pointerType === 'touch' ? (event.target as Element).closest('button') : null;
    gesture.begin(event);
    capture?.();
  };
  const move = (event: PointerEvent) => gesture.move(event);
  const release = () => {
    delete root.dataset.pointerActive;
    touchButton = null;
  };
  const up = (event: PointerEvent) => {
    if (!pointerClick) return;
    const valid = gesture.end(event);
    if (touchButton) {
      if (valid && touchButton.isConnected) touchButton.click();
      suppressUntil = performance.now() + 800;
    }
    release();
  };
  const cancel = () => {
    gesture.cancel();
    gesture.reset();
    release();
  };
  const click = (event: MouseEvent) => {
    if (
      event.detail !== 0 &&
      ((pointerClick && gesture.cancelled) || performance.now() < suppressUntil)
    ) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
    pointerClick = false;
  };
  document.addEventListener('pointerdown', down, true);
  document.addEventListener('pointermove', move, true);
  document.addEventListener('pointerup', up, true);
  document.addEventListener('pointercancel', cancel, true);
  root.addEventListener('scroll', cancel, true);
  root.addEventListener('contextmenu', cancel, true);
  root.addEventListener('click', click, true);
  window.addEventListener('blur', cancel);
  return () => {
    document.removeEventListener('pointerdown', down, true);
    document.removeEventListener('pointermove', move, true);
    document.removeEventListener('pointerup', up, true);
    document.removeEventListener('pointercancel', cancel, true);
    root.removeEventListener('scroll', cancel, true);
    root.removeEventListener('contextmenu', cancel, true);
    root.removeEventListener('click', click, true);
    window.removeEventListener('blur', cancel);
  };
}

let users = 0;
function rememberPointer(event: PointerEvent): void {
  if (event.pointerType !== 'touch' && event.pointerType !== 'mouse' && event.pointerType !== 'pen')
    return;
  document.documentElement.dataset.editorPointer = event.pointerType;
  document.dispatchEvent(new Event('editor-pointer-change'));
}
export function trackEditorPointer(): () => void {
  if (++users === 1) document.addEventListener('pointerdown', rememberPointer, true);
  return () => {
    if (--users === 0) document.removeEventListener('pointerdown', rememberPointer, true);
  };
}
export function isTouchInput(): boolean {
  return document.documentElement.dataset.editorPointer === 'touch';
}
