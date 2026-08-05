# JotLuck 官网 · 机器验证报告 v1

> 日期：2026-08-04 ｜ 会话：verify 工具链 ｜ 范围：`site/`（Vue 3 + vite-ssg，21 HTML）
> 方法：互链静态检查（grep src/ 全量 RouterLink / :to / href）+ 禁用特征扫描（DESIGN.md §1 硬规则）+ dist 断言脚本 `scripts/verify-dist.mjs`（由主线程运行，本节报告其输出）
> 基线：DESIGN.md v1.0 生产实现基线；`src/release.ts` 为外链唯一事实源

---

## 1. 结论摘要

| 检查项           |  结论   | 说明                                                                                                        |
| ---------------- | :-----: | ----------------------------------------------------------------------------------------------------------- |
| 一、互链静态检查 | ✅ PASS | 站内目标全部为有效路由；外链与 `EXTERNAL` 完全一致；mailto 仅 `official@leankom.com` / `carrie@leankom.com` |
| 二、禁用特征扫描 | ✅ PASS | 全部命中均落在三主题 SVG 预览（批准豁免）或为误报（CSS 属性/注释），设计系统样式层零违规                    |
| 三、dist 断言    |  见 §4  | 由主线程运行 `node scripts/verify-dist.mjs` 执行，退出码非零即 FAIL                                         |

## 2. 发现清单

| 严重度  | 文件:行号                                                                                                                                                         | 问题                                                                                                                                                                        | 建议                                                                                                                     |
| :-----: | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| 🟡 一般 | `packages/site/src/router.ts:14`、`packages/site/src/types.ts:11`、`packages/site/src/components/SiteFooter.vue:15`、`packages/site/scripts/build-locales.mjs:23` | 旧站点包 `packages/site/` 仍残留 `/privacy` 路由与页脚 `<RouterLink to="/privacy/">`（本次改动只更新了 `site/` 新工程；该包仍在 workspace `packages/*` 且被 git 跟踪）      | `packages/site/` 若已被 `site/` 取代：删除整个包或声明 DEPRECATED；若仍发布：确认 `/privacy` 路由存在，或同步改为 mailto |
| 🟢 建议 | `src/components/themes/PaperPreview.vue:159-276`、`LumenFieldPreview.vue:29-118`、`HaloCanvasPreview.vue:18,45-49,187-312`                                        | hex 色值约 70 处（fill/stroke/stop-color/flood-color/dotColors 数组，含 `#ffffff`）+ 2 个 `<radialGradient>` SVG 元素（HaloCanvasPreview.vue:44、LumenFieldPreview.vue:28） | 三主题预览为官方截图 1:1 复刻（DESIGN.md 用户裁决 #4），渐变已获批准 → **豁免不标记**；保持复刻真实性，勿 Token 化       |
| 🟢 建议 | `src/components/SiteHeader.vue:58`                                                                                                                                | `white-space: nowrap` 命中纯白关键字 `white`                                                                                                                                | 误报（CSS 属性名），无违规，无需处理                                                                                     |
| 🟢 建议 | `src/styles/tokens.css:41`                                                                                                                                        | 注释「动效（80–400ms，禁 bounce/elastic/持续呼吸）」命中 bounce/elastic 关键词                                                                                              | 误报（注释即禁令声明），无违规，无需处理                                                                                 |
| 🟢 建议 | `src/fonts/font-manifest.json:9-263`                                                                                                                              | `sourceUrl` 为 github/npm registry 外链，不在 `EXTERNAL` 中                                                                                                                 | 字体 provenance 元数据（非页面链接、不渲染），不适用互链规则，仅记录                                                     |

## 3. 互链检查明细

### 3.1 站内链接（全部有效路由）

| 位置                                      | 表达式                                          | 目标                                           |    判定    |
| ----------------------------------------- | ----------------------------------------------- | ---------------------------------------------- | :--------: |
| `src/components/SiteHeader.vue:11`        | `pagePath(locale, 'home')`                      | `/{locale}/`                                   |     ✅     |
| `src/components/SiteHeader.vue:16-19`     | `pagePath(locale, page)`（nav v-for）           | `/{locale}/{download\|themes\|studio}`         |     ✅     |
| `src/components/HeroPressStage.vue:50`    | `pagePath(locale, 'download')`                  | `/{locale}/download`                           |     ✅     |
| `src/pages/LocaleGate.vue:56`             | `router.replace(`/${detect()}/`)`               | `/{zh\|ja\|ko\|fr\|en}/`（detect 白名单闭合）  |     ✅     |
| `src/pages/LocaleGate.vue:69`             | ``:href="`/${l}/`"``（l ∈ LOCALES）             | `/{locale}/`                                   |     ✅     |
| `src/components/LanguageSelector.vue:17`  | `router.push(pagePath(target, page))`           | `/{locale}/{page}`（target 来自 LOCALES 常量） |     ✅     |
| `src/router.ts:34`                        | catch-all `/:pathMatch(.*)*`                    | redirect `/`                                   | ✅（兜底） |
| `src/composables/usePageHead.ts:26,34,38` | canonical/hreflang = `SITE_URL + pagePath(...)` | 绝对 URL                                       |     ✅     |

### 3.2 外链（与 `src/release.ts` EXTERNAL 完全一致，无硬编码外链）

