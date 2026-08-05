# JotLuck 官网字体核查报告 v1

- **日期**：2026-08-04
- **范围**：五语站点（zh-CN / en / ja / ko / fr）自托管字体覆盖与加载面审计
- **工具**：`scripts/verify-fonts.mjs`（纯 Node，从 site 根运行：`node scripts/verify-fonts.mjs`）
- **依据**：`src/fonts/font-manifest.json`（unicode-range 权威声明）、`src/styles/site.css`（@font-face 与 html[lang] 绑定）、`src/styles/tokens.css`、`public/assets/fonts/files/`、`src/content/{zh,en,ja,ko,fr}.ts`、`src/**/*.vue`
- **核查项**：(a) 每语言实际字符集（content 字符串字面量 ∪ vue 模板硬编码文本，五语共有）→ (b) 断言字符集被本语言 display/body/mono 字族 unicode-range 全覆盖 → (c) 加载面审计（单语言页面不下载他语字体）→ (d) `font-synthesis: none` 断言

---

## 1. 字体加载模型

| 角色    | 字族（site.css / tokens.css）     | 语言文件                        | unicode-range 要点                                                                |
| ------- | --------------------------------- | ------------------------------- | --------------------------------------------------------------------------------- |
| display | JL Display ZH / EN / FR / JA / KO | display-{lang}.woff2 ×5         | 拉丁版含 U+0000-024F+U+2000-206F+U+20AC；CJK/日/韩版含对应文字块 + U+2000-206F    |
| body    | JL Body ZH / EN / FR / JA / KO    | body-{lang}-{400,700}.woff2 ×10 | 同 display 分区；CJK 版含 U+4E00-9FFF（汉字），KO 版**不含汉字块**，JA 版含假名块 |
| mono    | JL Mono（:root，五语共享）        | mono-400.woff2 ×1               | **仅 U+0000-007F（纯 ASCII）**                                                    |

- 五语页面 = html[lang] 绑定字族（display+body）+ 共享 mono，共 3 字族 4 文件（含 body 双字重）。
- `font-synthesis: none` 已存在于 `tokens.css` 的 `:root`（site.css `html` 亦重复声明）✓。
- manifest 与磁盘现均为 **16 个文件**（见 §2 修正记录），site.css 16 个 @font-face 全部对应存在。

## 2. 数据修正记录（唯一允许的改动）

`src/fonts/font-manifest.json` 中残留已移除的 zh-hant（繁体）资产，与磁盘不符，纯数据错误，已修正：

| 删除项                                                    | 理由                                                                     |
| --------------------------------------------------------- | ------------------------------------------------------------------------ |
| family `Iansui`（output `display-zh-hant.woff2`）         | 文件不存在；tokens.css 注释「zh-hant 已按用户裁决移除」；site.css 无引用 |
| family `IBM Plex Sans TC`（`body-zh-hant-400/700.woff2`） | 同上                                                                     |
| `mono-400` locales 中的 `"zh-hant"`                       | 同步清理                                                                 |

修正后 manifest 声明 16 个输出 = 磁盘 16 个 = site.css 引用 16 个，三者一致。

## 3. 每语言字符集与覆盖（核查项 a+b）

> 字符集 = 该语言 content 全部字符串字面量的独码（codepoint）集合，并入 vue 模板硬编码可见文本（品牌名 JotLuck、语言标签 zh-CN/en/ja/ko/fr、主题预览 SVG 图标符号等，五语共有）。
> 规模为静态推演值，精确值以脚本运行输出为准；**缺字符清单为逐字核验结果**。

| locale | 字符集规模（独码，估） | 缺字符数 | 覆盖率（估） | 判定   |
| ------ | ---------------------- | -------- | ------------ | ------ |
| zh     | ≈900                   | 8        | ≈99.1%       | ✗ 缺字 |
| en     | ≈110                   | 13       | ≈88.2%       | ✗ 缺字 |
| ja     | ≈400                   | 8        | ≈98.0%       | ✗ 缺字 |
| ko     | ≈170                   | 10       | ≈94.1%       | ✗ 缺字 |
| fr     | ≈90                    | 13       | ≈85.6%       | ✗ 缺字 |

### 缺字符明细（全部五语）

**A. vue 模板硬编码装饰符号（五语共有，5 个）** — 均不在任何已加载字族的 unicode-range 内，渲染时回退系统字体：

