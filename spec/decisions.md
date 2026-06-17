# MarkLuck 架构决策记录 (ADR)

> 版本：v1.0 | 日期：2026-06-03 | 状态：Phase 0 奠基完成

---

## 概述

本文档记录 MarkLuck 项目中所有**不可逆或高成本逆转**的架构决策。每一项决策均遵循 ADR 格式（背景 → 决策 → 后果 → 替代方案），确保后来者（包括未来的自己）能够理解决策背后的上下文和权衡。

### ADR 索引

| ADR     | 决策                                     |  状态  |
| ------- | ---------------------------------------- | :----: |
| ADR-001 | Vue 3 而非 React                         | 已采纳 |
| ADR-002 | Tauri v2 而非 Electron                   | 已采纳 |
| ADR-003 | 文件架构而非数据库                       | 已采纳 |
| ADR-004 | marked 而非 markdown-it                  | 已采纳 |
| ADR-005 | 浏览器打印生成 PDF 而非 pdfkit/puppeteer | 已采纳 |
| ADR-006 | YAML frontmatter + #tag 双重标签语法     | 已采纳 |
| ADR-007 | Wiki-link `[[...]]` 语法                 | 已采纳 |
| ADR-008 | Tauri v2 统一全端（桌面 + 移动）         | 已采纳 |
| ADR-009 | docx.js + sheetjs 导出管线              | 已采纳 |
| ADR-010 | CM6 updateListener 替代 DOM 事件同步     | 已采纳 |

---

## ADR-001: 前端框架选择 — Vue 3

- **状态**: 已采纳
- **日期**: 2026-06-03

### 背景

MarkLuck 是一个富交互的 Markdown 编辑器，需要前端框架来管理复杂的状态（编辑器内容、文件树、搜索索引、Wiki-link 图）和组件化 UI。对于单人开发 + AI 协作的项目，框架选择的决定性因素不是社区规模或招聘市场，而是：

1. **决策疲劳度** — 是否需要从数十个竞争方案中逐一评估
2. **生态内聚性** — 路由、状态管理、构建工具是否由同一团队维护、API 风格一致
3. **学习曲线** — AI 协作工具对框架的代码生成质量
4. **轻量化** — 最终 bundle 体积对离线 PWA 场景至关重要

### 决策

**选择 Vue 3 (Composition API)** 作为前端框架，配套使用：

- **Pinia** — 状态管理（Vue 官方推荐，替代 Vuex）
- **vue-router 4** — 路由管理（Vue 官方）
- **Vite** — 构建工具（Vue 官方推荐）

### 后果

**正面**：

- **生态统一，零决策碎片**：路由、状态管理、构建工具均为 Vue 团队官方维护，API 风格高度一致，无需在 Redux/Zustand/Jotai/Recoil 或 React Router/TanStack Router 中纠结。
- **Composition API 的代码组织优势**：按功能关注点组织逻辑（而非 Options API 的按选项类型分散），与 Pinia 的 `setup` 语法天然契合，适合按模块拆分 Markdown 解析、文件管理、搜索等独立关注点。
- **单文件组件 (SFC)**：模板、逻辑、样式共置在 `.vue` 文件中，减少文件跳转和上下文切换。AI 生成代码时，单文件结构更容易产生正确、完整的输出。
- **运行时体积更小**：Vue 3 运行时约 16KB gzip，对比 React + ReactDOM 约 42KB gzip，有利于达成 PWA bundle ≤ 100KB 的性能目标。
- **响应式系统**：基于 Proxy 的自动依赖追踪，无需 `useMemo`/`useCallback` 等手动优化，减少心智负担和 AI 代码中的性能陷阱。

**负面**：

- **第三方组件库选择较少**：相比 React 生态，Vue 的无样式组件库（Headless UI 风格）较少。但 MarkLuck 采用"自己造组件"策略（设计系统约束 + 极简主义），对此依赖度低。
- **React 在 Markdown 编辑器领域的社区先例更多**：如 NotePad、Inkdrop 等均采用 React。但这不影响 Vue 的技术可行性。

### 替代方案

| 方案                    | 未选原因                                                                                                                                    |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| **React**               | 状态管理方案碎片化（Redux/Zustand/Jotai 等 10+ 种选择），路由方案不统一，决策疲劳严重。对单人项目而言，这种"自由"是负担。且运行时体积更大。 |
| **Svelte**              | 编译时魔法过多，AI 代码生成质量不稳定。生态规模小，遇到边界问题时社区资源不足。                                                             |
| **Angular**             | 框架过于重型，适合企业级团队协作而非轻量笔记工具。TypeScript 强制但 DI 系统过于复杂。                                                       |
| **Solid.js**            | 技术前瞻但生态不够成熟。路由、状态管理等周边设施不如 Vue 官方配套完整。                                                                     |
| **原生 Web Components** | 缺少响应式状态管理和路由，需要从头搭建大量基础设施，效率低。                                                                                |

---

## ADR-002: 桌面壳方案 — Tauri v2

- **状态**: 已采纳
- **日期**: 2026-06-03

### 背景

MarkLuck 的定位是"本地优先"的笔记工具，需要访问原生文件系统来读写用户的 `.md` 文件。Web 平台的 File System Access API 虽然可用，但在 Firefox/Safari 上不受支持，需要降级到 OPFS 沙箱（功能受限）。

因此，桌面端和移动端需要原生壳来提供完整的文件系统访问能力。壳方案的核心评估维度：

1. **安装包体积** — 笔记工具应当轻巧，用户不应为"记笔记"下载 150MB+
2. **内存占用** — 笔记工具应常驻后台但不消耗过多系统资源
3. **跨平台一致性** — 同一套代码能否复用到移动端（参见 ADR-008）
4. **安全模型** — 文件系统访问应是受限的、用户授权的

### 决策

**选择 Tauri v2** 作为桌面和移动端的原生壳。

### 后果

**正面**：

