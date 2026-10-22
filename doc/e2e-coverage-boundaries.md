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
