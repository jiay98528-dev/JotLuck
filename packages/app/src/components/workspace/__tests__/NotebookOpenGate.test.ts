import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import NotebookOpenGate from '../NotebookOpenGate.vue';

function mountGate(status: 'idle' | 'opening' | 'error' = 'idle', errorMessage = '') {
  return mount(NotebookOpenGate, {
    attachTo: document.body,
    props: {
      status,
      errorMessage,
      formatsLabel: '.md / .markdown / .mdx / .txt',
    },
  });
}

describe('NotebookOpenGate', () => {
  it('focuses the sole primary action and emits an open request', async () => {
    const wrapper = mountGate();
    await wrapper.vm.$nextTick();

    const button = wrapper.get('[data-testid="open-notebook-button"]');
    expect(document.activeElement).toBe(button.element);
    expect(wrapper.text()).toContain('.md / .markdown / .mdx / .txt');

    await button.trigger('click');
    expect(wrapper.emitted('open-notebook')).toHaveLength(1);
    wrapper.unmount();
  });

  it('announces opening and prevents a duplicate picker request', async () => {
    const wrapper = mountGate('opening');
    const gate = wrapper.get('[data-testid="notebook-open-gate"]');
    const button = wrapper.get('[data-testid="open-notebook-button"]');

    expect(gate.attributes('aria-busy')).toBe('true');
    expect(button.attributes('disabled')).toBeDefined();
    await button.trigger('click');
    expect(wrapper.emitted('open-notebook')).toBeUndefined();
    wrapper.unmount();
  });

  it('renders picker and permission failures as an inline alert', () => {
    const wrapper = mountGate('error', '该文件夹不可读');

    expect(wrapper.get('[role="alert"]').text()).toBe('该文件夹不可读');
    expect(wrapper.get('[data-testid="open-notebook-button"]').text()).toContain(
      '选择笔记本文件夹',
    );
    wrapper.unmount();
  });
});
