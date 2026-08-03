<script setup lang="ts">
import EditorProof from '../components/EditorProof.vue';
import type { SiteContent } from '../types';

defineProps<{ content: SiteContent }>();
</script>

<template>
  <section class="hero-stage">
    <div class="hero-copy">
      <h1>
        <span class="hero-voice">{{ content.hero.voice }}</span>
        <span class="hero-emphasis">{{ content.hero.emphasis }}</span>
      </h1>
      <img
        class="hero-ink"
        src="/assets/brand/hero-ink-approved-v1.png"
        alt=""
        aria-hidden="true"
      />
      <RouterLink class="primary-action" to="/download/"
        >{{ content.common.releaseProgress }} <span>→</span></RouterLink
      >
      <p class="release-note">{{ content.hero.releaseNote }}</p>
    </div>
    <div class="editor-stack">
      <span class="paper-layer paper-layer-one" aria-hidden="true"></span>
      <span class="paper-layer paper-layer-two" aria-hidden="true"></span>
      <EditorProof />
    </div>
  </section>

  <section class="proof-sequence" aria-labelledby="proof-title">
    <header>
      <p>01—04 / WORKING PROOF</p>
      <h2 id="proof-title">文件在本地，关系在文字之间。</h2>
    </header>
    <ol>
      <li>
        <span>01</span><strong>本地文件</strong>
        <p>.md · .markdown · .mdx · .txt</p>
      </li>
      <li>
        <span>02</span><strong>笔记关联</strong>
        <p>Wiki-link 与 backlink</p>
      </li>
      <li>
        <span>03</span><strong>实时写作</strong>
        <p>源码与安全预览并行</p>
      </li>
      <li>
        <span>04</span><strong>自由导出</strong>
        <p>PDF · TXT · DOCX · XLSX/CSV</p>
      </li>
    </ol>
    <p class="completion-note">文字补全当前仅支持中文和英文。</p>
  </section>
</template>
