import { mount, type VueWrapper } from '@vue/test-utils';
import { defineComponent, h, nextTick, ref } from 'vue';
import { afterEach, describe, expect, it } from 'vitest';
import { useDialogFocus } from '../useDialogFocus';

function createHarness(fallbackFocus?: () => HTMLElement | null) {
  return defineComponent({
    props: { visible: { type: Boolean, required: true } },
    setup(props) {
      const containerRef = ref<HTMLElement | null>(null);
      useDialogFocus({
        visible: () => props.visible,
        containerRef,
        initialFocus: '[data-dialog-initial-focus]',
        fallbackFocus,
      });
      return () =>
        props.visible
          ? h('div', { ref: containerRef, role: 'dialog', 'aria-modal': 'true' }, [
              h('button', { 'data-dialog-initial-focus': '', 'data-test': 'first' }, 'First'),
              h('button', { 'data-test': 'last' }, 'Last'),
              h('div', { style: { display: 'none' } }, [
                h('button', { 'data-test': 'hidden' }, 'Hidden'),
              ]),
            ])
          : null;
    },
  });
}

const wrappers: VueWrapper[] = [];

function mountHarness(visible: boolean, fallbackFocus?: () => HTMLElement | null): VueWrapper {
  const wrapper = mount(createHarness(fallbackFocus), {
    props: { visible },
    attachTo: document.body,
  });
  wrappers.push(wrapper);
  return wrapper;
}

function keyTab(shiftKey = false): void {
  document.dispatchEvent(
    new KeyboardEvent('keydown', {
      key: 'Tab',
      shiftKey,
      bubbles: true,
      cancelable: true,
    }),
  );
}

afterEach(() => {
  while (wrappers.length > 0) wrappers.pop()?.unmount();
  document.body.replaceChildren();
});

describe('useDialogFocus', () => {
  it('sets initial focus, loops Tab in both directions and pulls escaped focus back', async () => {
    const opener = document.createElement('button');
    opener.textContent = 'Open';
    const background = document.createElement('button');
    background.textContent = 'Background';
    document.body.append(opener, background);
    const wrapper = mountHarness(false);
    opener.focus();

    await wrapper.setProps({ visible: true });
    await nextTick();
    const first = wrapper.get('[data-test="first"]').element as HTMLButtonElement;
    const last = wrapper.get('[data-test="last"]').element as HTMLButtonElement;
    expect(document.activeElement).toBe(first);

    last.focus();
    keyTab();
    expect(document.activeElement).toBe(first);

    first.focus();
    keyTab(true);
    expect(document.activeElement).toBe(last);

    background.focus();
    await Promise.resolve();
    expect(document.activeElement).toBe(last);

    await wrapper.setProps({ visible: false });
    await nextTick();
    expect(document.activeElement).toBe(opener);
  });

  it('restores to fallback when the original trigger no longer exists', async () => {
    const opener = document.createElement('button');
    const fallback = document.createElement('button');
    document.body.append(opener, fallback);
    const wrapper = mountHarness(false, () => fallback);
    opener.focus();

    await wrapper.setProps({ visible: true });
    await nextTick();
    opener.remove();
    await wrapper.setProps({ visible: false });
    await nextTick();

    expect(document.activeElement).toBe(fallback);
  });

  it('falls back to the editor when a removed trigger has no explicit fallback', async () => {
    const opener = document.createElement('button');
    const editor = document.createElement('div');
    editor.className = 'cm-content';
    editor.tabIndex = 0;
    document.body.append(opener, editor);
    const wrapper = mountHarness(false);
    opener.focus();

    await wrapper.setProps({ visible: true });
    await nextTick();
    opener.remove();
    await wrapper.setProps({ visible: false });
    await nextTick();

    expect(document.activeElement).toBe(editor);
  });

  it('restores the pointer trigger when clicking it did not move focus', async () => {
    const opener = document.createElement('button');
    const openerIcon = document.createElement('span');
    opener.append(openerIcon);
    const previouslyFocused = document.createElement('button');
    document.body.append(opener, previouslyFocused);
    const wrapper = mountHarness(false);
    previouslyFocused.focus();

    openerIcon.dispatchEvent(new Event('pointerdown', { bubbles: true, composed: true }));
    await wrapper.setProps({ visible: true });
    await nextTick();
    await wrapper.setProps({ visible: false });
    await nextTick();

    expect(document.activeElement).toBe(opener);
  });

  it('keeps focus in the topmost nested dialog and restores through the stack', async () => {
    const pageOpener = document.createElement('button');
    document.body.append(pageOpener);
    pageOpener.focus();
    const outer = mountHarness(false);
    const inner = mountHarness(false);

    await outer.setProps({ visible: true });
    await nextTick();
    const outerLast = outer.get('[data-test="last"]').element as HTMLButtonElement;
    outerLast.focus();

    await inner.setProps({ visible: true });
    await nextTick();
    const innerFirst = inner.get('[data-test="first"]').element as HTMLButtonElement;
    expect(document.activeElement).toBe(innerFirst);

    outerLast.focus();
    await Promise.resolve();
    expect(document.activeElement).toBe(innerFirst);

    outerLast.remove();
    await inner.setProps({ visible: false });
    await nextTick();
    expect(document.activeElement).toBe(
      outer.get('[data-test="first"]').element as HTMLButtonElement,
    );

    await outer.setProps({ visible: false });
    await nextTick();
    expect(document.activeElement).toBe(pageOpener);
  });
});
