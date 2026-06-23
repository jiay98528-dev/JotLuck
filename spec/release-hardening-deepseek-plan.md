# MarkLuck 发布前打磨计划（tool 执行版）

> 日期：2026-06-23  
> 目标：把 MarkLuck 从“功能基本成熟”打磨到“可以彻底发行”的发布候选状态。  
> 使用方式：每次只把一个里程碑交给 tool 执行。tool 到达该里程碑验收点后必须停止，由用户转交 tool 验收。tool 验收通过后，用户再让 tool 继续下一里程碑。

---

## 0. 当前基线判断

当前项目不是功能原型阶段，而是发布前收口阶段。已知基线：

- Web 主流程已可用：编辑、保存、搜索、Wiki-link、模板、导出、主题、图片上传、离线补全均已有实现。
- 最近一次验证通过：
  - `pnpm.cmd --filter @markluck/app typecheck`
  - `pnpm.cmd exec eslint packages/app/src packages/renderer/src`
  - `pnpm.cmd exec prettier --check ...`
  - `pnpm.cmd --filter @markluck/app lint:style`
  - `pnpm.cmd --filter @markluck/app exec vitest run`
  - `pnpm.cmd --filter @markluck/app build`
  - `15-autocomplete-journey` Chromium / Firefox 单 worker 通过
  - `09-wiki-link` Chromium 单 worker 通过
- 已知风险：
  - Playwright 并行运行时可能出现状态污染或端口竞争，不等于产品功能失败，但发布前必须稳定测试策略。
  - `NotebookHome` 构建 chunk 偏大，当前是警告，不是阻断，但需要评估是否低风险优化。
  - CodeMirror、IME、文件 IO、可变默认状态、E2E 假设是历史高风险区。
  - Tauri 真实文件系统、WebKit、全量 E2E、真实安装包流程仍需发布级验证。

---

## 1. tool 全局执行协议

### 1.1 必须遵守

1. 每次只执行用户指定的一个里程碑，例如“执行 M-R1”。不得自动进入下一个里程碑。
2. 到达该里程碑的“停止验收点”后必须停止，输出报告，等待用户让 tool 验收。
3. 开始任何代码修改前必须阅读：
   - `AGENTS.md`
   - `memory/bug_log.md`
   - 本文件
   - 与本里程碑相关的现有测试和实现文件
4. 任何 BUG 修复必须先完成真/假 BUG 判定：
   - 能复现、能定位代码/数据流根因、属于当前发布范围，才算真 BUG。
   - 如果是环境缺失、浏览器能力边界、未来功能，不要硬修，记录为阻塞或 DEFERRED。
5. 所有修改必须小步提交到工作区，禁止大面积“顺手清理”。
6. 修改测试时不得降低断言强度。禁止用以下方式伪造通过：
   - 删除核心断言
   - 增加无意义超长 timeout
   - `test.skip` / `test.fixme` / 条件跳过
   - 只断言元素存在，不验证行为结果
   - 把真实失败改成“环境问题”但没有证据
7. 修改产品代码时必须增加或更新对应测试。没有可自动化测试时，必须写明手动 GUI 验收步骤和观察证据。
8. 如果同一个问题连续两轮修复仍失败，立即停止，不得扩大改动面。
9. Windows PowerShell 下统一使用 `pnpm.cmd`，避免 `pnpm.ps1` 执行策略失败。
10. Playwright 不要多个命令并行跑同一端口。E2E 发布验证优先使用单命令、单 worker 或明确隔离的稳定脚本。

### 1.2 禁止事项

- 禁止改技术栈：不得引入 React / Svelte / SQLite / IndexedDB 存笔记 / PDF 生成库。
- 禁止改产品原则：笔记内容仍是本地 Markdown 文件，补全仍是单一 ghost text，默认离线。
- 禁止无理由新增依赖。新增依赖必须说明发布收益、体积影响、替代方案和回退方案。
- 禁止重写 `NotebookHome.vue`、编辑器插件、文件系统服务等核心模块。只能做局部修复。
- 禁止把生成物当成源码提交，除非里程碑明确要求：
  - `e2e/report/index.html`
  - `test-results/`
  - 临时截图、视频、日志
