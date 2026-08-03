<script setup lang="ts">
import { computed, ref } from 'vue';

const mode = ref<'source' | 'preview'>('preview');
const activeBacklink = ref('沉默的大多数');
const source =
  '# 写作的自由\n\n我们给文字太多重量，它便不堪重负。\n\n## 专注于当下\n\n- 本地优先，数据由你掌控\n- Markdown 原生支持\n- 双侧栏设计，读写更流畅';
const safeHtml = ref('');
const rendered = computed(() => safeHtml.value);

async function setMode(nextMode: 'source' | 'preview'): Promise<void> {
  mode.value = nextMode;
  if (nextMode === 'preview' && !safeHtml.value) {
    const { renderMarkdown } = await import('@jotluck/renderer');
    safeHtml.value = renderMarkdown(source);
  }
}

if (typeof window !== 'undefined') void setMode('preview');
</script>

<template>
  <section class="editor-proof" aria-label="JotLuck editor product proof">
    <span class="editor-spine" aria-hidden="true"><i></i><i></i><i></i></span>
    <aside class="editor-bookmarks" aria-label="Bookmarks">
      <strong>书签</strong>
      <button type="button" class="is-active">写作的自由</button>
      <button type="button">在纸上思考</button>
      <button type="button">沉默的大多数</button>
      <button type="button">卡片盒笔记法</button>
      <button type="button">阅读与回想</button>
    </aside>
    <article class="editor-document">
      <div class="editor-mode" role="tablist" aria-label="Editor view">
        <button
          type="button"
          role="tab"
          :aria-selected="mode === 'source'"
          @click="setMode('source')"
        >
          源码
        </button>
        <button
          type="button"
          role="tab"
          :aria-selected="mode === 'preview'"
          @click="setMode('preview')"
        >
          预览
        </button>
      </div>
      <pre v-if="mode === 'source'"><code>{{ source }}</code></pre>
      <!-- renderMarkdown applies the shared DOMPurify sanitizer before returning HTML. -->
      <!-- eslint-disable-next-line vue/no-v-html -->
      <div v-else-if="rendered" class="rendered-markdown" v-html="rendered"></div>
      <div v-else class="rendered-markdown" aria-hidden="true">
        <h1>写作的自由</h1>
        <p>我们给文字太多重量，它便不堪重负。</p>
        <h2>专注于当下</h2>
      </div>
      <footer><span>1,024 words · 6 min read</span><span>Markdown</span></footer>
    </article>
    <aside class="editor-backlinks" aria-label="Backlinks">
      <h2>反向链接</h2>
      <button
        v-for="item in ['沉默的大多数', '在纸上思考', '卡片盒笔记法', '阅读与回想']"
        :key="item"
        type="button"
        @click="activeBacklink = item"
      >
        {{ item }}
      </button>
      <p>当前：{{ activeBacklink }}</p>
    </aside>
  </section>
</template>
