# JotLuck 真实安装包 RC 闸门

版本：2026-07-27

从 `v0.10.0-rc.1` 起，Web 自动化全绿只能表述为“自动化候选通过”，不能表述为“最终发布通过”。最终发布通过必须额外满足真实安装包 L4。历史报告中的旧版本号保持历史事实，不作迁移。

> **当前状态：fail-closed。** 旧 `jotluck-installed-l4-evidence` v1 只校验自报退出码，并要求证据文件绑定包含自身的新 HEAD，既可伪造又无法形成合法固定点，已永久禁用。协议 v2 已收紧为 GitHub Actions 固定执行与 REST provenance；其嵌套 WebDriver v2、旧 ASSOC launch trace、旧 RF-10 lifecycle 产物也已永久失效，必须分别使用 WebDriver v3、ASSOC v2 和 RF-10 v2。当前尚无同源正式 capture/evidence commit；`pnpm release:rc-gate` 还会被 V2S architecture-stop 以 code 10 阻断，`--autocomplete-only` 仍保留独立质量闸门。

## 两层 GUI 验收

- Web GUI 烟测: 只用于验证本轮前端交互修复。
- 安装版 L4: 必须基于 `JotLuck_0.10.0-rc.1_x64-setup.exe` 安装后的真实应用。

## 执行顺序

1. 运行既有自动化: L1/L2/coverage/build/Rust check/test、三引擎 E2E、`tauri:build`。
2. 生成并定位 `JotLuck_0.10.0-rc.1_x64-setup.exe`。默认路径为 `packages/app/src-tauri/target/release/bundle/nsis/JotLuck_0.10.0-rc.1_x64-setup.exe`。
3. 复制并填写 [release-installed-l4-template.md](./release-installed-l4-template.md)。
4. 在 L4 记录中粘贴执行前后的 `git status --short`，并填写 `L4-APP-VERSION`、`L4-INSTALLER-PATH`、`L4-INSTALLER-SHA256`。任何未提交/未跟踪文件必须清理、提交或解释。
5. 将候选 commit 冻结并推送到 `main`，以 `workflow_dispatch + capture_installed_evidence` 运行完整 CI。capture job 只有在 L1、Vitest、Rust、三引擎 E2E、Windows 视觉、Tauri build/smoke 全部成功后，才从同一 run 的候选 artifact 安装并执行固定 adapter；任一 case 失败、skip、缺执行日志或观察产物时不上传 evidence artifact。
6. 同一 run 的 materialization job 先经 REST resolver 核验来源，再按已核验 ID 下载 candidate/execution artifact。materializer 逐文件对账并生成 transcript、manifest、构建 inventory 和 `preview-gate.json`，上传的 managed bundle 只供后续证据提交；本地输出仅是结构诊断。
7. 证据 commit 只能新增 `release-evidence/installed-app/v2/<release-id>/`。raw report、case results 与附件必须和可信 execution artifact 逐文件一致；manifest 绑定 repository、run/attempt、两个固定 artifact 的 ID/name/API digest/size、materialization job/step、安装器和 required-case tree。
8. 最终 gate 必须从 provenance 绑定的 candidate artifact 中精确解析唯一 `jotluck.exe`，通过 `JOTLUCK_CANDIDATE_APPLICATION_PATH` 传入并独立复算 bytes/SHA-256；manifest、ASSOC 和 RF-10 只能引用该结果，不能以 capture 自报 metadata 代替。

`JotLuck_RELEASE_ALLOW_DIRTY=1` 仅作为诊断标记保留，正式 RC gate 仍无条件拒绝脏工作区，不能用它输出 PASS。

协议 v2 的 required cases 必须来自独立固定目录；catalog 为每项固定 `adapter` 与 `requiredArtifactKinds`。每个 case 必须包含可解析的 `execution-log.ndjson`，日志按序绑定 adapter 开始、每个观察产物的路径/字节数/SHA256 和结束 counters。命令字符串、退出码、非空占位 JSON 或状态文件自报字段不能单独构成 PASS。候选 commit 与证据 commit 必须分离，禁止证据 manifest 自引用当前 HEAD。

