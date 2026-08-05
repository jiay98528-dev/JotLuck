# JotLuck 验证体系标准（L1–L4 + 发布收口专项）

> 版本：v1.0 ｜ 日期：2026-08-04 ｜ 自 `AGENTS.md` v1.0 §5.7 / §5.0.0.2 / §5.0.0.3 / 附录 C 整体迁入，内容不变，仅更新交叉引用。
> 触发条件：执行任一验证层、编写 E2E、里程碑末审计/复审、发布收口验收前，必须先读本文档对应章节。
> 行为总则（自动推进、错题本、强约束、自检清单）仍在 `AGENTS.md` §五。

## 五层验证体系总览

> 设计原则：最大化 AI 自动验证覆盖，将人工复审压缩到仅剩主观判断项。

```
L1 ⚡ 写时检查     ~10s    每次保存         tsc + eslint + prettier
L2 🧪 组件测试     ~30s    每次提交前       vitest + @vue/test-utils + 快照
L3 🔗 集成测试     ~3min   每次提交/CI      Playwright E2E + XSS套件
   ├─ L3-S1 像素对比  每次提交前       toHaveScreenshot() 自动对比
   ├─ L3-S2 AI视觉分析 里程碑末/UI重构  MCP bailian-vision analyze_image
   └─ L3-S3 手动辅助   L4人工复审时     AI 辅助截图对比
L3.5 🔍 独立审计   ~3min   每个里程碑末     Subagent 四维审计（打破信息茧房）
L4 🔷 人工复审     ~10min  每个里程碑末     手感 / 视觉 / 触控 / 文档可读性
```

---

## L1 ⚡ 写时检查（每次保存触发）

| 检查项          | 命令                                                            | 通过标准                        |
| --------------- | --------------------------------------------------------------- | ------------------------------- |
| TypeScript 类型 | `npx vue-tsc --noEmit`                                          | 零错误                          |
| ESLint          | `npx eslint packages/app/src/ packages/renderer/src/`           | 零警告                          |
| Prettier        | `npx prettier --check packages/app/src/ packages/renderer/src/` | 格式一致                        |
| Stylelint       | `npx stylelint "packages/app/src/**/*.{vue,css}"`               | 零错误（强制 OKLCH Token 检查） |

**不通过 → 立即修复。禁止跳过 L1 直接声称"完成"。**

---

## L2 🧪 组件测试（每次提交前触发）

| 检查项   | 命令                        | 通过标准       |
| -------- | --------------------------- | -------------- |
| 单元测试 | `npx vitest run`            | 全量 PASS      |
| 覆盖率   | `npx vitest run --coverage` | 核心模块 ≥ 80% |

**测试策略**：

- **Composables 优先测试**（纯函数，无 DOM，速度最快）— `useMarkdown`、`useSearch`、`useFileSystem` 等
- **Pinia Stores** — 用 `createTestingPinia()` 隔离测试状态变更
- **Vue 组件** — 用 `@vue/test-utils` 挂载 + `toMatchSnapshot()` 快照测试渲染输出
- **Markdown 渲染管线** — 脱离 Vue 直接测 `marked + DOMPurify` 管道（更快更精确）

---

## L3 🔗 集成测试（CI 自动运行）

**触发条件**：L1 + L2 全部通过后，CI 自动执行。

**Playwright E2E 测试**（Web 构建）：

- 关键用户流程自动化测试
- 三引擎并行：Chromium / Firefox / WebKit
- 网络节流 + 离线模式模拟

**V-Rules（JotLuck 适配版）**：

> 来源：TeachFlow V1-V5 测试规则，裁剪适配为 JotLuck 版本
> 更新：2026-06-08 新增 V6 用户旅程完整性规则

| 规则   | 名称           | 要求                                                         | 反模式                       |
| ------ | -------------- | ------------------------------------------------------------ | ---------------------------- |
| **V1** | 交互正确性     | 验证交互后的**结果**（至少两个结果指标）                     | 仅断言 `element.isVisible()` |
| **V2** | 文件操作验证   | 文件写入后**读取验证内容**，文件删除后**确认不存在**         | 仅确认操作无报错             |
| **V3** | 跨会话持久化   | **6步**：写入 → 导航离开 → 返回 → 验证 → 刷新 → 再验证       | 单程 `goto away → goto back` |
| **V4** | 内容正确性     | 导出/渲染后的内容**必须与源 Markdown 相关**                  | 仅验证"页面不崩溃"           |
| **V5** | 按钮完整性     | 每个 `<button>` 必须**点击并验证可观测结果**                 | 仅验证按钮存在               |
| **V6** | 用户旅程完整性 | 每个核心功能必须有**≥1 个多步骤端到端测试**（≥4 步用户操作） | 仅测试孤立交互，无完整工作流 |

