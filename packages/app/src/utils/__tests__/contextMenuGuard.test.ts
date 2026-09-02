import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { isTauri } = vi.hoisted(() => ({ isTauri: vi.fn() }));

vi.mock('@tauri-apps/api/core', () => ({ isTauri }));

import { installDesktopContextMenuGuard } from '../contextMenuGuard';

function dispatchContextMenuOn(target: Element): boolean {
  const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event.defaultPrevented;
}

describe('installDesktopContextMenuGuard', () => {
  let uninstall: () => void = () => {};

  beforeEach(() => {
    isTauri.mockReset();
  });

  afterEach(() => {
    uninstall();
    uninstall = () => {};
    document.body.innerHTML = '';
  });

  it('suppresses the default menu on non-editable surfaces in the desktop runtime', () => {
    isTauri.mockReturnValue(true);
    uninstall = installDesktopContextMenuGuard();

    const plain = document.createElement('div');
    document.body.append(plain);
    expect(dispatchContextMenuOn(plain)).toBe(true);

    const anchor = document.createElement('a');
    anchor.href = 'https://example.com';
    plain.append(anchor);
    expect(dispatchContextMenuOn(anchor)).toBe(true);
  });

  it('keeps the native menu on editable surfaces', () => {
    isTauri.mockReturnValue(true);
    uninstall = installDesktopContextMenuGuard();

    const input = document.createElement('input');
    const textarea = document.createElement('textarea');
    const editable = document.createElement('div');
    editable.setAttribute('contenteditable', 'true');
    const cmContent = document.createElement('div');
    cmContent.className = 'cm-content';
    document.body.append(input, textarea, editable, cmContent);

    expect(dispatchContextMenuOn(input)).toBe(false);
    expect(dispatchContextMenuOn(textarea)).toBe(false);
    expect(dispatchContextMenuOn(editable)).toBe(false);
    expect(dispatchContextMenuOn(cmContent)).toBe(false);
  });

  it('ignores contenteditable="false" wrappers around editable content', () => {
    isTauri.mockReturnValue(true);
    uninstall = installDesktopContextMenuGuard();

    const locked = document.createElement('div');
    locked.setAttribute('contenteditable', 'false');
    const inner = document.createElement('div');
    locked.append(inner);
    document.body.append(locked);

    expect(dispatchContextMenuOn(inner)).toBe(true);
  });

  it('does not install any listener outside the desktop runtime', () => {
    isTauri.mockReturnValue(false);
    uninstall = installDesktopContextMenuGuard();

    const plain = document.createElement('div');
    document.body.append(plain);
    expect(dispatchContextMenuOn(plain)).toBe(false);
  });
});
