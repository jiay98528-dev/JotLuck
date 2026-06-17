# Changelog

## [0.2.0] — 2026-06-09

### Added

- 文字补全系统：幽灵文本预测 + 结构化补全（Wiki-link/标签/路径）
- NGramEngine 纯算法 N-gram 统计预测引擎
- GhostTextPlugin CM6 ViewPlugin，光标后灰色斜体幽灵文本
- 基准 L2 预训练语料管道 (train-baseline.ts + corpus/)
- SettingsDialog 文字补全开关

### Changed

- Tab 键行为：由 live preview 块固定改为 ghost text 接受优先消费
- Live preview 块固定切换改为 `Ctrl+Click`

## [0.1.0] — 2026-06-04

### Added

- Markdown 编辑器（CodeMirror 6），语法高亮 + 块标记装饰
- Wiki-link `[[...]]` 双向链接 + 反向链接面板
- 全文搜索（minisearch），支持正则/标签/日期/文件夹过滤
- 文件树 + 大纲导航 + 最近笔记 + 标签云
- 6 种导出格式：PDF / DOCX / XLSX / CSV / TXT / HTML
- Markdown 格式分享（剪贴板 / 邮件 / 系统分享）
- 模板系统：3 套内置模板（日记/会议/周报）+ 自定义模板，7 种占位符
- 格式工具栏（12 种格式按钮 + 快捷键）
- 双主题：构成主义 + 发光磨玻璃，亮/暗色模式
- 登录引导页
- Tauri v2 桌面后端：文件操作 / tantivy 搜索 / 文件监控 / 路径安全
- Rust 模板引擎
- XSS 防护（DOMPurify）
- 全局 Focus ring + prefers-reduced-motion
- 4px 栅格设计系统 + OKLCH 色彩
- E2E 测试（Playwright，Chromium/Firefox/WebKit）

### Known Limitations

- 移动端 UI 适配（计划 M8）
- VS Code 插件（计划 M9）
- 虚拟滚动（大文件夹场景）
- WiX 安装器需手动安装
