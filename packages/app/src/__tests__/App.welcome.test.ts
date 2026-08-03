import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { createMemoryHistory, createRouter, type Router } from 'vue-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import App from '../App.vue';
import { requestWelcomeReplay, WELCOME_COMPLETED_KEY } from '@/utils/welcome';

interface MountedApp {
  router: Router;
  wrapper: VueWrapper;
}

async function mountAt(path: '/workspace' | '/reader'): Promise<MountedApp> {
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
    localStorage.clear();
    document.body.replaceChildren();
  });

  afterEach(() => {
    document.body.replaceChildren();
  });

  it('shows onboarding on the first workspace launch and remembers skip', async () => {
    const { wrapper } = await mountAt('/workspace');
    expect(document.body.textContent).toContain('你的笔记就是纯文本文件');

    const skipButton = [...document.body.querySelectorAll('button')].find(
      (button) => button.textContent?.trim() === '跳过',
    );
    skipButton?.click();
    await flushPromises();

    expect(localStorage.getItem(WELCOME_COMPLETED_KEY)).toBe('1');
    expect(document.body.textContent).not.toContain('你的笔记就是纯文本文件');
    wrapper.unmount();
  });

  it('does not block a directly opened external file', async () => {
    const { wrapper } = await mountAt('/reader');
    expect(document.body.textContent).toContain('阅读器');
    expect(document.body.textContent).not.toContain('你的笔记就是纯文本文件');
    wrapper.unmount();
  });

  it('replays immediately without reloading the workspace', async () => {
    localStorage.setItem(WELCOME_COMPLETED_KEY, '1');
    const { wrapper } = await mountAt('/workspace');
    expect(document.body.textContent).not.toContain('你的笔记就是纯文本文件');

    requestWelcomeReplay();
    await flushPromises();

    expect(document.body.textContent).toContain('你的笔记就是纯文本文件');
    wrapper.unmount();
  });
});
