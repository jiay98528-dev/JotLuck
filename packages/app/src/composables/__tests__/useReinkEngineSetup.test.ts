import { mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';
import type { ReinkSettings } from '@/services/completion/reink-settings';

// 单测以 mock 驱动编排逻辑：invoke（reink_configure）、ReinkEngine、
// reink-settings 与 isDesktopRuntime 均不触真实实现。

const invokeMock = vi.hoisted(() => vi.fn());

interface StubReinkEngine {
  id: string;
  tier: string;
  mode: string;
  disposed: boolean;
  dispose(): Promise<void>;
  ensureWarmed(): Promise<boolean>;
  diagnostics(): { status: string; lastError: string | null };
}

const reinkStub = vi.hoisted(() => {
  const instances: StubReinkEngine[] = [];
  let counter = 0;
  class StubReinkEngine {
    id: string;
    tier: string;
    mode: string;
    disposed = false;
    constructor(options: { tier: string; mode: string }) {
      counter += 1;
      this.id = `reink-stub-${counter}`;
      this.tier = options.tier;
      this.mode = options.mode;
      instances.push(this);
    }
    async dispose(): Promise<void> {
      this.disposed = true;
    }
    async ensureWarmed(): Promise<boolean> {
      return true;
    }
    diagnostics(): { status: string; lastError: string | null } {
      return { status: 'ready', lastError: null };
    }
  }
  return { instances, ReinkEngine: StubReinkEngine };
});

const settingsStub = vi.hoisted(() => {
  const listeners = new Set<(settings: ReinkSettings) => void>();
  const current: ReinkSettings = {
    enabled: true,
    pythonPath: 'python',
    runtimeDir: 'D:\\reink',
    tier: '32m',
    mode: 'fast',
  };
  return { listeners, current };
});

vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));
vi.mock('@/utils/runtime', () => ({ isDesktopRuntime: () => false }));
vi.mock('@/services/completion/reink-engine', () => ({ ReinkEngine: reinkStub.ReinkEngine }));
vi.mock('@/services/completion/reink-settings', () => ({
  getReinkSettings: () => settingsStub.current,
  subscribeReinkSettings: (listener: (settings: ReinkSettings) => void) => {
    settingsStub.listeners.add(listener);
    return () => {
      settingsStub.listeners.delete(listener);
    };
  },
}));

import { useReinkEngineSetup } from '../useReinkEngineSetup';

const BASE_SETTINGS: ReinkSettings = {
  enabled: true,
  pythonPath: 'python',
  runtimeDir: 'D:\\reink',
  tier: '32m',
  mode: 'fast',
};

interface Harness {
  setup(): Promise<void>;
  emitSettings(settings: ReinkSettings): Promise<void>;
  unmount(): void;
  install: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
  restoreDefault: ReturnType<typeof vi.fn>;
  status: ReturnType<typeof useReinkEngineSetup>['status'];
  error: ReturnType<typeof useReinkEngineSetup>['error'];
}

function configureResponder(succeeds: boolean): void {
  invokeMock.mockImplementation((command: string) => {
    if (command !== 'reink_configure') {
      return Promise.reject(new Error(`unexpected invoke command: ${command}`));
    }
    return succeeds
      ? Promise.resolve(undefined)
      : Promise.reject(new Error('unable to start reink bridge (python "python")'));
  });
}

async function settle(): Promise<void> {
  // 排空 swapChain 上的微任务链（fake timers 下 0ms 推进即 flush 微任务）。
  await vi.advanceTimersByTimeAsync(0);
  await vi.advanceTimersByTimeAsync(0);
}