- **极致轻量**：Tauri 安装包 < 10MB（Rust 编译的二进制 + WebView 使用系统自带），对比 Electron 典型 150MB+（捆绑完整 Chromium）。这对"轻量化笔记工具"的定位至关重要。
- **内存效率**：Tauri 应用内存占用通常 < 50MB（闲置），Electron 通常 150MB+。MarkLuck 常驻后台时的资源消耗是用户可感知的体验指标。
- **Rust 后端复用**：桌面端的文件系统 IO、tantivy 全文索引、notify 文件监控全部用 Rust 实现。这些模块在移动端（Android APK）可以**直接复用**同一套 Rust 代码，零重写成本（详见 ADR-008）。
- **安全模型**：Tauri 的前端运行在 WebView 沙箱中，后端 Rust 命令必须显式声明和授权。文件系统访问通过 Tauri 的 `fs` plugin 或自定义命令实现，权限边界清晰。
- **系统 WebView**：利用 OS 内置的 WebView（Windows: WebView2, macOS: WKWebView, Linux: WebKitGTK），自动获得系统级安全补丁，无需像 Electron 那样自行管理 Chromium 版本。

**负面**：

- **Rust 学习曲线**：团队（单人 + AI）需要编写和维护 Rust 代码。但 Tauri v2 的 plugin 系统已经很成熟（文件系统、对话框、通知等常用功能有官方 plugin），自定义 Rust 代码量有限。
- **平台 WebView 差异**：不同操作系统的 WebView 行为可能有细微差异，需要在 Windows/macOS/Linux 上分别测试。但这种差异远小于 Electron 捆绑 Chromium 的版本管理复杂度。
- **生态系统较年轻**：Tauri 的社区插件和教程数量不如 Electron，遇到罕见问题时排查成本可能更高。但 Tauri v2 已经进入稳定阶段，核心功能完备。

### 替代方案

| 方案             | 未选原因                                                                                                                                                                                   |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Electron**     | 安装包 150MB+，内存占用高，对"轻量化笔记工具"的定位是致命伤。每安装一个 Electron 应用等于安装一个完整的 Chromium。且 Electron + React Native 的混合方案无法像 Tauri v2 那样桌面/移动统一。 |
| **Neutralinojs** | 使用系统 WebView 的轻量方案，但生态极小，社区不活跃，长期维护风险高。且无移动端支持。                                                                                                      |
| **PWA Only**     | 无法在所有浏览器上获得完整的原生文件系统访问（File System Access API 仅 Chrome/Edge 支持，且 API 有限制）。完全依赖 PWA 会排斥 Firefox/Safari 用户。                                       |
| **Flutter**      | 跨平台 UI 方案，但需要学习 Dart 语言，且 MarkLuck 的 Markdown 渲染（marked + highlight.js + DOMPurify）全部基于 Web 技术栈，用 Flutter 需要完全重写渲染管线。                              |
| **React Native** | 前端框架已选定 Vue（ADR-001），React Native 与 React 强绑定，技术栈断裂。                                                                                                                  |

---

## ADR-003: 数据持久化方案 — 文件架构

- **状态**: 已采纳
- **日期**: 2026-06-03

### 背景

MarkLuck 的核心价值主张是**"数据完全由用户掌控"**。这意味着笔记数据必须：

1. 以开放格式存储，任何文本编辑器都能打开
2. 不依赖专有数据库，迁移成本为零
3. 可以通过任何文件同步工具（git、Dropbox、Syncthing、rsync）进行备份和同步
4. 即使 MarkLuck 停止维护，数据依然完整可用

此外，引入数据库（哪怕是 SQLite）会带来一系列连锁问题：并发写入冲突、同步时的数据损坏风险、导出兼容性、以及对用户透明度的降低。对于一个**离线优先、单人使用**的笔记工具，数据库的 ACID 优势在场景中并不成立，但其复杂性和锁死风险却是实实在在的。

### 决策

**纯文件架构**: 每一条笔记是一个 `.md` 文件，文件夹即笔记本。索引元数据存储在同目录的 `.markluck_index.json` 文件中。

```
用户笔记本/
├── .markluck_index.json       ← 索引（标签、反向链接、搜索索引）
├── 项目笔记/
│   ├── MarkLuck 架构设计.md    ← 笔记即 .md 文件
│   └── 前端技术选型.md
├── 学习日记/
│   ├── 2026-06-01.md
│   └── 2026-06-02.md
├── _templates/                ← 模板文件夹
│   └── 日记模板.md
└── assets/                    ← 附件文件夹
    └── screenshot.png
```

### 后果

**正面**：

- **零数据库锁死**：用户随时可以用 VS Code、Notepad、Vim 或任何文本编辑器打开和编辑笔记。数据不属于 MarkLuck，属于用户。
- **同步自由**：笔记本文件夹可以放在 iCloud/Dropbox/OneDrive/Syncthing 等任意同步工具中，不会出现数据库文件被锁定导致的同步冲突。`.md` 文件的合并冲突远比 SQLite 二进制文件容易处理。
- **迁移成本为零**：换到其他笔记工具（Obsidian、Logseq、Joplin 等）只需打开同一个文件夹，因为这些工具也支持基于文件夹的 `.md` 工作流。
- **版本控制友好**：用户可以使用 git 对笔记进行版本控制。`.md` 文件的 diff 清晰可读，`.markluck_index.json` 可以加入 `.gitignore` 以保证每次克隆后重建索引。
- **数据透明**：用户永远可以看到自己的数据。没有隐藏的数据库、没有加密的二进制 blob。

**负面**：

- **无并发写入安全**：如果外部编辑器与 MarkLuck 同时保存同一文件，可能导致数据丢失。缓解措施：(1) 保存前检查文件 mtime，若外部已修改则弹窗提示冲突；(2) 文件监控（notify crate）在检测到外部变更时自动重新加载并通知用户。
- **大型笔记本的索引性能**：10000+ 个 `.md` 文件时，`.markluck_index.json` 的扫描和更新可能变慢。缓解措施：(1) 增量索引，仅扫描变更文件；(2) 分批加载 + 虚拟滚动；(3) 提供"重建索引"按钮以修复不一致。
- **无内置查询能力**：文件系统没有 SQL 那样的查询语言。缓解措施：`.markluck_index.json` 维护结构化的元数据（标签、出链、反向链接、文件时间戳），在内存中通过 minisearch 或 tantivy 实现全文搜索。
- **文件系统限制**：某些文件系统不支持特殊字符文件名，或路径长度有限制。缓解措施：笔记文件名使用 Unicode 规范化（NFC），避免使用 OS 保留字符（`< > : " / \ | ? *`）。

