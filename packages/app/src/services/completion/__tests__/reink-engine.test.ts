import { beforeEach, describe, expect, it, vi } from 'vitest';

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
}));

import {
  REINK_DEFAULT_HOST_DEADLINE_MS,
  REINK_ENGINE_ID,
  ReinkEngine,
  type ReinkCandidate,
  type ReinkGeneratePayload,
} from '../reink-engine';
import type { PublicEngineGenerateRequest } from '../public-engine-types';
import {
  DEFAULT_REINK_SETTINGS,
  REINK_SETTINGS_KEY,
  getReinkSettings,
  saveReinkSettings,
  subscribeReinkSettings,
  updateReinkSettings,
  type ReinkSettings,
} from '../reink-settings';

function request(
  overrides: Partial<PublicEngineGenerateRequest> = {},
): PublicEngineGenerateRequest {
  return {
    engineEpoch: 7,
    workspaceScope: 'workspace-a',
    documentVersion: 'revision:3',
    cursorPos: 8,
    contextTail: '今天先完成',
    contextTailUtf8Bytes: new TextEncoder().encode('今天先完成').byteLength,
    languageHint: 'zh',
    blockType: 'paragraph',
    cursorBoundary: 'other',
    maxCandidates: 32,
    deadlineAt: Date.now() + 5_000,
    ...overrides,
  };
}

function hostStatusSnapshot() {
  return {
    spawned: true,
    ready: true,
    lastError: null,
    warmupMs: 12,
    lastLatencyMs: 34,
    tier: '32m',
    fast: true,
  };
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolveValue, rejectValue) => {
    resolve = resolveValue;
    reject = rejectValue;
  });
  return { promise, resolve, reject };
}

function installInvoke(
  generateResponder: (payload: ReinkGeneratePayload) => Promise<ReinkCandidate[]> = () =>
    Promise.resolve([]),
): { generateCalls: ReinkGeneratePayload[] } {
  const generateCalls: ReinkGeneratePayload[] = [];
  invokeMock.mockImplementation((command: string, payload?: unknown) => {
    switch (command) {
      case 'reink_status':
        return Promise.resolve(hostStatusSnapshot());
      case 'reink_warmup':
        return Promise.resolve(true);
      case 'reink_dispose':
        return Promise.resolve(undefined);
      case 'reink_generate': {
        const generatePayload = (payload as { request: ReinkGeneratePayload }).request;
        generateCalls.push(generatePayload);
        return generateResponder(generatePayload);
      }
      default:
        return Promise.reject(new Error(`unexpected invoke command: ${command}`));
    }
  });
  return { generateCalls };
}

