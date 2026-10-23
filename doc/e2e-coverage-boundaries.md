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