### 替代方案

| 方案                                    | 未选原因                                                                                                                                                                                                                              |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **SQLite**                              | 笔记内容存入数据库 = 数据锁死。用户无法用文本编辑器打开笔记，迁移时需要导出工具，数据会因数据库损坏而丢失。且 SQLite 文件在云同步中容易损坏（部分写入 + 同步冲突）。项目中**明确禁用了数据库**（参见 tool.md §二 明确禁用的技术）。 |
| **IndexedDB (浏览器)**                  | 数据困在浏览器 Profile 中，清除浏览器数据 = 丢失所有笔记。不符合"数据由用户掌控"的核心原则。仅可用于缓存 `markluck_index.json` 的索引数据以提高搜索速度，绝不可用于存储笔记正文。                                                     |
| **LocalStorage**                        | 同 IndexedDB 的锁死问题，且存储容量限制（通常 5-10MB），对笔记场景不适用。                                                                                                                                                            |
| **PouchDB / CouchDB**                   | 引入了数据库和同步协议层，与"纯本地、零云服务"定位矛盾。架构复杂度远超需求。                                                                                                                                                          |
| **Obsidian 风格（纯文件，无索引文件）** | 不维护 `.markluck_index.json`，标签和反向链接每次实时扫描所有文件。对于 1000+ 笔记的场景，启动时需要完整扫描，延迟不可接受。维护一个轻量索引文件是性能与简洁的合理折中。                                                              |

---

## ADR-004: Markdown 解析库 — marked

- **状态**: 已采纳
- **日期**: 2026-06-03

### 背景

MarkLuck 需要将用户输入的 Markdown 文本解析为 HTML 进行渲染，解析器需要支持：

1. 标准 Markdown 语法（标题、列表、链接、图片、代码块等）
2. GFM 扩展（表格、任务列表、删除线）
3. MarkLuck 自定义扩展（Wiki-link `[[...]]`、行内 `#tag`、脚注）
4. LaTeX 数学公式（集成 KaTeX）

解析器的评估标准：

- **体积** — 对 PWA bundle ≤ 100KB 的目标至关重要
- **扩展性** — 能否方便地添加自定义语法（Wiki-link、#tag）
- **速度** — 大型笔记（100KB-5MB）的分块渲染性能
- **安全性** — 输出 HTML 的安全性（需配合 DOMPurify）

### 决策

**选择 marked** 作为 Markdown 解析器，通过自定义渲染器（custom renderer）和扩展（marked extensions）实现语法扩展。

### 后果

**正面**：

- **极致轻量**：marked 核心压缩后约 18KB gzip，markdown-it 约 35KB gzip（不含插件）。对于 PWA bundle 预算 100KB 的限制，节省 17KB 是显著的。
- **扩展性设计优雅**：marked 的自定义渲染器 API 允许逐 token 覆盖渲染逻辑。例如，Wiki-link `[[笔记名]]` 可以通过 `walkTokens` + 自定义渲染器实现，< 30 行代码即可完成。相比之下，markdown-it 的插件系统更强大但也更复杂。
- **速度优异**：marked 是市面上最快的 Markdown 解析器之一。对于 MarkLuck 的核心场景（编辑器实时预览），解析速度直接影响打字延迟的体感。
- **维护活跃**：marked 在 npm 上长期维护，社区活跃，Markdown 规范兼容性持续改进。

**负面**：

- **插件生态较小**：marked 的插件生态不如 markdown-it 丰富。MarkLuck 需要的扩展（Wiki-link、#tag、LaTeX）中，marked 没有现成插件，需要自行实现自定义渲染器。但这些扩展的代码量都很小（Wiki-link ~30 行，#tag ~20 行），自研成本可接受。
- **AST 操作能力弱**：marked 的 token 操作 API 不如 markdown-it 的 AST 操作能力精细。但 MarkLuck 的扩展需求主要在渲染端（如何展示），而非解析端（如何构建 AST），因此这个劣势影响有限。
- **部分 CommonMark 边缘情况**：在嵌套强调、列表缩进等边缘情况下，marked 的解析行为与 CommonMark 规范有细微偏差。这些偏差对实际写作几乎无影响，且 marked 团队在逐步修复。

### 替代方案

| 方案                                 | 未选原因                                                                                                                                                                                                                                    |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **markdown-it**                      | 体积更大（35KB+ vs marked 18KB），插件系统对 MarkLuck 的场景而言过度设计。虽然插件生态丰富，但 MarkLuck 需要的 Wiki-link 和 #tag 无论如何都需要自定义实现（因为涉及 MarkLuck 特定的文件系统交互逻辑）。重量级方案的优势无法体现在本项目上。 |
| **remark (unified 生态)**            | 基于 AST 的插件化架构非常强大，但整个 unified 生态（remark + rehype + 各种插件）的 bundle 体积可达 100KB+。且 API 学习曲线陡峭，对"解析 Markdown 然后渲染"的简单需求而言，抽象层次过高。                                                    |
| **showdown**                         | 曾经风光但现已几乎不再维护。存在已知的 XSS 风险，不建议用于新项目。                                                                                                                                                                         |
| **markdown-rs (Rust, Tauri 侧解析)** | 可以在 Rust 端解析 Markdown 并通过 IPC 传 HTML 到前端，但会增加 IPC 调用频率和序列化开销。Markdown 渲染适合在渲染层（前端）完成，保持数据流简单。                                                                                           |

---

## ADR-005: PDF 导出方案 — 浏览器打印

- **状态**: 已采纳
- **日期**: 2026-06-03

### 背景

MarkLuck 需要将笔记导出为 PDF 格式（用户故事 US-05）。PDF 生成是笔记工具的标准功能，但传统方案（如 wkhtmltopdf、Puppeteer、pdfkit）都会显著增加应用体积和复杂性。

MarkLuck 是离线本地工具，所有导出均在前端完成。评估 PDF 方案的维度：

1. **依赖体积** — 是否增加额外的二进制依赖
2. **排版质量** — 能否准确还原 Markdown 渲染效果
3. **跨平台可用** — Web PWA + Desktop Tauri + Mobile 是否都能使用
4. **中文支持** — 中文排版和字体嵌入

### 决策