| 字符 | 码点   | 位置                                                               |
| ---- | ------ | ------------------------------------------------------------------ |
| `▷`  | U+25B7 | `src/components/themes/PaperPreview.vue` 模板文本（live 按钮前缀） |
| `↗`  | U+2197 | `PaperPreview.vue` / `HaloCanvasPreview.vue` 工具条图标            |
| `⇩`  | U+21E9 | `HaloCanvasPreview.vue` 状态栏（导出图标）                         |
| `⌗`  | U+2317 | `HaloCanvasPreview.vue` 状态栏（分享图标）                         |
| `✓`  | U+2713 | `HaloCanvasPreview.vue` 状态栏（已保存图标）                       |

> `‹` U+2039、`›` U+203A、`·` U+00B7 均在 U+2000-206F / U+0000-00FF 内，覆盖 ✓。

**B. 各语言正文引用的他语语言名（content 缺口）**

| locale | 缺字符                                          | 位置                                                    |
| ------ | ----------------------------------------------- | ------------------------------------------------------- |
| zh     | `한` `국` `어`（한국어 3 字）                   | `zh.ts` multilingual.languages[2]、multilingual.body    |
| en     | `中` `文` `日` `本` `語` `한` `국` `어`（8 字） | `en.ts` multilingual.languages[0..2]、multilingual.body |
| ja     | `한` `국` `어`（3 字）                          | `ja.ts` multilingual.languages[2]、multilingual.body    |
| ko     | `中` `文` `日` `本` `語`（5 字）                | `ko.ts` multilingual.languages[0..1]、multilingual.body |
| fr     | `中` `文` `日` `本` `語` `한` `국` `어`（8 字） | `fr.ts` multilingual.languages[0..2]、multilingual.body |

成因：五语 `multilingual` 区块互相引用语言名（「中文」「日本語」「한국어」），而本语言字族的 unicode-range 不含他语文字块——尤其 **KO 字体（Gowun Batang / IBM Plex Sans KR）不含汉字块 U+4E00-9FFF**，故 ko 页面显示「中文」「日本語」必回退。en/fr 页面汉字与谚文均回退；ja 页面汉字可覆盖、谚文回退；zh 页面汉字可覆盖（日文汉字同 CJK 块）、谚文回退。

**C. mono 面（ASCII-only 的已知边界，非本报告缺字）**：`JL Mono` 仅 U+0000-007F。`.proof-backlinks`（zh「灵感清单」等）与 HaloCanvasPreview frontmatter（`title: 快速入门`）中的非 ASCII 文本在 mono 栈中缺失 → 回退系统等宽字体。按「display/body/mono 任一覆盖即可」的判定这些字符已被本语言 body 覆盖，不列为缺字，但**实际渲染路径不会跨字族回退**，mono 上下文始终显示系统字体。

**结论 (b)：覆盖断言失败** — 五语均存在缺字符（合计 A 5 个 + B 分布 3~8 个）。浏览器行为：unicode-range 外字符**不触发任何字体下载**，直接回退 font-family 栈的系统字体，页面不会缺字/崩溃，仅字形风格与自托管字族不一致。

## 4. 加载面审计（核查项 c）

按页面组件闭包静态分析（每页 = html[lang] 基底字族 ∪ 组件 `<style>` 中引用的 `JL *` 字族）：

| locale 页面 | home                                             | download                   | themes                     | studio                     | gate（/，html lang=en）                        |
| ----------- | ------------------------------------------------ | -------------------------- | -------------------------- | -------------------------- | ---------------------------------------------- |
| 触发下载    | 本语 display/body + mono + **全部 5 个 display** | 本语 display/body + mono ✓ | 本语 display/body + mono ✓ | 本语 display/body + mono ✓ | EN display/body + mono + **全部 5 个 display** |
| 他语文件    | ✗ 4 个（其余 4 语 display）                      | —                          | —                          | —                          | ✗ 4 个（zh-hans/fr/ja/ko display）             |

**结论 (c)：违规** — `HomePage` 的「五语声明」区块（`.zh-name`/`.ja-name`/`.ko-name`/`.en-name`/`.fr-name` 各绑自己语言的 display 字体）与 `LocaleGate` 的 `.gate-name` 五语索引，是**有意设计**（注释明示「每种语言用它自己的展示字体现身」），但确实使**任一语言访问 home 页或门页都会下载全部 5 个 display 字体文件**，违反「单一语言页面不应请求他语字体文件」策略，unicode-range 按需加载机制在这些页面上失效。download/themes/studio 三页干净。

