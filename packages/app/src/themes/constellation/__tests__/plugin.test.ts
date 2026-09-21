import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { h, type Component, type VNodeChild } from 'vue';
import { plugin } from '../plugin';
import { createConstellationStarfield, type ConstellationStarfieldHandle } from '../starfield';
import type { ThemeSlotId } from '@/types/theme-pack';

// Mock 对应真实模块 ../starfield.ts 的公开契约（createConstellationStarfield
// 返回 { mode, dispose() }）；单测不触碰真实 canvas/WebGL 环境。
vi.mock('../starfield', () => ({
  createConstellationStarfield: vi.fn(
    (): ConstellationStarfieldHandle => ({ mode: 'static', dispose: vi.fn() }),
  ),
}));

const constellationSlots = [
  'app-shell',
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
  if (!component) throw new Error(`Missing Constellation component: ${slot}`);
  return component as Component;
}

function mountFrame(slot: ThemeSlotId, child: VNodeChild) {
  return mount(componentFor(slot), {
    props: { slotId: slot },
    slots: { default: () => child },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('Constellation theme plugin', () => {
  it('registers exactly the exposed Theme API v2 slots', () => {
    expect(Object.keys(plugin.components ?? {}).sort()).toEqual([...constellationSlots].sort());
  });

  it('preserves host action wiring and accessible controls inside the command bar frame', async () => {
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

  it('keeps the native command, format, and status semantics intact', async () => {
    const applyBold = vi.fn();
    const controlWrapper = mountFrame(
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

    await controlWrapper.get('button[aria-label="加粗"]').trigger('click');
    expect(applyBold).toHaveBeenCalledTimes(1);
    expect(controlWrapper.get('[data-theme-part="format-toolbar"]').element.tagName).toBe('DIV');

    const retrySave = vi.fn();
    const statusWrapper = mountFrame(
      'status-bar',
      h('footer', { 'data-theme-part': 'status' }, [
        h(
          'button',
          {
            type: 'button',
            'aria-label': '重新保存当前笔记',
            'data-theme-part': 'status-save',
            onClick: retrySave,
          },
          '重新保存',
        ),
      ]),
    );

    await statusWrapper.get('button[aria-label="重新保存当前笔记"]').trigger('click');
    expect(retrySave).toHaveBeenCalledTimes(1);
    expect(statusWrapper.get('[data-theme-part="status"]').element.tagName).toBe('FOOTER');
  });

  it('wraps every content-preserving slot without replacing its host child', () => {
    for (const slot of constellationSlots) {
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
      expect(wrapper.attributes('data-constellation-zone')).toBe(slot);
    }
  });

  it('mounts the starfield canvas beneath hull content and disposes on unmount', () => {
    const wrapper = mountFrame(
      'app-shell',
      h('main', { 'data-testid': 'hull-host-child' }, 'host content'),
    );

    const canvas = wrapper.get('canvas.constellation-stars');
    expect(canvas.attributes('aria-hidden')).toBe('true');
    const children = Array.from(wrapper.element.children) as Element[];
    expect(children[0]?.classList.contains('constellation-stars')).toBe(true);
    expect(children[1]?.getAttribute('data-testid')).toBe('hull-host-child');
    expect(wrapper.get('[data-testid="hull-host-child"]').text()).toBe('host content');

    const createMock = vi.mocked(createConstellationStarfield);
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(createMock).toHaveBeenCalledWith(canvas.element);
    const handle = createMock.mock.results[0]?.value as ConstellationStarfieldHandle;

    wrapper.unmount();
    expect(handle.dispose).toHaveBeenCalledTimes(1);
  });
});