**V6 用户旅程标准模式**（≥4 步真实用户操作链）：

```typescript
// 示例：新建笔记 → 编辑 → 保存 → 删除 完整闭环
// Step 1: 触发新建
await page.locator('.wing-new-btn').click();
await page.locator('.tpl-card.blank-card').click();
// Step 2: 编辑内容
await page.locator('.cm-content').click();
await page.keyboard.type('# 测试笔记\n\n内容行');
// Step 3: 等待自动保存完成
await expect(page.locator('.status-saved')).toBeVisible({ timeout: 10000 });
// Step 4: 验证持久化 — 切换到其他笔记再切回
await page.locator('.wing-bookmark-dot').first().click();
await page.locator(`.wing-bookmark-dot[aria-label="测试笔记"]`).click();
const content = await getEditorContent(page);
expect(content).toContain('# 测试笔记');
// Step 5: 删除
await page.locator('[title="删除笔记"]').click();
await page.locator('.confirm-btn--danger').click();
// Step 6: 确认已删除
await expect(page.locator('.wing-bookmark-dot[aria-label="测试笔记"]')).not.toBeVisible();
```

**V6 强制覆盖清单**（每项必须有 ≥1 个测试）：

| #   | 用户旅程                            | 最少步骤                      | 状态 |
| --- | ----------------------------------- | ----------------------------- | :--: |
| 1   | 新建笔记 → 编辑 → 保存 → 删除       | 新建→键入→等保存→切回→删→确认 |  ⬜  |
| 2   | 文件抽屉 → 展开子目录 → 打开文件    | 开抽屉→点目录→点文件→验内容   |  ⬜  |
| 3   | 搜索 → 查看结果 → 点击跳转 → 编辑   | 搜索→验证结果→点击→验跳转     |  ⬜  |
| 4   | 即时渲染: 预览→点击块→编辑→ESC→预览 | 切模式→验块→点击→编辑→ESC     |  ⬜  |
| 5   | 右键菜单: 重命名/删除               | 右击→重命名→验证→右击→删除    |  ⬜  |
| 6   | 导出选项组合: 选格式→改选项→导出    | 选格式→切换选项→导出→验内容   |  ⬜  |
| 7   | 错误恢复: 保存失败 → 重试           | 注入错误→验提示→恢复→验保存   |  ⬜  |

> **能力边界说明**: 以上 7 项均可在 Web/MockFS 环境下测试，无需 Tauri 运行时。仅真实文件系统操作（系统对话框/回收站）受限于 Playwright 架构，归入 Tauri 桌面端手动测试。

**V3 多步往返标准模式**（适配文件系统）：

```typescript
// Step 1: 写入文件
await page.getByLabel('文件名').fill('test-note.md');
await page.getByLabel('内容').fill('# Hello World');
await page.getByText('保存').click();
await expect(page.getByText('保存成功')).toBeVisible();

// Step 2-3: 导航离开再返回
await page.getByText('所有笔记').click();
await page.waitForLoadState('networkidle');
await page.getByText('test-note.md').click();
await page.waitForLoadState('networkidle');

// Step 4: 第一轮验证（内存状态）
const content = await page.locator('.editor-content').textContent();
expect(content).toContain('Hello World');

// Step 5: 刷新（验证文件系统持久化）
await page.reload();
await page.waitForLoadState('networkidle');
await page.getByText('test-note.md').click();

// Step 6: 第二轮验证（文件系统持久化）
const content2 = await page.locator('.editor-content').textContent();
expect(content2).toContain('Hello World');
```

**XSS 安全测试套件**（CI 每次运行）：

- 参数化 Payload 库覆盖已知绕过向量（`<script>`、`onerror`、`javascript:` URL、HTML 实体编码、mXSS 变体）
- DOMPurify 版本锁定 + `npm audit` 阻断高危漏洞

### 视觉回归测试（三层体系）

#### L3-S1 ⚡ 像素级自动对比（每次提交前）

- Playwright `toHaveScreenshot()` 对比关键页面截图
- 基线存储在 git 中，CI 检测差异
- 阈值配置：`maxDiffPixelRatio: 0.01`（1% 像素差异容限）

#### L3-S2 🧠 AI 视觉分析（每个里程碑末 + 每次 UI 重构后）

