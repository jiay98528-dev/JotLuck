<p align="center">
  <a href="./README.md">English</a> · <a href="./README.zh.md">简体中文</a>
</p>

<p align="center">
  <img src="./packages/app/src-tauri/icons/128x128@2x.png" width="112" alt="JotLuck 应用图标">
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
  <a href="https://jotluck.com/zh/"><strong>官方网站</strong></a>
  · <a href="https://jotluck.com/zh/download"><strong>下载</strong></a>
  · <a href="https://github.com/jiay98528-dev/JotLuck/releases">GitHub Releases</a>
  · <a href="#三步开始使用">开始使用</a>
  · <a href="./SUPPORT.md">获得帮助</a>
  · <a href="./PRIVACY.md">隐私政策</a>
  · <a href="./CODE_SIGNING.md">代码签名政策</a>
  · <a href="https://github.com/jiay98528-dev/JotLuck/issues/new/choose">反馈问题</a>
</p>

JotLuck 是一个本地优先的 Windows Markdown 笔记本。
笔记就是你文件夹里的普通文件。不需要账号，没有数据库，内容不上传。

启动只需几秒，Markdown 渲染得干净漂亮。只读预览还是动手编辑，工作区怎么布置，由你决定。

适合所有与文字打交道的人，也适合与 AI 协作的你。

当前源码版本：`v0.12.3-preview`，Windows 公开预览版。经过完整测试，代码签名正在处理中。

