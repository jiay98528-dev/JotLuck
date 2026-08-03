import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import type { Component } from 'vue';
import type { ThemePluginModule } from '@/types/theme-pack';
import { plugin as lumenPlugin } from '@/themes/lumen-field/plugin';
import { plugin as superPlugin } from '@/themes/super-workbench/plugin';

function statusComponent(plugin: ThemePluginModule): Component {
  const component = plugin.components?.['status-bar'];
  if (!component) throw new Error('Theme does not expose status-bar');
  return component as Component;
}

describe.each([
  ['Lumen Field', lumenPlugin],
  ['Super Workbench', superPlugin],
] as const)('%s status recovery', (_name, plugin) => {
  it('does not reduce a save failure to warning text only', async () => {
    const retrySave = vi.fn();
    const saveCopy = vi.fn();
    const wrapper = mount(statusComponent(plugin), {
      props: {
        statusText: '保存失败',
        saveError: '原文件已被外部修改',
        retrySave,
        saveCopy,
      },
    });

    expect(wrapper.text()).toContain('原文件已被外部修改');
    await wrapper.get('button[aria-label="重新保存当前笔记"]').trigger('click');
    await wrapper.get('button[aria-label="另存当前笔记副本"]').trigger('click');
    expect(retrySave).toHaveBeenCalledTimes(1);
    expect(saveCopy).toHaveBeenCalledTimes(1);
  });
});