**前置条件**: `bailian-vision` MCP 服务器已加载（百炼视觉，支持 Qwen-VL 模型退化链）

**工具**: `analyze_image({ image_path: "绝对路径", prompt: "分析提示词" })`

**标准检查点**（定义于 `e2e/helpers/screenshot-utils.ts:STANDARD_CHECKPOINTS`）：

| #   | 检查点                | 验证内容                                                         |
| --- | --------------------- | ---------------------------------------------------------------- |
| 1   | `app-shell-initial`   | 三区布局、纸张暖色背景、书签圆点、TopBar、无横向溢出             |
| 2   | `editor-with-content` | CM6 编辑器、分栏预览、标题层级、代码高亮、状态栏、Wiki-link 样式 |
| 3   | `paper-shell`         | 羽翼布局三栏一致性、代码高亮、对比度达标                         |
| 4   | `template-dialog`     | 模态框居中+遮罩、模板卡片排列、羽翼阴影、纸张表面 Token          |
| 5   | `search-palette`      | 命令面板居中、输入框自动聚焦、placeholder 可见、面板浮起阴影     |
| 6   | `export-dialog`       | 格式卡片布局、Toggle 开关可见、选中状态反馈、按钮可点击          |

**执行流程**：

```
1. Playwright 在关键检查点自动截图 → packages/app/test-results/screenshots/
2. AI 通过 MCP analyze_image 逐张分析截图
3. AI 对比预期视觉特征，输出 PASS / FAIL / WARN 判定
4. FAIL 项记录错题本 → 修复 → 重新截图 → 重新分析
5. 全部 PASS 后，将截图归档为基线参考
```

**分析 Prompt 模板**（自动生成，定义于 `screenshot-utils.ts:buildAnalysisPrompt`）：

```
你是 JotLuck 笔记应用的视觉回归测试专家。请分析这张截图 (检查点: {name})。

预期视觉特征：{expectedVisuals}

请逐项检查并报告：
1. 布局是否正确（三区布局：左翼书签栏 / 中央编辑区 / 右翼面板）
2. 纸张主题 Token 是否正确应用（暖纸背景 + 墨色文字 + 冷蓝强调色）
3. 是否有元素重叠、遮挡、溢出或错位
4. 文字是否清晰可读，间距是否合理
5. 与预期视觉特征的偏差

输出格式：
- PASS: 说明通过的检查项
- FAIL: 说明失败项及具体位置
- 总结：整体评估 (PASS / FAIL / WARN)
```

#### L3-S3 🔄 手动截图对比（L4 人工复审辅助）

- 在关键页面手动截取全屏截图
- 使用 `analyze_image` 与基线进行 AI 辅助对比
- 关注主观审美：信息密度、留白舒适度、色彩和谐度

**依赖安全检查**：

- `npm audit --audit-level=high` — 高危漏洞阻断 CI
- `cargo audit` — Rust 依赖漏洞（M4+）
- Dependabot — 自动 PR 更新漏洞依赖

**Bundle 体积监控**：

- `size-limit` — 主 bundle 超限阻断 CI（JS ≤ 30MB gzip, CSS ≤ 30MB gzip）

**L3 最后一步 — 维护进度跟踪**：

- 所有 L3 检查通过后，**必须更新 `spec/progress.md`**
- 更新内容：已完成任务标记 ✅ + 完成日期 + Commit hash
- 重新计算并更新当前里程碑和总进度百分比
- 如 L3.5 审计已执行，补充审计摘要
- 如 L4 复审已通过，补充复审记录

**JotLuck 关键测试场景**（L2 + L3 必须覆盖）：

