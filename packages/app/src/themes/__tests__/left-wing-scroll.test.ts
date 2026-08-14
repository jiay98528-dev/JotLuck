import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import type { Component } from 'vue';
import haloCanvasCss from '../halo-canvas/halo-canvas.css?inline';
import { plugin as lumenPlugin } from '@/themes/lumen-field/plugin';
import { plugin as superPlugin } from '@/themes/super-workbench/plugin';
import type { ThemePluginModule } from '@/types/theme-pack';

function leftWingComponent(plugin: ThemePluginModule): Component {
  const component = plugin.components?.['left-wing'];
  if (!component) throw new Error('Theme does not expose left-wing');
  return component as Component;
}

const manyNotes = Array.from({ length: 16 }, (_, index) => ({
  path: `/note-${index}.md`,
  title: `Note ${index}`,
  colorIndex: index % 8,
}));

describe('theme left-wing bookmark scroll contract', () => {
  it('lets Halo wrap the host list without clipping its height contract', () => {
    expect(haloCanvasCss).toMatch(/\.halo-frame--left-wing\s*\{[^}]*min-height:\s*0/s);
    expect(haloCanvasCss).toMatch(
      /\.halo-frame--left-wing\s+\.left-wing\s*\{[^}]*min-height:\s*0/s,
    );
    expect(haloCanvasCss).not.toMatch(/\.wing-bookmarks\s*\{[^}]*scrollbar-width:\s*none/s);
  });

  it('renders every Lumen note into a scrollable list', () => {
    const onSelectNote = vi.fn();
    const wrapper = mount(leftWingComponent(lumenPlugin), {
      props: {
        notes: manyNotes,
        activePath: '/note-0.md',
        onSelectNote,
      },
    });

    expect(wrapper.findAll('.lumen-note')).toHaveLength(16);
    expect(wrapper.get('.lumen-note-list').classes()).toContain('lumen-note-list');
  });

  it('renders every Super Workbench note into a scrollable rail', () => {
    const onSelectNote = vi.fn();
    const wrapper = mount(leftWingComponent(superPlugin), {
      props: {
        notes: manyNotes,
        activePath: '/note-0.md',
        onSelectNote,
      },
    });

    expect(wrapper.findAll('.super-note-dot')).toHaveLength(16);
    expect(wrapper.find('.super-left-wing__notes').exists()).toBe(true);
  });
});