**使用浏览器打印 API (`window.print()`) + 专用打印 CSS 样式表生成 PDF。**

用户触发导出后 → 打开浏览器打印预览 → 用户确认打印/保存为 PDF → 完成。

### 后果

**正面**：

- **零依赖体积增加**：`window.print()` 是浏览器原生 API，不需要引入任何 JS 库、二进制文件或 Rust crate。对 bundle 体积的影响为 0KB。这正是 tool.md 中明确禁止 pdfkit/puppeteer 的原因。
- **排版一致性最高**：打印内容就是当前浏览器渲染的 HTML 页面，所见即所得。不会出现"导出后格式和预览不一样"的常见痛点。
- **浏览器 PDF 引擎成熟**：Chromium 的 PDF 生成引擎经过了数十亿用户的验证，字体嵌入、中文排版、CSS 分页规则（`page-break-before`、`@page` 等）都有完善支持。
- **跨平台内置支持**：Web (Chrome/Edge/Firefox/Safari)、Tauri Desktop (WebView2/WKWebView/WebKitGTK)、Tauri Mobile (Android WebView) —— 所有目标平台都原生支持 `window.print()`，无需任何额外工作。
- **用户最终控制权**：用户在打印预览中可以调整页面大小、边距、是否包含背景色等参数，而不是被导出工具的单一定制锁死。

**负面**：

- **非静默导出**：用户必须经过浏览器打印对话框，无法一键静默生成 PDF 文件。但 MarkLuck 定位为个人笔记工具（非服务端批量生成），这个交互流程是可接受的。
- **无法编程控制 PDF 细节**：无法指定 PDF 元数据（作者、标题）、无法设置 PDF 书签（outline）、无法控制压缩级别。但对于笔记导出的场景，这些高级特性并非必需。
- **浏览器间打印效果差异**：Chrome 和 Firefox 的 PDF 生成引擎有细微差异。需要为打印 CSS 进行跨浏览器测试。
- **移动端体验**：移动端浏览器对 `window.print()` 的支持效果参差不齐，可能需要提供"分享为 HTML → 在系统打印服务中打开"的降级路径。

### 替代方案

| 方案                                       | 未选原因                                                                                                                                                                                        |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **pdfkit**                                 | 纯 JS 方案但仍增加约 1MB bundle 体积（含字体数据则更大）。且需要手动编写 PDF 布局逻辑，无法直接复用浏览器渲染结果，排版一致性需要大量额外开发。不如图形化预览已有 HTML 然后在浏览器中打印直观。 |
| **Puppeteer / Playwright (服务端)**        | 需要绑定完整 Chromium 二进制（300MB+），完全违背"轻量离线"定位。且引入服务端架构，与纯客户端架构矛盾。                                                                                          |
| **jsPDF**                                  | 纯 JS 方案，但对 Markdown → PDF 的转换支持较弱。需要从 HTML 手动布局到 PDF 坐标系统，排版代码复杂且易出错。中文支持需要额外字体文件。                                                           |
| **Tauri 端 Rust PDF 库 (printpdf/genpdf)** | 在 Rust 端生成 PDF，但需要将 Markdown 渲染逻辑在 Rust 端再实现一遍（重复投入），且 Rust PDF 库的中文排版能力弱于浏览器引擎。                                                                    |
| **Microsoft Print to PDF / OS 级打印**     | 依赖操作系统功能，无法在应用内控制，跨平台行为差异大，且无法自定义打印样式。                                                                                                                    |

---

## ADR-006: 标签语法设计 — YAML Frontmatter + #tag 双轨制

- **状态**: 已采纳
- **日期**: 2026-06-03

### 背景

标签是笔记组织的重要维度（按主题分类、过滤、聚合）。在设计标签语法时，出现了两种不同的使用场景自然分化：

1. **结构化场景**：用户希望为笔记设置明确的分类/属性（如"这篇笔记属于 tutorials/javascript/beginner"），用于系统化的知识管理。这种场景偏"数据库思维"。
2. **流式写作场景**：用户在行文过程中自然使用 `#tag`（如"今天学习了 #javascript 的闭包"），类似社交媒体的标签习惯。这种场景偏"写作流"。

如果只提供一种语法，会迫使一类用户改变习惯。两种语法可以共存，各有清晰的定位和使用场景。

### 决策

**同时支持两种标签语法**：

1. **YAML Frontmatter 标签** — 位于文件顶部的结构化元数据，用于系统分类
2. **行内 `#tag` 标签** — 正文中任意位置的自然语言标签

两者在索引层统一合并，均可用于搜索过滤（`tag:javascript`）。

```markdown
---
title: JavaScript 闭包学习笔记
tags: [javascript, functional-programming, beginner]
created: 2026-06-03
---

# JavaScript 闭包学习笔记

今天终于理解了 #closure 的概念。
在项目中应用了 #functional-programming 的思维...
```

### 后果

**正面**：

- **覆盖两种写作习惯**：结构化整理者使用 frontmatter 维护清晰分类体系；流式写作者随手打 `#tag` 无需切换到文件头部。两种方式互不冲突。
- **与主流笔记工具兼容**：Frontmatter 标签格式与 Obsidian、Jekyll、Hugo、Logseq 等主流工具一致，用户迁移笔记时无需修改标签格式。`#tag` 语法在 Obsidian、Bear、Notion 等工具中也是常见模式。
- **索引层统一**：两种来源的标签在 `.markluck_index.json` 中合并为统一的标签列表。搜索 `tag:javascript` 会同时匹配 frontmatter 中的 `tags: [javascript]` 和正文中的 `#javascript`。
- **搜索过滤语法简单自然**：`tag:javascript` 是用户直觉式的查询语法，无需学习复杂的查询 DSL。

**负面**：

- **两种语法增加文档和维护复杂度**：开发者需要维护两套解析逻辑（frontmatter YAML 解析 + 行内 `#tag` 正则匹配）。好在这两套逻辑都很简单（YAML 解析用 `js-yaml` 或手写简单解析器，`#tag` 用正则 `/#[\w一-鿿\-\/]+/g`），不会显著增加系统复杂度。
- **标签不一致的风险**：用户可能在 frontmatter 写了 `tags: [javascript]`，但在正文中使用 `#js`。从系统角度看这是两个不同的标签，不会自动合并。这是"用户自由度"和"规范化"的必然权衡 — MarkLuck 选择自由。
- **#tag 的误匹配**：URL 片段（`https://example.com#section`）和 Markdown 标题（`# 一级标题`）不应被识别为标签。解析器需要上下文感知（排除 URL 内的 `#` 和行首的标题 `#`）。