> **下载提示：** 官方安装包只会出现在 [GitHub Releases](https://github.com/jiay98528-dev/JotLuck/releases)。`v0.12.3-preview` 安装包已上架，尚未签名——安装前请核对 SHA-256。请勿从其他任何渠道下载 JotLuck。

<p align="center">
  <img src="./packages/app/src/assets/theme-assets/halo-canvas-preview.png" width="100%" alt="JotLuck 工作区，左侧是最近笔记，中间是 Markdown 编辑器，右侧是大纲与反向链接">
  <br>
  <sub>JotLuck 工作区，使用内置 Halo Canvas 主题</sub>
</p>

## 你的笔记始终是你的

每条笔记都是普通文件：`.md`、`.markdown`、`.mdx` 或 `.txt`。任何编辑器都能打开，任何同步工具都能带走。哪怕明天不再使用 JotLuck，你的笔记也已经在该在的地方。

| 你关心的事 | JotLuck 的做法                                 |
| ---------- | ---------------------------------------------- |
| 文件所有权 | 直接读写你选择的本地文件夹，不建私有数据库     |
| 隐私       | 编辑、搜索、补全均可离线运行                   |
| 长期可用   | 开放的纯文本格式，随时交给下一件工具           |
| 写作效率   | 实时预览、双链、反向链接、本地搜索、设备端补全 |
| 交付可信度 | 正式安装包只出现在 GitHub Releases             |

## 三步开始使用

1. **获取应用。** 公开预览版安装包已在 [GitHub Releases](https://github.com/jiay98528-dev/JotLuck/releases) 上架，那是唯一官方来源。开发者可按下方说明从源码构建。
2. **在欢迎页选择文件打开方式。** 默认只建议 Markdown；纯文本、Word、PDF、Excel 均不预选。Windows 只应用你在“默认应用”系统界面中确认的选择。
3. **打开一个文件夹。** 通过“打开笔记本”门页把任意文件夹作为笔记本，`Ctrl/Cmd+O` 可随时切换；笔记直接保存在该文件夹中。

安装器会把 `.md`、`.markdown`、`.mdx`、`.txt`、`.docx`、`.pdf`、`.xlsx` 和 `.xls` 注册为可选“打开方式”。安装和升级都不会替换你在 Windows 中已有的默认应用选择。

## 在 JotLuck 里写作是什么感觉

- **第一秒就就绪。** 双击 Markdown 文件，即刻看到干净的渲染效果。编辑可选，工作区随你布置。
- **文档可带入，但不会被锁住。** `.docx`、`.pdf`、`.xlsx`、`.xls` 以只读 Markdown 语义预览打开；你可以继续用检测到的专业软件编辑原件，也可以另存 Markdown 副本后在 JotLuck 编辑。原文件绝不覆盖。
- **专注的编辑器。** CodeMirror 6、实时预览、块级编辑，键盘优先。
- **彼此认识的笔记。** `[[Wiki-link]]`、别名、反向链接、标签、大纲。
- **什么都找得到。** 本地搜索，支持关键词、正则、标签、日期、文件夹。
- **更快动笔。** 模板支持 `{{date}}` 占位符。粘贴的图片落进 `assets/`，相对路径引用。
- **六种出口。** 导出 PDF、DOCX、XLSX、CSV、TXT、HTML，无缝衔接你现有的工作流。
- **安静的助手。** 离线幽灵文本补全，Tab 采纳。
- **有深度的主题。** 六套随包主题配置，持续更新。在这里，主题改的不只是颜色，而是整个工作区的气质。
- **在 Windows 上很自在。** 原生文件监听、系统对话框、多窗口。基于 Tauri 2。

## 隐私与数据安全

- 笔记保存在你选的文件夹里。
- 不上传，无账号。
- 更新检查可选，且只查询公开的版本信息。
- 删除笔记不会连带删除图片，素材可以被多篇笔记共用。
- 批量操作前，请保留自己的备份。

安全问题请通过 [GitHub 私密安全报告](https://github.com/jiay98528-dev/JotLuck/security/advisories/new) 提交，不要在公开 Issue 中附上私人笔记或真实目录信息。详情见 [安全政策](./SECURITY.md)。

完整披露见 [隐私政策](./PRIVACY.md)；正式 Windows 产物的身份与完整性流程见 [代码签名政策](./CODE_SIGNING.md)。

## 当前发行范围

| 项目         | 当前范围                                                                                   |
| ------------ | ------------------------------------------------------------------------------------------ |
| 当前源码版本 | `v0.12.3-preview`                                                                          |
| 发行阶段     | 公开预览版，未签名；不是稳定版                                                             |
| 候选平台     | Windows x64                                                                                |
| 桌面运行时   | Tauri 2 与 Microsoft Edge WebView2                                                         |
| 可编辑格式   | `.md`、`.markdown`、`.mdx`、`.txt`                                                         |
| 只读导入格式 | `.docx`、`.pdf`、`.xlsx`、`.xls`；提供 Markdown 语义预览，不承诺 Office/PDF 像素级版式复刻 |
| 文件关联     | 八种扩展名均为可选“打开方式”；安装和升级都不替换用户在 Windows 中的默认选择                |
| 许可证       | MIT                                                                                        |

macOS 和 Linux 版本尚未完成对应主机的打包、签名与发行验证。完整边界请阅读 [已知限制](./KNOWN_LIMITATIONS.md) 和每次发布附带的说明。

## 常见问题

<details>
<summary><strong>JotLuck 是免费软件吗？</strong></summary>

核心源代码采用 MIT 协议。可自由使用、查看、修改和分发。

</details>

<details>
<summary><strong>它会把笔记上传到服务器吗？</strong></summary>

不会。笔记、索引和补全数据都留在本机。

</details>

<details>
<summary><strong>如何在多台设备之间同步？</strong></summary>

把笔记本文件夹放进你已经在用的同步工具里：OneDrive、Syncthing、Git，什么都行。

</details>

<details>
<summary><strong>能直接使用已有 Markdown 文件夹吗？</strong></summary>

直接指给它就能开始读。重要资料先备份。

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
- Rust 1.88+，仅桌面开发与打包需要
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
- [隐私政策](./PRIVACY.md)
- [代码签名政策](./CODE_SIGNING.md)
- [贡献指南](./CONTRIBUTING.md)

</details>

## 版权与许可证

JotLuck 源代码采用 [MIT License](./LICENSE)。

Copyright © 2026 鸰湖科技（深圳）有限公司<br>
Linghu Technology (Shenzhen) Co., Ltd.
