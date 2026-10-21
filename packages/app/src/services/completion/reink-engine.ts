import { invoke } from '@tauri-apps/api/core';
import {
  PUBLIC_ENGINE_MAX_OUTPUT_CODE_POINTS,
  PUBLIC_ENGINE_PROTOCOL_VERSION,
  createEmptyPublicEngineAssetDiagnostics,
  type CompletionPublicEngine,
  type PublicEngineDiagnostics,
  type PublicEngineGenerateRequest,
  type PublicEngineGenerateResponse,
  type PublicEngineRawCandidate,
  type PublicEngineVisibilityCalibrationInput,
} from './public-engine-types';
import type { ReinkMode, ReinkTier } from './reink-settings';

/**
 * Reink-1.0 local neural engine（本机接入，暂不进安装器）。
 *
 * 引擎确定性：同 prefix/lang/n/tier/mode 必同结果（运行包内部定种子），
 * 因此可用 LRU 缓存直接复用结果。候选上限 8 条、降序来自运行包契约。
 *
 * 与 router 的 V2.5 契约：id 带 'public-v2.5-' 前缀，必须实现
 * calibrateVisibility / visibilityThreshold。Reink 未做校准——calibrate
 * 原样返回夹紧后的 modelScore，阈值取保守低地板（见
 * REINK_UNCALIBRATED_VISIBILITY_THRESHOLD 注释），真正的显示质量门
 * 仍由宿主 v25-route-validator 把关。
 */
export const REINK_ENGINE_ID = 'public-v2.5-reink-1.0';
export const REINK_MAX_CANDIDATES = 8;
/**
 * 宿主侧单请求等待上限。刻意大于 router 的幽灵文本预算（110-200ms）：
 * 超预算的调用方早已被 router 放弃，但引擎确定性意味着迟到的结果仍可
 * 入缓存，供下一次相同 prefix 即时命中；故不在引擎侧掐断推理。
 */
export const REINK_DEFAULT_HOST_DEADLINE_MS = 2_500;
const REINK_CACHE_CAPACITY = 64;
/**
 * Reink 未做可见性校准：地板只挡真零分（1e-6）。实测 Reink 分数量级很小
 * （32m 快速档中文 top 候选约 0.004–0.02，为未归一化的似然值），任何接近
 * 0.05 的地板都会把全部合法候选静默过滤掉；显示质量裁决交给宿主路由验证器。
 */
export const REINK_UNCALIBRATED_VISIBILITY_THRESHOLD = 1e-6;
const HAN_TEST = /[\u4e00-\u9fff]/u;

export interface ReinkHostStatus {
  spawned: boolean;
  ready: boolean;
  lastError: string | null;
  warmupMs: number;
  lastLatencyMs: number;
  tier: string;
  fast: boolean;
}

export interface ReinkCandidate {
  text: string;
  kind: string;
  score: number;
}

export interface ReinkGeneratePayload {
  prefix: string;
  lang: 'zh' | 'en';
  n: number;
  tier: ReinkTier;
  deadlineMs: number;
}

/** reink_configure 请求体：与 Rust reink_engine::ReinkConfigureRequest 对齐。 */
export interface ReinkConfigureRequest {
  pythonPath: string;
  runtimeDir: string;
  tier: ReinkTier;
  fast: boolean;
}

/**
 * 模块级配置命令：configure 发生在 new ReinkEngine 之前，不属引擎实例
 * 生命周期，故不挂在 adapter（adapter 四方法只管实例运行期）。
 */
export function configureReinkRuntime(request: ReinkConfigureRequest): Promise<void> {
  return invoke<void>('reink_configure', { request });
}

/** Tauri adapter seam（默认走 invoke，测试可注入 mock）。 */
export interface ReinkEngineAdapter {
  warmup(): Promise<boolean>;
  generate(request: ReinkGeneratePayload): Promise<ReinkCandidate[]>;
  status(): Promise<ReinkHostStatus>;
  dispose(): Promise<void>;
}

export interface ReinkEngineOptions {
  tier: ReinkTier;
  mode: ReinkMode;
  adapter?: ReinkEngineAdapter;
  hostDeadlineMs?: number;
}

interface ReinkFlight {
  key: string;
  prefix: string;
  lang: 'zh' | 'en';
  n: number;
  deadlineAt: number;
  waiters: Array<(candidates: readonly ReinkCandidate[]) => void>;
  released: boolean;
}

export class ReinkEngine implements CompletionPublicEngine {
  readonly id = REINK_ENGINE_ID;
  readonly protocolVersion = PUBLIC_ENGINE_PROTOCOL_VERSION;
  readonly sourceKind = 'neural' as const;
  /** zh 宿主验证器限 16 码点、en 限 24——取 24 覆盖两路由。 */
  readonly maxOutputCodePoints = Math.min(24, PUBLIC_ENGINE_MAX_OUTPUT_CODE_POINTS);

