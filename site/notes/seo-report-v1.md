# SEO 静态核查报告 v1

- **日期**: 2026-08-04
- **范围**: 站点 https://jotluck.com（Vue 3 + vite-ssg + @unhead/vue），21 页面
- **核查方式**: 静态代码核对（`src/composables/usePageHead.ts`、`src/pages/LocaleGate.vue`、`src/router.ts`、`src/content/*.ts`、`src/release.ts`、`index.html`）+ 资产存在性/尺寸校验 + sitemap 与代码一致性比对
- **结论**: ✅ 通过（附 3 项 src 内发现 + 4 项建议，仅记录未修改，本次改动仅限 `public/` 与本报告）

---

## 一、页面清单（21 页）

| #    | 路径                                          | 页面          | 说明                          |
| ---- | --------------------------------------------- | ------------- | ----------------------------- |
| 1    | `/`                                           | 语言门页      | LocaleGate，客户端重定向五语  |
| 2–6  | `/{zh,en,ja,ko,fr}/`                          | 五语首页      | `pagePath` 首页带尾斜杠       |
| 7–21 | `/{l}/download`、`/{l}/themes`、`/{l}/studio` | 五语 × 3 子页 | 无尾斜杠（与 canonical 一致） |

hreflang 映射：`zh → zh-CN`，其余 `en/ja/ko/fr` 同名；`x-default → https://jotluck.com/`（门页）。

---

## 二、usePageHead（20 个语言页）逐项核对 — ✅ 一致

每页（locale L，页面 P）输出：

| 项                          | 期望值                                                | 实现（`usePageHead.ts:17-43`）                 | 结果                                   |
| --------------------------- | ----------------------------------------------------- | ---------------------------------------------- | -------------------------------------- |
| `html lang` / `data-locale` | LOCALE_TAGS[L]                                        | `htmlAttrs` ✓                                  | ✅                                     |
| `title`                     | `content.meta.title`（L 语）                          | 见下表                                         | ✅                                     |
| `meta description`          | `content.meta.description`（L 语）                    | 见下表                                         | ✅                                     |
| `og:title`                  | = title                                               | `content.value.meta.title`                     | ✅                                     |
| `og:description`            | = description                                         | 同上                                           | ✅                                     |
| `og:type`                   | `website`                                             | `'website'`                                    | ✅                                     |
| `og:url`                    | `https://jotluck.com` + `pagePath(L, P)`              | `:26`                                          | ✅ 绝对 URL，尾斜杠规则与 loc 一致     |
| `og:image`                  | `https://jotluck.com/assets/brand/social-preview.png` | `CARD_URL`（`release.ts:21`）                  | ✅                                     |
| `og:image:width`            | `1280`                                                | `:28`                                          | ✅                                     |
| `og:image:height`           | `640`                                                 | `:29`                                          | ✅                                     |
| `twitter:card`              | `summary_large_image`                                 | `:30`                                          | ✅                                     |
| `twitter:image`             | = og:image                                            | `:31`                                          | ✅                                     |
| `canonical`                 | 当前页绝对 URL                                        | `:34`                                          | ✅ 与 `og:url`、sitemap `loc` 三方一致 |
| hreflang 五条               | zh-CN/en/ja/ko/fr → 对应语言**同页**                  | `LOCALES.map`（`:35-39`），顺序 zh,en,ja,ko,fr | ✅ 与 sitemap 完全一致                 |
| hreflang `x-default`        | `https://jotluck.com/`                                | `:41`                                          | ✅ 与任务定案一致                      |

五语 `meta.title` / `meta.description`（`src/content/*.ts`）：

| locale | title                                  | description                                                                                                                  |
| ------ | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| zh     | JotLuck — 落字为安                     | 一款轻量、本地优先、离线可用的 Markdown 笔记工具。每一条笔记都是纯文本文件，文件夹即笔记本。                                 |
| en     | JotLuck — Set words down, at ease      | A lightweight, local-first, offline-capable Markdown note tool. Every note is a plain-text file; every folder is a notebook. |
| ja     | JotLuck — 書き留める、安心して         | 軽量で、ローカルファースト、オフラインでも使える Markdown ノートツール。…                                                    |
| ko     | JotLuck — 마음 편히 적어내려가다       | 가볍고, 로컬 우선이며, 오프라인에서도 쓸 수 있는 Markdown 노트 도구입니다. …                                                 |
| fr     | JotLuck — Posez les mots, en confiance | Un outil de notes Markdown léger, local d'abord, utilisable hors ligne. …                                                    |

**发现 1（src，仅记录）**: 同语言内 4 个页面（home/download/themes/studio）的 `title` 与 `description` **完全相同**——`usePageHead` 一律取 `content.meta.title/description`（站点级文案），未按页面差异化。子页将与首页重复 title/description，削弱 SERP 区分度。**不改**（超出本会话范围，建议后续按页面配置 meta）。

---

## 三、LocaleGate 门页（`/`）逐项核对 — ✅ 一致

