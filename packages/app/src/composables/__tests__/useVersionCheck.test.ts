import { beforeEach, describe, expect, it, vi } from 'vitest';
import { APP_VERSION } from '@/config/app-meta';
import type { UpdateState } from '../useVersionCheck';

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn(), desktop: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));
vi.mock('@tauri-apps/api/event', () => ({ listen: mocks.listen }));
vi.mock('@/utils/runtime', () => ({ isDesktopRuntime: mocks.desktop }));

const initial: UpdateState = {
  revision: 1,
  currentVersion: APP_VERSION,
  channel: 'stable',
  autoCheck: false,
  status: 'idle',
  candidate: null,
  lastChecked: null,
  welcomeCompleted: true,
  welcomeRevision: null,
};
describe('process-wide update service adapter', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    localStorage.clear();
    mocks.desktop.mockReturnValue(true);
    mocks.listen.mockResolvedValue(() => {});
    mocks.invoke.mockResolvedValue(initial);
  });
  it('migrates old preferences once, without issuing a frontend network request', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    localStorage.setItem('jotluck:version:autoCheck', 'true');
    localStorage.setItem('jotluck:welcome:completed', '1');
    const { useVersionCheck } = await import('../useVersionCheck');
    await Promise.all([useVersionCheck().initialize(), useVersionCheck().initialize()]);
    expect(mocks.invoke).toHaveBeenCalledOnce();
    expect(mocks.invoke).toHaveBeenCalledWith('get_update_state', {
      legacy: { autoCheck: true, welcomeCompleted: true },
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
  it('ignores stale snapshots and shares state between consumers', async () => {
    const { useVersionCheck } = await import('../useVersionCheck');
    const first = useVersionCheck();
    await first.initialize();
    const event = mocks.listen.mock.calls[0]![1];
    event({
      payload: {
        ...initial,
        revision: 3,
        status: 'available',
        candidate: {
          version: '99.0.0',
          releaseUrl: 'https://github.com/jiay98528-dev/JotLuck/releases/tag/v99.0.0',
          notes: '<script>plain text</script>',
          source: 'confirmed',
          downloadUrl: null,
        },
      },
    });
    event({ payload: { ...initial, revision: 2 } });
    expect(first.hasUpdate.value).toBe(true);
    expect(useVersionCheck().latestVersion.value).toBe('99.0.0');
  });
  it('does not optimistically enable a preference when persistence fails', async () => {
    const { useVersionCheck } = await import('../useVersionCheck');
    const updates = useVersionCheck();
    await updates.initialize();
    mocks.invoke.mockRejectedValueOnce(new Error('disk unavailable'));
    await updates.setPreferences(true);
    expect(updates.autoCheck.value).toBe(false);
    expect(updates.saving.value).toBe(false);
    expect(updates.error.value).toContain('无法保存');
  });
  it('uses backend manual checks even when automatic checks are off', async () => {
    const { useVersionCheck } = await import('../useVersionCheck');
    const updates = useVersionCheck();
    await updates.initialize();
    mocks.invoke.mockResolvedValueOnce({ ...initial, revision: 2, status: 'checking' });
    await updates.checkNow();
    expect(mocks.invoke).toHaveBeenLastCalledWith('check_for_updates');
    expect(updates.checking.value).toBe(true);
  });
  it('does not issue update requests in the browser preview', async () => {
    mocks.desktop.mockReturnValue(false);
    const { useVersionCheck } = await import('../useVersionCheck');
    const updates = useVersionCheck();
    await updates.checkNow();
    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(updates.error.value).toContain('桌面');
  });
});
