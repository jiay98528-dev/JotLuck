import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WELCOME_COMPLETED_KEY, WELCOME_REPLAY_EVENT } from '@/utils/welcome';
import SettingsDialog from '../SettingsDialog.vue';

describe('SettingsDialog welcome replay', () => {
  beforeEach(() => {
    localStorage.setItem(WELCOME_COMPLETED_KEY, '1');
    document.body.replaceChildren();
  });

  afterEach(() => {
    document.body.replaceChildren();
  });

  it('requests an immediate replay and closes settings without reloading', async () => {
    const replayListener = vi.fn();
    window.addEventListener(WELCOME_REPLAY_EVENT, replayListener);
    const wrapper = mount(SettingsDialog, {
      props: { visible: true },
      attachTo: document.body,
    });

    const updateTab = [...document.body.querySelectorAll<HTMLButtonElement>('button')].find(
      (button) => button.textContent?.trim() === '更新',
    );
    updateTab?.click();
    await flushPromises();
    const replayButton = [...document.body.querySelectorAll<HTMLButtonElement>('button')].find(
      (button) => button.textContent?.trim() === '重新播放欢迎引导',
    );
    replayButton?.click();
    await flushPromises();

    expect(replayListener).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(WELCOME_COMPLETED_KEY)).toBeNull();
    expect(wrapper.emitted('update:visible')).toContainEqual([false]);

    window.removeEventListener(WELCOME_REPLAY_EVENT, replayListener);
    wrapper.unmount();
  });
});