  private readonly adapter: ReinkEngineAdapter;
  private readonly tier: ReinkTier;
  private readonly mode: ReinkMode;
  private readonly hostDeadlineMs: number;
  private readonly cache = new Map<string, readonly ReinkCandidate[]>();
  private readonly diagnosticsState: PublicEngineDiagnostics;
  private readonly inferenceSamples: number[] = [];
  private warmupState: 'idle' | 'checked' | 'warmed' | 'failed' = 'idle';
  private warmupPromise: Promise<boolean> | null = null;
  private hostStatus: ReinkHostStatus | null = null;
  private activeFlight: ReinkFlight | null = null;
  private queuedFlight: ReinkFlight | null = null;
  private responseSequence = 0;
  private disposed = false;

  constructor(options: ReinkEngineOptions) {
    this.tier = options.tier;
    this.mode = options.mode;
    this.hostDeadlineMs = options.hostDeadlineMs ?? REINK_DEFAULT_HOST_DEADLINE_MS;
    this.adapter = options.adapter ?? createTauriReinkAdapter();
    this.diagnosticsState = {
      engineId: this.id,
      backendKind: 'tauri-reink-python-bridge',
      status: 'idle',
      epoch: 1,
      profile: `${this.tier}/${this.mode}`,
      lastError: null,
      warmupDurationMs: 0,
      lastInferenceDurationMs: 0,
      visibleInferenceP90Ms: 0,
      generateRequests: 0,
      generatedCandidates: 0,
      cancellations: 0,
      deadlineExpirations: 0,
      lateResponses: 0,
      invalidResponses: 0,
      workerErrors: 0,
      staleResponses: 0,
      lastRequestProbe: null,
      assets: createEmptyPublicEngineAssetDiagnostics(),
    };
  }

  /**
   * Router 安装期 warmup：轻量探测（reink_status），不加载模型——真实
   * spawn + warm 帧由 setup composable 在空闲时调 ensureWarmed 完成。
   */
  warmup(signal?: AbortSignal): Promise<boolean> {
    if (this.disposed) return Promise.resolve(false);
    if (this.warmupState === 'warmed') return Promise.resolve(true);
    return this.probeWarmup(signal);
  }

  /** 真实 warmup：spawn（若未起）+ warmup 帧测通；空闲后台调用。 */
  ensureWarmed(signal?: AbortSignal): Promise<boolean> {
    if (this.disposed) return Promise.resolve(false);
    if (this.warmupState === 'warmed') return Promise.resolve(true);
    this.warmupPromise ??= this.performRealWarmup(signal);
    return this.warmupPromise;
  }

  async generate(
    request: PublicEngineGenerateRequest,
    signal?: AbortSignal,
  ): Promise<PublicEngineGenerateResponse> {
    if (this.disposed) return this.emptyResponse(request);
    const prefix = request.extendedContextTail ?? request.contextTail;
    const lang = request.languageHint === 'en' ? ('en' as const) : ('zh' as const);
    const n = Math.min(Math.max(1, Math.trunc(request.maxCandidates) || 1), REINK_MAX_CANDIDATES);
    this.diagnosticsState.generateRequests += 1;

    const key = this.cacheKey(prefix, lang, n);
    const cached = this.readCache(key);
    if (cached) return this.buildResponse(request, cached);
    if (signal?.aborted) {
      this.diagnosticsState.cancellations += 1;
      return this.emptyResponse(request);
    }

    const candidates = await this.joinFlight(key, request, prefix, lang, n, signal);
    return this.buildResponse(request, candidates);
  }

  diagnostics(): PublicEngineDiagnostics {
    this.diagnosticsState.status = this.resolveStatus();
    this.diagnosticsState.warmupDurationMs = this.hostStatus?.warmupMs ?? 0;
    this.diagnosticsState.lastInferenceDurationMs =
      this.hostStatus?.lastLatencyMs || this.diagnosticsState.lastInferenceDurationMs;
    return { ...this.diagnosticsState, assets: { ...this.diagnosticsState.assets } };
  }

  /** Reink 未做校准：确定性直通（夹紧），显示裁决交给宿主路由验证器。 */
  calibrateVisibility(input: PublicEngineVisibilityCalibrationInput): number {
    if (!Number.isFinite(input.modelScore)) return 0;
    return Math.min(1, Math.max(0, input.modelScore));
  }

  visibilityThreshold(_input: PublicEngineVisibilityCalibrationInput): number {
    return REINK_UNCALIBRATED_VISIBILITY_THRESHOLD;
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.diagnosticsState.status = 'disposed';
    this.diagnosticsState.epoch += 1;
    this.releaseFlight(this.activeFlight, []);
    this.releaseFlight(this.queuedFlight, []);
    this.activeFlight = null;
    this.queuedFlight = null;
    this.cache.clear();
    await this.adapter.dispose().catch(() => {
      // dispose 失败不得影响其余补全层
    });
  }

