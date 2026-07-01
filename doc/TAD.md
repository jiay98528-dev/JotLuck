# MarkLuck TAD

版本：2026-06-27

## UX Theme Runtime v2

- 主题系统的规范源是 `doc/standards-theme-development.md`。TAD 只描述架构方向；具体 Manifest 字段、`.mltheme` 包结构、slot 清单、slot props、Host API、CSS 作用域和商业化接口以主题开发标准为准。
- `ThemeRegistry` 聚合官方模块、本地市场 catalog 与已安装 `.mltheme` 包。
- `ThemeManifest v2` 声明 runtime、capabilities、permissions、entrypoints、slots、assets、checksums、minAppVersion 和商业化预留字段。
- `useThemeStore` 管理运行态、安装包态和商业授权态：`activeThemeId`、`previewThemeId`、`installedThemes`、`entitlements`、安装、导入、卸载、启用、预览、回退和持久化。
- `ThemeSlotBoundary` 是统一 UX 插槽边界，渲染优先级固定为：插件组件 > 声明式 DSL recipe > 宿主默认组件。
- `ThemeRuntimeHost` 加载 `official-code` 和本地 `trusted-code` 插件，并向插件提供 `ThemeHostContext`。P0 阶段本地插件全权限运行，不做授权审批或沙箱隔离；公开 RC 只在导入入口做可信来源确认和实验功能披露，不改变 Theme API v2 的全 UX 插件能力。
- `ThemeCommerceProvider` 预留真实后端契约：`GET /v1/themes/catalog`、`GET /v1/themes/entitlements`、`POST /v1/themes/checkout`、`POST /v1/themes/licenses/redeem`、`POST /v1/themes/entitlements/refresh`。默认实现为本地 mock。

## 总体结构

```text
Vue 3 + Pinia + Vite
  ├─ AppShell / NotebookHome / ThemeSlotBoundary
  ├─ MarkdownEditor / Live Preview / Search / Export
  ├─ ThemeRegistry / ThemeRuntimeHost / ThemePackInstaller
  ├─ useThemeStore / ThemeCommerceProvider
  └─ MockFS / Tauri FS adapters
```

## 主题数据流

1. `NotebookHome` 挂载时调用 `theme.init()`。
2. `useThemeStore` 读取 registry、local market、installed packages 和持久化 active theme。
3. `ThemeChromeState` 由当前 rendered theme 的 `ShellRecipe` 推导。
4. `AppShell` 和 `NotebookHome` 通过 `ThemeSlotBoundary` 暴露 Shell、编辑器、弹窗、toast、更新提示等 UX slot。
5. `ThemeRuntimeHost` 注册当前主题插件组件，切换主题时卸载旧插件并触发 runtime version 更新。
6. 主题 CSS 注入到 active style，主题作者必须使用 `[data-theme-id="<id>"]` 作用域。

## 边界

- 主题可以接管 MarkLuck Shell 级 UX 与主要弹窗入口。
- 主题开发必须遵守 `doc/standards-theme-development.md`；不得新增未文档化 slot、Host API、Manifest 字段或宿主层 theme-id 特判。
- 主题不得直接替换 Markdown 清洗、文件 IO、搜索索引、导出服务或系统 API；这些能力通过宿主 action/API 间接触发。
- 商业化当前只提供接口和 mock 状态，不做真实支付、远程下载、账号体系或社区审核。
