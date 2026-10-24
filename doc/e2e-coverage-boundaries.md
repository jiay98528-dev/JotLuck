# E2E 覆盖边界说明（L9 处置记录）

- 落盘日期：2026-10-22。
- 对象：F-19「Windows 文档导入」（`doc/\PRD.md` §Windows 文档导入要求）在**浏览器级 e2e（Playwright + MockFS）**下的覆盖缺口定性——技术边界而非缺陷。

## 缺口定性

F-19 的完整链路（DOCX/PDF/Excel → 隔离只读预览 → 启动编辑双选项 → 另存 Markdown 副本）依赖三个浏览器级 e2e 技术上承载不了的原生设施：

1. **隐藏转换工作进程**：导入解析由受资源限制的隐藏工作进程执行（全局最多两个低优先级进程，取消/关窗须硬终止并清理临时数据，见 PRD F-19 资源边界）。浏览器级 e2e 没有侧车进程的生成、资源限额与硬终止观测面。
2. **原生另存对话框**：「另存 Markdown 副本」必须弹出 OS 原生保存对话框（默认 `<原文件名>.md`、强制 `.md`、资产目录 `-2/-3` 递增）。Playwright 运行在浏览器上下文，无法驱动原生文件对话框。
3. **Windows 文件关联**：从文件关联/「打开方式」进入 `document-import-readonly` 会话属于 F-20 安装器注册的 Shell 能力（ProgID/`OpenWithProgids`/`UserChoice`），浏览器级 e2e 无注册表与 Shell 观测面。

因此该链路**不在浏览器级 e2e 补测**：不是测试遗漏，而是工具边界。

## 真环境链路的既有覆盖

链路由 **安装版应用证据管线**（真环境、真进程、真对话框）覆盖：

- `e2e/tauri/installed-app-evidence-adapters.mjs:58`：适配器注册表登记 `document-import-save-as-markdown`。
- `e2e/tauri/installed-app-evidence-adapters.mjs:1310`：`documentImportSaveAsMarkdown` 适配器本体，断言链为——真实 DOCX fixture（含图片与 marker）经**只读 reader 会话**打开 → `document-edit-button` 进入编辑 → `.document-edit-dialog__choices` **双选项**确认 → footer 确认触发**原生另存对话框**（`completeNativeSaveDialog`）→ 另存产物回到 JotLuck 编辑器且含 marker → **源 DOCX SHA-256/字节前后不变** → 另存 Markdown 含 marker 与 `.assets` 伴随资产目录（非空图片资产）。
- `scripts/release/capture-installed-app-evidence-v2.mjs`：按 `spec/release/required-cases/installed-app-v2.json` 案例目录逐适配器采集证据（`document-import-save-as-markdown` 在必跑清单内，`:87`）。

## 残余缺口（发布证据管线增强项，非缺陷）

- `document-import-save-as-markdown` 类 evidence 适配器目前仅覆盖 **DOCX** fixture；**PDF / Excel（xlsx/xls）** 的导入→另存链路只有 `association-pdf` / `association-xlsx` / `association-xls`（文件关联注册验证），没有同规格的导入转换+另存证据适配器。
- 处置：列为发布证据管线的**增强项**（为 PDF/Excel 各补一个 evidence 适配器，复用 `documentImportSaveAsMarkdown` 的 fixture→reader→双选项→原生另存→不变性断言骨架），不阻塞当前发布，不计入 e2e 缺陷台账。

## 追加处置记录（2026-10-23，链接交互修复线 W4 低危收尾）

修复线矩阵排查中定性的三条低危残留项处置如下（不改动上文 F-19 定性）：

### 1. 文档导入资产图在笔记本/改稿链路——边界闭合，无新修复

- 链路事实：转换期资产图以 `jotluck-asset://` 引用，仅存在于真实 Tauri 会话（`ExternalReaderPage` 经 `read_document_conversion_asset` 换装 blob:）；「另存 Markdown 副本」时由 Rust 侧 `save_converted_document_as`（`packages/app/src-tauri/src/document_import.rs`）把引用重写为 `<名>.assets/` 相对路径并落盘。
- 处置：转换→另存前段同属上文 F-19 三原生设施边界（隐藏工作进程/原生对话框），浏览器级 e2e 不补测；另存后的相对路径图在笔记本侧走 `usePreviewImageResolver` readBinary 链路（含单测），改稿侧 W2 已把 `resolveImageSrc` 等 props 下沉 `ReviewWorkbench`——两侧按普通本地图渲染，既有覆盖足够。**标注闭合**。

