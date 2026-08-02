# JotLuck TypeScript & Vue 3 代码规范

> 版本：v1.0 | 日期：2026-06-03
> 关联文档：`PRODUCT.md`（"无感·真诚·精确"）

---

## 一、TypeScript 配置

```json
// tsconfig.json (strict)
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "exactOptionalPropertyTypes": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "paths": {
      "@/*": ["./src/*"]
    }
  }
}
```

### 类型导入

```typescript
// ✅ 显式使用 import type（防止类型被编译为运行时导入）
import type { Note, Notebook } from '@/types';
import { renderMarkdown } from '@/services/renderer';

// ❌ 禁止：混合类型和值的导入
import { Note, renderMarkdown } from '@/types'; // Note 可能被 tree-shaking 遗漏
```

---

## 二、命名规范

| 实体               | 规范                                 | 示例                                       |
| ------------------ | ------------------------------------ | ------------------------------------------ |
| Vue 组件文件       | PascalCase                           | `MarkdownEditor.vue`、`FileTree.vue`       |
| Vue 组件名         | PascalCase（与文件名一致）           | `<MarkdownEditor />`                       |
| Composables        | camelCase，`use` 前缀                | `useMarkdown.ts`、`useFileSystem.ts`       |
| Pinia Stores       | camelCase，`use` 前缀 + `Store` 后缀 | `useNotebookStore.ts`、`useEditorStore.ts` |
| Types / Interfaces | PascalCase，无 `I` 前缀              | `Note`（非 `INote`）、`SearchResult`       |
| Enums              | PascalCase，成员 PascalCase          | `BlockType.Paragraph`                      |
| Constants          | UPPER_SNAKE_CASE                     | `MAX_FILE_SIZE`、`DEFAULT_THEME`           |
| Functions          | camelCase                            | `renderMarkdown`、`openNotebook`           |
| Variables          | camelCase                            | `currentNote`、`isLoading`                 |
| Props (TS 侧)      | camelCase                            | `fileName: string`                         |
| Props (模板中)     | kebab-case                           | `<FileTree :file-name="...">`              |
| Events             | kebab-case                           | `@update:model-value`、`@file-selected`    |

---

## 三、Vue 3 组件规范

### 3.1 必须使用 `<script setup lang="ts">`

```vue
<!-- ✅ 正确 -->
<script setup lang="ts">
import type { Note } from '@/types';

const props = defineProps<{
  note: Note;
  readonly?: boolean;
}>();

const emit = defineEmits<{
  'update:note': [note: Note];
  close: [];
}>();
</script>

<!-- ❌ 禁止：Options API -->
<script lang="ts">
export default {
  data() {
    return {};
  },
};
</script>
```

### 3.2 Props 类型定义

```typescript
// ✅ 使用 interface
interface Props {
  fileName: string;
  content: string;
  readonly?: boolean;
}
const props = defineProps<Props>();

// ✅ 带默认值
const props = withDefaults(defineProps<Props>(), {
  readonly: false,
});

// ❌ 禁止：运行时声明
const props = defineProps({
  fileName: String, // 无类型安全
});
```

### 3.3 模板规范

```vue
<template>
  <!-- ✅ 组件用 PascalCase -->
  <FileTree :nodes="treeData" @select="handleSelect" />

  <!-- ✅ DOM 元素用 kebab-case -->
  <div class="editor-panel">
    <button @click="save">保存</button>
  </div>

  <!-- ✅ v-for 必须有 :key -->
  <FileTreeNode v-for="node in treeData" :key="node.path" :node="node" />

  <!-- ❌ 禁止 -->
  <div v-if="show" v-for="item in list" />
  <!-- v-if + v-for 同元素 -->
  <FileTreeNode v-for="node in treeData" />
  <!-- 缺 :key -->
</template>
```

### 3.4 计算属性

```typescript
// ✅ 使用 computed 派生状态
const wordCount = computed(() => props.content.split(/\s+/).length);

// ❌ 禁止：在模板中做复杂计算
// <span>{{ content.split(/\s+/).length }}</span>

// ❌ 禁止：在 computed 中修改状态
const badComputed = computed(() => {
  store.increment(); // 副作用！
  return store.count;
});
```

---

