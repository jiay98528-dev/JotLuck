# 架构与配置笔记语料

## Provider Engine 说明

补全系统采用分层 provider 架构。编辑器只调用 `MarkdownPredictor.getGhostText()`，不关心内部来自规则、索引还是 N-gram。

数据流：

```text
GhostTextPlugin
  -> MarkdownPredictor
  -> CompletionContextBuilder
  -> CompletionProvider[]
  -> CompletionResolver
  -> ghost text
```

设计目标：

- 保持外部接口稳定。
- 让结构化补全和普通文本补全分离。
- 把排序、裁剪、降噪集中在 resolver。
- 后续可以接入本地 LLM，但默认不启用。

当前 provider：

- 格式闭合。
- Markdown 结构。
- Wiki-link。
- 标签。
- 文件路径。
- 近期短语。
- 短中文。
- N-gram。

LLM provider 只保留 stub，不进入默认链路。

## 配置说明

文字补全设置存储在本地。默认启用 ghost text，但用户可以在设置里关闭。关闭后编辑器应立即清理当前 ghost text，并且刷新后保持设置。

关键字段：

- `enabled`：是否启用补全。
- `maxSuggestionLength`：候选最大长度。
- `minConfidence`：普通文本最低置信度。
- `aggressiveness`：防抖策略。
- `showDebugStats`：仅用于开发观察。

配置变更后，编辑器需要重新配置 extension。不能只更新设置面板，否则用户会看到开关变化但编辑器行为不变。

## 存储说明

N-gram 本地模型存储在 localStorage。旧键名继续保留，内容升级为 v3 JSONL tuple。

meta 中需要记录：

- schemaVersion。
- docs。
- totalEntries。
- lastSave。
- lastError。
- migratedFrom。

读取失败时回退空模型，编辑器继续可用。写入失败时尝试裁剪，再失败则记录错误，不阻断用户编辑。

## 配置变更记录

这次语料配置的变化：

- 删除小说类语料源。
- 降低英文编程文档权重。
- 降低项目规格文档权重。
- 提高短笔记和技术笔记占比。
- 保留 Markdown 结构语料，但不让它主导模型。

这样做的原因是 baseline 要服务普通笔记记录，而不是长文创作。项目文档可以提供技术词汇，但不能让所有笔记都像规格说明。