- 禁止修改用户未授权的系统目录。操作范围限定在 `D:\VibeCoding\MarkLuck`。
- 禁止执行破坏性命令：`git reset --hard`、强制 checkout、递归删除、force push。

### 1.3 高风险代码规则

#### 状态和默认对象

- 默认状态对象如果包含 `Record` / `Array` / `Map`，不得浅拷贝后写入。
- 必须使用工厂函数创建运行态副本，例如 `createDefaultState()`。
- 修改 localStorage key、默认设置、持久化 schema 时必须加兼容测试。

#### CodeMirror / IME

- composition 期间不得直接 dispatch 破坏输入法事务。
- 修改 editor update listener、widget、Decoration、selection 后必须覆盖中文 IME 或 Firefox 场景。
- Task checkbox、Wiki-link、Live Preview 等 widget 内交互应优先在捕获阶段完成文档写回。

#### 文件 IO

- 图片/附件必须验证三件事：
  - 写入的是二进制/base64 数据，不是 data URL 文本。
  - Markdown 相对路径从当前笔记所在目录出发正确。
  - 文件树或真实文件系统能看到 assets 文件。
- 保存逻辑必须捕获 path 快照，不能在异步回调里动态读取已变化的 `activePath`。
- 大文件、assets、二进制文件必须跳过索引/训练。

#### UI / 可访问性

- 不得出现 button 嵌套 button。
- Dialog 必须有 `role="dialog"`、可关闭、焦点不丢失。
- 右键菜单、抽屉、浮层必须有可退出路径。
- 样式不得绕过 token 体系新增大量硬编码色值。

---

## 2. 里程碑停止协议

每个里程碑结束时，tool 必须：

1. 停止后续执行。
2. 输出本里程碑报告。
3. 把报告追加到 `memory/release-hardening-execution-log.md`。
4. 报告必须包含：
   - 执行的里程碑编号
   - 修改文件列表
   - 真 BUG / 假 BUG / 环境阻塞列表
   - 每个 BUG 的根因和修复
   - 执行过的命令和结果
   - 未通过项及原因
   - 是否需要 tool 验收
5. 最后一行必须写：

```text
M-Rx 已到达停止验收点，等待 tool 验收。不得继续执行下一里程碑。
```

如果没有达到验收点，也必须停止并写：

```text
M-Rx 未达到验收点，原因：...
```

---

## 3. 发布完成定义

只有全部条件满足，才允许进入最终发布：

- L1 全绿：
  - `pnpm.cmd --filter @markluck/app typecheck`
  - `pnpm.cmd exec eslint packages/app/src packages/renderer/src`
  - `pnpm.cmd exec prettier --check packages/app/src packages/renderer/src e2e spec memory`
  - `pnpm.cmd --filter @markluck/app lint:style`
- L2 全绿：
  - `pnpm.cmd --filter @markluck/app exec vitest run`
- Web build 通过：
  - `pnpm.cmd --filter @markluck/app build`
- E2E 发布矩阵通过：
  - Chromium 全量稳定套件通过
  - Firefox 全量稳定套件通过
  - WebKit 通过；如果本机 WebKit 不可用，必须有明确环境阻塞证据
- GUI 用户旅程通过：
  - 新建、编辑、保存、刷新、删除
  - 文件抽屉、搜索、Wiki-link、反链、大纲、标签
  - Live Preview、任务 checkbox、格式工具栏、IME
  - 模板、自定义模板、图片上传、导出、设置、主题、离线补全
- Tauri 桌面端通过：
  - 开发模式或 debug build 可启动
  - 真实文件系统笔记本可打开/保存/监控
  - 打包流程可执行；代码签名缺失可作为发布说明阻塞项
- 安全和依赖检查通过：
  - 高危依赖漏洞为 0，或有明确不可修复说明
  - XSS 套件通过
  - 无意外网络访问
- 发布文档完整：
  - README / CHANGELOG / release notes / known limitations / install instructions 更新
- `spec/progress.md` 与实际状态一致。

---

## 4. 里程碑计划

### M-R0：基线冻结与执行环境确认

目标：确认 tool 开始执行时的工作区、依赖、测试命令和当前失败面，避免在脏状态上盲修。

