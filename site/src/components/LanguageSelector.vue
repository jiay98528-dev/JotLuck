<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { LOCALES, getContent, type Locale } from '../content';
import { pagePath, type SitePage } from '../router';
import { useLocale } from '../composables/useLocale';

const { locale, content } = useLocale();
const route = useRoute();
const router = useRouter();
const open = ref(false);
const rootEl = ref<HTMLElement | null>(null);
const triggerEl = ref<HTMLButtonElement | null>(null);

function nameOf(l: Locale): string {
  return getContent(l).localeName;
}

/**
 * 键盘闭环（裁决 26，黑盒审计 P2）：Escape 关闭并焦点回触发钮；外部点击关闭；
 * 方向键/Home/End 在选项间移动焦点（选项为真实 button，直接承接焦点）；
 * 列表 v-if 销毁后焦点必须显式回收，否则落到 body。
 */
function focusOption(index: number) {
  const items = rootEl.value?.querySelectorAll<HTMLButtonElement>('.lang-option');
  if (!items?.length) return;
  items[(index + items.length) % items.length]?.focus();
}

function openAndFocus(index: number) {
  open.value = true;
  void nextTick(() => focusOption(index));
}

function onTriggerKeydown(e: KeyboardEvent) {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    openAndFocus(LOCALES.indexOf(locale.value));
  } else if (e.key === 'Escape' && open.value) {
    e.preventDefault();
    open.value = false;
  }
}

function onListKeydown(e: KeyboardEvent) {
  const items = [...(rootEl.value?.querySelectorAll<HTMLButtonElement>('.lang-option') ?? [])];
  const current = items.indexOf(document.activeElement as HTMLButtonElement);
  if (e.key === 'Escape') {
    e.preventDefault();
    open.value = false;
    triggerEl.value?.focus();
  } else if (e.key === 'ArrowDown') {
    e.preventDefault();
    focusOption(current + 1);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    focusOption(current - 1);
  } else if (e.key === 'Home') {
    e.preventDefault();
    focusOption(0);
  } else if (e.key === 'End') {
    e.preventDefault();
    focusOption(items.length - 1);
  } else if (e.key === 'Tab') {
    open.value = false; // 不拦截自然焦点流
  }
}

function onDocPointerdown(e: PointerEvent) {
  if (open.value && rootEl.value && !rootEl.value.contains(e.target as Node)) {
    open.value = false;
  }
}

watch(open, (v) => {
  if (v) document.addEventListener('pointerdown', onDocPointerdown);
  else document.removeEventListener('pointerdown', onDocPointerdown);
});
onBeforeUnmount(() => document.removeEventListener('pointerdown', onDocPointerdown));

function switchTo(target: Locale) {
  open.value = false;
  triggerEl.value?.focus();
  if (target === locale.value) return;
  const page = (route.meta.page as SitePage | undefined) ?? 'home';
  router.push(pagePath(target, page));
}
</script>

<template>
  <div ref="rootEl" class="lang-selector">
    <button
      ref="triggerEl"
      type="button"
      class="lang-trigger"
      :aria-expanded="open"
      :aria-label="content.header.langSelectorLabel"
      aria-haspopup="listbox"
      @click="open = !open"
      @keydown="onTriggerKeydown"
    >
      {{ content.localeName }}
    </button>
    <ul v-if="open" class="lang-list" role="listbox" @keydown="onListKeydown">
      <li v-for="l in LOCALES" :key="l" role="presentation">
        <button
          type="button"
          class="lang-option"
          role="option"
          :aria-selected="l === locale"
          @click="switchTo(l)"
        >
          {{ nameOf(l) }}
        </button>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.lang-selector {
  position: relative;
}
.lang-trigger {
  min-height: 44px;
  min-width: 44px;
  padding: 0 12px;
  border-radius: var(--r-control);
  border: 1px solid var(--ink-30);
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.06em;
}
.lang-list {
  position: absolute;
  right: 0;
  top: calc(100% + 6px);
  background: var(--paper);
  border-radius: var(--r-compact);
  box-shadow: var(--shadow-float);
  padding: 6px;
  min-width: 140px;
  z-index: 20;
}
.lang-option {
  width: 100%;
  min-height: 44px;
  display: flex;
  align-items: center;
  padding: 0 12px;
  border-radius: var(--r-compact);
  text-align: left;
}
.lang-option[aria-selected='true'] {
  color: var(--teal);
  font-weight: 700;
}
</style>
