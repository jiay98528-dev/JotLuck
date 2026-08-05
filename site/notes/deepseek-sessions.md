# DeepSeek 协作会话注册表（持久复用，禁止新建重复会话）

> 2026-08-04（晚）模型切回记录：claude 侧路由已切回 **deepseekV4Flash**。调用必须显式 `--model "deepseek-v4-flash[1m]"`（1m 上下文）+ Max 思考（settings 已配 `CLAUDE_CODE_EFFORT_LEVEL=max`；禁止 v4-pro）。M3 时代的「省略 `--model`、禁 Bash、任务粒度收窄」约束随之解除；任务封套纪律（M0 封套、窄目标、主线程机器验收、自报不可信）继续有效。
> （历史）2026-08-04 模型切换记录：claude 侧默认模型曾由 deepseek 体系切到 MiniMax M3，当日已回切。能力基线 `notes/minimax-m3-capability-v1.md` 仅作历史评级存档。

| #   | 用途                             | Session ID                             | 状态                                                                                                                                                                                                                                                         |
| --- | -------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | i18n：ja/ko/fr 全量翻译初稿      | `f29df46f-9480-4f40-8ed0-d9af0743be13` | ✅ 完成（两轮：全站翻译 + themePreview，已验收转正）；2026-08-05 续作：SEO meta 标题 ja/ko/fr 起草（`notes/seo-meta-draft-2026-08-05.md`，主线程复审转正，裁决 23）；同日续作 2：pageDescriptions ja/ko/fr 起草（转正，公司名译法被主线程驳回改写，裁决 24） |
| 2   | verify：机器验证工具链           | `b4659aae-9555-4bde-9f09-e4b4c6939e4c` | ✅ 完成（互链/禁用特征 PASS；verify-dist.mjs 转正，首跑 247 FAIL 揪出 main.ts head 回归，修复后 294/294 PASS；报告 §6 有主线程运行记录）；2026-08-05 续作：verify-dist 断言 294→379 升级起草（目录式布局/404/sitemap 映射/H1/JSON-LD，转正，裁决 23）        |
| 3   | fonts：字体清单/语料覆盖核查     | `243890b6-4681-40f3-82ec-c0c38e623201` | ✅ 完成（manifest zh-hant 残留清理转正；verify-fonts.mjs 两处自身 bug 主线程修复后跑通；缺口裁决=接受回退，报告 §8）                                                                                                                                         |
| 4   | seo：hreflang/sitemap/社卡片脚本 | `0231e732-05a7-40f7-9e0b-4611070b3e26` | ✅ 完成（sitemap.xml 21 URL×6 alternate + robots.txt 转正；遗留按页 title 已由主线程落地）                                                                                                                                                                   |
| 5   | 备用                             | `4ef1d84b-52f6-46e1-a8a9-81c25ab59f07` | 未启动                                                                                                                                                                                                                                                       |

## 调用方式

首次：`claude -p "<任务>" --model "deepseek-v4-flash[1m]" --session-id <ID> --permission-mode acceptEdits --allowedTools "Read Edit Write Glob Grep Bash(pnpm:*)"`
续作：`claude --resume <ID> -p "<任务>" --model "deepseek-v4-flash[1m]" --permission-mode acceptEdits --allowedTools "Read Edit Write Glob Grep Bash(pnpm:*)"`

任务书按 `notes/meta-instructions.md` 的 M0 封套 + M1–M6 模板（M 模板中的能力评级源自 M3 评测，deepseek 下整体偏保守，可作下限参照）。

工作目录固定 `D:\VibeCoding\MarkLuck\site`。每个任务只给一个窄目标，写明可改范围/禁改范围/验收命令/停止点。产物一律主线程验收后转正。