  // ── 内部 ────────────────────────────────────────────────────────────

  private async probeWarmup(signal?: AbortSignal): Promise<boolean> {
    try {
      const status = await this.adapter.status();
      if (signal?.aborted) return false;
      this.hostStatus = status;
      this.warmupState = 'checked';
      this.diagnosticsState.status = 'warming';
      return true;
    } catch (error) {
      this.warmupState = 'failed';
      this.diagnosticsState.status = 'disabled';
      this.diagnosticsState.lastError = errorMessage(error);
      this.diagnosticsState.workerErrors += 1;
      return false;
    }
  }

  private async performRealWarmup(signal?: AbortSignal): Promise<boolean> {
    const startedAt = performance.now();
    this.diagnosticsState.status = 'warming';
    try {
      const ok = await this.adapter.warmup();
      if (!ok || signal?.aborted) throw new Error('reink warmup returned false');
      this.warmupState = 'warmed';
      this.diagnosticsState.status = 'ready';
      this.diagnosticsState.lastError = null;
      this.refreshHostStatus();
      return true;
    } catch (error) {
      this.warmupState = 'failed';
      this.diagnosticsState.status = 'degraded';
      this.diagnosticsState.lastError = errorMessage(error);
      this.diagnosticsState.workerErrors += 1;
      this.refreshHostStatus();
      return false;
    } finally {
      this.diagnosticsState.warmupDurationMs = Math.max(0, performance.now() - startedAt);
    }
  }

  private cacheKey(prefix: string, lang: 'zh' | 'en', n: number): string {
    // 引擎确定性：tier/mode/lang/n + prefix 完全决定输出（tier/mode 固化于实例）。
    return `${this.tier}\u0000${this.mode}\u0000${lang}\u0000${n}\u0000${prefix}`;
  }

  private readCache(key: string): readonly ReinkCandidate[] | null {
    const cached = this.cache.get(key) ?? null;
    if (!cached) return null;
    // LRU 触碰：删后重插，容量 64 淘汰最旧。
    this.cache.delete(key);
    this.cache.set(key, cached);
    return cached;
  }

  private writeCache(key: string, candidates: readonly ReinkCandidate[]): void {
    if (candidates.length === 0) return;
    this.cache.set(key, candidates);
    while (this.cache.size > REINK_CACHE_CAPACITY) {
      const oldest = this.cache.keys().next().value;
      if (oldest === undefined) break;
      this.cache.delete(oldest);
    }
  }

  /**
   * 单飞 + 最新优先（补全体感防排队堆积）：
   * - 无在飞请求 → 立即下发；
   * - 在飞且同 key → 合并等待同一结果；
   * - 在飞且不同 key → 作废在飞请求的等待者（旧 Promise resolve 空，推理
   *   照常完成并按确定性入缓存），本请求排队为唯一后继；
   * - AbortSignal 中止同理：该等待者立即拿空结果，推理结果仍入缓存。
   */
  private joinFlight(
    key: string,
    request: PublicEngineGenerateRequest,
    prefix: string,
    lang: 'zh' | 'en',
    n: number,
    signal?: AbortSignal,
  ): Promise<readonly ReinkCandidate[]> {
    if (this.activeFlight?.key === key) {
      return this.awaitFlight(this.activeFlight, signal);
    }
    if (this.activeFlight) {
      this.diagnosticsState.cancellations += 1;
      this.releaseFlight(this.activeFlight, []);
      if (this.queuedFlight) {
        this.diagnosticsState.staleResponses += 1;
        this.releaseFlight(this.queuedFlight, []);
      }
    }
    const flight: ReinkFlight = {
      key,
      prefix,
      lang,
      n,
      deadlineAt: request.deadlineAt,
      waiters: [],
      released: false,
    };
    if (this.activeFlight) {
      this.queuedFlight = flight;
    } else {
      this.activeFlight = flight;
      void this.executeFlight(flight);
    }
    return this.awaitFlight(flight, signal);
  }

  private awaitFlight(
    flight: ReinkFlight,
    signal?: AbortSignal,
  ): Promise<readonly ReinkCandidate[]> {
    return new Promise<readonly ReinkCandidate[]>((resolve) => {
      let settled = false;
      const finish = (candidates: readonly ReinkCandidate[]) => {
        if (settled) return;
        settled = true;
        resolve(candidates);
      };
      flight.waiters.push(finish);
      if (signal) {
        signal.addEventListener(
          'abort',
          () => {
            this.diagnosticsState.cancellations += 1;
            finish([]);
          },
          { once: true },
        );
      }
    });
  }

