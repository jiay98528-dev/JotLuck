# Frontend Design System

版本：2026-07-11

## 基线

- 默认视觉系统为 `paper` / 羽翼布局。
- 主题系统必须支持 `ThemeManifest v2` 驱动的本地市场、`.mltheme` 导入、安装、预览、启用、卸载和回退。
- 主题 token 必须限定在 `[data-theme-id="<id>"]` 作用域内；代码主题注入样式也必须带主题 scope。
- 主题可以通过 `ThemeSlotBoundary` 接管 Shell、主页、编辑器表面、弹窗和状态层 UX，但不应把核心写作流程变成商业化入口。

## 样式来源

- `packages/app/src/assets/styles/tokens.css`
- `packages/app/src/assets/styles/themes/paper.css`
- `packages/app/src/assets/styles/themes/theme-layouts.css`
- 主题包 manifest 与 scoped CSS

## 间距合同

- 布局以 4px 为主栅格：`--space-0/4/8/12/16/20/24/32/40/48/64/80/96/120`。
- 紧凑控件、图标与描边对齐允许使用 2px 微调档：`--space-2/6/10/14/18/22/28/36`；这不是第二套布局栅格，不能用来替代页面级节奏。
- `--space-3`、`--space-9` 不属于合同。原先的孤立用法应分别归一为 `--space-4`、`--space-8`。
- 未定义的 CSS custom property 会使引用它的整个声明失效；例如一个无效的 `padding` 会退回 reset 后的零内边距。因此任何 `var(--space-*)` 都必须由 `tokens.css` 明确定义。
- `pnpm.cmd lint:tokens` 是间距合同的静态闸门，扫描 CSS、Vue SFC 和官方主题模块内的 CSS 字符串。新的 spacing token 或引用必须同时更新 token 定义、文档和测试。

## 运行时属性

- `data-theme-id`
- `data-active-theme-id`
- `data-theme-runtime`
- `data-layout-preset`
- `data-chrome-topbar`
- `data-chrome-left-wing`
- `data-chrome-right-wing`
- `data-chrome-toolbar`
- `data-chrome-drawer`
- `data-chrome-reading`
- `data-topbar-layout`
- `data-left-wing-layout`
- `data-editor-control-layout`
- `data-status-layout`
- `data-right-wing-policy`
- `data-workspace-intent`

## 视觉原则

- 背景使用暖纸面而非纯白。
- 控件层级通过纸面、边框、阴影和留白区分。
- 主题中心是产品 UI：状态清晰、按钮一致、错误可恢复、空状态说明下一步。
- 商业状态只作为主题卡片和详情区元信息，不在启动、保存、编辑过程中打断用户。

### Halo Canvas 官方主题细化契约

- 环境层是低色度银雾，不叠加多层全屏彩雾；蓝紫与珊瑚只能出现在 glass chrome 的局部折射伪层。
- 材质高度固定为三档：环境无阴影；chrome 使用轻浮起、透光、内侧高光与 16px blur；工具分组只使用浅内凹；正文画布使用最强但克制的接触与扩散阴影。
- 几何约束：控件 10px、分组 14px、主面板 20px、浮层 24px；仅 chip 可使用全圆角。导航主文本 14/20，辅助信息 12/16，顶栏标题 14/18。
- 响应式优先级：721–900px 保留 56px 右侧检查器窄轨并通过本地、可键盘访问的控件展开为 264px；≤480px 隐藏常驻两翼，正文和现有文件抽屉入口优先。

## 禁止项

- 新增宿主级明暗切换。
- 用硬编码 theme id 分支替代 manifest、recipe 或 slot。
- 未加主题 scope 的全局配色覆盖。
- 启动弹窗式付费提示或保存时商业化打断。

## 变更记录

- 2026-07-11：确立 Halo Canvas 的中性银雾环境、三档玻璃材质高度、10/14/20/24px 几何和 768/360 响应式优先级契约。
- 2026-07-10：补齐 4px 主栅格所需的 2px 控件微调档，并把 spacing custom property 校验纳入构建前静态闸门。
