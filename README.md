<p align="center">
  <a href="./README.md">简体中文</a> · <a href="./README.en.md">English</a>
</p>

<p align="center">
  <img src="./assets/icons/exports/app-256.png" width="112" alt="JotLuck 应用图标">
</p>

<h1 align="center">JotLuck</h1>

<p align="center">
  <strong>文件就是笔记，文件夹就是笔记本。</strong><br>
  一款轻量、本地优先、离线可用的 Windows Markdown 笔记工具。
</p>

<p align="center">
  <a href="https://github.com/jiay98528-dev/JotLuck/releases"><img src="https://img.shields.io/badge/Windows-x64-2f6f5e?style=flat-square&logo=windows&logoColor=white" alt="Windows x64"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-b06f35?style=flat-square" alt="MIT License"></a>
  <a href="https://github.com/jiay98528-dev/JotLuck/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/jiay98528-dev/JotLuck/ci.yml?branch=main&style=flat-square&label=build" alt="构建状态"></a>
  <img src="https://img.shields.io/badge/data-local%20files-60675f?style=flat-square" alt="数据保存在本地文件">
</p>

<p align="center">
  <a href="https://github.com/jiay98528-dev/JotLuck/releases"><strong>获取 Windows 版</strong></a>
  · <a href="#三步开始使用">开始使用</a>
  · <a href="./SUPPORT.md">获得帮助</a>
  · <a href="https://github.com/jiay98528-dev/JotLuck/issues/new/choose">反馈问题</a>
</p>

> **下载提示：** GitHub Releases 是官方公开安装包的唯一下载入口。若发布页尚无安装包，代表当前没有对外可下载的正式候选。

<p align="center">
  <img src="./packages/app/src/assets/theme-assets/halo-canvas-preview.png" width="100%" alt="JotLuck 工作区，左侧是最近笔记，中间是 Markdown 编辑器，右侧是大纲与反向链接">
  <br>
  <sub>JotLuck 工作区，使用内置 Halo Canvas 主题</sub>
</p>

## 你的笔记始终是你的

JotLuck 不创建专有笔记数据库。每条笔记都是普通的 `.md`、`.markdown`、`.mdx` 或 `.txt` 文件，任何文本编辑器都能打开。你可以用 OneDrive、Git、Syncthing 或自己的备份工具管理它们，离开 JotLuck 时也不需要导出数据。

| 你关心的事 | JotLuck 的做法                                                        |
| ---------- | --------------------------------------------------------------------- |
| 文件所有权 | 直接读写你选择的本地文件夹，不把笔记锁进数据库                        |
| 隐私       | 核心编辑与搜索离线运行，不上传笔记本内容                              |
| 长期可用   | 使用开放的纯文本格式，随时可由其他工具接管                            |
| 写作效率   | 提供实时预览、双链、反向链接、全文搜索和本地补全                      |
| 交付可信度 | Windows 公开包通过 Releases 发布，并明确标注签名状态与 SHA-256 校验值 |

## 三步开始使用

