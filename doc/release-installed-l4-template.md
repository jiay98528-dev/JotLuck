# JotLuck 安装版 L4 人工验收记录模板

> 复制本模板为单次发行记录，例如 `验收报告/2026-06-30-JotLuck-0.15.0-installed-L4.md`。
> 所有 `状态` 必须填写 `PASS`，否则 `pnpm release:rc-gate` 必须阻断 RC 放行。任何失败项标记为 P0/P1/P2，不允许用 Web 自动化通过覆盖人工失败。

## 发行对象

- L4-INSTALLER-PATH:
- L4-INSTALLER-SHA256:
- L4-APP-VERSION:
- 安装时间:
- L4-WINDOWS-VERSION:
- 验收人:
- 验收结论: Web 自动化通过，安装版 L4 未完成前只能称为“自动化候选通过”。

## 工作区状态

- L4-GIT-BEFORE:

```text
粘贴执行前 git status --short 输出；干净时写 (clean)。
```

- L4-GIT-AFTER:

```text
粘贴执行后 git status --short 输出；干净时写 (clean)。任何未提交/未跟踪文件必须解释、清理或提交。
```

## 自动化与 Rust Audit

- L1/L2/coverage/build:
- 三引擎 E2E:
- tauri:build:
- L4-RUST-AUDIT:

```text
粘贴本机 pnpm audit:rust / cargo audit 通过结果；或写明 CI job URL、commit、通过时间。
```

## 安装版 L4 路径

### L4-01-INSTALL-START-CRUD

- 操作: 安装 -> 启动 -> 新建笔记 -> 编辑 -> 自动保存 -> 重启应用 -> 验证内容 -> 删除。
- 可观测结果:
- 证据路径/截图:
- 状态: TODO
- 失败级别:

### L4-02-REAL-FOLDER

- 操作: 打开真实本地文件夹 -> 展开子目录 -> 打开 `.md/.markdown/.mdx/.txt` -> 编辑保存 -> 用外部编辑器回读。
- 可观测结果:
- 证据路径/截图:
- 状态: TODO
- 失败级别:

### L4-03-EXTERNAL-FILE

- 操作: 双击外部 `.md/.markdown/.mdx` -> 只读预览 -> 启用编辑 -> 保存当前文件 -> 确认不扫描父目录。
- 可观测结果:
- 证据路径/截图:
- 状态: TODO
- 失败级别:

### L4-04-SEARCH-EDIT

- 操作: 搜索 -> 点击结果 -> 编辑命中笔记。
- 可观测结果:
- 证据路径/截图:
- 状态: TODO
- 失败级别:

### L4-05-LIVE-PREVIEW

- 操作: Live Preview 点击渲染块 -> 编辑 -> Escape/失焦恢复。
- 可观测结果:
- 证据路径/截图:
- 状态: TODO
- 失败级别:

### L4-06-SETTINGS-PERSISTENCE

- 操作: 设置/主题/补全开关 -> 重启后验证持久化或即时生效。
- 可观测结果:
- 证据路径/截图:
- 状态: TODO
- 失败级别:

### L4-07-EXPORT-READBACK

- 操作: 导出至少 TXT/DOCX/XLSX 中一种 -> 打开导出文件 -> 验证内容与源 Markdown 相关。
- 可观测结果:
- 证据路径/截图:
- 状态: TODO
- 失败级别:

### L4-08-IMAGE-ASSETS

- 操作: 图片上传或拖放 -> Markdown 路径正确 -> assets 写入 -> 文件抽屉不把 assets 当笔记入口。
- 可观测结果:
- 证据路径/截图:
- 状态: TODO
- 失败级别:

### L4-09-UNINSTALL-CLEANUP

- 操作: 卸载 -> 验证安装目录、`.md/.markdown/.mdx` 文件关联、OpenWith 残留和图标残留。
- 可观测结果:
- 证据路径/截图:
- 状态: TODO
- 失败级别:

## L4-EVIDENCE

- 截图目录:
- 验证用本地文件夹:
- 外部编辑器回读文件:
- 导出文件:
- 卸载残留检查记录:

## 结论

- L4-CONCLUSION: TODO
- 放行判断: 安装版 L4 全部 PASS 前不得称为“最终发布通过”。
