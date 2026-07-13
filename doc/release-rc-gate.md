# JotLuck 真实安装包 RC 闸门

从 `0.15.0` RC 起，Web 自动化全绿只能表述为“自动化候选通过”，不能表述为“最终发布通过”。最终发布通过必须额外满足真实安装包 L4。

> **当前状态：fail-closed。** 旧 `jotluck-installed-l4-evidence` v1 只校验自报退出码，并要求证据文件绑定包含自身的新 HEAD，既可伪造又无法形成合法固定点，已永久禁用。`pnpm release:rc-gate` 在独立证据协议 v2 落地前不得输出通用 RC PASS；`--autocomplete-only` 仍保留独立质量闸门。

## 两层 GUI 验收

- Web GUI 烟测: 只用于验证本轮前端交互修复。
- 安装版 L4: 必须基于 `JotLuck_0.15.0_x64-setup.exe` 安装后的真实应用。

## 执行顺序

1. 运行既有自动化: L1/L2/coverage/build/Rust check/test、三引擎 E2E、`tauri:build`。
2. 生成并定位 `JotLuck_0.15.0_x64-setup.exe`。默认路径为 `packages/app/src-tauri/target/release/bundle/nsis/JotLuck_0.15.0_x64-setup.exe`。
3. 复制并填写 [release-installed-l4-template.md](./release-installed-l4-template.md)。
4. 在 L4 记录中粘贴执行前后的 `git status --short`，并填写 `L4-APP-VERSION`、`L4-INSTALLER-PATH`、`L4-INSTALLER-SHA256`。任何未提交/未跟踪文件必须清理、提交或解释。
5. 将候选 commit 冻结后，由只读执行者生成不可变原始报告，再由同一执行者生成结构化二次转录；证据 commit 只能增加受版本管理的普通证据文件，并绑定候选 commit、安装包 SHA256、实际 case 结果和原始报告 SHA。协议 v2 尚未实现，因此当前在此步保持阻断。

`JotLuck_RELEASE_ALLOW_DIRTY=1` 仅作为诊断标记保留，正式 RC gate 仍无条件拒绝脏工作区，不能用它输出 PASS。

协议 v2 的 required cases 必须来自独立固定目录；校验器必须读取每项原始 artifact、复算 SHA 并解析实际执行数、通过数、失败数和 skip 数。命令字符串、退出码或状态文件自报字段不能单独构成 PASS。候选 commit 与证据 commit 必须分离，禁止证据 manifest 自引用当前 HEAD。

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
