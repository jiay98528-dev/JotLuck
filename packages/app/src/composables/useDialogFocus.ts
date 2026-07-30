import { nextTick, onBeforeUnmount, watch, type Ref } from 'vue';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

type FocusTarget = string | (() => HTMLElement | null);

interface DialogFocusOptions {
  visible: () => boolean;
  containerRef: Ref<HTMLElement | null>;
  initialFocus?: FocusTarget;
  fallbackFocus?: () => HTMLElement | null;
}

export interface DialogFocusController {
  suppressNextRestore: () => void;
}

interface DialogFocusEntry {
  id: symbol;
  containerRef: Ref<HTMLElement | null>;
  lastFocused: HTMLElement | null;
  focusInside: () => void;
}

const focusStack: DialogFocusEntry[] = [];
const observedDocuments = new WeakSet<Document>();
const pointerOpeners = new WeakMap<Document, { element: HTMLElement; capturedAt: number }>();

function observePointerOpeners(ownerDocument: Document): void {
  if (observedDocuments.has(ownerDocument)) return;
  observedDocuments.add(ownerDocument);
  ownerDocument.addEventListener(
    'pointerdown',
    (event) => {
      const element = event
        .composedPath()
        .find(
          (candidate) => candidate instanceof HTMLElement && candidate.matches(FOCUSABLE_SELECTOR),
        );
      if (element instanceof HTMLElement) {
        pointerOpeners.set(ownerDocument, { element, capturedAt: Date.now() });
      }
    },
    true,
  );
}

function topEntry(): DialogFocusEntry | undefined {
  return focusStack.at(-1);
}

function isUsable(element: HTMLElement | null): element is HTMLElement {
  if (!element?.isConnected) return false;
  if (element.hidden || element.closest('[hidden], [inert], [aria-hidden="true"]')) return false;
  if ('disabled' in element && Boolean((element as HTMLButtonElement).disabled)) return false;
  const ownerWindow = element.ownerDocument.defaultView;
  for (let current: HTMLElement | null = element; current; current = current.parentElement) {
    const style = ownerWindow?.getComputedStyle(current);
    if (
      style?.display === 'none' ||
      style?.visibility === 'hidden' ||
      style?.visibility === 'collapse'
    ) {
      return false;
    }
  }
  return true;
}

function isRestorable(element: HTMLElement | null): element is HTMLElement {
  if (!isUsable(element)) return false;
  const documentElement = element.ownerDocument.documentElement;
  return element !== element.ownerDocument.body && element !== documentElement;
}

function focusElement(element: HTMLElement | null): boolean {
  if (!isUsable(element)) return false;
  try {
    element.focus({ preventScroll: true });
    if (element.ownerDocument.activeElement !== element) element.focus();
    return element.ownerDocument.activeElement === element;
  } catch {
    return false;
  }
}

function focusableElements(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)].filter(isUsable);
}

