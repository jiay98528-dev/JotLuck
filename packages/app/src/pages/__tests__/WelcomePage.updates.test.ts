import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

async function welcome() {
  const { default: WelcomePage } = await import('../WelcomePage.vue');
  const wrapper = mount(WelcomePage, {
    props: { visible: true, mode: 'upgrade' },
    attachTo: document.body,
    global: { stubs: { teleport: true } },
  });
  await flushPromises();
  return wrapper;
}
describe('welcome update opt-in', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    localStorage.clear();
    document.body.replaceChildren();
  });
  it('saves an explicit choice immediately without completing onboarding or fetching metadata', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const wrapper = await welcome();
    await wrapper.find('[role="switch"]').trigger('click');
    await flushPromises();
    expect(localStorage.getItem('jotluck:version:autoCheck')).toBe('true');
    expect(localStorage.getItem('jotluck:welcome:revision')).toBeNull();
    expect(wrapper.find('[role="switch"]').attributes('aria-checked')).toBe('true');
    expect(fetchSpy).not.toHaveBeenCalled();
    wrapper.unmount();
  });
  it('keeps the switch off and reports a failed save', async () => {
    const wrapper = await welcome();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage full');
    });
    await wrapper.find('[role="switch"]').trigger('click');
    await flushPromises();
    expect(wrapper.find('[role="switch"]').attributes('aria-checked')).toBe('false');
    expect(wrapper.find('[role="alert"]').text()).toContain('无法保存');
    wrapper.unmount();
  });
  it('allows Escape to confirm the feature introduction without opting in', async () => {
    const wrapper = await welcome();
    await wrapper.find('[role="dialog"]').trigger('keydown', { key: 'Escape' });
    await flushPromises();
    expect(localStorage.getItem('jotluck:welcome:revision')).toBe('updates-opt-in-v1');
    expect(localStorage.getItem('jotluck:version:autoCheck')).toBeNull();
    expect(wrapper.emitted('complete')).toHaveLength(1);
    wrapper.unmount();
  });
});