### 2. XLSX 单元格 URL 转义可点性——转换压平边界，增强项

- 事实：`convert_spreadsheet` 只导出单元格缓存值，`format_spreadsheet_cell` 经 `escape_markdown` 转义（含 `.` 与括号），表格单元格中的 URL 是转义纯文本、不构成 markdown 链接（裸 URL 自动链接也被转义阻断）；xlsx 单元格超链接关系（worksheet rels）不进入转换产物。
- 处置：与 `spreadsheet-layout-flattened` 的压平定性一致，列为**转换增强项**（读取单元格 hyperlink rels 并升级为 `[文本](url)`），不计缺陷、不阻塞发布。

### 3. Word 书签锚点——W1 归一承接文本形态；位置书签为转换增强项

- 事实：转换白名单 `is_safe_link_target`（document_import.rs）只放行 https/http/mailto/`#` 前缀目标；Word 内部书签链接（`w:anchor`，无 `#` 形态）在转换期即降级为纯文字，不产生 `[x](#锚点)`。
- 处置：渲染端点击查找已由 W1 `heading-anchor` 三形态归一（原文 / `heading-原文` / `headingIdFromText`）承接——凡以 `#标题文本` 形态进入 Markdown 的锚点均可点击滚动，**该子集标注闭合**；`_TocNNN` 位置书签无对应标题 id，属**转换层增强项**（把书签链接改写为所在标题文本锚点，W1 归一即可直接消费），不阻塞发布。

## 追加处置记录（2026-10-24，静态 debug 报告「记录不修」项 L6/L7/L8）

修复线静态 debug 报告复核确认成立、但本批**记录不修**的三条残留项处置如下（不影响上文各节定性）。

### L6 · on_navigation 导航白名单宽于「应用自身源」口径（低危）

- 事实：`packages/app/src-tauri/src/lib.rs` `allows_webview_navigation` 放行 scheme ∈ {http, https, tauri} ∧ host ∈ {tauri.localhost, localhost} 的**任意端口**组合——较 `build_window` 注释宣称的「只放行应用自身源」更宽（https+localhost 组合在口径内确无用途；dev 为 http://localhost:5173，Win/macOS 生产为 tauri.localhost）。任意端口系被 `webview_navigation_guard_allows_only_app_origins` 测试显式锁定的有意行为（注释明写「端口任意」），与 build_window 旧注释自相矛盾——本批已顺手消歧该注释（补「localhost 任意端口：Linux 生产源端口不定+dev server」）。
- 不修理由：(1) 兜底非首道防线——on_navigation 之前有前端三层点击拦截（NotebookHome 静态预览 / ReviewWorkbench 左栏 / cm6-live-preview live 视图），触发兜底需绕过全部前端拦截的导航向量且本机恰有恶意 localhost 服务监听，利用前提苛刻；(2) 修复非低风险顺手——端口收窄可能弄坏 Linux 生产窗口加载（其生产源也是 localhost 但端口未在仓库内固定记录，本机无法验证收窄安全性），「至少收窄端口」在 Linux 生产源端口未知时不成立。
- 后续若修：最小安全步是剔除 https+localhost 组合并同步改 `lib.rs` 导航守卫测试，但需 Linux 实测窗口加载配合。

### L7 · 外部会话读类命令无会话世代门（安全加固备忘）

- 事实：`fs_ops.rs` 读类命令（read_external_markdown_file / read_external_note_file / read_external_note_file_snapshot / read_external_note_asset）仅做 assert_external_owner + grant 过期/能力/范围校验，无会话世代门；写类命令才有 assert_external_edit。新资产通道 resolve_asset 确将读面扩至 grant 根全目录位图（含子目录）。
- 不修理由：这是被测试钉住的**有意存量语义**——`promoted_grant_never_becomes_a_sibling_write_backdoor` 显式断言升级笔记本后旧 token 目录级读取放行，`commit_prepared_notebook_promotion` 设计上仅撤写保留读。本地单用户威胁模型下：grant 窗口隔离 + 30 分钟闲置过期（每次使用续期）+ 读面限于用户主动打开的目录 + 位图白名单 + 5MB 上限兜底，危险方向（写）已有会话门。加读类世代门需改 4 条 IPC 命令契约并破坏「升级后可读」既有设计。
- 加固备忘（后续安全线候选）：模式切换时撤读能力；或资产读取不再续期 grant。