| 项                               | 期望值                                   | 实现（`LocaleGate.vue:16-40`） | 结果                                             |
| -------------------------------- | ---------------------------------------- | ------------------------------ | ------------------------------------------------ |
| `html lang`                      | en（静态默认，客户端重定向后更新）       | `:17`                          | ✅ 合理（门页为五语索引）                        |
| `title`                          | `JotLuck`                                | `:18`                          | ✅ 与 index.html 默认一致                        |
| `meta description`               | en 语描述                                | `:20`                          | ✅（以英文为主语，门页合理）                     |
| `og:title`                       | `JotLuck`                                | `:21`                          | ✅                                               |
| `og:description`                 | = description                            | `:22`                          | ✅                                               |
| `og:type`                        | `website`                                | `:23`                          | ✅                                               |
| `og:url`                         | `https://jotluck.com/`                   | `:24`                          | ✅ 与 canonical 一致                             |
| `og:image` + 宽高                | social-preview.png 1280×640              | `:25-27`                       | ✅                                               |
| `twitter:card` / `twitter:image` | summary_large_image / 卡图               | `:28-29`                       | ✅                                               |
| `canonical`                      | `https://jotluck.com/`                   | `:32`                          | ✅                                               |
| hreflang 五条                    | zh-CN/en/ja/ko/fr → **五语首页** `/{l}/` | `:33-37`                       | ✅ 与任务定案一致（门页 alternate 指向五语首页） |
| hreflang `x-default`             | `https://jotluck.com/`（自身）           | `:38`                          | ✅                                               |

**发现 2（src，仅记录）**: 门页 `html lang="en"` 固定写死，但页面实际以五语索引呈现且 `hreflang` 含 zh-CN 等——`lang` 与 `hreflang` 集合不完全对应。轻微语义瑕疵，不影响机器解析。**不改**。

---

## 四、og:image 资产核对 — ✅ 存在且尺寸正确

- 路径：`public/assets/brand/social-preview.png`（线上 `https://jotluck.com/assets/brand/social-preview.png`）
- PNG 头解析：**1280 × 640**（`0x500` × `0x280`）✅
- 与 `og:image:width/height` 声明完全一致；`release.ts:21` 的 `SOCIAL_CARD` 与两处使用方（usePageHead、LocaleGate）引用一致 ✅
- 部署注意：`public/` 下的资产随构建原样发布，无需额外处理。

---

## 五、sitemap.xml 与代码一致性 — ✅ 完全一致

- 21 个 `<loc>` 逐一比对 `router.ts` 路由（`/` + 五语 × 4 页），数量与路径均匹配，无多余/遗漏。
- 每个 url 的 6 条 `<xhtml:link alternate>` 与 `usePageHead` 的 `LOCALES.map`（五语同页）+ `x-default → /` 逐条一致；门页的 alternate 与 `LocaleGate.vue` 一致（五语首页 + x-default 自身）。
- 尾斜杠规则一致：首页 `/zh/` 带斜杠，子页 `/zh/download` 不带（`pagePath` 实现如此，sitemap 照抄，canonical 亦同）。
- `lastmod 2026-08-04` 全站统一（静态值，构建时不可变）。
- 命名空间：`xmlns`（sitemap 0.9）+ `xmlns:xhtml`（W3C XHTML）均声明 ✅。

---

## 六、index.html 默认 head 评估 — 合理，2 点建议

```
lang="zh-CN"（默认语言 zh 合理）｜charset/viewport/color-scheme 齐全
icon 引用 /assets/brand/jotluck-icon.png ✅ 存在
title "JotLuck" ✅ 与门页一致
```

- vite-ssg + unhead 会在 SSG 阶段为每页写入完整 head（title/meta/link），模板 head 只是回退基线，**生产各页 head 以 usePageHead/LocaleGate 为准**，整体合理 ✅。
- **建议 1**：模板无默认 `meta description`（`index.html` 第 4-7 行只有 charset/viewport/color-scheme/icon）。若某页 SSG 失败或 JS 关闭，爬虫只见裸 title。建议补一条站点级默认 description（本次未改）。
- **建议 2**：模板 `lang="zh-CN"` 与门页运行时 `lang="en"` 存在瞬时差异（SSG 产物为 en，模板为 zh-CN，仅影响无 JS 兜底渲染），低优先级。

---

## 七、src 内发现汇总（仅记录，未修改）

| #   | 位置                   | 发现                                                      | 严重度  | 建议                                                        |
| --- | ---------------------- | --------------------------------------------------------- | :-----: | ----------------------------------------------------------- |
| 1   | `usePageHead.ts:21-22` | 同语言 4 页共用同一 title/description，子页无差异化       | 🟡 一般 | 页面级 meta 配置（按 `page` 参数取 `content` 下各页面字段） |
| 2   | `LocaleGate.vue:17`    | 门页 `lang="en"` 固定，与五语索引语义不完全对应           | 🟢 建议 | 可保持现状或改为 `lang="zh-CN"` 对齐模板默认                |
| 3   | 全站                   | 无 `og:site_name`；无 `twitter:title/twitter:description` | 🟢 建议 | 可选增强，非必需                                            |

---

## 八、结论

- 21 页 head 输出（title/description/canonical/hreflang 六条/og 全套/twitter 全套）与代码一致，无断裂。
- sitemap.xml（21 loc + 每页 6 条 alternate）与 robots.txt 与代码及定案完全一致，命名空间、绝对 URL、尾斜杠规则正确。
- og:image 资产存在且 1280×640，与声明匹配。
- 遗留：发现 1（页面级 title 重复）建议后续按页面差异化；index.html 建议补默认 description；lastmod 为静态值，发布时宜改为构建期生成。
