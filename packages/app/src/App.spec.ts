import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createRouter, createWebHistory } from 'vue-router';
import App from './App.vue';

describe('App', () => {
  it('mounts and renders heading', () => {
    setActivePinia(createPinia());

    const router = createRouter({
      history: createWebHistory(),
      routes: [],
    });

    const wrapper = mount(App, {
      global: {
        plugins: [router],
      },
    });

    expect(wrapper.find('h1').text()).toBe('MarkLuck');
  });
});
