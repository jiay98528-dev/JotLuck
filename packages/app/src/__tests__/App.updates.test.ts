import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UpdateState } from '@/composables/useVersionCheck';

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));
vi.mock('@tauri-apps/api/event', () => ({ listen: mocks.listen }));
vi.mock('@/utils/runtime', () => ({ isDesktopRuntime: () => true }));
const initial: UpdateState = {
  revision: 1,
  currentVersion: '0.14.0',
  channel: 'stable',
  autoCheck: true,
  status: 'available',
  lastChecked: 123,
  welcomeCompleted: true,
  welcomeRevision: 'updates-opt-in-v1',
  candidate: {
    version: '99.0.0',
    notes: '<script>untrusted text</script>',
    source: 'confirmed',
    releaseUrl: 'https://github.com/jiay98528-dev/JotLuck/releases/tag/v99.0.0',
    downloadUrl: 'https://github.com/jiay98528-dev/JotLuck/releases/download/v99.0.0/app.exe',
  },
};
async function mountReader() {
  const { default: App } = await import('../App.vue');
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/reader', name: 'external-reader', component: { template: '<main>Reader</main>' } },
    ],
  });
  await router.push('/reader');
  const wrapper = mount(App, { attachTo: document.body, global: { plugins: [router] } });
  await flushPromises();
  return wrapper;
}
describe('application-level update presentation', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    localStorage.clear();
    document.body.replaceChildren();
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    mocks.listen.mockResolvedValue(() => {});
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === 'get_update_state') return initial;
      if (command === 'claim_welcome') return { show: false, mode: 'upgrade' };
      if (command === 'claim_update_notification') return true;
      return undefined;
    });
  });
  it('shows verified download actions in the existing reader and treats notes as text', async () => {
    const wrapper = await mountReader();
    expect(document.querySelector('.update-card')?.textContent).toContain('前往下载');
    expect(document.querySelector('.update-card script')).toBeNull();
    expect(document.querySelector('.update-card')?.textContent).toContain(
      '<script>untrusted text</script>',
    );
    const event = mocks.listen.mock.calls[0]![1];
    event({ payload: { ...initial, revision: 2, autoCheck: false } });
    await flushPromises();
    expect(document.querySelector('.update-card')).toBeNull();
    wrapper.unmount();
  });
  it('offers only source details for unverified release information', async () => {
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === 'get_update_state') return { ...initial, status: 'unverified' };
      if (command === 'claim_welcome') return { show: false, mode: 'upgrade' };
      if (command === 'claim_update_notification') return true;
    });
    const wrapper = await mountReader();
    expect(document.querySelector('.update-card')?.textContent).toContain('查看 GitHub 发布页');
    expect(document.querySelector('.update-card')?.textContent).not.toContain('前往下载');
    wrapper.unmount();
  });
  it('does not claim notifications while the welcome overlay is visible', async () => {
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === 'get_update_state') return initial;
      if (command === 'claim_welcome') return { show: true, mode: 'upgrade' };
    });
    const wrapper = await mountReader();
    expect(document.querySelector('.welcome-overlay')).not.toBeNull();
    expect(mocks.invoke).not.toHaveBeenCalledWith('claim_update_notification');
    wrapper.unmount();
  });
});
