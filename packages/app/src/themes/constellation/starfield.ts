// Constellation 群星 — zero-dependency starfield renderer.
//
// 调用方必须把 handle 当作不透明运行时对象，不得放入深层响应式容器：
// Vue 的 `ref` / Pinia state 会深度代理，触发 reactive warning 并破坏组件身份。
// 持有方式参考 `shallowRef` 或非响应式闭包变量（见 BUG-139）。
//
// 设计要点：
// - 舱体底色近白乳白（oklch ~0.925），加色/滤色叠加会让星点不可见，
//   故统一走普通 SRC_ALPHA 混合，星点为比底色更深的「背光指示灯」色。
// - 渲染走 WebGL2 → Canvas2D → static 三档降级；'static' 不启动任何循环。
// - 固定种子 mulberry32 保证每次加载布局一致，截图可复现。

export type ConstellationStarfieldMode = 'webgl' | 'canvas2d' | 'static';

export interface ConstellationStarfieldHandle {
  readonly mode: ConstellationStarfieldMode;
  /** Idempotent — calling more than once must not throw. */
  dispose(): void;
}

/* ── 视觉常量 ──────────────────────────────────────────────────────────── */

/** 冰蓝：rgb(124,150,205) ↔ oklch(0.72 0.09 251.5)；tokens --link 同源。 */
const STAR_ICE_BLUE: readonly [number, number, number] = [124 / 255, 150 / 255, 205 / 255];

/** 钢蓝灰：rgb(143,152,172) ↔ oklch(0.62 0.05 250)；与舱体冷调发丝刻线同温区。 */
const STAR_STEEL: readonly [number, number, number] = [143 / 255, 152 / 255, 172 / 255];

/** 国际橙：rgb(238,96,40) ↔ oklch(0.623 0.188 46.5)；与 tokens --accent 同源。 */
const STAR_INTL_ORANGE: readonly [number, number, number] = [238 / 255, 96 / 255, 40 / 255];

/** Star count; fixed for screenshot reproducibility. */
const STAR_COUNT = 650;
/** Single-star peak alpha — must stay ≤ 0.9 so a deeper hue can still read on the near-white hull. */
const STAR_PEAK_ALPHA = 0.9;
/** DPR cap — keeps pixel cost bounded on retina panels. */
const MAX_DPR = 1.5;
/** Full rotation period in seconds — deliberately glacial. */
const ROTATION_PERIOD_SEC = 240;
/** Star depth z ∈ [Z_MIN, Z_MAX]; values closer to 1 are nearer to the camera. */
const Z_MIN = 0.15;
const Z_MAX = 1;
/** Pointer parallax target offset (±0.03 in normalized canvas coords). */
const PARALLAX_TARGET = 0.03;
/** Per-frame lerp factor for parallax smoothing. */
const PARALLAX_LERP = 0.04;
/** Forward travel speed in z-units per second; wraps mod (Z_MAX − Z_MIN). */
const Z_TRAVEL_PER_SEC = 1 / 60;

/* ── 工具 ──────────────────────────────────────────────────────────────── */

/**
 * mulberry32 — tiny seeded PRNG. Returns a deterministic [0,1) sampler.
 * Used so star positions are byte-stable across reloads (screenshot parity).
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface StarData {
  x: number;
  y: number;
  z: number;
  size: number;
  r: number;
  g: number;
  b: number;
  phase: number;
}

function buildStars(): StarData[] {
  const rng = mulberry32(0xc057e111);
  const stars: StarData[] = [];
  for (let i = 0; i < STAR_COUNT; i++) {
    const x = (rng() * 2 - 1) * 1.15;
    const y = (rng() * 2 - 1) * 1.15;
    const z = Z_MIN + rng() * (Z_MAX - Z_MIN);
    // Size grows modestly toward the camera (z → 1).
    let size = 2 + ((z - Z_MIN) * (5 - 2)) / (Z_MAX - Z_MIN);
    // 约 8% 的大柔光斑：小星点经面板磨砂后会低于可见阈值，
    // 大光斑透过去才读得出「光从磨砂材料里渗出来」。
    if (i % 12 === 7) size = 10 + rng() * 8;
    const pick = rng();
    // 60% ice blue / 25% steel / 15% international orange.
    const rgb = pick < 0.6 ? STAR_ICE_BLUE : pick < 0.85 ? STAR_STEEL : STAR_INTL_ORANGE;
    stars.push({
      x,
      y,
      z,
      size,
      r: rgb[0],
      g: rgb[1],
      b: rgb[2],
      phase: rng() * Math.PI * 2,
    });
  }
  return stars;
}

/* ── 通用状态 ──────────────────────────────────────────────────────────── */

