import { defineConfig, type Plugin } from 'vite';
import vue from '@vitejs/plugin-vue';
import { resolve } from 'path';
import { readFileSync } from 'fs';

const packageJson = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf8')) as {
  version: string;
};

/**
 * 冷启动预加载：NotebookHome 由路由在 mount 后才发现，CodeMirror/markdown 等
 * 大 chunk 又要等 NotebookHome 解析后才发起请求，形成串行瀑布。在 index.html
 * 预注入 modulepreload：NotebookHome 的 link 会递归拉取其全部静态依赖图
 * （CodeMirror 三块 + markdown + renderer + vue 系列），再补 BootstrapPage
 * 与对应 CSS。只预取不执行，无可见行为变化。
 */
function startupModulePreload(): Plugin {
  // MarkdownEditor 不预载：只读外部文件会话（/reader）按产品约定不得加载
  // 编辑器资产（16-user-journeys 有守护断言），且其重量级依赖
  // （CodeMirror/markdown/renderer）已随 NotebookHome 的 modulepreload 递归拉取。
  const jsChunkPrefixes = ['assets/NotebookHome-', 'assets/BootstrapPage-'];
  const cssChunkPrefixes = ['assets/NotebookHome-', 'assets/BootstrapPage-'];
  return {
    name: 'jotluck:startup-module-preload',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(_html, ctx) {
        if (!ctx.bundle) return [];
        const files = Object.keys(ctx.bundle);
        const pick = (prefixes: string[], ext: string) =>
          prefixes.flatMap((prefix) =>
            files.filter((name) => name.startsWith(prefix) && name.endsWith(ext)),
          );
        return [
          ...pick(jsChunkPrefixes, '.js').map((name) => ({
            tag: 'link',
            attrs: { rel: 'modulepreload', href: `/${name}`, crossorigin: true },
            injectTo: 'head',
          })),
          // as="style" 的 preload 必须带 crossorigin，否则与真实样式请求的
          // credentials mode 不匹配，预加载被弃用并触发控制台警告。
          ...pick(cssChunkPrefixes, '.css').map((name) => ({
            tag: 'link',
            attrs: { rel: 'preload', as: 'style', href: `/${name}`, crossorigin: true },
            injectTo: 'head',
          })),
        ];
      },
    },
  };
}

export default defineConfig({
  plugins: [vue(), startupModulePreload()],
  define: {
    __APP_VERSION__: JSON.stringify(packageJson.version),
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  server: {
    port: 5173,
  },
  build: {
    target: 'es2022',
    manifest: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('@codemirror/view')) return 'vendor-codemirror-view';
            if (id.includes('@codemirror/state')) return 'vendor-codemirror-state';
            if (
              id.includes('@codemirror/lang-markdown') ||
              id.includes('@codemirror/language') ||
              id.includes('@codemirror/search') ||
              id.includes('@codemirror/commands') ||
              id.includes('@codemirror') ||
              id.includes('@lezer')
            ) {
              return 'vendor-codemirror-language';
            }
            if (id.includes('docx') || id.includes('write-excel-file')) return 'vendor-export';
            if (id.includes('vue-i18n') || id.includes('@intlify')) return 'vendor-i18n';
            if (id.includes('vue') || id.includes('pinia')) return 'vendor-vue';
            if (id.includes('marked') || id.includes('dompurify')) return 'vendor-markdown';
            if (id.includes('@tauri-apps')) return 'vendor-tauri';
          }
        },
      },
    },
  },
});
