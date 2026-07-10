# JotLuck 真实安装包 RC 闸门

从 `0.15.0` RC 起，Web 自动化全绿只能表述为“自动化候选通过”，不能表述为“最终发布通过”。最终发布通过必须额外满足真实安装包 L4。

## 两层 GUI 验收

- Web GUI 烟测: 只用于验证本轮前端交互修复。
- 安装版 L4: 必须基于 `JotLuck_0.15.0_x64-setup.exe` 安装后的真实应用。

## 执行顺序

1. 运行既有自动化: L1/L2/coverage/build/Rust check/test、三引擎 E2E、`tauri:build`。
2. 生成并定位 `JotLuck_0.15.0_x64-setup.exe`。默认路径为 `packages/app/src-tauri/target/release/bundle/nsis/JotLuck_0.15.0_x64-setup.exe`。
3. 复制并填写 [release-installed-l4-template.md](./release-installed-l4-template.md)。
4. 在 L4 记录中粘贴执行前后的 `git status --short`，并填写 `L4-APP-VERSION`、`L4-INSTALLER-PATH`、`L4-INSTALLER-SHA256`。任何未提交/未跟踪文件必须清理、提交或解释。
5. 运行 `pnpm release:rc-gate`。默认要求工作区干净、安装包存在、L4 记录完整、版本匹配、路径匹配、SHA256 重新计算一致，且 `L4-CONCLUSION: PASS`。

如必须临时审计脏工作区，可设置 `JotLuck_RELEASE_ALLOW_DIRTY=1`，但正式放行前仍必须回到干净工作区。

## 安装版 L4 必测路径

- 安装 -> 启动 -> 新建笔记 -> 编辑 -> 自动保存 -> 重启应用 -> 验证内容 -> 删除。
- 打开真实本地文件夹 -> 展开子目录 -> 打开 `.md/.markdown/.mdx/.txt` -> 编辑保存 -> 用外部编辑器回读。
- 双击外部 `.md/.markdown/.mdx` -> 只读预览 -> 启用编辑 -> 保存当前文件，不扫描父目录。
- 搜索 -> 点击结果 -> 编辑命中笔记。
- Live Preview 点击渲染块 -> 编辑 -> Escape/失焦恢复。
- 设置/主题/补全开关 -> 重启后验证持久化或即时生效。
- 导出至少 TXT/DOCX/XLSX 中一种，并打开文件验证内容相关。
- 图片上传或拖放 -> Markdown 路径正确 -> assets 写入 -> 文件抽屉不把 assets 当笔记入口。
- 卸载 -> 验证安装目录、`.md/.markdown/.mdx` 文件关联、OpenWith 残留和图标残留。

## Rust Audit

安装版 L4 记录必须包含以下二选一:

- 本机 `pnpm audit:rust` 或 `cargo audit` 通过输出。
- CI job URL、commit、通过时间和通过状态。

本机 `cargo-audit` 未安装或安装失败时，不能口头声称 Rust audit 已通过；只能引用已通过的 CI job 作为证据。

## 阻断标准

- 任一安装版 L4 项失败时按 P0/P1/P2 记录，不允许用 Web E2E、coverage 或 build 通过覆盖人工失败。
- `pnpm release:rc-gate` 失败时，当前结论必须保持为“Web 自动化通过，等待安装包 L4 复核”。
- 只有安装版 L4 全部 PASS，且闸门脚本 PASS，才能称为“最终发布通过”。
