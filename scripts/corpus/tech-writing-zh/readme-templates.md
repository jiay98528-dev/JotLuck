# README 风格语料

以下为中文项目说明文档风格的 Markdown 文本。

---

## JotLuck

轻量化、本地优先、离线可用的 Markdown 笔记工具。

### 核心理念

世界上最好的笔记格式是纯文本。JotLuck 让它好用，但不锁死它。每一条笔记就是一个 `.md` 文件，文件夹即笔记本。数据完全由用户掌控，不依赖任何云服务或专有格式。

### 特性

- 纯 `.md` 文件，任何编辑器都可打开
- 块级混合编辑器，即时渲染 Markdown
- Wiki-link 自动关联笔记，反向链接面板
- 全文搜索，支持正则、标签过滤和日期范围
- 模板系统，快速创建日记和笔记
- 多格式导出，支持 PDF、docx、xlsx、TXT 和 HTML
- 完全离线，零网络依赖

### 安装

#### Web 版本

直接访问 PWA 页面即可使用。支持 Chrome 90+、Edge 90+、Firefox 90+ 和 Safari 15+。

#### 桌面版本

从 Releases 页面下载对应平台的安装包。Windows 提供 MSI 安装程序，macOS 提供 DMG 镜像，Linux 提供 AppImage 和 deb 两种格式。

### 快速开始

启动应用后，首先选择一个文件夹作为笔记本根目录。选择后，该文件夹下的所有 Markdown 文件会自动显示在文件树中。

点击文件即可在编辑器中打开。编辑内容会自动保存，状态栏显示当前的保存状态。使用 `Ctrl+B` 加粗文本，`Ctrl+K` 插入链接，`Ctrl+Shift+F` 打开全局搜索。

在编辑器中输入 Markdown 语法时，系统会自动识别格式块并即时渲染预览。如果需要在源码和渲染之间切换，使用顶栏的视图切换按钮。

### 技术架构

JotLuck 采用 Vue 3 作为前端框架，CodeMirror 6 作为编辑器内核，marked 作为 Markdown 解析器，DOMPurify 确保渲染安全。桌面端通过 Tauri v2 提供原生体验，使用 Rust 实现文件系统 IO 和全文搜索。

### 许可

MIT License。详见 LICENSE 文件。