允许修改：

- 默认不修改代码。
- 只允许新增或更新 `memory/release-hardening-execution-log.md`。

必须执行：

1. `git status --short --branch`
2. `git log --oneline -5`
3. `pnpm.cmd --filter @markluck/app typecheck`
4. `pnpm.cmd exec eslint packages/app/src packages/renderer/src`
5. `pnpm.cmd --filter @markluck/app lint:style`
6. `pnpm.cmd --filter @markluck/app exec vitest run`
7. `pnpm.cmd --filter @markluck/app build`
8. 记录是否存在用户或 tool 未提交改动。不得覆盖这些改动。

验收标准：

- 能明确说明当前基线是否可继续。
- 如有失败，能区分环境失败、已有真实 BUG、测试参数错误。
- 没有改产品代码。

停止验收点：

- 写入 `memory/release-hardening-execution-log.md`。
- 停止，等待 tool 验收。

---

### M-R1：E2E 稳定性与测试隔离收口

目标：把发布验证从“人工知道怎么跑”变成“脚本化、稳定、不可误判”的 E2E 流程。

问题背景：

- 多个 Playwright 命令并行跑同一个 dev server 端口会污染结果。
- 当前配置 `fullyParallel: true`，部分测试可能共享 MockFS/localStorage/页面状态。
- 发布前需要一个稳定脚本，而不是依赖人工记忆“单 worker 顺序跑”。

允许修改：

- `packages/app/playwright.config.ts`
- `packages/app/package.json`
- `e2e/helpers/**`
- 仅当测试隔离需要时，修改具体 e2e 测试文件。

禁止：

- 禁止删除失败测试。
- 禁止把真实用户旅程改成只检查页面加载。
- 禁止通过无限增加 timeout 掩盖状态污染。

建议任务：

1. 增加发布级稳定 E2E 脚本，例如：
   - `test:e2e:stable`
   - `test:e2e:chromium`
   - `test:e2e:firefox`
   - `test:e2e:webkit`
2. 明确发布验证使用 `--workers=1` 或确保每个测试具备完整隔离。
3. 检查 `e2e/helpers/test-utils.ts`：
   - 每个测试开始前清理 localStorage/sessionStorage。
   - MockFS 初始数据可重复。
   - 不依赖上一个测试创建的文件。
4. 对仍需要并行的测试，使用独立测试数据命名，避免同名笔记互相覆盖。
5. 保留 Playwright 报告，但不要提交生成的 `e2e/report/index.html` 变化。

验收命令：

```powershell
pnpm.cmd --filter @markluck/app exec playwright test --project=chromium --workers=1
pnpm.cmd --filter @markluck/app exec playwright test --project=firefox --workers=1
```

WebKit：

```powershell
pnpm.cmd --filter @markluck/app exec playwright test --project=webkit --workers=1
```

如果 WebKit 缺浏览器或系统依赖，记录环境阻塞，不要修改产品代码绕过。

验收标准：

- Chromium 全量 E2E 稳定通过。
- Firefox 全量 E2E 稳定通过，或仅剩有明确根因的真实 BUG。
- WebKit 通过或被明确标记为环境阻塞。
- 新增/修改的脚本在 README 或执行日志中说明。

停止验收点：

- E2E 稳定性报告写入执行日志。
- 停止，等待 tool 验收。

---

### M-R2：Web 核心用户旅程补洞

目标：确保每个核心功能至少有一条完整用户旅程测试，符合 V6“多步骤端到端闭环”。

覆盖清单：

1. 新建笔记 → 编辑 → 自动保存 → 刷新 → 验证 → 删除
2. 文件抽屉 → 展开子目录 → 打开文件 → 编辑 → 保存
3. 搜索 → 查看结果 → 点击跳转 → 编辑命中笔记
4. Live Preview → 点击块 → 编辑 → ESC/失焦 → 预览恢复
5. 右键菜单 → 重命名 → 验证 → 删除 → 验证不存在
6. 导出 → 选格式 → 改选项 → 导出 → 验证内容相关
7. 错误恢复 → 注入保存失败 → 显示错误 → 恢复 → 保存成功
8. 模板 → 新建内置模板 → 自定义模板 → 删除自定义模板
9. 图片上传 → 粘贴/拖放/文件对象模拟 → assets 写入 → Markdown 路径正确
10. Wiki-link → 死链/活链样式 → 新建目标后状态刷新 → 反链更新
11. 任务 checkbox → 点击 → Markdown 源码写回 → 刷新仍保持
12. 离线补全 → ghost text 出现 → Tab 接受 → 设置关闭即时消失
13. 主题/设置 → 切换 → 刷新持久化
14. 中文 IME → 输入标题/正文/标点 → 不吞字符 → Live Preview 恢复