| 场景类别          | 测试用例                                                                    |      测试层       |  对应规则  |
| ----------------- | --------------------------------------------------------------------------- | :---------------: | :--------: |
| **Markdown 渲染** | 代码块高亮、表格、LaTeX 公式、嵌套列表、图片引用                            | L2 快照 + L3 截图 |   V1, V4   |
| **XSS 防护**      | 已知绕过向量注入 → DOMPurify 清洗后不含恶意代码                             |        L2         |     —      |
| **文件读写**      | 创建→保存→重新打开→内容一致；删除→确认文件消失                              |        L3         |   V2, V3   |
| **外部编辑**      | JotLuck 打开文件 → 外部编辑器修改 → JotLuck 检测变更并刷新                  |        L3         |     V1     |
| **Wiki-link**     | 创建 `[[其他笔记]]` → 渲染为链接 → 点击跳转 → 反向链接面板显示              |      L2 + L3      |   V1, V4   |
| **搜索**          | 中文搜索、英文搜索、正则搜索、标签过滤、日期范围过滤                        |      L2 + L3      |   V1, V4   |
| **导出**          | 导出 docx → 解析回读验证；xlsx → sheetjs 回读 cell 级对比；PDF 文本提取对比 |        L2         |   V2, V4   |
| **模板**          | 使用模板创建笔记 → `{{date}}` 正确替换 → 内容保存正确                       |      L2 + L3      |   V1, V4   |
| **跨浏览器**      | Chromium / Firefox / WebKit 三引擎并行运行相同测试                          |        L3         |     —      |
| **用户旅程(1)**   | 新建空白笔记 → 键入内容 → 等待自动保存 → 切换后切回验证 → 删除确认          |        L3         | V6, V2, V3 |
| **用户旅程(2)**   | 文件抽屉打开 → 展开子目录 → 选择文件 → 验证编辑器内容                       |        L3         |   V6, V1   |
| **用户旅程(3)**   | Ctrl+K 搜索 → 验证结果 → 点击跳转 → 编辑器内容匹配                          |        L3         | V6, V1, V4 |
| **用户旅程(4)**   | 即时渲染: 切换到live → 验证渲染块 → 点击块编辑 → ESC恢复渲染                |        L3         |   V6, V1   |
| **用户旅程(5)**   | 右键文件 → 重命名 → 验证新名称 → 右键删除 → 确认消失                        |        L3         |   V6, V2   |
| **用户旅程(6)**   | 导出对话框: 选HTML格式 → 关Wiki链接 → 导出 → 下载内容验证                   |        L3         |   V6, V4   |
| **用户旅程(7)**   | 模拟保存失败 → 验证错误提示 → 恢复 → 重试保存成功                           |        L3         |   V6, V1   |

---

## L3.5 🔍 独立审计环（每个里程碑末，L3 通过后触发）

**目的**：打破单上下文持续开发产生的信息茧房。启动一个**全新上下文的 Subagent**，以"攻击者"视角审查本里程碑的全部代码和规格文档。

**审计维度**（四维全覆盖）：

| 维度                    | 审查内容                                                                                                                                                                                                                                                                 |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **1. 规格一致性**       | 组件 Props/Events 是否完全匹配 `components.md`；样式是否只用 Paper Token（`tokens.css` / `paper.css` 中定义的 CSS 变量，纯 OKLCH，无硬编码色值）；页面状态机是否完整                                                                                                     |
| **2. 已知易错点清单**   | 逐项对照 `memory/bug_log.md` 末尾的 JotLuck 特定易错点自查表（文件编码、路径分隔符、大文件卡死、XSS 注入、Wiki-link 死链、循环引用、并发写入冲突、索引不一致、Overlay 遮挡、CSS 类名不一致、E2E 选择器过时等）。同时执行 L3-S2 AI 视觉分析（如 bailian-vision MCP 可用） |
| **3. 类型边界与数据流** | TypeScript 类型安全、null/undefined 处理、异常捕获完整性；渲染管线 → Pinia Store → 文件 IO 的数据流是否完整无断裂                                                                                                                                                        |
| **4. 跨平台兼容**       | Web (Chrome + Firefox) / Tauri Desktop / Mobile 行为差异；PWA 离线兼容；File System Access API 降级路径                                                                                                                                                                  |

**L3.5 不可跳过的情况**（任一条件满足即必须执行）：

| 条件                                     | 原因                                         |
| ---------------------------------------- | -------------------------------------------- |
| 里程碑包含任何 `.vue` 或 `.css` 文件变更 | 样式 Token 违规只有全新上下文能发现          |
| 里程碑新增组件 ≥ 3 个                    | 组件 Props/Events 与 spec 一致性需要独立核验 |
| 里程碑涉及 Pinia Store 或数据流变更      | 状态管理错误是最高发类别                     |
| 里程碑包含任何共享类型 (`types/`) 变更   | 类型错误会级联影响                           |

可跳过（需明确说明理由）：

- 仅配置文件变更（CI, package.json, tsconfig 等）
- 仅文档更新（`spec/`, `doc/`, README 等）

**教训 (2026-06-04)**: M2 以"规模可控"、M5 以"纯样式里程碑"为由跳过了 L3.5。结果 M2 的 10+ 组件硬编码色值完全绕过了 M5 的主题系统，直到 L4 人工复审才发现。L3.5 是防止信息茧房的唯一闸门，跳过条件必须严格。