### L8 · DOCX 导入警告按 rels 全集而非正文引用集（纯提示性）

- 事实：`document_import.rs` 转换警告遍历 `document.hyperlinks` 全集，该字段由 docx-rs 按 rels 的 HYPERLINK_TYPE 全量填充，与正文是否引用无关——孤儿 rels、仅存在于被丢弃页眉/页脚中的链接都会触发 scheme 警告误报。渲染层实际过滤在 `find_docx_hyperlink_target`，Markdown 产物不受影响，仅警告文案可能多列 scheme。
- 不修理由：精确修法需在正文遍历中记录被引用的 rId 并把警告发射移到块循环之后，属转换 worker 生产路径的结构性改动，对纯提示性问题不成比例。
- 后续若修：未来触碰 convert_docx 时顺带做「正文引用集 ∩ rels 全集」交集即可。

## 追加处置记录（2026-10-24，Flash 评审 17 项发现处置批「记录不修」项 L1/L3）

静态评审 17 项发现经复核裁决：四条确认项与低危 L2/L4-L13 已修复；本节记录两条**记录不修**项（与上文 2026-10-23 批记录的 L6/L8 同主题，本批为独立复核口径的补充与再确认，不推翻既有定性）。

### L1 · DOCX 导入链接警告按 rels 全集发射且表格归因失真（纯信息性）

- 事实（复核确认，较 2026-10-23 批 L8 更深一层）：`document_import.rs` 遍历 `document.hyperlinks` 全量过滤 `!is_safe_link_target` 发射 `docx-unsupported-link`；经查 docx-rs 0.4.22 源码（`src/reader/read_docx.rs` HYPERLINK_TYPE 条目装配），hyperlinks 由 document.xml.rels **全量填充、与正文是否引用无关**——孤立 rels 条目（如遗留 ftp:/file: 关系）会在零条可见链接被降级的情况下触发警告，确为误报路径。**表格归因失真亦属实**：`render_docx_table` 只走 `collect_docx_plain_text`，表格内一切链接（含 https）均拍平为纯文本，警告文案「unsupported schemes were flattened」以方案为唯一归因不完全准确。
- 不修理由：纯信息性警告面，无数据损害（渲染层实际过滤在 `find_docx_hyperlink_target`，Markdown 产物不受影响）。正确修法需渲染期跟踪实际遇到的 unsafe scheme（类似 `referenced_assets` 先例），且表格/脚注路径不走 `render_docx_value`、需专门设计，还要改动现有断言 rels 全量上下文的测试（`document_import.rs` 断言 `context == "file, ftp"` 的用例）——非低风险顺手改。
- 后续若修：与 2026-10-23 批 L8 的「正文引用集 ∩ rels 全集」交集方案合并实施，表格/脚注路径单独补渲染期 scheme 跟踪。

### L3 · on_navigation localhost 任意端口口径（兜底守卫的已知权衡）

- 事实（复核确认，与 2026-10-23 批 L6 同一守卫）：`lib.rs` `allows_webview_navigation` 放行任意端口的 http/https/tauri + tauri.localhost|localhost。但与该批评定「宽于注释口径」不同，本批复核认定**代码与文档一致**：`build_window` 注释与 `webview_navigation_guard_allows_only_app_origins` 测试（明示「Linux 生产源与 Vite 开发服务器（端口任意）都在 localhost 上」并断言 localhost:5173 放行）均已显式记录并锁定任意端口口径，非超注释用途。
- 不可收窄论证：Linux 生产源端口动态、dev server 由 Vite 分配，二者均无法静态枚举；运行时门控也只能覆盖 Windows/macOS 生产态（Linux 生产态必须保留任意端口 localhost）。收窄属对「前端已拦截、此处仅深度兜底」守卫的边际加固，且需改动锁定该行为的既有测试——不可低风险收窄。
- 已知残余面（接受并记录）：本机恶意进程占据 localhost 端口时，WebView 可导航至该源——作为兜底守卫的已知权衡，与 L6 批记录的利用前提苛刻定性一致（需先绕过全部前端点击拦截）。
