# Frontend Components

版本：2026-06-27

## 布局主链

- `AppShell`
- `LeftWing`
- `TopBar`
- `EditorControlStrip`
- `StatusBar`
- `RightWing`
- `ThemeSlotBoundary`

## 主题插槽约束

- Shell、主页、编辑器表面、文件抽屉、命令面板、导出/模板/设置/分享/新建/删除/外部编辑/草稿退出弹窗、toast、更新提示和 Markdown 速查表都必须通过 `ThemeSlotBoundary` 暴露。
- `ThemeSlotBoundary` 渲染优先级为插件组件 > `UxComponentRecipe` DSL > 宿主默认组件。
- 所有 slot 都必须传入明确 `slotProps`，并保留默认 slot，使主题可以选择完全替换或包裹宿主 UI。
- `ThemeHostContext` 向主题插件提供 action、slot、editor、dialog、toast、storage、commerce 和只读 appState API。

## 交互要求

- 主题入口位于 TopBar，打开主题中心。
- 主题中心必须显示本地市场、已安装、导入、商业状态和开发者信息。
- 不提供宿主级明暗切换；多 scheme 只能由单个主题 manifest 自行声明。
- 切换主题不得打断当前编辑、搜索、导出、外部单文件会话或草稿流程。