## 四、Pinia Store 规范

```typescript
// ✅ 使用 Setup Store 语法
export const useEditorStore = defineStore('editor', () => {
  // State
  const currentNote = ref<Note | null>(null);
  const isDirty = ref(false);

  // Getters
  const wordCount = computed(() => currentNote.value?.content.split(/\s+/).length ?? 0);

  // Actions（异步函数）
  async function saveNote() {
    if (!currentNote.value) return;
    await fileSystem.write(currentNote.value.path, currentNote.value.content);
    isDirty.value = false;
  }

  return { currentNote, isDirty, wordCount, saveNote };
});
```

**Store 命名**：`use{Name}Store`，文件名与 Store 名一致（`useEditorStore.ts`）。

---

## 五、Composable 规范

```typescript
// ✅ 单一职责 + 明确返回类型
export function useMarkdownRenderer() {
  const html = ref('');
  const isProcessing = ref(false);

  async function render(source: string) {
    isProcessing.value = true;
    html.value = await marked.parse(source);
    isProcessing.value = false;
  }

  return { html, isProcessing, render };
}
```

**规则**：

- 一个 composable 只做一件事
- 返回 `ref` + 函数，不返回原始值
- 如注册了事件监听或计时器，在 `onUnmounted` 中清理

---

## 六、导入顺序

```typescript
// 1. Vue 核心
import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';

// 2. 第三方库
import { marked } from 'marked';
import DOMPurify from 'dompurify';

// 3. 内部模块
import type { Note } from '@/types';
import { useNotebookStore } from '@/stores/useNotebookStore';
import { FileTree } from '@/components/FileTree.vue';

// 4. 相对导入
import { formatDate } from './utils';

// 5. 类型导入（可在任意位置，用 import type）
```

---

## 七、错误处理

```typescript
import type { Result } from '@/types';

// ✅ 使用 Result<T, E> 模式
async function loadFile(path: string): Promise<Result<string, 'NotFound' | 'PermissionDenied'>> {
  try {
    const content = await fs.read(path);
    return { success: true, data: content };
  } catch (err) {
    return { success: false, error: 'NotFound' };
  }
}

// ✅ 调用侧
const result = await loadFile('note.md');
if (result.success) {
  editor.content = result.data;
} else {
  toast.error(`无法加载文件：${result.error}`); // 用户可见用中文
}

// ❌ 禁止：空 catch
try {
  await riskyOp();
} catch {} // 不允许

// ❌ 禁止：不处理错误
await riskyOp(); // 返回 Promise 但不 await 也不 .catch
```

---

## 八、禁止事项

| 禁止                       | 替代方案                       |
| -------------------------- | ------------------------------ |
| `any` 类型                 | 使用 `unknown`（如果确实未知） |
| `as` 断言无注释            | 加 `// as 原因` 注释           |
| 直接 DOM 操作              | 使用 `ref` + template refs     |
| `$parent` / `$root`        | 使用 provide/inject 或 Pinia   |
| 修改 props                 | 使用 emit 通知父组件           |
| computed 中有副作用        | 将副作用移到 watch 或方法中    |
| `console.log` 留在生产代码 | 使用统一的 logger 工具函数     |

---

## 九、测试规范

```typescript
// Composables 优先用纯 vitest 测试（无 DOM）
import { useMarkdownRenderer } from '@/composables/useMarkdownRenderer';

describe('useMarkdownRenderer', () => {
  it('renders bold text to HTML', async () => {
    const { html, render } = useMarkdownRenderer();
    await render('**bold**');
    expect(html.value).toContain('<strong>bold</strong>');
  });
});

// 组件用 @vue/test-utils
import { mount } from '@vue/test-utils';
import MarkdownEditor from '@/components/MarkdownEditor.vue';

describe('MarkdownEditor', () => {
  it('renders with initial content', () => {
    const wrapper = mount(MarkdownEditor, {
      props: { content: '# Hello' },
    });
    expect(wrapper.html()).toMatchSnapshot();
  });
});
```

**最低测试覆盖要求**：

- 每个 composable：正常路径 + 错误路径
- 每个组件：渲染正确 + props 处理 + 事件触发 + 关键边缘情况
- 核心渲染管线：XSS 安全套件全量 PASS
