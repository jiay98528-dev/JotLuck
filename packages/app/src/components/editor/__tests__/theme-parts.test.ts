import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import EditorControlStrip from '../EditorControlStrip.vue';
import FormatToolbar from '../FormatToolbar.vue';
import StatusBar from '../StatusBar.vue';
import TopBar from '../TopBar.vue';
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

describe('editor theme part contracts', () => {
  it('labels workbench topbar chrome without changing host actions', async () => {
    const createNote = vi.fn();
    const search = vi.fn();
    const settings = vi.fn();
    const wrapper = mount(TopBar, {
      props: {
        noteTitle: 'Draft',
        notebookName: 'Notebook',
        region: { variant: 'atelier', layout: 'workbench' },
        leftActions: [createAction('new-note', 'topbar-left', 'New note', createNote)],
        centerActions: [createAction('search', 'topbar-center', 'Search', search)],
        rightActions: [createAction('settings', 'topbar-right', 'Settings', settings)],
      },
    });

    expect(wrapper.get('[data-theme-part="topbar"]').attributes('role')).toBe('banner');
    expect(wrapper.get('[data-theme-part="topbar-content"]').classes()).toContain(
      'topbar-inner--workbench',
    );
    expect(wrapper.get('[data-theme-part="topbar-identity"]').attributes('data-theme-part')).toBe(
      'topbar-identity',
    );
    expect(wrapper.get('[data-theme-part="topbar-command"]').attributes('data-theme-part')).toBe(
      'topbar-command',
    );
    expect(wrapper.findAll('[data-theme-part="topbar-actions"]')).toHaveLength(2);

    await wrapper.get('button[aria-label="New note"]').trigger('click');
    await wrapper.get('button[aria-label="Search"]').trigger('click');
    await wrapper.get('button[aria-label="Settings"]').trigger('click');

    expect(createNote).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenCalledTimes(1);
    expect(settings).toHaveBeenCalledTimes(1);
  });

  it('labels the control strip and preserves format events', async () => {
    const action = createAction('template', 'editor-control', 'Template');
    const wrapper = mount(EditorControlStrip, {
      props: {
        region: { layout: 'toolbar', density: 'calm' },
        actions: [action],
      },
    });

    expect(wrapper.get('[data-theme-part="editor-control"]').attributes('data-theme-part')).toBe(
      'editor-control',
    );
    expect(
      wrapper.get('[data-theme-part="editor-control-actions"]').attributes('data-theme-part'),
    ).toBe('editor-control-actions');
    expect(wrapper.get('[data-theme-part="format-toolbar"]').attributes('role')).toBe('toolbar');

    await wrapper.get('button[aria-label="加粗"]').trigger('click');

    expect(wrapper.emitted('format')).toEqual([['bold']]);
  });

  it('removes formatting controls in read mode while preserving view actions', async () => {
    const switchView = vi.fn();
    const wrapper = mount(EditorControlStrip, {
      props: {
        region: { layout: 'toolbar', density: 'calm' },
        actions: [createAction('view-toggle', 'editor-control', '返回即时编辑', switchView)],
        viewMode: 'read',
      },
    });

    expect(wrapper.get('[data-theme-part="editor-control"]').attributes('data-view-mode')).toBe(
      'read',
    );
    expect(wrapper.find('[data-theme-part="format-toolbar"]').exists()).toBe(false);

    const button = wrapper.get('button[aria-label="返回即时编辑"]');
    expect(button.attributes('aria-pressed')).toBeUndefined();
    await button.trigger('click');
    expect(switchView).toHaveBeenCalledTimes(1);
  });

  it('labels format controls while retaining accessible preset and clear actions', async () => {
    const wrapper = mount(FormatToolbar, {
      props: { activeAction: 'bold' },
    });

    expect(
      wrapper.get('[data-theme-part="format-toolbar-preset"] select').attributes('aria-label'),
    ).toBe('段落样式');
    expect(wrapper.findAll('[data-theme-part="format-toolbar-action"]')).toHaveLength(5);
    expect(wrapper.get('[data-theme-part="format-toolbar-clear"]').attributes('aria-label')).toBe(
      '清除格式',
    );

    await wrapper.get('[data-theme-part="format-toolbar-clear"]').trigger('click');

    expect(wrapper.emitted('format')).toEqual([['clear']]);
  });

  it('labels status regions while keeping dashboard actions operational', async () => {
    const exportNote = vi.fn();
    const wrapper = mount(StatusBar, {
      props: {
        charCount: 84,
        wordCount: 12,
        lineCount: 6,
        cursorLine: 3,
        cursorCol: 7,
        region: { layout: 'dashboard', density: 'productive' },
        actions: [createAction('export', 'status-right', 'Export', exportNote)],
      },
    });

    expect(wrapper.get('[data-theme-part="status"]').attributes('role')).toBe('status');
    expect(wrapper.get('[data-theme-part="status-metrics"]').text()).toContain('84');
    expect(wrapper.get('[data-theme-part="status-position"]').text()).toContain('Ln 3, Col 7');
    expect(wrapper.get('[data-theme-part="status-actions"]').attributes('data-theme-part')).toBe(
      'status-actions',
    );
    expect(wrapper.get('[data-theme-part="status-save"]').attributes('data-theme-part')).toBe(
      'status-save',
    );

    await wrapper.get('button[aria-label="Export"]').trigger('click');

    expect(exportNote).toHaveBeenCalledTimes(1);
  });
});
