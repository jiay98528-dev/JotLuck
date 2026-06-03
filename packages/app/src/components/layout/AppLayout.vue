<template>
  <div class="app-layout" :class="{ 'app-layout--mobile': isMobile }">
    <!-- 左侧文件边栏 -->
    <aside v-if="!isMobile || showMobileSidebar" class="app-layout__left">
      <slot name="left-sidebar">
        <FileSidebar />
      </slot>
    </aside>

    <!-- 中间编辑区 -->
    <main class="app-layout__center">
      <slot name="editor">
        <MarkdownEditor
          v-if="currentContent !== undefined"
          :model-value="currentContent"
          @update:model-value="(v: string) => $emit('updateContent', v)"
        />
      </slot>
    </main>

    <!-- 右侧导航面板 -->
    <aside v-if="!isMobile && showRightSidebar" class="app-layout__right">
      <slot name="right-sidebar">
        <NavTree />
      </slot>
    </aside>

    <!-- 移动端遮罩 -->
    <div
      v-if="isMobile && showMobileSidebar"
      class="app-layout__overlay"
      @click="showMobileSidebar = false"
    />
  </div>
</template>

<script setup lang="ts">
/**
 * AppLayout.vue — 三联画布局容器
 *
 * M1-20: 桌面端三栏布局（260px : flex : 240px），移动端单栏 + 抽屉。
 *
 * @see components.md §3
 */
import { ref } from 'vue';
import FileSidebar from '@/components/file-tree/FileSidebar.vue';
import MarkdownEditor from '@/components/editor/MarkdownEditor.vue';
import NavTree from '@/components/nav/NavTree.vue';

defineProps<{
  currentContent?: string;
}>();

defineEmits<{
  updateContent: [content: string];
}>();

const showRightSidebar = ref(true);
const showMobileSidebar = ref(false);
const isMobile = ref(false);

// Detect mobile viewport
if (typeof window !== 'undefined') {
  const mq = window.matchMedia('(max-width: 767px)');
  isMobile.value = mq.matches;
  mq.addEventListener('change', (e) => {
    isMobile.value = e.matches;
  });
}
</script>

<style scoped>
.app-layout {
  display: grid;
  grid-template-columns: var(--sidebar-width, 260px) 1fr var(--navtree-width, 240px);
  height: 100vh;
  overflow: hidden;
}

.app-layout--mobile {
  grid-template-columns: 1fr;
}

.app-layout__left {
  border-right: 1px solid var(--clr-border, #e0e0e0);
  overflow-y: auto;
  background: var(--clr-zone-sidebar, #f8f9fa);
}

.app-layout__center {
  overflow: hidden;
  display: flex;
  flex-direction: column;
  background: var(--clr-zone-editor, #fffef9);
}

.app-layout__right {
  border-left: 1px solid var(--clr-border, #e0e0e0);
  overflow-y: auto;
  background: var(--clr-zone-navtree, #f8faf8);
}

.app-layout__overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.3);
  z-index: 20;
}
</style>
