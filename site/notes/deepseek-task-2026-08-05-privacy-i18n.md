# DeepSeek #1 续作任务书（2026-08-05 黑盒审计修复批 · i18n 起草）

会话：#1 i18n（resume）。工作目录 `D:\VibeCoding\MarkLuck\site`。

## 窄目标

为 ja / ko / fr 三个 locale 起草以下内容，直接编辑 `src/content/ja.ts`、`src/content/ko.ts`、`src/content/fr.ts`：

1. **`privacy` 内容块**（新增）：对照 `src/content/zh.ts`（正典）与 `src/content/en.ts`（翻译源）中已落盘的 `privacy` 块，在 ja/ko/fr 各自文件的 `footer: {` 之前插入同构 `privacy` 块。键集合必须与 zh/en 完全一致：`eyebrow / title / lead / sections[4]{title,body} / contactTitle / contactBody`（TypeScript 结构类型强制，缺键编译失败）。
2. **`meta.pageTitles.privacy` 与 `meta.pageDescriptions.privacy`**：在各文件 meta 的两个 Record 中补 `privacy` 条目（对照 zh/en 已落盘写法）。长度契约：`pageTitles` ≤ 60 字符；`pageDescriptions` 70–160 字符（按 JS 字符串 .length 计，含标点）。
3. **`themes.blueprintBody` 改写**：对照 zh/en 新文案（已删除 `Theme API v2 / slot / 宿主 API / .mltheme` 术语），把 ja/ko/fr 的 blueprintBody 同步改写为无技术术语版本，保留原意「开放整个工作区的深度定制，留给有独特创意、有强烈表达欲望的人」。`blueprintTitle` 不动。

## 硬约束（裁决 24 教训，违反即驳回）

- **禁止翻译或发明「鸰湖科技」等公司名译法**；privacy 文案本就无需提及法律主体，不要主动添加。
- `JotLuck`、`GitHub`、`Markdown` 等品牌/技术名保持原形；其余术语按各语言 UI 惯例处理。
- 语义以 zh 正典为准，en 为表达参照；不得新增 zh 版没有的事实承诺（如具体法律条款、GDPR 等）。
- 五语既有事实（离线、无账号、无遥测、无 Cookie/分析、GitHub 发布）必须与 zh 版逐点对应，不多不少。

## 可改范围

仅 `src/content/ja.ts`、`src/content/ko.ts`、`src/content/fr.ts` 三个文件。其余文件一律禁改。

## 验收与停止点

- 跑 `pnpm typecheck`，必须通过（键对称硬闸门）。不跑 build（主线程统一验收）。
- 完成后报告：每语 `pageDescriptions.privacy` 与 `pageTitles.privacy` 的字符数（自数，供主线程复核 70–160 / ≤60 契约），以及 blueprintBody 三语新文本。
- 产物为草稿，主线程复审后转正；不要自行宣称完成标准已达成。