  private async executeFlight(flight: ReinkFlight): Promise<void> {
    const startedAt = performance.now();
    let candidates: readonly ReinkCandidate[] = [];
    try {
      const raw = await this.adapter.generate({
        prefix: flight.prefix,
        lang: flight.lang,
        n: flight.n,
        tier: this.tier,
        deadlineMs: this.hostDeadlineMs,
      });
      if (Array.isArray(raw)) {
        candidates = raw.filter(
          (candidate) =>
            typeof candidate?.text === 'string' &&
            candidate.text.length > 0 &&
            Number.isFinite(candidate.score),
        );
      } else {
        this.diagnosticsState.invalidResponses += 1;
      }
      // 迟到判定：调用方预算（router deadline）已过，但确定性结果照常入缓存。
      if (Date.now() > flight.deadlineAt) this.diagnosticsState.lateResponses += 1;
      this.writeCache(flight.key, candidates);
      this.refreshHostStatus();
    } catch (error) {
      this.diagnosticsState.workerErrors += 1;
      this.diagnosticsState.lastError = errorMessage(error);
      this.refreshHostStatus();
    } finally {
      this.recordInference(Math.max(0, performance.now() - startedAt));
      this.releaseFlight(flight, candidates);
      if (this.activeFlight === flight) {
        this.activeFlight = null;
        const queued = this.queuedFlight;
        this.queuedFlight = null;
        if (queued) {
          this.activeFlight = queued;
          void this.executeFlight(queued);
        }
      }
    }
  }

  private releaseFlight(flight: ReinkFlight | null, candidates: readonly ReinkCandidate[]): void {
    if (!flight || flight.released) return;
    flight.released = true;
    for (const waiter of flight.waiters.splice(0)) {
      waiter(candidates);
    }
  }

  private buildResponse(
    request: PublicEngineGenerateRequest,
    candidates: readonly ReinkCandidate[],
  ): PublicEngineGenerateResponse {
    const mapped: PublicEngineRawCandidate[] = [];
    for (const candidate of candidates) {
      if (codePointLength(candidate.text) > this.maxOutputCodePoints) continue;
      const score = Math.min(1, Math.max(0, candidate.score));
      mapped.push({
        candidateId: `reink-${++this.responseSequence}`,
        text: candidate.text,
        confidence: Math.min(0.99, Math.max(0.01, score)),
        modelScore: score,
        gateScore: score,
        language: HAN_TEST.test(candidate.text) ? 'zh' : 'en',
      });
      if (mapped.length >= REINK_MAX_CANDIDATES) break;
    }
    this.diagnosticsState.generatedCandidates += mapped.length;
    return {
      protocolVersion: this.protocolVersion,
      engineEpoch: request.engineEpoch,
      workspaceScope: request.workspaceScope,
      documentVersion: request.documentVersion,
      cursorPos: request.cursorPos,
      candidates: mapped,
    };
  }

  private emptyResponse(request: PublicEngineGenerateRequest): PublicEngineGenerateResponse {
    return {
      protocolVersion: this.protocolVersion,
      engineEpoch: request.engineEpoch,
      workspaceScope: request.workspaceScope,
      documentVersion: request.documentVersion,
      cursorPos: request.cursorPos,
      candidates: [],
    };
  }

  private resolveStatus(): PublicEngineDiagnostics['status'] {
    if (this.disposed) return 'disposed';
    if (this.hostStatus?.ready) return 'ready';
    if (this.warmupState === 'failed') return 'degraded';
    if (this.warmupState === 'checked' || this.warmupState === 'warmed') return 'warming';
    if (this.hostStatus?.lastError) return 'degraded';
    return 'idle';
  }

  private refreshHostStatus(): void {
    void this.adapter
      .status()
      .then((status) => {
        this.hostStatus = status;
      })
      .catch(() => {
        // 状态探测失败不影响补全主路径
      });
  }

  private recordInference(duration: number): void {
    this.diagnosticsState.lastInferenceDurationMs = duration;
    this.inferenceSamples.push(duration);
    if (this.inferenceSamples.length > 128) this.inferenceSamples.shift();
    const sorted = [...this.inferenceSamples].sort((left, right) => left - right);
    this.diagnosticsState.visibleInferenceP90Ms =
      sorted[Math.max(0, Math.ceil(sorted.length * 0.9) - 1)] ?? 0;
  }
}

function createTauriReinkAdapter(): ReinkEngineAdapter {
  return {
    warmup: () => invoke<boolean>('reink_warmup'),
    generate: (request) => invoke<ReinkCandidate[]>('reink_generate', { request }),
    status: () => invoke<ReinkHostStatus>('reink_status'),
    dispose: () => invoke<void>('reink_dispose'),
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function codePointLength(text: string): number {
  return Array.from(text).length;
}
