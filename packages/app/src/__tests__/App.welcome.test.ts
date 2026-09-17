import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { createMemoryHistory, createRouter, type Router } from 'vue-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { requestWelcomeReplay, WELCOME_COMPLETED_KEY } from '@/utils/welcome';

interface MountedApp {
  router: Router;
  wrapper: VueWrapper;
}

async function mountAt(path: '/workspace' | '/reader'): Promise<MountedApp> {
  const { default: App } = await import('../App.vue');
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/workspace', name: 'workspace', component: { template: '<main>工作区</main>' } },
      { path: '/reader', name: 'external-reader', component: { template: '<main>阅读器</main>' } },
    ],
  });
  await router.push(path);
  await router.isReady();
  const wrapper = mount(App, { attachTo: document.body, global: { plugins: [router] } });
  await flushPromises();
  return { router, wrapper };
}

describe('App welcome integration', () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
    document.body.replaceChildren();
  });

  afterEach(() => {
    document.body.replaceChildren();
  });

  it('shows onboarding on the first workspace launch and remembers skip', async () => {
    const { wrapper } = await mountAt('/workspace');
    expect(document.body.textContent).toContain('欢迎使用新版 JotLuck');
    expect(document.querySelector('[role="switch"]')?.getAttribute('aria-checked')).toBe('false');

    const skipButton = [...document.body.querySelectorAll('button')].find(
      (button) => button.textContent?.trim() === '跳过',
    );
    skipButton?.click();
    await flushPromises();

    expect(localStorage.getItem(WELCOME_COMPLETED_KEY)).toBe('1');
    expect(document.body.textContent).not.toContain('欢迎使用新版 JotLuck');
    wrapper.unmount();
  });

  it('welcomes users within a directly opened reader without creating a workspace', async () => {
    const { wrapper } = await mountAt('/reader');
    expect(document.body.textContent).toContain('阅读器');
    expect(document.body.textContent).toContain('欢迎使用新版 JotLuck');
    expect(document.body.textContent).not.toContain('工作区');
    wrapper.unmount();
  });

  it('replays immediately without reloading the workspace', async () => {
    localStorage.setItem(WELCOME_COMPLETED_KEY, '1');
    localStorage.setItem('jotluck:welcome:revision', 'updates-opt-in-v1');
    const { wrapper } = await mountAt('/workspace');
    expect(document.body.textContent).not.toContain('欢迎使用新版 JotLuck');

    requestWelcomeReplay();
    await flushPromises();

    expect(document.body.textContent).toContain('欢迎使用新版 JotLuck');
    expect(localStorage.getItem('jotluck:welcome:revision')).toBe('updates-opt-in-v1');
    wrapper.unmount();
  });

  it('shows existing users a one-screen opt-in while preserving their choice', async () => {
    localStorage.setItem(WELCOME_COMPLETED_KEY, '1');
    localStorage.setItem('jotluck:version:autoCheck', 'true');
    const { wrapper } = await mountAt('/workspace');
    expect(document.querySelector('[role="switch"]')?.getAttribute('aria-checked')).toBe('true');
    expect(document.querySelector('.welcome-next-btn')?.textContent).toContain('完成设置');
    (document.querySelector('.welcome-next-btn') as HTMLButtonElement).click();
    await flushPromises();
    expect(document.body.textContent).not.toContain('欢迎使用新版 JotLuck');
    expect(localStorage.getItem('jotluck:version:autoCheck')).toBe('true');
    expect(localStorage.getItem('jotluck:welcome:revision')).toBe('updates-opt-in-v1');
    wrapper.unmount();
  });
});