### 替代方案

| 方案                           | 未选原因                                                                                                                                                               |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **仅 Frontmatter 标签**        | 强制用户在文件头部声明所有标签，打断写作流。对于想随手打标签的用户不友好。且 frontmatter 不适合表达"句子中提到某个话题但该话题不是整篇笔记的分类"的细粒度关系。        |
| **仅行内 #tag**                | 无法满足需要结构化分类体系的用户。Frontmatter 还可以承载标签之外的其他元数据（创建日期、修改日期、作者等），仅行内标签丢失了这种扩展能力。                             |
| **数据库驱动的标签系统**       | 标签存储在数据库中而非文件中，违背 ADR-003（文件架构）原则。笔记文件在其他工具中打开时会丢失标签信息。                                                                 |
| **标签文件（如 `tags.json`）** | 将标签集中存储在一个文件中，解耦标签和笔记内容。好处是修改标签不需要编辑笔记，坏处是笔记脱离 MarkLuck 后标签丢失。且集中式标签管理引入了"标签与内容不同步"的维护问题。 |

---

## ADR-007: 笔记间链接语法 — Wiki-link `[[...]]`

- **状态**: 已采纳
- **日期**: 2026-06-03

### 背景

笔记工具区别于普通 Markdown 编辑器的核心特性之一是**笔记间链接**（inter-note linking）。用户创建知识网络的关键在于能自然地引用其他笔记。

标准 Markdown 链接语法 `[显示文字](./路径/笔记名.md)` 在笔记场景中存在明显问题：

- 需要知道目标文件的完整相对路径（移动文件后链接断裂）
- 写法冗长，不符合快速记笔记的手感
- 无法表达"这是一条笔记引用"的特殊语义（反向链接、死链检测）

Wiki-link 语法 `[[笔记名]]` 在 Roam Research、Obsidian、Logseq 等现代笔记工具中已经成为事实标准。MarkLuck 需要既兼容这个生态，又保持简洁。

### 决策

**采用 Wiki-link `[[...]]` 语法**，与 Obsidian 兼容：

| 语法                        | 效果                               |
| --------------------------- | ---------------------------------- |
| `[[笔记名]]`                | 链接到同名笔记文件（自动匹配路径） |
| `[[笔记名\|显示文字]]`      | 别名语法，显示文字不同于笔记名     |
| `[[笔记名#标题]]`           | 链接到目标笔记的特定章节           |
| `[[笔记名#标题\|显示文字]]` | 别名 + 锚点组合                    |

### 后果

**正面**：

- **Obsidian 生态兼容**：Obsidian 是当前最大的本地 Markdown 笔记生态。MarkLuck 的 Wiki-link 语法与 Obsidian 完全兼容，用户可以在两个工具之间无缝切换，笔记的链接不会断裂。这也是吸引 Obsidian 用户尝试 MarkLuck 的关键卖点。
- **路径无关性**：`[[笔记名]]` 通过索引（`.markluck_index.json`）解析目标文件，不依赖文件路径。即使文件被移动到其他子文件夹，只要名称不变，链接依然有效。
- **反向链接基础设施**：Wiki-link 的独特语义（这是一个笔记引用，而非普通超链接）使得系统可以自动构建反向链接图谱。打开笔记 B 时，可以列出所有通过 `[[B]]` 引用了它的笔记 A1, A2, A3...
- **死链检测**：当 `[[笔记名]]` 指向的笔记不存在时，系统可以用特殊样式（红色虚线、警告图标）标注"死链"，用户点击死链可以一键创建该笔记。
- **书写直觉**：`[[` 两个字符的按键成本远低于 `[text](./path/name.md)` 的完整链接语法。在快速记笔记时，打字流畅度至关重要。

**负面**：

- **非标准 Markdown**：Wiki-link 不在 CommonMark 或 GFM 规范中。用其他 Markdown 渲染器打开包含 `[[...]]` 的文件时，链接不会被渲染为可点击链接（通常显示为纯文本 `[[笔记名]]`）。但用户始终可以用文本编辑器打开文件 — 链接信息不会丢失，只是渲染效果降级。
- **解析器需要自定义实现**：marked 原生不支持 Wiki-link 语法，需要通过 `marked.use()` 自定义扩展实现。好在 Wiki-link 的语法规则简单（正则匹配 `\[\[(.+?)\]\]`），扩展代码量小。
- **命名冲突**：如果笔记本中存在两个同名但位于不同文件夹的笔记，`[[笔记名]]` 会产生歧义。解决方案：(1) 链接解析时优先匹配当前文件夹；(2) 如果有多个匹配，弹出选择器让用户确认；(3) 支持 `[[文件夹/笔记名]]` 的路径限定语法消除歧义。

### 替代方案

| 方案                                             | 未选原因                                                                                                                                                                                            |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **标准 Markdown 链接 `[text](./path/name.md)`**  | 冗长、路径耦合、无法表达"笔记引用"语义。不符合快速笔记写作的手感需求。且标准链接无法让系统区分"笔记间引用"和"外部 URL 链接"，反向链接功能无法实现。                                                 |
| **自定义链接语法（如 `@笔记名` 或 `=>笔记名`）** | 语法不兼容任何现有笔记工具，用户迁移笔记时需要全局替换语法，且无法吸引 Obsidian/Logseq 生态用户。自定义语法 = 生态孤岛。                                                                            |
| **Roam 风格的 `((uid))` 块引用**                 | 基于唯一 ID 的引用，更精确但可读性差。用户无法从 `((a3f7b2c1))` 看出引用的是什么笔记。适合块级引用（段落级别的引用），不适合笔记级引用。MarkLuck V1 可以仅支持笔记级 Wiki-link，V2 再考虑块级引用。 |
| **Notion 风格的 `@笔记名` 提及**                 | 同样是生态孤岛问题，且 `@` 在 Markdown 中没有特殊含义，容易与邮件地址、代码注解混淆。                                                                                                               |

---