| 位置                               | 值                                                                                     | 判定 |
| ---------------------------------- | -------------------------------------------------------------------------------------- | :--: |
| `src/components/SiteFooter.vue:15` | `EXTERNAL.githubIssues` → `https://github.com/jiay98528-dev/JotLuck/issues/new/choose` |  ✅  |
| `src/components/SiteFooter.vue:17` | `EXTERNAL.githubRepo` → `https://github.com/jiay98528-dev/JotLuck`                     |  ✅  |
| `src/pages/DownloadPage.vue:44`    | `EXTERNAL.githubReleases` → `https://github.com/jiay98528-dev/JotLuck/releases`        |  ✅  |

### 3.3 mailto（仅两个白名单地址）

| 位置                               | 值                                                                                                              | 判定 |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------- | :--: |
| `src/components/SiteFooter.vue:16` | `mailto:${EXTERNAL.supportMail}` = `mailto:official@leankom.com`（页脚隐私入口，已从 /privacy 路由改为 mailto） |  ✅  |
| `src/pages/StudioPage.vue:25`      | `mailto:${s().action}` = `mailto:carrie@leankom.com`（五语 content 一致）                                       |  ✅  |

### 3.4 /privacy 残留核查

- **`site/` 工程：零残留** ✅（`src/content/*.ts` 中的 `privacy` 仅为文案标签，非路径；全仓 grep 无 `/privacy` 命中于 site/ 范围）
- **主仓 `packages/site/` 旧站点：4 处残留** ⚠️（见 §2 首行，路由注册 / 类型 / 页脚链接 / 构建清单）

## 4. 禁用特征扫描明细

| 特征                              | 扫描结果                                                                                                       |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| 十六进制色值（CSS/vue style）     | 仅三主题预览命中（~70 处，豁免）；设计系统层（tokens.css/site.css/controls.css/各页面样式）零命中 ✅           |
| 纯白纯黑关键字                    | `#ffffff` 仅 HaloCanvasPreview.vue:190（SVG 复刻，豁免）；`white` 仅 SiteHeader.vue:58 `white-space`（误报）✅ |
| linear-gradient / radial-gradient | CSS 渐变函数零命中；仅 2 个 SVG `<radialGradient>` 元素（豁免）✅                                              |
| infinite 持续动画                 | 零命中（tokens.css:41 为注释）✅                                                                               |
| bounce / elastic 缓动             | 零命中（同上注释）；`--ease-press: cubic-bezier(0.16,1,0.3,1)` 非回弹曲线；动效 token 80–400ms 符合契约 ✅     |
| Math.random 运行时随机            | 零命中；HaloCanvasPreview.vue:18 `dotColors` 为确定性数组 ✅                                                   |

补充核验（非任务项，顺带记录）：`site.css:215-216` reduced-motion 覆盖为 `animation-duration: 0.01ms !important; animation-iteration-count: 1 !important`，符合「reduced-motion 全静态」✅；HeroPressStage.vue:81-104 `press-in` keyframes 使用 `var(--dur-narrative)` + 确定性 60/120/180/240ms 延迟阶梯 ✅。

## 5. dist 断言（主线程执行 `node scripts/verify-dist.mjs`）

| 断言            | 期望                                                                                                                                           | 覆盖 |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | :--: |
| (a) 21 文件存在 | index + 5 语根页 + 5 语 × 3 子页                                                                                                               |  21  |
| (b) html lang   | 门页 en；zh 页 zh-CN；其余 en/ja/ko/fr                                                                                                         |  21  |
| (c) canonical   | 门页 `https://jotluck.com/`；首页 `https://jotluck.com/{l}/`；子页 `https://jotluck.com/{l}/{page}`                                            |  21  |
| (d) hreflang    | 5 条 alternate（zh-CN/en/ja/ko/fr 指向同页对应语言）+ 1 条 x-default → `https://jotluck.com/`；无多余、无重复                                  |  21  |
| (e) 社卡片      | og:image 与 twitter:image = `https://jotluck.com/assets/brand/social-preview.png`（public 中已确认存在）；twitter:card = `summary_large_image` |  21  |

脚本为纯 Node 标准库（fs/path/url），无第三方依赖；任一 FAIL 即 `process.exitCode = 1`。实际输出以主线程运行为准，本报告不代为断言。

---

## 6. 主线程运行记录（2026-08-04）

`node scripts/verify-dist.mjs` 首跑 **247 FAIL**，暴露一个自工程建立就存在的真回归：`src/main.ts` 手动 `app.use(createHead())`（且误用 `@unhead/vue/client`）。vite-ssg 自动安装 unhead（SSR=server、浏览器=client）并序列化**它自己创建的** `appCtx.head`（`vite-ssg/dist/index.mjs:19` + `shared/vite-ssg.*.mjs` 的 `renderDOMHead(head, {document})`）；手动注册的第二个 head 接管了组件 `injectHead`，导致 SSG 序列化的永远是空 head——21 页无 canonical/hreflang/社卡片/按页 title，`<!-- %-unhead-%- -->` 占位符原样残留。

**修复**：删除手动注册（`main.ts`），交由 vite-ssg 自动安装。修复后重跑 **294/294 PASS**（21 文件 × 存在性/lang/canonical/hreflang 5+1/社卡片断言）。同轮顺带落地按页 title/description 差异化（子页 = `导航标签 · JotLuck` + 页首 lead）与 `og:site_name`。

`packages/site/` 旧包 `/privacy` 残留已闭环：用户裁决删除整包（2026-08-04），主线程已执行 `rm -rf packages/site` 并清理 `.gitattributes` LFS 行与 `pnpm-lock.yaml` 失效 importer；该包删除前无未提交改动，git 历史可恢复。