interface CommonState {
  stars: StarData[];
  width: number;
  height: number;
  dpr: number;
  parallaxX: number;
  parallaxY: number;
  targetX: number;
  targetY: number;
  rafId: number;
  visible: boolean;
  reducedMotion: boolean;
  resizeObserver: ResizeObserver | null;
  onVisibility: (() => void) | null;
  onPointerMove: ((event: PointerEvent) => void) | null;
  onMotionChange: ((event: MediaQueryListEvent) => void) | null;
  motionQuery: MediaQueryList | null;
  running: boolean;
  disposed: boolean;
}

function createCommonState(): CommonState {
  return {
    stars: buildStars(),
    width: 0,
    height: 0,
    dpr: 1,
    parallaxX: 0,
    parallaxY: 0,
    targetX: 0,
    targetY: 0,
    rafId: 0,
    visible: typeof document !== 'undefined' ? !document.hidden : true,
    reducedMotion: false,
    resizeObserver: null,
    onVisibility: null,
    onPointerMove: null,
    onMotionChange: null,
    motionQuery: null,
    running: false,
    disposed: false,
  };
}

/* ── WebGL2 路径 ───────────────────────────────────────────────────────── */

const VERT_SRC = /* glsl */ `#version 300 es
precision highp float;
in vec3 aPos;
in float aSize;
in vec4 aColor;
in float aPhase;
uniform float uTime;
uniform vec2 uParallax;
uniform float uDpr;
out vec4 vColor;
out float vTwinkle;

void main() {
  // 1. Wrap z so a star traveling toward the camera re-emerges at the far plane.
  float zRange = ${Z_MAX.toFixed(4)} - ${Z_MIN.toFixed(4)};
  float z = aPos.z - uTime * ${Z_TRAVEL_PER_SEC.toFixed(6)};
  z = mod(z - ${Z_MIN.toFixed(4)}, zRange) + ${Z_MIN.toFixed(4)};

  // 2. Slow global rotation around the centre.
  float angle = uTime * (6.2831853 / ${ROTATION_PERIOD_SEC.toFixed(1)});
  float c = cos(angle);
  float s = sin(angle);
  float rx = aPos.x * c - aPos.y * s;
  float ry = aPos.x * s + aPos.y * c;

  // 3. Perspective: divide by z so near stars bulge, far stars shrink.
  float inv = 1.0 / z;
  vec2 ndc = vec2(rx, ry) * inv + uParallax;

  // 4. Twinkle: 0.75 → 1.0 brightness modulation.
  float twinkle = 0.75 + 0.25 * sin(uTime * 0.6 + aPhase);
  vTwinkle = twinkle;
  vColor = vec4(aColor.rgb * twinkle, aColor.a);

  gl_Position = vec4(ndc, 0.0, 1.0);
  // Depth-attenuated point size; point sprite is centred at gl_PointCoord (0.5, 0.5).
  gl_PointSize = aSize * uDpr * (0.6 + 0.6 * inv);
  // Guard against zero-size points on degenerate geometry.
  gl_PointSize = max(gl_PointSize, 1.0);
}
`;

const FRAG_SRC = /* glsl */ `#version 300 es
precision highp float;
in vec4 vColor;
in float vTwinkle;
out vec4 fragColor;

void main() {
  // Radial falloff: solid at centre, transparent at rim, soft edge via smoothstep.
  vec2 d = gl_PointCoord - vec2(0.5);
  float r2 = dot(d, d);
  if (r2 > 0.25) discard;
  float alpha = 1.0 - smoothstep(0.05, 0.25, r2);
  fragColor = vec4(vColor.rgb, vColor.a * alpha);
}
`;

function compileShader(
  gl: WebGL2RenderingContext,
  type: number,
  source: string,
): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

