import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import LeftWing from '../LeftWing.vue';
import RightWing from '../RightWing.vue';
import ShellActionButton from '../ShellActionButton.vue';
import type { ShellAction } from '@/types/theme-pack';

function createAction(
  id: ShellAction['id'],
  region: ShellAction['region'],
  label: string,
  run = vi.fn(),
): ShellAction {
  return {
    id,
    region,
    label,
    shortLabel: label,
    title: label,
    icon: id,
    run,
  };
}

describe('layout theme part contracts', () => {
  it('labels shell actions without changing icon, label, or click semantics', async () => {
    const run = vi.fn();
    const wrapper = mount(ShellActionButton, {
      props: {
        action: createAction('search', 'topbar-center', 'Search notes', run),
        labelMode: 'full',
      },
    });

    const button = wrapper.get('[data-theme-part="shell-action"]');
    expect(button.attributes('aria-label')).toBe('Search notes');
    expect(button.get('[data-theme-part="shell-action-icon"]').attributes('aria-hidden')).toBe(
      'true',
    );
    expect(button.get('[data-theme-part="shell-action-label"]').text()).toBe('Search notes');

    await button.trigger('click');

    expect(run).toHaveBeenCalledTimes(1);
  });

  it('uses a neutral layout symbol for the three-state view action', () => {
    const wrapper = mount(ShellActionButton, {
      props: {
        action: createAction('view-toggle', 'editor-control', '切换到只读渲染'),
        labelMode: 'short',
      },
    });

    const icon = wrapper.get('[data-theme-part="shell-action-icon"]');
    expect(icon.find('rect').exists()).toBe(true);
    expect(icon.find('path[d="M8 5v14l11-7z"]').exists()).toBe(false);
    expect(wrapper.get('button').attributes('aria-pressed')).toBeUndefined();
  });

  it('labels the navigator list and retains note selection', async () => {
    const wrapper = mount(LeftWing, {
      props: {
        activePath: '/first.md',
        notes: [
          { path: '/first.md', title: 'First note', colorIndex: 0 },
          { path: '/second.md', title: 'Second note', colorIndex: 1 },
        ],
        region: { mode: 'navigator', layout: 'navigator' },
      },
    });

    expect(wrapper.get('[data-theme-part="navigator"]').attributes('aria-label')).toBeTruthy();
    expect(wrapper.get('[data-theme-part="navigator-list"]').attributes('aria-label')).toBeTruthy();
    expect(wrapper.findAll('[data-theme-part="navigator-item"]')).toHaveLength(2);

    await wrapper.get('button[aria-label="Second note"]').trigger('click');

    expect(wrapper.emitted('select-note')).toEqual([['/second.md']]);
  });

  it('labels inspector sections while preserving the resize separator and accordion', async () => {
    const wrapper = mount(RightWing, {
      props: {
        headings: [
          {
            id: 'introduction',
            level: 1,
            text: 'Introduction',
            lineNumber: 1,
            children: [],
          },
        ],
        backlinks: [],
        tags: [],
        activeHeadingId: null,
      },
    });

    expect(wrapper.get('[data-theme-part="inspector"]').attributes('data-theme-part')).toBe(
      'inspector',
    );
    expect(wrapper.get('[data-theme-part="inspector-resize"]').attributes('role')).toBe(
      'separator',
    );
    const railToggle = wrapper.get('[data-theme-part="inspector-rail-toggle"]');
    expect(railToggle.attributes('aria-controls')).toBe('inspector-content');
    expect(railToggle.attributes('aria-expanded')).toBe('false');
    expect(wrapper.get('[data-theme-part="inspector-content"]').attributes('data-theme-part')).toBe(
      'inspector-content',
    );
    expect(wrapper.findAll('[data-theme-part="inspector-section"]')).toHaveLength(3);
    expect(wrapper.findAll('[data-theme-part="inspector-section-header"]')).toHaveLength(3);
    expect(wrapper.findAll('[data-theme-part="inspector-section-body"]')).toHaveLength(2);

    await wrapper.findAll('[data-theme-part="inspector-section-header"]')[1]!.trigger('click');

    expect(wrapper.findAll('[data-theme-part="inspector-section-body"]')).toHaveLength(3);

    await railToggle.trigger('click');

    expect(railToggle.attributes('aria-expanded')).toBe('true');
  });
});