允许修改：

- `e2e/tests/**`
- `e2e/helpers/**`
- 与真实 BUG 根因直接相关的产品文件

禁止：

- 禁止新增只覆盖 happy path 的浅测试来冒充完整旅程。
- 禁止只测试 `.isVisible()`，每条旅程至少验证两个结果指标。
- 禁止让测试依赖测试执行顺序。

验收命令：

```powershell
pnpm.cmd --filter @markluck/app exec playwright test --project=chromium --workers=1
pnpm.cmd --filter @markluck/app exec playwright test --project=firefox --workers=1
pnpm.cmd --filter @markluck/app exec vitest run
```

验收标准：

- 覆盖清单 14 项均有自动化或明确手动验证步骤。
- Chromium 全量通过。
- Firefox 全量通过，或有明确环境/浏览器能力边界说明。
- 任何新增真实 BUG 已记录到 `memory/bug_log.md`。

停止验收点：

- 用户旅程覆盖矩阵写入执行日志。
- 停止，等待 tool 验收。

---

### M-R3：跨浏览器、响应式、可访问性和视觉回归

目标：证明软件在桌面常用浏览器、窄屏、键盘操作和视觉层级上达到发布质量。

允许修改：

- 样式和 UI 相关文件。
- 可访问性属性。
- 必要的 E2E/截图辅助。

额外约束：

- 涉及 UI 控件样式、布局或新增组件时，必须先在报告中写出设计意图和影响范围，再编码。
- 禁止引入大面积视觉重构。
- 禁止新增一套颜色系统或绕过 token。

必须验证：

1. 视口：
   - 360x740
   - 768x1024
   - 1280x800
   - 1440x900
2. 页面状态：
   - 初始页
   - 编辑器含长文档
   - 设置页
   - 搜索面板
   - 模板对话框
   - 导出对话框
3. 交互：
   - Tab 键焦点路径
   - Escape 关闭浮层
   - 右键菜单可退出
   - 设置开关可被屏幕阅读器识别为 switch/checkbox
4. 视觉：
   - 无横向溢出
   - 无文字重叠
   - 按钮文字不溢出
   - 模态框在小屏可滚动
   - 暗色主题对比度可读

建议命令：

```powershell
pnpm.cmd --filter @markluck/app exec playwright test --project=chromium --workers=1
pnpm.cmd --filter @markluck/app exec playwright test --project=firefox --workers=1
pnpm.cmd --filter @markluck/app lint:style
```

如项目已有截图工具，可补关键截图；否则在执行日志中给出手动 GUI 检查步骤和截图路径。

验收标准：

- Chromium/Firefox 中无发布阻断级视觉或可访问性问题。
- 小屏不遮挡核心编辑、保存、设置、导出入口。
- 任何 UI 修复都有对应截图或 E2E 证据。

停止验收点：

- 响应式/可访问性/视觉验收表写入执行日志。
- 停止，等待 tool 验收。

---

### M-R4：Tauri 桌面端和真实文件系统闭环

目标：证明 MarkLuck 作为本地优先桌面笔记工具，在真实文件系统下可发行。

允许修改：

- `packages/app/src/services/TauriIPCService.ts`
- `packages/app/src-tauri/**`
- 与真实 FS bug 直接相关的前端调用层
- Tauri 配置和打包元数据

禁止：

- 禁止用 MockFS 行为掩盖 Tauri 真实文件系统失败。
- 禁止把真实文件系统失败改为静默忽略。
- 禁止写死绝对路径。

必须验证：

1. Tauri dev 启动：

```powershell
pnpm.cmd --filter @markluck/app tauri:dev
```

