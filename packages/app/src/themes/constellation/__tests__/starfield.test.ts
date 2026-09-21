import { afterEach, describe, expect, it, vi } from 'vitest';
import { createConstellationStarfield } from '../starfield';

/**
 * Minimal CanvasRenderingContext2D stub covering only the surface the
 * engine actually touches. Each method comment notes the real Canvas API
 * it stands in for, so future engine changes can extend the stub.
 *
 * Real APIs covered:
 *   - save() / restore(): context state stack.
 *   - setTransform(a,b,c,d,e,f): replace current transform matrix.
 *   - clearRect(x,y,w,h): erase pixels to transparent.
 *   - createRadialGradient(x0,y0,r0,x1,y1,r1): returns CanvasGradient with
 *     addColorStop(offset, colour) for radial sprite construction.
 *   - fillStyle (setter) + fillRect(x,y,w,h): paint solid region.
 *   - globalCompositeOperation (setter): draw mode ('source-over' etc.).
 *   - globalAlpha (setter): per-draw opacity multiplier.
 *   - drawImage(canvas, x, y, w, h): blit an offscreen canvas region.
 */
interface FakeGradient {
  addColorStop: (offset: number, colour: string) => void;
}

function makeFakeCanvas2D(): CanvasRenderingContext2D {
  const calls = {
    save: 0,
    restore: 0,
    clearRect: 0,
    fillRect: 0,
    drawImage: 0,
    setTransform: 0,
    createRadialGradient: 0,
    fillStyleSet: 0,
    compositeSet: 0,
    alphaSet: 0,
  };
  const ctx: CanvasRenderingContext2D = {
    save: vi.fn(() => {
      calls.save++;
    }),
    restore: vi.fn(() => {
      calls.restore++;
    }),
    clearRect: vi.fn(() => {
      calls.clearRect++;
    }),
    setTransform: vi.fn(() => {
      calls.setTransform++;
    }),
    createRadialGradient: vi.fn((): FakeGradient => {
      calls.createRadialGradient++;
      return { addColorStop: vi.fn() };
    }),
    fillRect: vi.fn(() => {
      calls.fillRect++;
    }),
    drawImage: vi.fn(() => {
      calls.drawImage++;
    }),
    get fillStyle(): string {
      return '';
    },
    set fillStyle(_v: string) {
      calls.fillStyleSet++;
    },
    get globalCompositeOperation(): GlobalCompositeOperation {
      return 'source-over';
    },
    set globalCompositeOperation(_v: GlobalCompositeOperation) {
      calls.compositeSet++;
    },
    get globalAlpha(): number {
      return 1;
    },
    set globalAlpha(_v: number) {
      calls.alphaSet++;
    },
    canvas: document.createElement('canvas'),
  } as unknown as CanvasRenderingContext2D;
  return ctx;
}