## ADR-008: 跨平台策略 — Tauri v2 统一全端

- **状态**: 已采纳
- **日期**: 2026-06-03

### 背景

MarkLuck 的 PRD 定义了四级部署目标：

1. **Web PWA**（所有现代浏览器）
2. **Desktop**（Windows / macOS / Linux，原生应用）
3. **Mobile**（Android APK）
4. 未来可能的 iOS 支持

"一套代码，多端部署"是所有跨平台工具的终极追求，但现实中往往需要在"代码复用率"和"平台原生体验"之间做权衡。核心问题是：桌面端和移动端是各自用不同的壳方案，还是统一用一套壳方案？

### 决策

**Tauri v2 统一所有原生平台（桌面 + 移动）**：

```
                    ┌─────────────────────────┐
                    │  Vue 3 前端（共享 100%）  │
                    ├─────────────────────────┤
                    │  Tauri v2 桥接层（Rust）  │
                    │  ┌──────┐ ┌───────────┐  │
                    │  │文件IO│ │tantivy搜索│  │
                    │  │notify│ │IPC 通信   │  │
                    │  └──────┘ └───────────┘  │
                    ├─────────────────────────┤
                    │  Tauri Runtime + WebView │
                    ├─────────────────────────┤
                    │  Installer / APK / PWA   │
                    └─────────────────────────┘
```

### 后果

**正面**：

- **一个 Rust 后端，所有平台复用**：文件系统 IO、tantivy 全文索引、notify 文件监控等核心后端逻辑**只需编写一次**。Rust 的跨平台编译能力（通过 `cargo` 交叉编译目标）使得同一套代码可以编译为 Windows `.exe`、macOS `.app`、Linux 二进制、Android `.so` 库。零重写成本。
- **一个 Vue 前端，所有平台复用**：编辑器 UI、Markdown 渲染、搜索界面、导航树、设置面板等全部前端代码 100% 共享。平台差异仅体现在少数适配层（窗口控制、菜单栏、分享 API、触摸手势）。
- **技术栈高度集中**：无需学习多套壳框架（如 Electron + Capacitor），减少技术债务和认知负担。对于单人项目的长期维护，技术栈的简洁比功能的花哨更重要。
- **一致的 Rust 安全模型**：所有原生能力通过 Tauri 的权限系统统一管理。桌面端和移动端的安全策略一致，不会出现"桌面端功能全开、移动端权限缺失"的不对称问题。
- **Android APK 的极致体积优势**：Tauri v2 Mobile 的 APK 体积远小于基于 Chromium 的方案。一个典型的 Tauri Mobile APK 约 10-20MB（含 Rust 编译的 `.so` 和 WebView 壳），对于希望快速下载体验的用户非常友好。

**负面**：

- **iOS 暂不支持**：Tauri v2 Mobile 目前主要支持 Android，iOS 支持仍处于实验阶段。这意味 MarkLuck 初期只能在 Android 移动端使用。对于 iOS 用户，需要引导使用 Web PWA 版本（Safari 的 PWA 支持已足够好）。当 Tauri iOS 成熟后，可补上原生 iOS 版本。
- **移动端 WebView 兼容性**：Android 的 WebView 基于 Chromium，但版本因设备制造商和系统版本而异。老设备（Android 10 以下）的 WebView 可能缺少某些现代 Web API。需要在前端做好降级处理。
- **Tauri v2 仍在演进**：虽然 v2 已进入稳定阶段，但移动端的 plugin 生态仍不如桌面端成熟。部分功能（如移动端的原生分享面板、文件选择器 UI）可能需要编写少量平台特定代码。
- **调试复杂度**：移动端的 Rust 代码调试比桌面端更复杂（需要 Android 模拟器或真机连接）。好在核心 Rust 代码在桌面端经过充分测试后，编译到移动端的行为通常一致。

### 替代方案

| 方案                                             | 未选原因                                                                                                                                                                                                                                  |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Electron (桌面) + Capacitor (移动)**           | 两个不同的壳框架，各自有不同的 API 风格和配置体系。Electron 使用 Node.js 后端 + Chromium 渲染，Capacitor 使用 WebView + 原生 plugin。维护两套壳的 API 适配层意味着双倍的兼容性测试和调试成本。且 Electron 的体积问题（ADR-002）仍然存在。 |
| **Flutter 全平台**                               | 跨平台 UI 方案，但 MarkLuck 的渲染核心（marked + highlight.js + DOMPurify + CodeMirror 6）全部依赖 Web 技术栈（浏览器 DOM + CSS）。用 Flutter 需要完全重写渲染管线，投入产出比极低。且 Flutter Web 应用的体积和性能都不如纯 Web 方案。    |
| **React Native 全平台**                          | 与 Vue 3 决策（ADR-001）冲突。React Native 与 React 生态强绑定，Vue + React Native 的技术栈搭配不自然。                                                                                                                                   |
| **PWA + 桌面 PWA (TWA)**                         | 依赖浏览器厂商对 PWA 的支持程度。Firefox 不完全支持 File System Access API，Safari 的 PWA 能力也有限。无法提供"原生应用"的文件关联、系统托盘、快捷键等特性。适合作为到原生版本的降级路径，不适合作为唯一方案。                            |
| **Kotlin Multiplatform / Compose Multiplatform** | 需要学习 Kotlin 和 JVM 生态，与项目现有的 Vue + Rust 技术栈完全断裂。对于一个小型团队，多语言混合开发是效率杀手。                                                                                                                         |

---

## 附录 A：决策追溯矩阵

下表展示各 ADR 之间的依赖和影响关系：

