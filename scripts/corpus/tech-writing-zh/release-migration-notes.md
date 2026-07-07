# 发布与迁移记录语料

## 迁移步骤

目标：把旧的单体补全逻辑迁移为 provider engine。

步骤：

1. 先更新规格文档。
2. 新增核心类型和上下文构建器。
3. 迁移结构化补全 provider。
4. 接入 resolver。
5. 保留 facade 方法。
6. 跑旧测试，确认外部行为不变。
7. 补新测试，覆盖 provider 级行为。

迁移过程中不要一次性修改编辑器组件。编辑器集成已经有 IME、Tab、Escape 和失焦处理，直接大改风险很高。更稳的方式是保持 `MarkdownPredictor` 入口不变。

## 发布检查单

- 类型检查通过。
- ESLint 通过。
- Prettier 检查通过。
- 相关单测通过。
- 自动补全 E2E 通过。
- GUI 手动验收通过。
- 训练报告更新。
- baseline 文件更新。
- 语料来源记录完整。

如果某个检查无法执行，需要记录具体原因和剩余风险，不能只写“未测”。

## 回滚策略

如果新 baseline 体感明显变差，不要回滚 provider 架构。先回滚语料配置和 baseline 文件，因为补全语感主要来自语料和权重。

可回滚内容：

- `corpus.config.json`。
- 语料文件。
- `baseline-ngram.v1.compact.txt`。
- `training-report.json`。

不建议回滚内容：

- N-gram v3 兼容读取。
- Provider facade。
- 训练 partial 状态。
- 路径 prefix 修复。

原因：这些属于可靠性地基，和语料体感问题是不同层级。

## 版本记录模板

### Changed

- 重建基线语料库，移除长篇小说语料。
- 新增短笔记和技术笔记样例。
- 训练报告增加加权覆盖指标。
- baseline 重新生成。

### Fixed

- 避免 CRLF 行尾进入训练模型。
- 避免 frontmatter 参与训练。
- 避免训练报告把 fallback 当作模型命中。

### Validation

- `pnpm generate-baseline`
- `pnpm typecheck`
- targeted unit tests
- autocomplete E2E
- GUI smoke check

### Notes

这次变更不涉及本地 LLM。LLMProvider 仍然是禁用扩展点。
