import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import FileDrawer from '../FileDrawer.vue';

function mountDrawer(switchingNotebook = false) {
  return mount(FileDrawer, {
    props: {
      visible: true,
      files: [],
      switchingNotebook,
    },
    global: {
      stubs: {
        Teleport: true,
        Transition: false,
      },
    },
  });
}

describe('FileDrawer notebook switch control', () => {
  it('emits open-notebook from the visible switch control by default', async () => {
    const wrapper = mountDrawer();
    const button = wrapper.get('button[title="切换笔记本"]');

    expect(button.text()).toContain('切换笔记本');
    expect(button.attributes('disabled')).toBeUndefined();

    await button.trigger('click');

    expect(wrapper.emitted('open-notebook')).toEqual([[]]);
  });

  it('disables the switch control while a notebook switch is in progress', async () => {
    const wrapper = mountDrawer(true);
    const button = wrapper.get('button[title="切换笔记本"]');

    expect(button.attributes('disabled')).toBeDefined();
    expect(button.text()).toContain('切换中…');

    await button.trigger('click');

    expect(wrapper.emitted('open-notebook')).toBeUndefined();
  });
});
