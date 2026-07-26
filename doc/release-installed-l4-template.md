# JotLuck 安装版 L4 人工验收记录模板

版本：2026-07-27（installed-app evidence v2）

> 复制本模板为单次发行记录，例如 `验收报告/2026-07-25-JotLuck-0.1.0-preview-installed-L4.md`。
> 所有 `状态` 必须填写 `PASS`，否则 `pnpm release:rc-gate` 必须阻断 RC 放行。任何失败项标记为 P0/P1/P2，不允许用 Web 自动化通过覆盖人工失败。
>
> **协议状态：本模板仅用于人工记录，不构成机器 PASS。** 文末 v1 JSON 示例是历史迁移参考，不能再被 `release:rc-gate` 接受。正式放行必须把本记录转换为已实现的“候选 commit → 只读原始报告 → 同执行者结构化二次转录 → 证据 commit”v2 证据链，并由校验器复算。

> **v2 证据要求**：每项 case 必须链接受版本管理的原始产物，并记录实际 passed/failed/skipped 计数、退出码、时间、产物 SHA256 与候选 commit；只读执行者的原始报告和同一执行者的结构化二次转录必须互相校验。命令文本、截图路径或自报 PASS 不能单独构成通过。
>
> required cases 和 case/raw/transcript/manifest 严格 JSON Schema 位于 `spec/release/`；证据目录固定为 `release-evidence/installed-app/v2/<release-id>/`。安装器与 execution evidence 必须来自同一个 GitHub Actions candidate run；gate 先通过 REST 核验 provenance，再下载并与受管证据逐文件对账。

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

### L4-03-EXTERNAL-FILE-GRANT

- 操作: 分别双击外部 `.md/.markdown/.mdx/.txt` -> 只读预览 -> 启用编辑 -> 保存当前文件 -> 确认不扫描父目录、不出现跨文件 workspace UI；再点击“添加到笔记”并确认只有此时父目录成为 notebook。
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

- 操作: 卸载 -> 验证安装目录、`.md/.markdown/.mdx/.txt` 可选文件关联、OpenWith 残留和图标残留；安装前后的系统默认应用必须一致，其他应用的 OpenWithList 槽位及 `MRUList` 相对顺序必须保持。
- 可观测结果:
- 证据路径/截图:
- 状态: TODO
- 失败级别:

## L4-EVIDENCE

- L4-EVIDENCE-MANIFEST: `TODO — 填写 release-evidence/installed-app/v2/<release-id>/manifest.json；缺失时闸门必须失败`

协议 v2 落地后，机器清单必须绑定独立的候选 commit、受版本管理的原始执行产物、逐 case 结果、安装包 SHA、只读审计原始报告及其结构化二次转录。禁止复制旧 v1 JSON 或只填写命令退出码。

- GitHub repository / workflow run ID / run attempt / candidate head SHA:
- candidate artifact ID / fixed name / API digest:
- execution evidence artifact ID / fixed name / API digest:
- candidate / execution artifact API size、materialization job/step:
- 每 case 固定 adapter / `execution-log.ndjson` / required artifact kinds:
- RF-10 20 次冷启动 / 30 次热开窗原始样本、复算 P90、advisory（超过参考线为非阻断警告；缺样本仍失败）:

- 截图目录:
- 验证用本地文件夹:
- 外部编辑器回读文件:
- 导出文件:
- 卸载残留检查记录:
- 原始执行报告（受版本管理）:
- 结构化二次转录（受版本管理）:
- 候选 commit:
- 证据 commit:
- 每 case 实际 counters / exit code / 时间 / artifact SHA256:
- Preview gate：V2S Worker/factory/候选资产在生产依赖图、bundle、安装包中不可达的报告:

## 结论

- L4-CONCLUSION: TODO
- 放行判断: 安装版 L4 全部 PASS 前不得称为“最终发布通过”。

## 变更记录

- 2026-07-27：增加 materialization 来源绑定和 RF-10 原始性能样本/advisory 记录；参考线超标不再单独阻断。
- 2026-07-26：增加 GitHub REST provenance、同 run 双 artifact、固定 adapter/execution log 和卸载 MRU 保序记录。
- 2026-07-25：模板升级为 installed-app evidence v2，增加原始产物、二次转录、counter/hash/commit 链及 `0.1.0-preview` V2S 不可达证据字段。