function linkProgram(
  gl: WebGL2RenderingContext,
  vs: WebGLShader,
  fs: WebGLShader,
): WebGLProgram | null {
  const program = gl.createProgram();
  if (!program) return null;
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    gl.deleteProgram(program);
    return null;
  }
  return program;
}

interface WebGLState extends CommonState {
  gl: WebGL2RenderingContext;
  program: WebGLProgram;
  buffer: WebGLBuffer;
  vao: WebGLVertexArrayObject;
  aPos: number;
  aSize: number;
  aColor: number;
  aPhase: number;
  uTime: WebGLUniformLocation | null;
  uParallax: WebGLUniformLocation | null;
  uDpr: WebGLUniformLocation | null;
  loseExt: WEBGL_lose_context | null;
}

function initWebGL(canvas: HTMLCanvasElement, base: CommonState): WebGLState | null {
  const gl = canvas.getContext('webgl2', {
    alpha: true,
    premultipliedAlpha: true,
    antialias: false,
    preserveDrawingBuffer: false,
  });
  if (!gl) return null;

  const vs = compileShader(gl, gl.VERTEX_SHADER, VERT_SRC);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, FRAG_SRC);
  if (!vs || !fs) return null;
  const program = linkProgram(gl, vs, fs);
  if (!program) return null;

  const aPos = gl.getAttribLocation(program, 'aPos');
  const aSize = gl.getAttribLocation(program, 'aSize');
  const aColor = gl.getAttribLocation(program, 'aColor');
  const aPhase = gl.getAttribLocation(program, 'aPhase');

  const buffer = gl.createBuffer();
  const vao = gl.createVertexArray();
  if (!buffer || !vao) return null;

  const loseExt = gl.getExtension('WEBGL_lose_context');

  const state: WebGLState = {
    ...base,
    gl,
    program,
    buffer,
    vao,
    aPos,
    aSize,
    aColor,
    aPhase,
    uTime: gl.getUniformLocation(program, 'uTime'),
    uParallax: gl.getUniformLocation(program, 'uParallax'),
    uDpr: gl.getUniformLocation(program, 'uDpr'),
    loseExt,
  };
  uploadBuffers(state);
  configureGL(state);
  return state;
}

function uploadBuffers(state: WebGLState): void {
  const { gl, buffer, vao, stars, aPos, aSize, aColor, aPhase } = state;
  // Interleave: position(3f), size(1f), color(4f), phase(1f) → 9 floats per star.
  const stride = 9;
  const data = new Float32Array(stars.length * stride);
  for (let i = 0; i < stars.length; i++) {
    const s = stars[i]!;
    const o = i * stride;
    data[o + 0] = s.x;
    data[o + 1] = s.y;
    data[o + 2] = s.z;
    data[o + 3] = s.size;
    data[o + 4] = s.r * STAR_PEAK_ALPHA;
    data[o + 5] = s.g * STAR_PEAK_ALPHA;
    data[o + 6] = s.b * STAR_PEAK_ALPHA;
    data[o + 7] = STAR_PEAK_ALPHA;
    data[o + 8] = s.phase;
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
  gl.bindVertexArray(vao);
  const FLOAT_SIZE = 4;
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, stride * FLOAT_SIZE, 0);
  gl.enableVertexAttribArray(aSize);
  gl.vertexAttribPointer(aSize, 1, gl.FLOAT, false, stride * FLOAT_SIZE, 3 * FLOAT_SIZE);
  gl.enableVertexAttribArray(aColor);
  gl.vertexAttribPointer(aColor, 4, gl.FLOAT, false, stride * FLOAT_SIZE, 4 * FLOAT_SIZE);
  gl.enableVertexAttribArray(aPhase);
  gl.vertexAttribPointer(aPhase, 1, gl.FLOAT, false, stride * FLOAT_SIZE, 8 * FLOAT_SIZE);
  gl.bindVertexArray(null);
}

function configureGL(state: WebGLState): void {
  const { gl } = state;
  gl.clearColor(0, 0, 0, 0);
  gl.enable(gl.BLEND);
  // Standard alpha-over blending; additive/filtering would be invisible on the near-white hull.
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.disable(gl.DEPTH_TEST);
}