2. Tauri build 或 debug build：

```powershell
pnpm.cmd --filter @markluck/app tauri:build:debug
```

如 release build 因签名/平台依赖失败，记录阻塞。

3. 真实笔记本手动闭环：
   - 打开本地文件夹。
   - 新建 `.md`。
   - 编辑并保存。
   - 关闭应用再打开，内容仍存在。
   - 粘贴图片，确认真实 `assets/` 文件存在且不是 data URL 文本。
   - 重命名文件，Wiki-link / 文件树刷新。
   - 删除文件，确认 UI 和磁盘一致。
   - 外部编辑器修改文件，MarkLuck 文件监控刷新。
   - 导出 docx/txt/html/md/xlsx/csv 中至少 3 种，并验证内容与源 Markdown 相关。

4. 大笔记本压力样本：
   - 至少 100 个 Markdown/text 文件。
   - 至少 1 个 >512KB 文件。
   - 至少 1 个 assets 子目录。
   - 确认索引/补全训练跳过超大文件和 assets。

验收标准：

- Tauri debug build 通过，或明确环境阻塞。
- 真实文件系统用户闭环通过。
- 文件监控无明显重复事件风暴或 UI 卡死。
- 所有真实 FS bug 记录到 `memory/bug_log.md`。

停止验收点：

- 桌面端验证报告写入执行日志。
- 停止，等待 tool 验收。

---

### M-R5：安全、依赖、性能与体积收口

目标：发布前确认没有高危依赖、明显 XSS 缺口、意外联网或不可接受的首屏性能问题。

允许修改：

- 依赖版本。
- 构建配置。
- 低风险懒加载。
- XSS/安全相关代码。

禁止：

- 禁止为了消除 warning 做大规模架构拆分。
- 禁止引入更重的替代库。
- 禁止关闭 DOMPurify 或绕过清洗。

必须执行：

```powershell
pnpm.cmd audit --audit-level high
pnpm.cmd --filter @markluck/app exec vitest run
pnpm.cmd --filter @markluck/app build
```

Rust 依赖：

```powershell
cargo audit
```

如果未安装 `cargo-audit`，记录环境阻塞；不得安装全局工具，除非用户明确授权。

检查项：

1. XSS：
   - `<script>`
   - `onerror`
   - `javascript:`
   - HTML 实体编码绕过
   - Wiki-link/tag 属性注入
2. 依赖：
   - 高危漏洞为 0，或明确不可修复原因。
3. 体积：
   - 记录当前 build 输出。
   - `NotebookHome` chunk warning 如果仍存在，需要判断：
     - 是否影响首屏实际体验。
     - 是否能通过低风险懒加载对话框/非首屏面板改善。
   - 只有在收益明确且 E2E 能覆盖时才做拆分。
4. 网络：
   - 离线补全不得访问网络。
   - 应用启动不得向外部服务发送笔记内容。

验收标准：

- 高危漏洞无阻断。
- XSS 测试通过。
- 构建通过。
- 体积 warning 有处理或有明确发布接受理由。

停止验收点：

- 安全/依赖/性能报告写入执行日志。
- 停止，等待 tool 验收。

---

### M-R6：发布文档、版本信息和用户可交付物

目标：把工程状态转成用户可以理解、可以安装、可以回退的发布材料。

允许修改：

- `README.md`
- `CHANGELOG.md`
- `spec/progress.md`
- `doc/**`
- `package.json` / Tauri version 字段（仅版本号）
- 发布说明文档

禁止：

- 禁止在未通过前面里程碑时宣称“稳定版”。
- 禁止把未验证功能写成已验证。
- 禁止删除历史限制说明。

必须补齐：

1. 版本号：
   - Web package 版本。
   - Tauri app 版本。
   - CHANGELOG 版本段。
2. README：
   - 项目定位。
   - 本地优先/离线原则。
   - 安装和运行。
   - Web 与 Desktop 能力差异。
   - 已知限制。
3. Release notes：
   - 新增功能。
   - 修复项。
   - 已知问题。
   - 验证矩阵。
4. `spec/progress.md`：
   - 更新 M-R 发布收口状态。
   - 不得伪造 commit hash。
   - 不得把未验收项标记为完成。
