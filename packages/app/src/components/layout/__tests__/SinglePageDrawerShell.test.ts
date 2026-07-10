import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it } from 'vitest';
import SinglePageDrawerShell from '../SinglePageDrawerShell.vue';
import type { ThemeDrawerShellRecipe } from '@/types/theme-pack';

const drawerShell: ThemeDrawerShellRecipe = {
  left: {
    side: 'left',
    slot: 'left-wing',
    label: '文件信标',
    size: 280,
  },
  right: {
    side: 'right',
    slot: 'right-wing',
    label: '知识雷达',
    size: 320,
  },
  bottom: {
    side: 'bottom',
    slot: 'editor-control',
    label: '命令舱',
    size: 164,
  },
};

function mountShell(themeId = 'jotluck.lumen-field') {
  return mount(SinglePageDrawerShell, {
    props: {
      themeId,
      drawerShell,
    },
    slots: {
      left: '<nav data-test="left-slot">left</nav>',
      main: '<article data-test="main-slot">main</article>',
      right: '<aside data-test="right-slot">right</aside>',
      bottom: '<footer data-test="bottom-slot">bottom</footer>',
    },
    attachTo: document.body,
  });
}

describe('SinglePageDrawerShell', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    localStorage.clear();
  });

  it('renders a single page with all drawers closed by default', () => {
    const wrapper = mountShell();

    expect(wrapper.find('[data-test="main-slot"]').exists()).toBe(true);
    expect(wrapper.find('.single-page-drawer--left').classes()).not.toContain('is-open');
    expect(wrapper.find('.single-page-drawer--right').classes()).not.toContain('is-open');
    expect(wrapper.find('.single-page-drawer--bottom').classes()).not.toContain('is-open');
    expect(wrapper.find('.single-page-drawer-handle--left').exists()).toBe(true);
    expect(wrapper.find('.single-page-drawer-handle--right').exists()).toBe(true);
    expect(wrapper.find('.single-page-drawer-handle--bottom').exists()).toBe(true);
  });

  it('keeps drawer chrome labels and actions readable', () => {
    const wrapper = mountShell();

    expect(
      wrapper.find('.single-page-drawer--right .single-page-drawer__chrome strong').text(),
    ).toBe('知识雷达');
    expect(
      wrapper.findAll('.single-page-drawer__actions button').map((button) => button.text()),
    ).toEqual(expect.arrayContaining(['固定', '关闭']));
  });

  it('opens a floating drawer and closes it from the scrim', async () => {
    const wrapper = mountShell();

    await wrapper.find('.single-page-drawer-handle--left').trigger('click');

    expect(wrapper.find('.single-page-drawer--left').classes()).toContain('is-open');
    expect(wrapper.find('.single-page-drawer-shell__scrim').exists()).toBe(true);

    await wrapper.find('.single-page-drawer-shell__scrim').trigger('click');

    expect(wrapper.find('.single-page-drawer--left').classes()).not.toContain('is-open');
  });

  it('pins a drawer and restores the pinned state for the same theme', async () => {
    const wrapper = mountShell();

    await wrapper.find('.single-page-drawer-handle--right').trigger('click');
    const pinButton = wrapper
      .find('.single-page-drawer--right')
      .findAll('button')
      .find((button) => button.text() === '固定');
    expect(pinButton).toBeTruthy();
    await pinButton!.trigger('click');

    expect(wrapper.find('.single-page-drawer--right').classes()).toContain('is-pinned');
    expect(localStorage.getItem('jotluck:theme:jotluck.lumen-field:drawer-shell-pins:v1')).toBe(
      JSON.stringify({ left: false, right: true, bottom: false }),
    );

    wrapper.unmount();
    const restored = mountShell();
    await restored.vm.$nextTick();

    expect(restored.find('.single-page-drawer--right').classes()).toContain('is-pinned');
    expect(restored.find('.single-page-drawer--left').classes()).not.toContain('is-pinned');
  });

  it('does not leak pinned state across themes', async () => {
    const wrapper = mountShell('jotluck.lumen-field');

    await wrapper.find('.single-page-drawer-handle--bottom').trigger('click');
    const pinButton = wrapper
      .find('.single-page-drawer--bottom')
      .findAll('button')
      .find((button) => button.text() === '固定');
    await pinButton!.trigger('click');
    wrapper.unmount();

    const otherTheme = mountShell('paper');

    expect(otherTheme.find('.single-page-drawer--bottom').classes()).not.toContain('is-pinned');
  });

  it('closes floating drawers with Escape', async () => {
    const wrapper = mountShell();

    await wrapper.find('.single-page-drawer-handle--bottom').trigger('click');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await wrapper.vm.$nextTick();

    expect(wrapper.find('.single-page-drawer--bottom').classes()).not.toContain('is-open');
  });
});