|                        | ADR-001 Vue 3        | ADR-002 Tauri v2           | ADR-003 文件架构      | ADR-004 marked           | ADR-005 浏览器打印  | ADR-006 双标签             | ADR-007 Wiki-link    | ADR-008 统一全端 |
| ---------------------- | -------------------- | -------------------------- | --------------------- | ------------------------ | ------------------- | -------------------------- | -------------------- | ---------------- |
| **ADR-001 Vue 3**      | —                    | 前端壳无关                 | 前端壳无关            | marked 工作在 Vue 组件内 | 打印 CSS 在 Vue SFC | Vue 解析 YAML              | Vue 渲染 Wiki-link   | 前端 100% 复用   |
| **ADR-002 Tauri v2**   | Tauri 不关心前端框架 | —                          | Rust 端文件系统 IO    | 前端渲染 → IPC 到 Tauri  | Tauri WebView 打印  | 索引在 Tauri 端构建        | Tauri 端维护链接索引 | 桌面端壳         |
| **ADR-003 文件架构**   | Vue 读取渲染 .md     | Tauri 提供文件 IO          | —                     | marked 解析 .md 内容     | 打印 .md 渲染结果   | 标签存于文件和 frontmatter | 链接存于文件中       | 文件跨平台可读   |
| **ADR-004 marked**     | Vue 生态中的 JS 库   | 前端运行                   | 解析 .md 文件         | —                        | 渲染 HTML → 打印    | 需扩展解析 #tag            | 需扩展解析 [[..]]    | 前端共享         |
| **ADR-005 浏览器打印** | Vue 组件触发 print() | Tauri WebView 支持 print() | 打印当前打开的 .md    | 打印 marked 渲染的 HTML  | —                   | 打印含标签渲染             | 打印含链接渲染       | 全平台内置       |
| **ADR-006 双标签**     | Vue 组件展示标签云   | Tauri 端索引提取标签       | 标签存储于 .md 文件内 | marked 扩展解析 #tag     | 打印含标签样式      | —                          | 标签可搜索链接       | 索引全平台共享   |
| **ADR-007 Wiki-link**  | Vue 组件渲染链接     | Tauri 端维护链接图         | 链接语法存于 .md 内   | marked 扩展解析 [[..]]   | 打印链接可点击样式  | 标签 + 链接共存            | —                    | 链接图全平台共享 |
| **ADR-008 统一全端**   | Vue 跨平台           | Rust 后端跨平台            | 文件系统跨平台        | JS 跨平台                | 浏览器打印跨平台    | 索引跨平台                 | 索引跨平台           | —                |

---

## ADR-009: DOCX/XLSX 导出库选型 — docx.js + sheetjs

- **状态**: 已采纳
- **日期**: 2026-06-05

### 背景

M3 导出管线最初为 stub 实现——DOCX 保存为 HTML 包装的 `.doc` 文件、XLSX 保存为 CSV、PDF/HTML 直接输出原始 markdown 文本。需要引入真实的 DOCX/XLSX 生成库来实现 PRD F-09 要求的完整导出功能。

### 决策

**DOCX 使用 `docx` (v9.x)，XLSX 使用 `xlsx` (sheetjs v0.18.x)**。均为纯 JS 实现，无需原生依赖。

- **DOCX 管线**: `marked.lexer()` 将 Markdown 解析为 Token 流 → 逐 Token 映射为 `Document/Paragraph/TextRun/HeadingLevel/Table` → `Packer.toBlob()` 生成 `.docx`
- **XLSX 管线**: `extractMarkdownTables()` 提取表格数据 → `XLSX.utils.aoa_to_sheet()` → `XLSX.write()` 生成 `.xlsx`
- **PDF 管线**: `renderMarkdown()` 渲染完整 HTML → 隐藏 iframe 注入 + print.css → `window.print()`
- **HTML 管线**: `renderMarkdown()` + 内嵌 Paper 主题 CSS → 自包含 `.html`
- **选项接入**: `includeFrontmatter`、`includeWikiLinks`、`codeLineNumbers` 三个开关在 `preprocessMarkdown()` 中统一处理

### 后果

**正面**：
- 6 种导出格式全部真实可用，符合 PRD F-09 规格
- `marked.lexer()` 复用已有的 Markdown 解析器，格式映射准确
- 无原生依赖，Web/Desktop 端共享同一导出代码

**负面**：
- `docx` + `xlsx` 合计约 +300KB gzip，主 bundle 从 ~100KB 膨胀到 ~450KB
- 需后续做动态 import() 代码分割

### 替代方案

| 方案 | 评估 |
|------|------|
| HTML→DOCX 转换器 | 格式保真度差，Word 兼容性不可控 |
| Pandoc WASM | WASM 体积 +50MB，加载时间不可接受 |
| Tauri 端调用 Pandoc CLI | 仅 Desktop 可用，Web 端无降级路径 |

---

## ADR-010: CM6 编辑器内容同步 — updateListener 替代 DOM 事件

- **状态**: 已采纳
- **日期**: 2026-06-05

### 背景

MarkdownEditor.vue 原先通过 `view.dom.addEventListener('keyup', syncContent)` 监听用户输入并将内容同步回 Vue（emit update:modelValue）。发现两个严重问题：

1. 中文 IME 输入使用 `insertText` 合成事件，不触发 `keyup`，导致中文内容不保存
2. 外部 `modelValue` 变更通过 `watch` → `view.dispatch()` 注入 CM6 后，`syncContent` 再次 emit 回 Vue，形成反馈环（误标 dirty + 无效保存）

### 决策

**使用 CodeMirror 6 原生的 `EditorView.updateListener` Facet 替代 DOM 事件监听。**

```typescript
EditorView.updateListener.of((update) => {
  if (update.docChanged && !suppressSync) {
    emit('update:modelValue', update.state.doc.toString());
  }
});
```

- `updateListener` 在 CM6 的**每一次状态更新**后触发，覆盖所有输入方式：键盘、IME、粘贴、拖放、撤销/重做、程序化 dispatch
- 引入 `suppressSync` 布尔标志：在 `watch` → `view.dispatch()` 前设为 true，dispatch 完成后恢复 false，切断反馈环
- 保留 `keyup`/`mouseup`/`paste` DOM 监听器作为容错备份（均受 `suppressSync` 保护）

### 后果

**正面**：
- 中文 IME 输入完整保存，切换笔记后不丢失
- 所有输入路径（含撤销/重做/粘贴）统一同步
- 反馈环彻底消除，不再误标 dirty

**负面**：
- `updateListener` 在每个 view update 周期触发，需确保 `syncContent` 轻量（仅读 `doc.toString()` + emit）
- 新增 `suppressSync` 状态变量，需在 `onUnmounted` 中不处理

### 替代方案

| 方案 | 评估 |
|------|------|
| 全部走 `input` DOM 事件 | IME composition 期间的 input 事件数据不完整 |
| 用 `requestAnimationFrame` 轮询 CM6 state | 不必要的 CPU 开销 + 延迟 |