5. 用户数据安全说明：
   - 笔记存在本地文件夹。
   - 不上传内容。
   - 图片写入 `assets/`。
   - 删除/覆盖行为说明。

验收标准：

- 文档与实际能力一致。
- 没有“将来会支持”的承诺冒充当前功能。
- 用户可按 README 跑起 Web 版或桌面版。

停止验收点：

- 发布文档报告写入执行日志。
- 停止，等待 tool 验收。

---

### M-R7：最终发布候选冻结

目标：生成最终 RC 验收包，冻结范围，等待 tool 最终审计和用户发布确认。

允许修改：

- 只允许修复最终检查中发现的阻断问题。
- 只允许更新最终报告。

禁止：

- 禁止新增功能。
- 禁止重构。
- 禁止清理“看起来不优雅”的代码。
- 禁止继续优化非阻断体验问题。

必须执行完整闸门：

```powershell
pnpm.cmd --filter @markluck/app typecheck
pnpm.cmd exec eslint packages/app/src packages/renderer/src
pnpm.cmd exec prettier --check packages/app/src packages/renderer/src e2e spec memory README.md CHANGELOG.md
pnpm.cmd --filter @markluck/app lint:style
pnpm.cmd --filter @markluck/app exec vitest run
pnpm.cmd --filter @markluck/app build
pnpm.cmd --filter @markluck/app exec playwright test --project=chromium --workers=1
pnpm.cmd --filter @markluck/app exec playwright test --project=firefox --workers=1
pnpm.cmd --filter @markluck/app exec playwright test --project=webkit --workers=1
pnpm.cmd audit --audit-level high
```

Tauri：

```powershell
pnpm.cmd --filter @markluck/app tauri:build:debug
```

如果 WebKit、cargo audit、Tauri build 因环境不可用失败，必须记录为“环境阻塞”，并提供：

- 命令
- 错误摘要
- 为什么判断为环境问题
- 需要用户提供什么环境或权限

最终报告必须包含：

- Git 状态。
- 修改文件列表。
- 验证矩阵。
- 未解决问题列表。
- 发布阻断项列表。
- 非阻断已知限制列表。
- 是否建议发布。

验收标准：

- 没有 P0/P1 阻断。
- 所有可运行自动化通过。
- 环境阻塞项清晰、具体、可复现。
- 最终报告足够让 tool 进行独立验收。

停止验收点：

- 写入 `memory/release-candidate-final-report.md`。
- 停止。
- 最后一行必须写：

```text
M-R7 已到达最终停止验收点，等待 tool 最终发布审计。不得继续修改。
```

---

## 5. 推荐给 tool 的提示词模板

每次只发送一个里程碑，格式如下：

```text
你是 MarkLuck 发布前打磨执行代理。请严格阅读并遵守：
- AGENTS.md
- memory/bug_log.md
- spec/release-hardening-tool-plan.md

本次只执行 M-Rx，不得执行后续里程碑。

硬约束：
1. 到达 M-Rx 停止验收点后必须停止。
2. 不得跳过失败测试，不得降低断言，不得使用 test.skip/test.fixme 伪造通过。
3. 每个真 BUG 必须定位根因、最小修复、补测试、记录到 memory/bug_log.md。
4. 执行报告必须追加到 memory/release-hardening-execution-log.md。
5. 若同一问题两轮修复仍失败，立即停止并报告。

请开始执行 M-Rx。
```

---

## 6. tool 验收关注点

用户把 tool 的结果交给 tool 验收时，tool 优先检查：

1. 是否越过指定里程碑继续执行。
2. 是否修改了不在允许范围内的文件。
3. 是否用测试弱化、跳过、扩大 timeout 掩盖失败。
4. 是否触碰历史高风险区：
   - 默认状态对象浅拷贝
   - IME composition
   - CodeMirror widget
   - 文件保存路径快照
   - Tauri 真实 FS
5. 是否有完整命令证据。
6. 是否有生成物噪音混入 diff。
7. 是否将环境阻塞误报为功能通过。

验收失败时，tool 只修复当前里程碑内的阻断问题，不继续执行 tool 后续计划。