**审计执行流程**：

```
1. L3 全量通过 → 确认 CI 绿色
2. 启动独立 Subagent（全新上下文，无对话历史）
   - 子Agent 读取：AGENTS.md + 本里程碑所有 spec 文档 + 全部代码变更
   - 子Agent 以"攻击者/质疑者"视角逐维审查
   - 子Agent 输出结构化审计报告（发现列表 + 严重度 + 位置）
3. 主 Agent 逐条判定审计发现：
   - 真 BUG → 记录错题本 → 修复 → 重新 L1 → L2 → L3
   - 假阳性 → 注明判定理由，不修复
   - DEFERRED → 标注依赖里程碑，不修复
4. 审计报告所有条目处理完毕 → 进入 L4 人工复审
```

**审计报告格式**：

```markdown
## L3.5 审计报告 — M{n} {里程碑名称}

### 审计结果汇总

- 审查文件数：{n}
- 发现问题数：{n}（严重{n} / 一般{n} / 建议{n}）

### 发现清单

| #   | 严重度  | 维度     | 位置                        | 描述                            | 判定         |
| --- | :-----: | -------- | --------------------------- | ------------------------------- | ------------ |
| 1   | 🔴 严重 | 类型边界 | `src/stores/note.ts:42`     | saveNote 未处理磁盘满异常       | 真BUG→修复   |
| 2   | 🟡 一般 | 跨平台   | `src/utils/path.ts:15`      | 路径拼接在 Windows 上使用了 `\` | 真BUG→修复   |
| 3   | 🟢 建议 | 规格一致 | `src/components/Editor.vue` | 缺少 Empty 状态 UI              | DEFERRED(M2) |

### 审计结论

- [ ] 所有严重/一般问题已修复并重跑 L1-L3
- [ ] 建议项已标记 DEFERRED 或记录原因
- [ ] 审计通过，进入 L4
```

---

## L4 🔷 人工复审（每个里程碑末，L3.5 通过后触发）

**这是最终质量闸门。每个里程碑 🔷 到达时，暂停开发，呼叫用户手工测试。禁止跳过。**

**里程碑将在 `spec/milestones.md` 中详细定义，届时每个里程碑的复审清单从 milestones.md 提取（模板见本文档附录）。**

**人工复审只关注 AI 无法自动判断的 4 件事**：

| 复审项   | 说明                                               | AI 为什么做不到    |
| -------- | -------------------------------------------------- | ------------------ |
| **手感** | 编辑器光标行为、输入延迟、拖拽流畅度、快捷键直觉性 | 主观体验，无法量化 |
| **视觉** | 色彩和谐度、信息密度、留白舒适度、渲染美观度       | 审美判断           |
| **触控** | 移动端手势、长按、触控区域大小（M4+）              | 物理操作体验       |
| **文档** | README/帮助文档的可读性和信息传达效果              | 面向人的沟通质量   |

**复审执行流程**：

```
1. 到达 🔷 检查点 → 确认 L1/L2/L3 全部通过 + L3.5 审计报告清零
2. 确认所有已知 BUG 已修复或标记 DEFERRED
3. 确认 spec 文档与代码实现一致（AGENTS.md §5.9 文档同步检查）
4. 准备复审清单（从 milestones.md 提取验收项 + 4 项人工判断维度）
5. 通知用户开始手动测试
6. 用户测试期间，记录所有发现的问题
7. 测试结束后，逐条判定真/假 BUG（AGENTS.md §5.7）
8. 真 BUG → 记录错题本 → 修复 → 重新 L1 → L2 → L3 → 通知用户复测
9. 假 BUG → 标注 DEFERRED + 依赖里程碑
10. 用户确认通过 → 标记里程碑完成 → 推进下一里程碑
```

**复审期间规则**：

- **禁止编辑代码**，除非是修复复审中发现的真 BUG
- 所有发现的问题必须记录（包括被认为"不是问题"的）
- BUG 修复后必须重新通过 L1 → L2 → L3 全链，确认不引入回归

**自动化验证 vs 人工复审的能力边界**：

