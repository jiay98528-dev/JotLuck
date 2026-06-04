# MarkLuck

> 轻量、本地优先、离线可用的 Markdown 笔记工具

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Rust](https://img.shields.io/badge/rust-1.96%2B-orange.svg)](https://rust-lang.org)
[![Vue](https://img.shields.io/badge/vue-3.5%2B-green.svg)](https://vuejs.org)

MarkLuck 的核心理念：**每一篇笔记就是一个 `.md` 文件，文件夹即笔记本。数据完全由你掌控。**

所有笔记都是纯文本 Markdown 文件——你可以用 Git 管理版本，用 OneDrive 同步，用任何文本编辑器打开。MarkLuck 让它更好用，但绝不锁死你的数据。

---

## 特性

- **📝 纯文本即笔记** — 每个 `.md` 文件就是一篇笔记，文件夹就是笔记本
- **🔗 Wiki-link 双向链接** — `[[笔记名]]` 自动关联，反向链接面板追踪引用
- **🔍 全文搜索** — 正则 + 标签 + 日期过滤，秒级检索
- **📋 模板系统** — 内置日记/会议/周报模板，支持自定义，`{{date}}` 等占位符自动替换
- **📤 多格式导出** — PDF / DOCX / XLSX / CSV / TXT / HTML，一键导出
- **🎨 双主题** — 构成主义（直角硬阴影）+ 发光磨玻璃（半透明模糊），亮/暗色模式
- **💻 跨平台** — Web (PWA) · Windows · macOS · Linux

## 安装

### 桌面版

从 [Releases](https://github.com/markluck/markluck/releases) 下载对应平台安装包：

- **Windows**: `.msi` 或 `.exe` 安装程序
- **macOS**: `.dmg` 磁盘映像
- **Linux**: `.AppImage` 或 `.deb` 包

### Web 版

访问 [markluck.app](https://markluck.app) 直接在浏览器中使用（需要浏览器支持 File System Access API）。

### 开发者

```bash
# 克隆仓库
git clone https://github.com/markluck/markluck.git
cd markluck

# 安装依赖
pnpm install

# 启动 Web 开发服务器
pnpm --filter @markluck/app dev

# 启动 Tauri 桌面开发
pnpm --filter @markluck/app tauri:dev
```

## 使用

### 基本操作

| 操作     | 快捷键               |
| -------- | -------------------- |
| 新建笔记 | `+` 按钮（选择模板） |
| 搜索笔记 | `Ctrl + Shift + P`   |
| 加粗     | `Ctrl + B`           |
| 斜体     | `Ctrl + I`           |
| 插入链接 | `Ctrl + K`           |

### Wiki-link 语法

```markdown
[[笔记名]] → 链接到同名笔记
[[笔记名|显示文字]] → 链接到笔记，显示别名
[[笔记名#标题]] → 链接到笔记的指定标题
```

### 模板占位符

创建笔记时可用模板，以下占位符会自动替换：

| 占位符         | 替换为                |
| -------------- | --------------------- |
| `{{date}}`     | `2026-06-04`          |
| `{{time}}`     | `14:30:00`            |
| `{{datetime}}` | `2026-06-04 14:30:00` |
| `{{year}}`     | `2026`                |
| `{{month}}`    | `06`                  |
| `{{day}}`      | `04`                  |
| `{{week}}`     | `周四`                |

---

## 技术栈

| 层级          | 技术                                 |
| ------------- | ------------------------------------ |
| 前端框架      | Vue 3 (Composition API) + TypeScript |
| 构建工具      | Vite 5                               |
| 编辑器        | CodeMirror 6                         |
| Markdown 渲染 | marked + DOMPurify + highlight.js    |
| 状态管理      | Pinia                                |
| Web 搜索      | minisearch                           |
| 桌面框架      | Tauri v2 (Rust)                      |
| 桌面搜索      | tantivy                              |
| 文件监控      | notify (Rust crate)                  |

## 项目结构

```
MarkLuck/
├── packages/
│   ├── app/              # @markluck/app — Vue 3 主应用
│   │   ├── src/
│   │   │   ├── components/   # UI 组件
│   │   │   ├── stores/       # Pinia 状态
│   │   │   ├── services/     # 业务逻辑
│   │   │   ├── composables/  # 组合式函数
│   │   │   └── utils/        # 工具函数
│   │   └── src-tauri/        # Tauri Rust 后端
│   └── renderer/         # @markluck/renderer — 共享渲染库
├── spec/                 # 规格文档
├── doc/                  # 设计文档
├── e2e/                  # E2E 测试
└── memory/               # 项目错题本
```

## 许可证

MIT © MarkLuck