function makeCanvasWithContext(kind: 'webgl2' | '2d', ctx: unknown): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  const stub = vi.fn((target: 'webgl2' | '2d'): unknown => {
    if (target === kind) return ctx;
    return null;
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (canvas as any).getContext = stub;
  // Provide a measurable client rect so the engine treats size as non-zero.
  Object.defineProperty(canvas, 'getBoundingClientRect', {
    configurable: true,
    value: () =>
      ({
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: 800,
        bottom: 600,
        width: 800,
        height: 600,
        toJSON: () => ({}),
      }) as DOMRect,
  });
  return canvas;
}

/* ── matchMedia stub ─────────────────────────────────────────────────── */

/**
 * Real MediaQueryList exposes:
 *   - matches: boolean (current state of the query)
 *   - addEventListener('change', cb) / removeEventListener('change', cb)
 *   - older addListener / removeListener on older Safari
 *
 * We capture the listener so the engine's `change` handler stays observable.
 */
interface FakeMotionQuery {
  matches: boolean;
  media: string;
  addEventListener: (event: 'change', cb: () => void) => void;
  removeEventListener: (event: 'change', cb: () => void) => void;
  dispatch: () => void;
}

function stubMatchMedia(matches: boolean): FakeMotionQuery {
  const listeners = new Set<() => void>();
  const mq: FakeMotionQuery = {
    matches,
    media: '(prefers-reduced-motion: reduce)',
    addEventListener: (_event, cb) => {
      listeners.add(cb);
    },
    removeEventListener: (_event, cb) => {
      listeners.delete(cb);
    },
    dispatch: () => {
      listeners.forEach((cb) => cb());
    },
  };
  // jsdom 29 implements matchMedia but always returns matches:false — replace.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).matchMedia = vi.fn(() => mq);
  return mq;
}

/* ── tests ───────────────────────────────────────────────────────────── */

describe('Constellation starfield', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    // Restore document.hidden to its default getter if we patched it.
    delete (document as { hidden?: boolean }).hidden;
  });

  it('falls back to static mode when getContext returns null and is idempotent on dispose', () => {
    const canvas = document.createElement('canvas');
    // jsdom: by default canvas.getContext returns null for both '2d' and 'webgl2'.
    const handle = createConstellationStarfield(canvas);
    expect(handle.mode).toBe('static');
    // dispose must be safe to call repeatedly.
    expect(() => handle.dispose()).not.toThrow();
    expect(() => handle.dispose()).not.toThrow();
  });

  it('uses canvas2d mode when only a 2d context is available, schedules rAF, and disposes cleanly', () => {
    const fakeCtx = makeFakeCanvas2D();
    const canvas = makeCanvasWithContext('2d', fakeCtx);
    stubMatchMedia(false);

    const rafSpy = vi.spyOn(window, 'requestAnimationFrame');
    const cancelSpy = vi.spyOn(window, 'cancelAnimationFrame');

    const handle = createConstellationStarfield(canvas);
    expect(handle.mode).toBe('canvas2d');
    expect(rafSpy).toHaveBeenCalled();

    handle.dispose();
    expect(cancelSpy).toHaveBeenCalled();
    // Second dispose must remain idempotent.
    expect(() => handle.dispose()).not.toThrow();
  });

  it('never schedules rAF when prefers-reduced-motion is reduce', () => {
    const fakeCtx = makeFakeCanvas2D();
    const canvas = makeCanvasWithContext('2d', fakeCtx);
    stubMatchMedia(true);

    const rafSpy = vi.spyOn(window, 'requestAnimationFrame');
    const handle = createConstellationStarfield(canvas);
    expect(handle.mode).toBe('canvas2d');
    expect(rafSpy).not.toHaveBeenCalled();
    handle.dispose();
  });

  it('halts the rAF chain when the page becomes hidden', () => {
    const fakeCtx = makeFakeCanvas2D();
    const canvas = makeCanvasWithContext('2d', fakeCtx);
    stubMatchMedia(false);

    // jsdom's document.hidden is a getter; replace it so we can flip it.
    let hidden = false;
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      get: () => hidden,
    });

    vi.useFakeTimers();
    const rafSpy = vi.spyOn(window, 'requestAnimationFrame');
    const handle = createConstellationStarfield(canvas);
    expect(handle.mode).toBe('canvas2d');

    // Let the loop run for a few frames so we have a stable baseline.
    vi.advanceTimersByTime(16);
    vi.advanceTimersByTime(16);
    vi.advanceTimersByTime(16);
    const baseline = rafSpy.mock.calls.length;
    expect(baseline).toBeGreaterThan(0);

    // Flip the visibility and dispatch the event.
    hidden = true;
    document.dispatchEvent(new Event('visibilitychange'));
    // Advance timers; no new rAF callbacks should be queued.
    vi.advanceTimersByTime(64);
    vi.advanceTimersByTime(64);
    expect(rafSpy.mock.calls.length).toBe(baseline);

    // Restoring visibility resumes the loop (still under fake timers).
    hidden = false;
    document.dispatchEvent(new Event('visibilitychange'));
    vi.advanceTimersByTime(16);
    expect(rafSpy.mock.calls.length).toBeGreaterThan(baseline);

    handle.dispose();
  });
});