固定目录为 `spec/release/required-cases/`，严格 case/raw/transcript/manifest Schema 位于 `spec/release/schemas/`。正式 gate 在下载前通过 GitHub REST 验证 repository、固定 workflow、`workflow_dispatch`、`main`、`head_sha`、run attempt、run/job/step conclusion，以及两个 artifact 的同 run 身份、固定名称、未过期、非空和 API digest；缺 token、网络/限流/非 200 或字段缺失不得降级。API 核验后才能把 artifact ID 交给下载动作。

`v0.10.0-rc.1` 还必须有独立 preview gate：Public L3 的 architecture-stop / fail-closed 可接受，但执行记录必须证明生产依赖图、Vite/Tauri bundle 与安装包均不存在 V2S Worker、factory、候选 manifest、候选二进制或自动加载路径。候选 workflow 必须把安装器、桌面 EXE 与真实 `dist` 一起作为同一不可变 artifact 上传；gate 会逐文件枚举下载后的 `dist`、复算字节数与 SHA256，并要求受管 inventory 精确覆盖，漏列文件也会失败。仅“未运行 V2S”或测试注入路径不能构成该证明。

性能参考线不再单独阻断 preview：RF-10 必须以版本化 lifecycle 保存 packaged/installed EXE 身份、20 次冷启动和 30 次运行中新窗口的全部原始时长，并记录每次进程/窗口边界；capture 与 verifier 共同复算 P90。冷启动超过 2 秒或热开窗超过 1 秒时返回 `pass-with-warnings` 和固定 advisory code；缺样本、数量错误、非正数、P90/advisory 不可复算、身份或证据不守恒仍是硬失败。

## 安装版 L4 必测路径

- 安装 -> 启动 -> 新建笔记 -> 编辑 -> 自动保存 -> 重启应用 -> 验证内容 -> 删除。
- 打开真实本地文件夹 -> 展开子目录 -> 打开 `.md/.markdown/.mdx/.txt` -> 编辑保存 -> 用外部编辑器回读。
- 双击外部 `.md/.markdown/.mdx/.txt` -> 只读预览 -> 启用编辑 -> 保存当前文件，不扫描父目录；另验证“添加到笔记”才创建工作区服务。
- 搜索 -> 点击结果 -> 编辑命中笔记。
- Live Preview 点击渲染块 -> 编辑 -> Escape/失焦恢复。
- 设置/主题/补全开关 -> 重启后验证持久化或即时生效。
- 导出至少 TXT/DOCX/XLSX 中一种，并打开文件验证内容相关。
- 图片上传或拖放 -> Markdown 路径正确 -> assets 写入 -> 文件抽屉不把 assets 当笔记入口。
- 卸载 -> 验证安装目录、`.md/.markdown/.mdx/.txt` 可选文件关联、OpenWith 残留和图标残留；安装前后的系统默认应用必须一致。

## Rust Audit

安装版 L4 记录必须包含以下二选一:

- 本机 `pnpm audit:rust` 或 `cargo audit` 通过输出。
- CI job URL、commit、通过时间和通过状态。

本机 `cargo-audit` 未安装或安装失败时，不能口头声称 Rust audit 已通过；只能引用已通过的 CI job 作为证据。

## 阻断标准

- 任一安装版 L4 项失败时按 P0/P1/P2 记录，不允许用 Web E2E、coverage 或 build 通过覆盖人工失败。
- `pnpm release:rc-gate` 失败时，当前结论必须保持为“Web 自动化通过，等待安装包 L4 复核”。
- 只有安装版 L4 全部 PASS，且闸门脚本 PASS，才能称为“最终发布通过”。

## 变更记录

- 2026-07-27：WebDriver 子协议升级为 v3 handshake 状态机；ASSOC/RF-10 升级为严格版本化观察对象；最终 gate 独立重哈希 provenance-bound `jotluck.exe`。旧嵌套产物全部失效。
- 2026-07-27：补齐 REST resolver → 固定 ID 下载 → materializer → managed bundle 链；2 秒/1 秒性能参考线改为非阻断 advisory，样本与证据完整性不降级。
- 2026-07-26：协议 v2 收紧为固定 adapter/非空观察产物/execution NDJSON，并以 GitHub Actions REST provenance 绑定同一候选 run 的安装器与 execution evidence；删除 preview gate 的手写 audit/test/build 成功 JSON。
- 2026-07-25：升级为 `v0.10.0-rc.1` gate，新增 Public L3 stop 但 V2S 生产不可达的独立证明，以及四扩展名/外部授权提升的安装版验证。
