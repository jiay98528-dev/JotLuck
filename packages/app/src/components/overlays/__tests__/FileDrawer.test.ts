import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import { describe, expect, it } from 'vitest';
import type { DirEntry } from '@/types';
import FileDrawer from '../FileDrawer.vue';

const NOTE_ENTRY: DirEntry = {
  name: '笔记.md',
  path: '/笔记.md',
  isDirectory: false,
  isFile: true,
};

function mountDrawer(switchingNotebook = false, files: DirEntry[] = []) {
  return mount(FileDrawer, {
    props: {
      visible: true,
      files,
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

describe('FileDrawer 重命名入口文件名守卫（E2）', () => {
  async function startRename(wrapper: ReturnType<typeof mountDrawer>) {
    const item = wrapper.get('.tree-item');
    await item.trigger('dblclick');
    await nextTick();
    return wrapper.get('.tree-rename-input');
  }

  it('含 / 与 :*? 的名字：就地报具体错误、保留编辑态、不 emit（/ 不再静默建目录）', async () => {
    const wrapper = mountDrawer(false, [NOTE_ENTRY]);
    const input = await startRename(wrapper);

    await input.setValue('子目录/笔记:名*?');
    await input.trigger('keydown.enter');

    const error = wrapper.get('.tree-rename-error');
    // 报错须点名具体字符（/ 与 Windows 非法字符提前暴露，非底层模糊报错）
    expect(error.text()).toContain('/');
    expect(error.text()).toContain(':');
    expect(error.attributes('role')).toBe('alert');
    // 编辑态保留（输入框仍在）且不提交
    expect(wrapper.find('.tree-rename-input').exists()).toBe(true);
    expect(wrapper.emitted('rename-file')).toBeUndefined();
    wrapper.unmount();
  });

  it('修正输入后错误态清除，合法名正常 emit（补扩展名口径不变）', async () => {
    const wrapper = mountDrawer(false, [NOTE_ENTRY]);
    const input = await startRename(wrapper);

    await input.setValue('坏/名字');
    await input.trigger('keydown.enter');
    expect(wrapper.find('.tree-rename-error').exists()).toBe(true);

    await input.setValue('改名');
    expect(wrapper.find('.tree-rename-error').exists()).toBe(false);
    await input.trigger('keydown.enter');

    expect(wrapper.emitted('rename-file')).toEqual([['/笔记.md', '改名.md']]);
    wrapper.unmount();
  });
});