function drawWebGL(state: WebGLState, time: number): void {
  const { gl, program, vao, uTime, uParallax, uDpr, width, height, dpr, parallaxX, parallaxY } =
    state;
  if (width === 0 || height === 0) return;
  gl.viewport(0, 0, width, height);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.useProgram(program);
  gl.bindVertexArray(vao);
  if (uTime) gl.uniform1f(uTime, time);
  if (uParallax) gl.uniform2f(uParallax, parallaxX, parallaxY);
  if (uDpr) gl.uniform1f(uDpr, dpr);
  gl.drawArrays(gl.POINTS, 0, state.stars.length);
  gl.bindVertexArray(null);
}

function disposeWebGL(state: WebGLState): void {
  const { gl, program, buffer, vao, loseExt } = state;
  gl.deleteProgram(program);
  gl.deleteBuffer(buffer);
  gl.deleteVertexArray(vao);
  loseExt?.loseContext();
}

/* ── Canvas2D 降级 ─────────────────────────────────────────────────────── */

interface Canvas2DState extends CommonState {
  ctx: CanvasRenderingContext2D;
  sprites: HTMLCanvasElement[];
}

function makeRadialSprite(rgb: readonly [number, number, number]): HTMLCanvasElement {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const c = canvas.getContext('2d');
  if (!c) return canvas;
  // Transparent black → coloured core → transparent black at the rim.
  // Alpha rises gently to keep edges soft on the hull.
  const grad = c.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  const r = (rgb[0] * 255) | 0;
  const g = (rgb[1] * 255) | 0;
  const b = (rgb[2] * 255) | 0;
  grad.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${STAR_PEAK_ALPHA})`);
  grad.addColorStop(0.45, `rgba(${r}, ${g}, ${b}, ${STAR_PEAK_ALPHA * 0.45})`);
  grad.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
  c.fillStyle = grad;
  c.fillRect(0, 0, size, size);
  return canvas;
}

function initCanvas2D(canvas: HTMLCanvasElement, base: CommonState): Canvas2DState | null {
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  // Build one sprite per colour family — drawImage performs the blending so
  // we never set globalCompositeOperation = 'lighter' (would be invisible on hull).
  const sprites: HTMLCanvasElement[] = [
    makeRadialSprite(STAR_ICE_BLUE),
    makeRadialSprite(STAR_STEEL),
    makeRadialSprite(STAR_INTL_ORANGE),
  ];
  return { ...base, ctx, sprites };
}

function colorIndex(star: StarData): number {
  if (star.r === STAR_ICE_BLUE[0]) return 0;
  if (star.r === STAR_STEEL[0]) return 1;
  return 2;
}

function drawCanvas2D(state: Canvas2DState, time: number): void {
  const { ctx, stars, sprites, width, height, parallaxX, parallaxY, dpr } = state;
  if (width === 0 || height === 0) return;
  // Clear to fully transparent so the deck paper colour shows through.
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  const angle = (time * Math.PI * 2) / ROTATION_PERIOD_SEC;
  const zRange = Z_MAX - Z_MIN;
  const halfW = width / (2 * dpr);
  const halfH = height / (2 * dpr);
  for (let i = 0; i < stars.length; i++) {
    const s = stars[i]!;
    const zRaw = s.z - Z_MIN - time * Z_TRAVEL_PER_SEC;
    const z = (((zRaw % zRange) + zRange) % zRange) + Z_MIN;
    const inv = 1 / z;
    const cx = s.x * Math.cos(angle) - s.y * Math.sin(angle);
    const cy = s.x * Math.sin(angle) + s.y * Math.cos(angle);
    const ndcX = cx * inv + parallaxX;
    const ndcY = cy * inv + parallaxY;
    const px = halfW + ndcX * halfW;
    const py = halfH - ndcY * halfH;
    // Twinkle multiplier (mirrors the shader branch).
    const twinkle = 0.75 + 0.25 * Math.sin(time * 0.6 + s.phase);
    ctx.globalAlpha = twinkle;
    const sprite = sprites[colorIndex(s)]!;
    // 与 WebGL 路径同径：gl_PointSize 是直径，2D 绘制盒同宽。
    const drawSize = Math.max(1, s.size * (0.6 + 0.6 * inv));
    ctx.drawImage(sprite, px - drawSize / 2, py - drawSize / 2, drawSize, drawSize);
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}

/* ── 生命周期：rAF / resize / visibility / motion / pointer ─────────────── */

function readDpr(): number {
  if (typeof window === 'undefined') return 1;
  return Math.min(window.devicePixelRatio || 1, MAX_DPR);
}

function measureCanvas(canvas: HTMLCanvasElement, state: CommonState): void {
  const rect = canvas.getBoundingClientRect();
  const dpr = readDpr();
  const w = Math.max(0, Math.round(rect.width * dpr));
  const h = Math.max(0, Math.round(rect.height * dpr));
  state.dpr = dpr;
  if (w !== state.width || h !== state.height) {
    state.width = w;
    state.height = h;
    canvas.width = w;
    canvas.height = h;
  }
}

function applyMotionTargets(state: CommonState): void {
  state.parallaxX += (state.targetX - state.parallaxX) * PARALLAX_LERP;
  state.parallaxY += (state.targetY - state.parallaxY) * PARALLAX_LERP;
}

type DrawFn = (time: number) => void;

function bindCommon(
  canvas: HTMLCanvasElement,
  state: CommonState,
  draw: DrawFn,
  onResize: () => void,
): void {
  measureCanvas(canvas, state);

  // ResizeObserver — re-measure on layout-driven size changes.
  if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(() => {
      measureCanvas(canvas, state);
      onResize();
      // Repaint immediately so the buffer doesn't show stretched old content.
      draw(performance.now() / 1000);
    });
    ro.observe(canvas);
    state.resizeObserver = ro;
  }

  // visibilitychange — pause while the tab is hidden.
  if (typeof document !== 'undefined') {
    const onVisibility = (): void => {
      state.visible = !document.hidden;
      if (state.visible && !state.running && !state.reducedMotion) {
        startLoop(state, draw);
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    state.onVisibility = onVisibility;
  }

  // Pointer parallax 监听由 bindMotionQuery 按 reduced-motion 状态条件挂载：
  // contract 强制「reduced-motion / static 模式下不挂此监听」，bindCommon 只
  // 承担尺寸 + visibility 两个生命周期护栏，避免在静态模式中误触发 DOM 监听。
}

function startLoop(state: CommonState, draw: DrawFn): void {
  if (state.running || state.disposed || state.reducedMotion) return;
  state.running = true;
  const tick = (nowMs: number): void => {
    if (state.disposed || !state.visible || state.reducedMotion) {
      state.running = false;
      state.rafId = 0;
      return;
    }
    const time = nowMs / 1000;
    applyMotionTargets(state);
    draw(time);
    state.rafId = requestAnimationFrame(tick);
  };
  state.rafId = requestAnimationFrame(tick);
}

function bindMotionQuery(state: CommonState, draw: DrawFn, onReducedFrame: () => void): void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    // 无 matchMedia 的老环境：按非 reduced 处理，正常启动循环与指针监听。
    state.reducedMotion = false;
    attachPointer();
    if (state.visible && !state.running) startLoop(state, draw);
    return;
  }
  const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
  state.motionQuery = mq;

  function attachPointer(): void {
    // 仅当未挂且非 reduced-motion 时挂 pointermove 监听。
    if (state.onPointerMove || typeof window === 'undefined') return;
    const handler = (event: PointerEvent): void => {
      const w = window.innerWidth || 1;
      const h = window.innerHeight || 1;
      // Normalise to [-1, 1] then scale to ±PARALLAX_TARGET.
      const nx = (event.clientX / w) * 2 - 1;
      const ny = (event.clientY / h) * 2 - 1;
      state.targetX = nx * PARALLAX_TARGET;
      state.targetY = -ny * PARALLAX_TARGET;
    };
    window.addEventListener('pointermove', handler);
    state.onPointerMove = handler;
  }

  function detachPointer(): void {
    if (state.onPointerMove && typeof window !== 'undefined') {
      window.removeEventListener('pointermove', state.onPointerMove);
    }
    state.onPointerMove = null;
  }

  const update = (): void => {
    const reduced = mq.matches;
    state.reducedMotion = reduced;
    if (reduced) {
      // reduced-motion：从挂监听 → 仅同步绘制一帧静态星图，永不进 rAF。
      if (state.rafId) cancelAnimationFrame(state.rafId);
      state.rafId = 0;
      state.running = false;
      detachPointer();
      onReducedFrame();
    } else {
      attachPointer();
      if (state.visible && !state.running) {
        startLoop(state, draw);
      }
    }
  };
  const onChange = (): void => update();
  if (typeof mq.addEventListener === 'function') {
    mq.addEventListener('change', onChange);
  } else {
    const legacy = mq as MediaQueryList & {
      addListener?: (cb: () => void) => void;
    };
    legacy.addListener?.(onChange);
  }
  state.onMotionChange = onChange;
  update();
}

function detachCommon(state: CommonState): void {
  if (state.resizeObserver) {
    state.resizeObserver.disconnect();
    state.resizeObserver = null;
  }
  if (state.rafId) {
    cancelAnimationFrame(state.rafId);
    state.rafId = 0;
  }
  state.running = false;
  if (state.onVisibility) {
    document.removeEventListener('visibilitychange', state.onVisibility);
    state.onVisibility = null;
  }
  if (state.onPointerMove && typeof window !== 'undefined') {
    window.removeEventListener('pointermove', state.onPointerMove);
    state.onPointerMove = null;
  }
  if (state.motionQuery && state.onMotionChange) {
    if (typeof state.motionQuery.removeEventListener === 'function') {
      state.motionQuery.removeEventListener('change', state.onMotionChange);
    } else {
      const legacy = state.motionQuery as MediaQueryList & {
        removeListener?: (cb: () => void) => void;
      };
      legacy.removeListener?.(state.onMotionChange);
    }
  }
  state.motionQuery = null;
  state.onMotionChange = null;
}

/* ── 入口 ─────────────────────────────────────────────────────────────── */

export function createConstellationStarfield(
  canvas: HTMLCanvasElement,
): ConstellationStarfieldHandle {
  if (typeof canvas.getContext !== 'function') {
    return staticHandle(canvas);
  }

  const base = createCommonState();

  // Try WebGL2 first.
  const webglState = initWebGL(canvas, base);
  if (webglState) {
    return activeHandle(canvas, webglState, 'webgl', drawWebGL, disposeWebGL);
  }

  // Fall back to Canvas2D.
  const c2dState = initCanvas2D(canvas, base);
  if (c2dState) {
    return activeHandle(canvas, c2dState, 'canvas2d', drawCanvas2D);
  }

  // No usable context — bind inert listeners so callers see no errors and the
  // contract holds: no rAF, no canvas mutation, idempotent dispose.
  return staticHandle(canvas);
}

function staticHandle(_canvas: HTMLCanvasElement): ConstellationStarfieldHandle {
  // 静态模式：WebGL2 + Canvas2D 都不可用。按契约「不启动循环、不抛错、不动 canvas」，
  // 此处既不挂监听也不开 rAF；dispose 仅翻位、幂等，无需 detach。
  let disposed = false;
  return {
    mode: 'static',
    dispose(): void {
      if (disposed) return;
      disposed = true;
    },
  };
}

function activeHandle<S extends CommonState>(
  canvas: HTMLCanvasElement,
  state: S,
  mode: ConstellationStarfieldMode,
  draw: (s: S, time: number) => void,
  teardown?: (s: S) => void,
): ConstellationStarfieldHandle {
  const drawBound = (time: number): void => draw(state, time);
  const onResize = (): void => {
    // drawWebGL/drawCanvas2D read width/height each frame; nothing extra to do.
  };
  bindCommon(canvas, state, drawBound, onResize);
  bindMotionQuery(state, drawBound, () => {
    draw(state, 0);
  });
  let disposed = false;
  return {
    mode,
    dispose(): void {
      if (disposed) return;
      disposed = true;
      state.disposed = true;
      detachCommon(state);
      // Mode-specific GPU resource release.
      if (teardown) {
        try {
          teardown(state);
        } catch {
          /* context may already be lost; swallow on dispose path */
        }
      }
    },
  };
}