| 自动验证（L1/L2/L3/L3.5 已覆盖） | 人工判断（L4 关注）               |
| -------------------------------- | --------------------------------- |
| TypeScript 类型正确性            | 编辑器**操作手感**是否流畅        |
| ESLint/Prettier 规范             | Markdown 渲染**视觉效果**是否美观 |
| 单元测试 + 快照测试通过          | 整体**信息密度**和**视觉舒适度**  |
| Playwright E2E 全量 PASS         | 移动端**触控体验**（M4+）         |
| XSS Payload 安全套件全量 PASS    | README / 帮助文档**可读性**       |
| 三引擎跨浏览器截图对比           | —                                 |
| Bundle 体积 ≤ 上限               | —                                 |
| 文件读写回环验证正确             | —                                 |
| 导出内容结构化对比一致           | —                                 |
| 搜索精确率/召回率达标            | —                                 |
| L3.5 四维审计清零                | —                                 |

---

## 发布收口专项规则

### 多会话协作（Spark 会话，强制）

发布收口阶段允许创建 `gpt-5.3-codex-spark` 后台编码会话，但只能用于明确、机械、低上下文的小任务。主 Codex 负责高风险修复、架构判断、GUI 验收和最终合入。

**Spark 会话硬约束**：

- 必须运行在 `D:\VibeCoding\MarkLuck` 的独立 worktree，不得直接修改主工作区。
- 每个任务只能覆盖一个小目标，提示词必须写明输入文件、允许修改范围、禁止修改范围、验收命令和停止点。
- 禁止委派 `IndexService` 数据一致性设计、CodeMirror/IME/ghost text 生命周期、Tauri 真实文件系统、大范围 `NotebookHome.vue` 重写等高风险任务。
- Spark 产物只作为候选补丁；主 Codex 必须检查 diff、运行验收命令后，才允许挑选合入主工作区。
- 不合格 worktree 直接废弃，不在主工作区继续修补其大范围误改。
- 禁止提交或合入生成物噪声：`e2e/report/index.html`、`test-results/`、临时截图/视频/日志等。

**轮询与纠偏**：

- 主 Codex 创建 Spark 会话后，默认每 10 分钟使用线程读取工具轮询一次。
- 30 分钟无有效进展时，只发送一次纠偏提示。
- 同一问题连续两轮失败时，停止该 Spark 会话，由主 Codex 接手。

### 最终验收 GUI 闭环（强制）

任何发布收口、里程碑验收、最终 RC 闸门，均不得只依赖自动化命令通过。自动化通过后，主 Codex 必须在 Codex 内置浏览器中以 GUI 层级执行真实用户旅程手动核验，并把核验结果写入验收报告或执行日志。

**最低 GUI 核验范围**：

- 新建笔记 → 编辑 → 自动保存 → 刷新 → 验证内容 → 删除 → 文件树与左侧书签均无残留。
- 文件抽屉 → 展开子目录 → 打开文件 → 编辑 → 保存。
- 搜索 → 点击结果跳转 → 编辑命中笔记。
- Live Preview → 点击渲染块 → 编辑 → Escape/失焦恢复。
- 设置 → 切换主题/文字补全开关 → 刷新后验证持久化或即时生效。
- 导出 → 选择至少一种可读取格式 → 验证导出内容与源 Markdown 相关。
- 图片上传或等价 GUI 模拟 → 验证 Markdown 路径、assets 写入、文件抽屉不暴露资产入口。

**通过标准**：GUI 核验必须覆盖完整闭环和可观测结果，不得只确认页面可见；若内置浏览器或宿主能力阻塞某项，必须记录具体阻塞原因、替代验证证据和剩余风险。

---

## 附录：里程碑检查清单模板

以下模板用于每个里程碑复审时生成具体的检查清单：

```markdown
## M{n} 🔷 复审清单 — {里程碑名称}

**日期**: YYYY-MM-DD
**前置条件**: L1 全部通过 | 已知 BUG 全部修复或 DEFERRED | 文档同步检查通过

### 功能验收项

- [ ] {验收项1}
- [ ] {验收项2}
- [ ] ...

### 边界情况

- [ ] 空文件夹
- [ ] 超大文件 (>5MB)
- [ ] 中文文件名/路径
- [ ] 特殊字符（emoji, 符号）
- [ ] 并发操作
- [ ] 网络断开（PWA）

### 跨平台兼容（M4+）

- [ ] Chrome/Edge (Windows)
- [ ] Firefox (Windows)
- [ ] Safari (macOS) — 如适用
- [ ] Tauri Desktop (Windows)
- [ ] Tauri Mobile (Android)

### 用户反馈

| #   | 问题描述 | 真/假BUG | 处理 |
| --- | -------- | :------: | ---- |
| 1   |          |          |      |
| 2   |          |          |      |

### 结论

- [ ] 全部通过，推进下一里程碑
- [ ] 存在问题，修复后复测
```
