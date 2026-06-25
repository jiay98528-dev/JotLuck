import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { resolve } from 'path';

export default defineConfig({
  plugins: [vue()],
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
            if (id.includes('vue') || id.includes('pinia')) return 'vendor-vue';
            if (id.includes('marked') || id.includes('dompurify')) return 'vendor-markdown';
            if (id.includes('@tauri-apps')) return 'vendor-tauri';
          }
        },
      },
    },
  },
});
