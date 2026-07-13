import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { h, type Component, type VNodeChild } from 'vue';
import { plugin } from '../plugin';
import type { ThemeSlotId } from '@/types/theme-pack';

const haloSlots = [
  'topbar',
  'left-wing',
  'right-wing',
  'editor-control',
  'status-bar',
  'workflow-canvas',
  'editor-surface',
  'external-reader',
] as const satisfies readonly ThemeSlotId[];

function componentFor(slot: ThemeSlotId): Component {
  const component = plugin.components?.[slot];
  if (!component) throw new Error(`Missing Halo Canvas component: ${slot}`);
  return component as Component;
}

function mountFrame(slot: ThemeSlotId, child: VNodeChild) {
  return mount(componentFor(slot), {
    props: { slotId: slot },
    slots: { default: () => child },
  });
}

describe('Halo Canvas theme plugin', () => {
  it('registers exactly the exposed Theme API v2 slots', () => {
    expect(Object.keys(plugin.components ?? {}).sort()).toEqual([...haloSlots].sort());
  });

  it('preserves host action wiring and accessible controls inside the top chrome frame', async () => {
    const createNote = vi.fn();
    const wrapper = mountFrame(
      'topbar',
      h('header', { 'data-theme-part': 'topbar' }, [
        h(
          'button',
          {
            'aria-label': '新建笔记',
            'data-theme-part': 'shell-action',
            onClick: createNote,
          },
          '新建笔记',
        ),
      ]),
    );

    await wrapper.get('button[aria-label="新建笔记"]').trigger('click');
    expect(createNote).toHaveBeenCalledTimes(1);
    expect(wrapper.get('[data-theme-part="topbar"]').element.tagName).toBe('HEADER');
    expect(wrapper.attributes('data-theme-plugin-slot')).toBe('topbar');
  });

  it('keeps the native command, format, and default slot semantics intact', async () => {
    const applyBold = vi.fn();
    const wrapper = mountFrame(
      'editor-control',
      h('section', { 'data-theme-part': 'editor-control' }, [
        h('div', { 'data-theme-part': 'format-toolbar' }, [
          h(
            'button',
            {
              type: 'button',
              'aria-label': '加粗',
              'data-theme-part': 'format-toolbar-action',
              onClick: applyBold,
            },
            'B',
          ),
        ]),
      ]),
    );

    await wrapper.get('button[aria-label="加粗"]').trigger('click');
    expect(applyBold).toHaveBeenCalledTimes(1);
    expect(wrapper.get('[data-theme-part="format-toolbar"]').element.tagName).toBe('DIV');
    expect(wrapper.find('.halo-command-deck__header').exists()).toBe(false);
    expect(wrapper.get('.halo-command-deck__content').element.tagName).toBe('DIV');
  });

  it('wraps every content-preserving slot without replacing its host child', () => {
    for (const slot of haloSlots) {
      const wrapper = mountFrame(
        slot,
        h(
          'section',
          { 'data-testid': `${slot}-host-child`, 'aria-label': `${slot} host` },
          'host content',
        ),
      );

      expect(wrapper.get(`[data-testid="${slot}-host-child"]`).text()).toBe('host content');
      expect(wrapper.get(`[aria-label="${slot} host"]`).element.tagName).toBe('SECTION');
      expect(wrapper.attributes('data-theme-plugin-slot')).toBe(slot);
    }
  });
});
