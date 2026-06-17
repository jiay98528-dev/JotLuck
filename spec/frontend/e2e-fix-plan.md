# E2E 测试修复计划 — P0~P3

> 日期: 2026-06-05 | 基于根因分析制定

## P0 🔴 — export / share / wiki-link (0% 通过率)

**根因**: 测试文件使用旧 M1/M3 三栏布局选择器，组件已完全重构为 Winged Editor 模态框。

**修复策略**: 读取组件源码 DOM → 建立精确选择器映射 → 重写测试

### ExportDialog (6 tests)
| 旧选择器 | 新选择器 |
|------|------|
| `.export-dialog` | `.modal-overlay` |
| `.format-option` | `.format-card` |
| `.export-progress` | `.export-status` |
| 任何旧按钮选择器 | `.btn--primary` / `.btn--secondary` |

### ShareDialog (9 tests)
| 旧选择器 | 新选择器 |
|------|------|
| `.share-dialog` | `.modal-overlay` |
| `.share-format` | `.option-card` |
| `.share-channel` | `.option-card` |
| `.step-indicator` | `.step-dots` |

### Wiki-link (4 tests)
| 旧选择器 | 新选择器 |
|------|------|
| `.wiki-link-panel` | `.right-wing` > `.section-body--backlinks` |
| `.backlink-count` | `.count-badge` |

## P1 🟡 — editor (6 failures)

**根因**: 6个测试中的异步时序问题 + 选择器细微不匹配

**修复**:
- `openNote` 后添加 `waitForEditorReady`
- `.status-dirty` 检查前确认编辑器已聚焦
- 右翼大纲测试先展开手风琴再验证
- 命令面板测试确保 palette-overlay 可见

## P2 🟡 — templates / panels (12 failures)

**根因**: 面板选择器使用了旧 NavTree/TagPanel/RecentNotes 类名

**修复**:
- `.nav-tree` → `.right-wing .section-body--outline`
- `.tag-panel` → `.right-wing .tag-cloud`
- `.recent-notes` → `.left-wing .wing-bookmarks`
- 模板卡片: `.template-card` → `.tpl-card`

## P3 🟢 — 异步竞态加固

**修复策略**:
- 所有 `openNote()` 后添加 `waitForEditorReady`
- 自动保存测试增加 `waitForSaved` 超时到 8000ms
- 索引加载测试等待 `.wing-bookmark-dot` 数量达标
- 使用 `waitForFunction` 替代固定 `waitForTimeout`
