# Corpus Sources

`provenance.json` 是训练来源的机器可读事实清单。训练器只接受 `approval: approved`、许可证证据文件存在且内容哈希匹配的来源。

## 当前批准来源

- `creative-zh/`：项目自有的短篇自然中文笔记，MIT。
- `tech-writing-zh/`：项目自有的中文技术记录，MIT。
- `note-patterns-zh/`：项目自有的任务、会议、复盘短句，MIT；其中 `autocomplete-regression-notes.md` 与高度重复的 `short-anchors.md` 明确排除训练。
- `markdown-structures/`：项目自有的 Markdown 周边短文本，MIT。
- `code-doc-en/`：项目自有的英文软件笔记示例，MIT；自指且与其他文档高度重复的 `software-development-patterns.md` 明确排除训练。
- `_web-cache/generated-project-owned/`：由固定 seed 和
  `jotluck-synthetic-short-notes-v1` 生成的 24MiB 项目自有短笔记池，MIT。五个来源分别覆盖
  中文自然观察、项目复盘、技术诊断与英文工作流、技术诊断；每个来源以独立 JSONL pack
  哈希登记。正文不进入 Git，只有生成器、固定 seed、SPDX/所有者、pack 哈希与治理报告进入审计链。

合成来源在 `corpus.config.json` 与 `provenance.json` 中已获批准，但“批准”不代表文件可以缺失：
干净克隆未显式运行生成器、pack 被截断、出现未知文件或哈希漂移时，训练器必须 fail closed。

`doc/`、`spec/`、E2E 质量样本和 `formal-holdout.json` 都不是训练来源。

## Web 候选来源

`web-sources.json` 只是候选入口，不构成授权。启用项必须逐一补齐：

- `license.status: approved`
- SPDX 或明确的 `licenseId`
- 可复核的 `license.evidence`
- 必要的路径白名单和拒绝列表

只要任一启用项未获批准，采集器会在网络请求和文件写入之前失败。采集结果保留来源 ID、许可证、clean SHA-256 和清洗统计；它仍不会自动进入模型，必须显式提升到配置和来源清单。

## 永久排除

- `novel-zh/` 长篇小说和连续叙事材料。
- 真实用户笔记、私人目录、账户页面和登录态内容。
- 许可证不明、仅允许阅读但不允许再分发/衍生训练的网页正文。
- 包含姓名、署名、邮箱、电话、账号、地址、客户信息或凭据的片段。
- GitHub 会话横幅、MDN 反馈控件、Rust Book 导航提示、站点版权/登录/推广等模板文本。
- 为质量评测或回归测试专门编写的期望答案。