1. 从 [GitHub Releases](https://github.com/jiay98528-dev/JotLuck/releases) 获取官方 Windows x64 安装包。
2. 安装并打开 JotLuck，选择一个已有文件夹，或创建新的笔记本文件夹。
3. 开始写作。笔记会直接保存在该文件夹中，不需要注册账号。

JotLuck 不会强制替换系统默认的 Markdown 或文本编辑器。你也可以在 Windows 的“打开方式”中按需选择它。

## 为本地写作准备的功能

- **纯文本笔记本**：文件夹即笔记本，支持 `.md`、`.markdown`、`.mdx` 和 `.txt`。
- **专注编辑**：CodeMirror 6 编辑器、实时 Markdown 预览、块级编辑和键盘操作。
- **知识关联**：`[[Wiki-link]]`、别名、反向链接、标签与文档大纲。
- **本地检索**：关键词、正则、标签、日期和文件夹筛选。
- **模板与素材**：自定义模板、日期占位符、图片粘贴和相对路径管理。
- **多格式导出**：PDF、DOCX、XLSX、CSV、TXT 和 HTML。
- **离线补全**：补全模型和笔记训练数据保存在本机，不上传笔记内容。
- **原生桌面体验**：Windows 文件监听、系统文件对话框和可选文件关联。

## 隐私与数据安全

- 笔记内容保存在你选择的文件夹中。
- JotLuck 不上传笔记本内容，也不要求云端账号。
- 自动更新检查关闭时，应用不会主动请求 GitHub 版本接口。
- 启用更新检查时，仅查询 GitHub 的公开版本信息，不发送笔记内容。
- 删除笔记不会自动删除可能被多篇笔记共用的图片素材。
- 批量改名、删除或首次使用预览版前，建议保留独立备份或版本历史。

安全问题请通过 [GitHub 私密安全报告](https://github.com/jiay98528-dev/JotLuck/security/advisories/new) 提交，不要在公开 Issue 中附上私人笔记或真实目录信息。详情见 [安全政策](./SECURITY.md)。

## 当前发行范围

| 项目       | 当前范围                                           |
| ---------- | -------------------------------------------------- |
| 发行阶段   | 公开预览版，稳定版放行以 Releases 中的实际说明为准 |
| 已验证平台 | Windows x64                                        |
| 桌面运行时 | Tauri 2 与 Microsoft Edge WebView2                 |
| 数据格式   | `.md`、`.markdown`、`.mdx`、`.txt`                 |
| 许可证     | MIT                                                |

macOS 和 Linux 版本尚未完成对应主机的打包、签名与发行验证。完整边界请阅读 [已知限制](./KNOWN_LIMITATIONS.md) 和每次发布附带的说明。

## 常见问题

<details>
<summary><strong>JotLuck 是免费软件吗？</strong></summary>

JotLuck 核心源代码采用 MIT 协议，可以免费使用、查看、修改和分发。MIT 协议不代表官方必须提供无限期免费支持、签名服务或其他增值内容。

</details>

<details>
<summary><strong>它会把笔记上传到服务器吗？</strong></summary>

不会。核心笔记、索引和离线补全数据保存在本机。只有在你启用或主动触发版本检查、打开外部链接时，应用才会访问相应的网络地址。

</details>

<details>
<summary><strong>如何在多台设备之间同步？</strong></summary>

JotLuck 不绑定同步服务。你可以把笔记本文件夹放入 OneDrive、Syncthing、Git 或其他自己信任的文件同步工具中。

</details>

<details>
<summary><strong>能直接使用已有 Markdown 文件夹吗？</strong></summary>

可以。选择现有文件夹后，JotLuck 会把其中支持的纯文本文件作为笔记读取。首次操作重要资料前，仍建议先保留备份。

</details>

## 帮助与反馈

- 使用问题与排查步骤：[SUPPORT.md](./SUPPORT.md)
- 功能边界：[KNOWN_LIMITATIONS.md](./KNOWN_LIMITATIONS.md)
- 提交缺陷：[Bug report](https://github.com/jiay98528-dev/JotLuck/issues/new?template=bug_report.yml)
- 提交建议：[Feature request](https://github.com/jiay98528-dev/JotLuck/issues/new?template=feature_request.yml)
- 私密安全报告：[Security advisory](https://github.com/jiay98528-dev/JotLuck/security/advisories/new)

<details>
<summary><strong>开发者：本地构建与项目文档</strong></summary>

### 环境要求

- Node.js 20+
- pnpm 9+，仓库当前锁定 pnpm 11.x
- Rust 1.77.2+，仅桌面开发与打包需要
- Windows 上的 Tauri 与 WebView2 构建依赖

### 启动 Web 开发环境

```powershell
pnpm.cmd install
pnpm.cmd --filter @jotluck/app dev
```

### 启动桌面开发环境

```powershell
pnpm.cmd --filter @jotluck/app tauri:dev
```

### 常用检查

```powershell
pnpm.cmd --filter @jotluck/app typecheck
pnpm.cmd --filter @jotluck/app test
pnpm.cmd --filter @jotluck/app build
pnpm.cmd audit --prod --audit-level high
```

正式发行还需要通过安装包级验证、Rust 依赖审计和人工 GUI 旅程，具体规则见 [发行闸门](./doc/release-rc-gate.md)。

项目资料：

- [产品需求](./doc/PRD.md)
- [技术架构](./doc/TAD.md)
- [版本记录](./CHANGELOG.md)
- [发行说明](./RELEASE_NOTES.md)
- [安全政策](./SECURITY.md)
- [贡献指南](./CONTRIBUTING.md)

</details>

## 版权与许可证

JotLuck 源代码采用 [MIT License](./LICENSE)。

Copyright © 2026 鸰湖科技（深圳）有限公司<br>
Linghu Technology (Shenzhen) Co., Ltd.