export function useDialogFocus(options: DialogFocusOptions): DialogFocusController {
  if (typeof document !== 'undefined') observePointerOpeners(document);
  const id = Symbol('dialog-focus');
  let active = false;
  let opener: HTMLElement | null = null;
  let ownerDocument: Document | null = null;
  let restoreOnNextDeactivate = true;
  const entry: DialogFocusEntry = {
    id,
    containerRef: options.containerRef,
    lastFocused: null,
    focusInside: () => focusInside(),
  };

  function resolveInitialFocus(): HTMLElement | null {
    const container = options.containerRef.value;
    if (!container) return null;
    if (typeof options.initialFocus === 'function') {
      const explicit = options.initialFocus();
      if (explicit && container.contains(explicit) && isUsable(explicit)) return explicit;
    } else if (options.initialFocus) {
      const explicit = container.querySelector<HTMLElement>(options.initialFocus);
      if (isUsable(explicit)) return explicit;
    }
    const marked = container.querySelector<HTMLElement>('[data-dialog-initial-focus]');
    if (isUsable(marked)) return marked;
    return focusableElements(container)[0] ?? null;
  }

  function focusInside(): void {
    const container = options.containerRef.value;
    if (!container) return;
    const preferred =
      entry.lastFocused && container.contains(entry.lastFocused) && isUsable(entry.lastFocused)
        ? entry.lastFocused
        : resolveInitialFocus();
    if (focusElement(preferred)) return;
    container.tabIndex = -1;
    focusElement(container);
  }

  function onKeydown(event: KeyboardEvent): void {
    if (!active || topEntry()?.id !== id || event.key !== 'Tab') return;
    const container = options.containerRef.value;
    if (!container) return;
    const focusables = focusableElements(container);
    if (focusables.length === 0) {
      event.preventDefault();
      focusInside();
      return;
    }

    const current = ownerDocument?.activeElement as HTMLElement | null;
    const index = current ? focusables.indexOf(current) : -1;
    if (event.shiftKey && index <= 0) {
      event.preventDefault();
      focusElement(focusables.at(-1) ?? null);
    } else if (!event.shiftKey && (index < 0 || index === focusables.length - 1)) {
      event.preventDefault();
      focusElement(focusables[0] ?? null);
    }
  }

  function onFocusin(event: FocusEvent): void {
    if (!active || topEntry()?.id !== id) return;
    const container = options.containerRef.value;
    const target = event.target as HTMLElement | null;
    if (!container) return;
    if (target && container.contains(target)) {
      entry.lastFocused = target;
      return;
    }
    queueMicrotask(() => {
      if (!active || topEntry()?.id !== id) return;
      const currentContainer = options.containerRef.value;
      const current = ownerDocument?.activeElement;
      if (!currentContainer || (current instanceof Node && currentContainer.contains(current))) {
        return;
      }
      focusInside();
    });
  }

  function activate(): void {
    if (active || typeof document === 'undefined') return;
    active = true;
    ownerDocument = options.containerRef.value?.ownerDocument ?? document;
    observePointerOpeners(ownerDocument);
    const pointerOpener = pointerOpeners.get(ownerDocument);
    pointerOpeners.delete(ownerDocument);
    const activeElement =
      ownerDocument.activeElement instanceof HTMLElement ? ownerDocument.activeElement : null;
    opener =
      pointerOpener &&
      Date.now() - pointerOpener.capturedAt < 1000 &&
      isRestorable(pointerOpener.element)
        ? pointerOpener.element
        : activeElement;
    focusStack.push(entry);
    ownerDocument.addEventListener('keydown', onKeydown, true);
    ownerDocument.addEventListener('focusin', onFocusin, true);
    void nextTick(() => {
      if (active && topEntry()?.id === id) focusInside();
    });
  }

  function deactivate(restoreFocus = true): void {
    if (!active) return;
    const wasTop = topEntry()?.id === id;
    active = false;
    const index = focusStack.findIndex((candidate) => candidate.id === id);
    if (index >= 0) focusStack.splice(index, 1);
    ownerDocument?.removeEventListener('keydown', onKeydown, true);
    ownerDocument?.removeEventListener('focusin', onFocusin, true);
    entry.lastFocused = null;

    if (restoreFocus && wasTop) {
      const capturedOpener = opener;
      const capturedDocument = ownerDocument;
      void nextTick(() => {
        const restore = (onlyWhenFocusWasLost = false): void => {
          const requestedFallback = options.fallbackFocus?.() ?? null;
          const editorFallback =
            capturedDocument?.querySelector<HTMLElement>('.cm-content') ?? null;
          const target = isRestorable(capturedOpener)
            ? capturedOpener
            : isRestorable(requestedFallback)
              ? requestedFallback
              : editorFallback;
          const currentTop = topEntry();
          const currentContainer = currentTop?.containerRef.value;
          if (currentContainer && (!target || !currentContainer.contains(target))) {
            currentTop.focusInside();
            return;
          }

          const current = capturedDocument?.activeElement as HTMLElement | null;
          if (current === target) return;
          if (
            onlyWhenFocusWasLost &&
            current &&
            current !== capturedDocument?.body &&
            current !== capturedDocument?.documentElement &&
            isRestorable(current)
          ) {
            return;
          }
          if (!focusElement(target)) currentTop?.focusInside();
        };

        restore();
        // WebKit may clear focus after removing the focused dialog subtree. Re-assert
        // once on the next frame, but never override a deliberate intervening focus.
        capturedDocument?.defaultView?.requestAnimationFrame(() => restore(true));
      });
    }
    opener = null;
    ownerDocument = null;
  }

  watch(
    options.visible,
    (visible) => {
      if (visible) {
        restoreOnNextDeactivate = true;
        activate();
        return;
      }
      const restoreFocus = restoreOnNextDeactivate;
      restoreOnNextDeactivate = true;
      deactivate(restoreFocus);
    },
    { immediate: true },
  );
  onBeforeUnmount(() => deactivate());

  return {
    suppressNextRestore: () => {
      restoreOnNextDeactivate = false;
    },
  };
}