## 5. font-synthesis（核查项 d）

`tokens.css` 存在 `font-synthesis: none`（`:root`）✓ — 无合成粗体/斜体，缺字重依赖各语言自身的 400/700 切裁。

## 6. 总体结论

**FAIL**（3 项断言未通过，均为非阻断性）：

1. **覆盖缺口（b）**：五语均有缺字符 — 5 个 SVG 装饰符号 + 各语言引用的他语语言名（en/fr 最重 13 个）。渲染回退系统字体，无下载、无崩溃。
2. **加载面违规（c）**：home 页五语 showcase 与门页五语索引 → 任何语言都下载全部 5 个 display 文件。
3. 字体文件数据一致性（a）已通过：manifest/site.css/磁盘三方一致（修正后）。

## 7. 建议（按优先级）

1. **装饰符号去字体化（推荐）**：`▷ ↗ ⇩ ⌗ ✓` 属 UI 图标，建议改用内联 SVG path（如同现有 `paper-stack` 图标画法）或图标字体，从文本字符集剔除；否则 `pyftsubset --text-file` 追加这 5 个符号到全部 5 套字体（符号体积极小，一个字符一个 glyph）。
2. **语言名回退策略**：multilingual 区块的内嵌他语语言名接受系统回退（当前行为）或绑定对应语言字族（仅 showcase 大字已如此；正文段落如需一致需加 class）。建议接受回退 — 语言名是小字号短词，风格差异可接受，且避免在正文中触发他语字体下载。
3. **mono 面**：backlinks / frontmatter 的非 ASCII 项当前回退系统等宽字体。若需一致，二选一：给 `mono-400` 裁切追加常用 CJK/谚文/假名（体积可控），或把这些文本改绑 `--font-body`。
4. **加载面（产品决策）**：home 五语 showcase 与门页五语索引是品牌卖点，但违反单一语言零他语下载策略。三个选项：(a) 接受现状（5 个 display 文件均为小体积子集，总增量预计 <100 KB，首屏阻塞仅 CSS 引用本身）；(b) 懒加载 — showcase 进入视口后才 `IntersectionObserver` 注入他语 @font-face；(c) 降级为仅文本不加字族。推荐 (a) 或 (b)。
5. **回归护栏**：将 `verify-fonts.mjs` 纳入 CI（新增字体/文案后运行），防止缺字符与他语加载面漂移。

---

## 8. 主线程复核（2026-08-04）

**脚本验收**：`node scripts/verify-fonts.mjs` 首跑发现两处脚本自身 bug 并已由主线程修复——(1) 头注释内 `**/*.vue` 含 `*/` 提前闭合块注释（SyntaxError）；(2) unicode-range 解析正则不认标准 `U+0000-00FF` 写法（区间末端 `U+` 前缀已改为可选）。修复后脚本完整跑通。

**运行结果**：一致性（a）✓ 三方一致；加载面（c）按 html[lang] 绑定模型 ✓ 每页仅本语字体（showcase 的他语 display 下载属组件级 class 绑定，模型外，见 §4）；font-synthesis（d）✓。覆盖（b）FAIL 即 §6 所列缺口，全部经主线程裁决为**接受回退**：

| §7 建议           | 主线程裁决                                                                                            |
| ----------------- | ----------------------------------------------------------------------------------------------------- |
| 1. 装饰符号 ▷↗⇩⌗✓ | **接受系统回退**（SVG 内小符号，截图目检渲染正常；不做 path 化，扩裁切留作后续备选）                  |
| 2. 语言名回退     | **接受**（同报告推荐）                                                                                |
| 3. mono 非 ASCII  | **接受系统等宽回退**（demo 数据角落，不影响主体）                                                     |
| 4. 加载面         | **选 (a) 接受现状**——五语标本是品牌声明核心时刻，5 个 display 子集体积小；已记 DESIGN.md §2.1 裁决 #9 |
| 5. CI 护栏        | 记录为部署前手动步骤，暂不接 CI                                                                       |

`font-manifest.json` 的 zh-hant 残留清理（Iansui / IBM Plex Sans TC）核验通过，16 文件 ↔ site.css ↔ 磁盘三方一致。