---

## ADR-011: 文字补全系统架构 — 统一幽灵文本管道

- **状态**: 已采纳 ✅ 已实现 (2026-06-09)
- **日期**: 2026-06-07

### 背景

MarkLuck 编辑器需要提供轻量、完全离线、毫秒级响应的文字补全功能。核心设计原则是"无感"——不弹出任何菜单、不下拉任何选择框、不打断用户写作心流。所有补全（文字内容、Markdown 格式语法、Wiki-link、标签、文件路径）必须通过同一条灰色幽灵文本自动预判，用户只需按 Tab 一键接受或继续输入自然覆盖。

### 决策

**采用纯前端 TypeScript 统一幽灵文本管道，零新依赖。**

1. **融合预测架构** — 三个预测源融合输出唯一最佳结果：
   - N-gram 统计表（用户写作习惯）
   - 结构化知识库（IndexStore：笔记名/标签/文件树）
   - 语法上下文感知（代码块/frontmatter 快速短路 + 格式标记未闭合检测）
   
2. **分层架构**：
   - `NGramEngine`（纯算法，零依赖）→ `scan()` / `predict()` / `learn()` / `mergeTables()`
   - `MarkdownPredictor`（服务层）→ `getGhostText()` 融合决策入口 + L1 内存缓存 + L2 localStorage 持久化
   - `GhostTextPlugin`（CM6 ViewPlugin）→ 150ms 防抖 + Decoration.widget 幽灵文本渲染 + Tab keymap
   - **不使用** `@codemirror/autocomplete`（该包专为弹出菜单设计，不符合幽灵文本范式）

3. **融合决策算法**：
   ```
   getGhostText(cursor, doc, indexStore):
     1. isDisabledContext? → return null (代码块/frontmatter)
     2. detectSyntaxContext → wiki-link/tag/file-path/format/general
     3. ngramResult = NGramEngine.predict(ctx, 20, 0.15)
     4. structuredResult = matchStructured(syntaxCtx, indexStore)  // 仅特定上下文触发
     5. return merge(ngramResult, structuredResult)
        → 结构化候选置信度 > 0.8 时优先，否则信任 N-gram
   ```

4. **Tab 键方案**：废除 live preview 的 `toggleBlockRender` Tab 绑定。Ghost text 可见时 Tab 接受补全；无 ghost text 时 Tab 回退到 CM6 默认行为（插入制表符）。Live preview 块固定改为 `Ctrl+Click`。

5. **数据持久化与基准预训练**：
   - L1（当前文档）：内存中完整 4-gram，scanDocument() 瞬时构建，< 50ms
   - L2（全局）：localStorage 紧凑文本格式持久化，< 5MB
   - 基准 L2：构建时生成 `baseline-ngram.v1.compact.txt`（~2500 条预训练 N-gram），首次启动 fetch → localStorage
   - 持久化格式：`ctx(hex)|pred1,cnt1|pred2,cnt2|pred3,cnt3|flag`（flag=b 基准 / u 用户）
   - 末位淘汰：`score = freq × recencyDecay × sourceWeight`，4.5MB 触发淘汰至 3.5MB，每轮最多淘汰 20%
   - 基准条目 sourceWeight=0.5（优先被淘汰），用户条目 sourceWeight=1.0
   - 禁止后台扫描未打开的文件（AV 误报风险）

6. **基准语料来源**：通过 `scripts/train-baseline.ts` 从可迭代语料目录 `scripts/corpus/` 自动训练。仅 P0 格式闭合规则硬编码（Markdown 语法不变）；其他全部语料驱动——用户可随时往 corpus/ 添加 .md 文件并重新训练，无需改代码。构建脚本自动注入项目文档（doc/ + spec/）作为语料源之一。

### 后果

**正面**：
- 完全符合 MarkLuck "无感·真诚·精确"的设计哲学——没有弹窗打断心流
- 代码更简单：少了 `@codemirror/autocomplete` 集成层、少了 3 个 completion-source 文件、少了菜单 UI 状态管理
- 用户体验更流畅：只有一个操作（Tab 接受），零认知负荷
- Web PWA + Tauri Desktop 零差异共享同一套代码
- Bundle 增量 < 5KB gzip

**负面**：
- 无法一次看到多个候选（设计选择：不需要）
- 结构化候选只在特定语法上下文中激活，普通段落中纯依赖 N-gram（冷启动时无预测）
- `Ctrl+Click` 块固定的发现性不如原 Tab 键

### 替代方案

| 方案 | 评估 |
|------|------|
| 弹出菜单（`@codemirror/autocomplete`） | 打断写作心流，违背"无感"设计哲学，已被否决 |
| Rust 马尔可夫链 + Tauri IPC | Web PWA 不可用，IPC 开销抵消 Rust 性能优势，过度设计 |
| AI 大模型 | 违反离线/轻量约束 |

---

## 附录 B：未来可能的 ADR 候选项

以下议题尚未成为正式决策，预计在后续里程碑中讨论：

| 候选 ADR                                      | 涉及模块       | 预计里程碑 |
| --------------------------------------------- | -------------- | :--------: |
| ~~CodeMirror 6 vs Monaco Editor vs Tiptap~~       | ~~块级混合编辑器~~ |  ✅ 已选 CM6 |
| minisearch vs fuse.js vs lunr.js (Web 搜索)   | 全文搜索       |  Phase 2   |
| tantivy vs meilisearch (Tauri 端搜索)         | 全文搜索       |  Phase 4   |
| KaTeX vs MathJax (LaTeX 渲染)                 | Markdown 渲染  |  Phase 1   |
| 暗色模式实现方案 (CSS 变量 vs Tailwind dark:) | 主题系统       |  Phase 5   |
| 国际化框架 (vue-i18n vs 自定义)               | 多语言支持     |  Phase 5   |
| 移动端手势与导航模式                          | 移动端 UX      |  Phase 4   |
| PWA Service Worker 缓存策略                   | Web 离线       |  Phase 1   |

---

> **文档维护规则**：当某个决策被推翻或替换时，不要删除原 ADR，而是在其状态中标注"已废弃"，并添加指向新 ADR 的链接。历史决策的上下文对理解系统演进至关重要。
