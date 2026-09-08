# 工单 B 审查记录：补全引擎装载重试 + 设置页健康块

- 日期：2026-09-08
- 席位：GLM-Flash（审计复核，只读，独立于实现者报告）
- 对象：仓库 D:\VibeCoding\MarkLuck @ 593658f + 工作树未 commit 改动（9 文件：新增 composable+test，改 NotebookHome/SettingsDialog/5 locale）
- 手段：全量 diff 通读 + 源码交叉验证（MarkdownPredictor/engine-router/public-free-decoder-engine/factory/tokens.css/themes）+ 全仓 grep + 实跑门槛四件套

## Findings（逐项 a–g）

| 项                | 结论 | 证据                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ----------------- | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| a 失败语义        | PASS | 三态全识别且不缓存：factory reject→usePublicDecoderSetup.ts:68-74（catch+warn+false）；factory null→:76-81；install false→:88-95；install reject→:96-102。`inFlight` 仅并发去重且 `.finally` 置空（:134-144），无 `??=` 残留。unhandled rejection：installOne 内 factory/install 全部 try/catch 包裹；唯一裸 await 是 :84 `await engine.dispose()`，但 PublicFreeDecoderEngine.dispose（public-free-decoder-engine.ts:219-229）对所有 await 均 `.catch(()=>{})`、其余为同步字段写，现实不可能 reject。install-false 引擎无泄漏：engine-router.ts:233 installPublicEngine 所有 false 路径均 `safeDisposePublicEngine(next)` |
| b 定时器/生命周期 | PASS | clearPendingTimer(:54-58) 覆盖重排程前/retryNow(:160-165)/cancel(:167-170)；timer 回调先置空再跑(:127-129)；成功路径不排程。unmount：onBeforeUnmount→cancel(:172-174)。isUnmounted 接线等价：NotebookHome.vue:1092 `()=>componentUnmounted`，:5343 onUnmounted 置 true。原 :4973-4975/:4985-4987 unmount→engine.dispose() 保护保留为 composable :83-86                                                                                                                                                                                                                                                                     |
| c 装配接缝        | PASS | 模板 NotebookHome.vue:486-497 `:completion-engine-health`/`@retry-completion-engine`/`@update:visible` 与 SettingsDialog.vue:410/416 prop、:424-428 emit 声明一致。refresh 仅两触发点：NotebookHome.vue:5052（弹窗打开）、:5057（retry 后）；无 setInterval/watcher 轮询（grep 证实）。onMounted 调用点 :5319 `void setupCanonicalPublicDecoderOnce()` 保留，:4986-4990 委托 setupNow()，行为兼容                                                                                                                                                                                                                          |
| d i18n            | PASS | 程序化比对五语言 engine 块：各 17 键、键序一致 ALIGNED；lastError 五语言均含 {error} 插值。审计单写"13 键"与实际 17 键不符，按文件为准（17 键齐全无缺失）。zh-CN "已停用/未启用"区分清晰；ja '未有効'/'縮退運転' 略生硬但非占位机翻（minor）                                                                                                                                                                                                                                                                                                                                                                               |
| e 测试质量        | PASS | 5 测均断言行为契约：install 参数/次数、factory 计数、unhandledrejection 事件为零、预算耗尽后推进 60s 无新调用、retryNow 后 5→7 计数证明预算归零。mock 出处注释实测准确：MarkdownPredictor.ts:572/:562、factory catch→null :95-97。fake timers 覆盖两段退避（2500>2000、5500>5000）。minor：harness `disposeEngine` helper 与 getHealth mock 未被断言消费；两新文件缺 EOF 换行（eslint 未拦）                                                                                                                                                                                                                               |
| f 同族残留        | PASS | 全仓 grep `flaggedPublicDecoderSetup\|canonicalPublicDecoderSetup\|setupFlaggedPublicDecoderOnce`：仅剩 NotebookHome.vue:4986（委托包装）与 :5319（唯一调用点）；旧缓存变量与被删 flagged 函数零残留，无遗漏调用方                                                                                                                                                                                                                                                                                                                                                                                                         |
| g 样式/依赖       | PASS | 新增 CSS（SettingsDialog.vue .engine-meta-title/.engine-error）全为 var() token：--ink-muted/--text-xs/--fw-semibold/--ls-wide/--signal-error/--lh-ui；零 hex/rgb/hsl。token 定义核实：assets/styles/tokens.css:21/32/37/45、themes/paper.css:20/35（SettingsDialog 既有 :718/:786 已用同款）。lint:tokens 通过。package.json 零改动，零新依赖                                                                                                                                                                                                                                                                             |

## 门槛实跑

- vue-tsc --noEmit：exit 0，零错
- vitest：新 composable 测试 5/5 绿；主配置全量 85 files / 814 tests 全绿（npm test 另含 3 个 scripts/installed-evidence 配置未跑，与本改动无交集，范围如实注明）
- eslint（9 个改动文件）：exit 0
- git diff --check：exit 0 无告警

## 低置信/备注（不构成打回）

1. composable:84 `await engine.dispose()` 未包 try/catch——当前 dispose 实现吞掉一切 rejection，无现实风险，但属未来防回归弱点（若 dispose 实现变更，`void` 调用点 NotebookHome.vue:5319 会再现 unhandled rejection）。
2. setupNow:153-157 注释称提前触发 pending attempt "不膨胀预算"，实际 attempt():107 会计数；行为正确（该次为真实尝试），仅注释措辞不准。
3. retryNow 在上一 attempt 仍 in-flight 时是"搭车等待"而非中断重跑（仅空闲态保证立即重跑整链）；设置弹窗手动触发场景可接受。
4. 两新文件缺 EOF 换行（`\ No newline at end of file`），工具链不拦，建议补。

## Verdict

**通过** — B1/B2 验收标准与门槛全部满足；备注 1–4 为非阻断改进项。