describe('ReinkEngine', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    localStorage.clear();
  });

  it('maps candidates with clamped confidence, per-response ids and language detection', async () => {
    const { generateCalls } = installInvoke(async () => [
      { text: '运行时', kind: 'phrase', score: 1.5 },
      { text: 'hello world', kind: 'word', score: 0 },
      { text: 'x'.repeat(40), kind: 'word', score: 0.9 },
      { text: '', kind: 'word', score: 0.5 },
    ]);
    const engine = new ReinkEngine({ tier: '32m', mode: 'fast' });
    await expect(engine.warmup()).resolves.toBe(true);

    const response = await engine.generate(request({ extendedContextTail: '长上下文前缀' }));
    expect(response.protocolVersion).toBe(1);
    expect(response.engineEpoch).toBe(7);
    expect(response.workspaceScope).toBe('workspace-a');
    expect(response.documentVersion).toBe('revision:3');
    expect(response.cursorPos).toBe(8);
    // 超长与空文本被过滤，只剩两条合法候选。
    expect(response.candidates).toHaveLength(2);
    const [zh, en] = response.candidates;
    expect(zh).toMatchObject({
      text: '运行时',
      language: 'zh',
      confidence: 0.99,
      modelScore: 1,
      gateScore: 1,
    });
    expect(en).toMatchObject({
      text: 'hello world',
      language: 'en',
      confidence: 0.01,
      modelScore: 0,
      gateScore: 0,
    });
    expect(zh!.candidateId).not.toBe(en!.candidateId);
    expect(generateCalls).toHaveLength(1);
    expect(generateCalls[0]).toMatchObject({
      prefix: '长上下文前缀',
      lang: 'zh',
      n: 8,
      tier: '32m',
      deadlineMs: REINK_DEFAULT_HOST_DEADLINE_MS,
    });
    expect(engine.id).toBe(REINK_ENGINE_ID);
  });

  it('falls back to contextTail when extendedContextTail is absent', async () => {
    const { generateCalls } = installInvoke(async () => []);
    const engine = new ReinkEngine({ tier: '32m', mode: 'fast' });
    await engine.generate(request());
    expect(generateCalls[0]?.prefix).toBe('今天先完成');
  });

  it('serves repeated prefixes from the LRU cache without a second invoke', async () => {
    const { generateCalls } = installInvoke(async () => [
      { text: '缓存命中', kind: 'word', score: 0.4 },
    ]);
    const engine = new ReinkEngine({ tier: '32m', mode: 'fast' });
    const first = await engine.generate(request({ extendedContextTail: '同一前缀' }));
    const second = await engine.generate(
      request({ extendedContextTail: '同一前缀', engineEpoch: 9, cursorPos: 12 }),
    );
    expect(generateCalls).toHaveLength(1);
    expect(first.candidates).toHaveLength(1);
    expect(second.candidates).toHaveLength(1);
    // 缓存命中也按当次请求回填元数据。
    expect(second.engineEpoch).toBe(9);
    expect(second.cursorPos).toBe(12);
    expect(second.candidates[0]?.text).toBe('缓存命中');
  });

  it('supersedes an in-flight different prefix (old caller gets empty) and keeps the latest', async () => {
    const deferredA = createDeferred<ReinkCandidate[]>();
    const { generateCalls } = installInvoke((payload) =>
      payload.prefix.includes('prefix-a')
        ? deferredA.promise
        : Promise.resolve([{ text: '乙结果', kind: 'word', score: 0.6 }]),
    );
    const engine = new ReinkEngine({ tier: '32m', mode: 'fast' });
    const first = engine.generate(request({ extendedContextTail: 'prefix-a' }));
    const second = engine.generate(request({ extendedContextTail: 'prefix-b' }));

    // 旧请求被作废：旧 Promise 直接 resolve 空候选。
    await expect(first).resolves.toMatchObject({ candidates: [] });

    // A 的推理照常完成（确定性结果入缓存），随后最新请求 B 才下发。
    deferredA.resolve([{ text: '甲结果', kind: 'word', score: 0.5 }]);
    await expect(second).resolves.toMatchObject({
      candidates: [{ text: '乙结果' }],
    });
    expect(generateCalls.map((call) => call.prefix)).toEqual(['prefix-a', 'prefix-b']);

    // A 的迟到结果已入缓存：再次请求 A 不触发新的 invoke。
    const replay = await engine.generate(request({ extendedContextTail: 'prefix-a' }));
    expect(generateCalls).toHaveLength(2);
    expect(replay.candidates[0]?.text).toBe('甲结果');
  });

  it('resolves empty candidates when the host generate rejects', async () => {
    installInvoke(() => Promise.reject(new Error('reink engine deadline expired')));
    const engine = new ReinkEngine({ tier: '32m', mode: 'fast' });
    const response = await engine.generate(request({ extendedContextTail: '会失败' }));
    expect(response.candidates).toEqual([]);
    expect(engine.diagnostics().lastError).toContain('reink engine deadline expired');
  });

  it('uses an idle warmup seam, then dispose detaches the host process', async () => {
    installInvoke(async () => []);
    const engine = new ReinkEngine({ tier: '64m', mode: 'quality' });
    // 轻量 warmup 只探测 status，不触发 reink_warmup。
    await expect(engine.warmup()).resolves.toBe(true);
    expect(invokeMock).not.toHaveBeenCalledWith('reink_warmup');
    await expect(engine.ensureWarmed()).resolves.toBe(true);
    expect(invokeMock).toHaveBeenCalledWith('reink_warmup');
    expect(engine.diagnostics().status).toBe('ready');

    await engine.dispose();
    expect(invokeMock).toHaveBeenCalledWith('reink_dispose');
    const afterDispose = await engine.generate(request());
    expect(afterDispose.candidates).toEqual([]);
  });
});

describe('reink settings', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    localStorage.clear();
  });

  it('normalizes stored values and emits change events', () => {
    localStorage.clear();
    expect(getReinkSettings()).toEqual(DEFAULT_REINK_SETTINGS);

    const listener = vi.fn();
    const unsubscribe = subscribeReinkSettings(listener);
    try {
      updateReinkSettings({ tier: '64m', mode: 'quality', enabled: false });
      const stored = getReinkSettings();
      expect(stored).toMatchObject({ tier: '64m', mode: 'quality', enabled: false });
      expect(listener).toHaveBeenCalled();

      // 非法字段归一回默认档；空路径回落默认路径。
      saveReinkSettings({
        enabled: true,
        pythonPath: '  ',
        runtimeDir: '',
        tier: 'bogus',
        mode: 'bogus',
      } as unknown as ReinkSettings);
      expect(getReinkSettings()).toEqual({ ...DEFAULT_REINK_SETTINGS, enabled: true });

      // storage 事件（跨窗口）也驱动订阅。
      listener.mockClear();
      localStorage.setItem(
        REINK_SETTINGS_KEY,
        JSON.stringify({ ...DEFAULT_REINK_SETTINGS, tier: '64m' }),
      );
      window.dispatchEvent(
        new StorageEvent('storage', { key: REINK_SETTINGS_KEY, storageArea: localStorage }),
      );
      expect(listener).toHaveBeenCalledWith(expect.objectContaining({ tier: '64m' }));
    } finally {
      unsubscribe();
      localStorage.clear();
    }
  });
});