function buildHarness(): Harness {
  const install = vi.fn<(engine: StubReinkEngine) => Promise<boolean>>(async () => true);
  const remove = vi.fn<(engineId: string) => Promise<boolean>>(async () => true);
  const restoreDefault = vi.fn(async () => undefined);
  let unmounted = false;
  // 闭包变量持有实例：不进 ref()——UnwrapRef 会把 status/error 的 Ref
  // 类型解包成裸值，运行时 reactive 代理同样会解包 Ref 属性导致 .value 失效。
  let instance: ReturnType<typeof useReinkEngineSetup> | null = null;
  const wrapper = mount(
    defineComponent({
      setup() {
        instance = useReinkEngineSetup({
          predictor: {
            installPublicEngineForEvaluation: install,
            removePublicEngineForEvaluation: remove,
          } as unknown as Parameters<typeof useReinkEngineSetup>[0]['predictor'],
          isUnmounted: () => unmounted,
          restoreDefaultEngine: restoreDefault,
        });
        return () => h('div');
      },
    }),
    { attachTo: document.body },
  );
  return {
    setup: () => instance!.setupNow(),
    emitSettings: async (settings) => {
      settingsStub.current = settings;
      for (const listener of [...settingsStub.listeners]) listener(settings);
      await settle();
    },
    unmount: () => {
      unmounted = true;
      wrapper.unmount();
    },
    install,
    remove,
    restoreDefault,
    status: instance!.status,
    error: instance!.error,
  };
}

afterEach(() => {
  document.body.replaceChildren();
  vi.useRealTimers();
});

describe('useReinkEngineSetup', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    invokeMock.mockReset();
    reinkStub.instances.length = 0;
    settingsStub.listeners.clear();
    settingsStub.current = { ...BASE_SETTINGS };
  });

  it('接管后热切换失败：默认引擎链必须恢复', async () => {
    // 首次安装成功（显式 enabled=true）。
    configureResponder(true);
    const harness = buildHarness();
    await harness.setup();
    expect(harness.install).toHaveBeenCalledTimes(1);
    expect(harness.status.value).toBe('installed');
    expect(harness.restoreDefault).not.toHaveBeenCalled();
    const firstEngine = reinkStub.instances[0]!;

    // 用户改设置热切换：teardown(false) 撤下旧引擎后，configure 这次失败。
    configureResponder(false);
    await harness.emitSettings({ ...BASE_SETTINGS, mode: 'quality' });

    expect(harness.status.value).toBe('error');
    expect(harness.error.value).toContain('unable to start reink bridge');
    // 旧 Reink 引擎已被撤下并 dispose。
    expect(harness.remove).toHaveBeenCalledWith(firstEngine.id);
    expect(firstEngine.disposed).toBe(true);
    // 回归锚点：teardown 不得因 installedEngine 已空而早退，
    // 公共槽位被撤空后 restoreDefaultEngine 必须执行（否则 L3 补全全灭）。
    expect(harness.restoreDefault).toHaveBeenCalled();
    harness.unmount();
  });

  it('首次 configure 失败：同样恢复默认引擎链', async () => {
    configureResponder(false);
    const harness = buildHarness();
    await harness.setup();
    expect(harness.status.value).toBe('error');
    expect(harness.install).not.toHaveBeenCalled();
    expect(harness.restoreDefault).toHaveBeenCalled();
    harness.unmount();
  });

  it('热切换成功：新引擎接管，不重装默认引擎链', async () => {
    configureResponder(true);
    const harness = buildHarness();
    await harness.setup();
    await harness.emitSettings({ ...BASE_SETTINGS, tier: '64m' });

    expect(harness.install).toHaveBeenCalledTimes(2);
    expect(harness.status.value).toBe('installed');
    expect(harness.remove).toHaveBeenCalledTimes(1);
    expect(harness.restoreDefault).not.toHaveBeenCalled();
    harness.unmount();
  });

  it('enabled=false 热切换：撤下引擎并恢复默认引擎链', async () => {
    configureResponder(true);
    const harness = buildHarness();
    await harness.setup();
    expect(harness.install).toHaveBeenCalledTimes(1);

    await harness.emitSettings({ ...BASE_SETTINGS, enabled: false });
    expect(harness.status.value).toBe('disabled');
    expect(harness.remove).toHaveBeenCalledTimes(1);
    expect(harness.restoreDefault).toHaveBeenCalled();
    harness.unmount();
  });
});
