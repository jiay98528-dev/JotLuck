# M2 GUI E2E 验收清单

> 里程碑: Shell Recipe 驱动 (Shell Recipe Engine)
> 完成日期: 2026-06-26
> Commit: `a9911c0`
> Dev Server: http://localhost:5173

## 快速启动

```bash
cd D:\VibeCoding\MarkLuck
npm run dev
```

打开 http://localhost:5173

## 重要说明

M2 将所有子组件的布局 Props 从散字段统一为 Region 对象。**组件模板内部的渲染逻辑未变**——TopBar 的 5 种变体、LeftWing 的 4 种布局、StatusBar 的 4 种密度、RightWing 的 4 种策略行为应与 M1 完全一致。验收重点是确认 Props 重构无回归。

## 验收项

### 基础检查

- [ ] M2-01: `npm run dev` 正常启动，无编译错误
- [ ] M2-02: 浏览器打开 http://localhost:5173，主界面正常加载
- [ ] M2-03: F12 Console 无红色错误（允许的预存警告除外）

### 主题切换 — 布局无回归

- [ ] M2-04: 羽翼布局：三栏 + classic TopBar + 书签 LeftWing
- [ ] M2-05: 墨线书房：writing Canvas 居中 + writing-strip + 折叠 RightWing
- [ ] M2-06: 档案馆：search-first TopBar（搜索居中）+ research-stack LeftWing
- [ ] M2-07: 夜读星幕：reader TopBar + hidden 编辑器控件 + save-only StatusBar
- [ ] M2-08: 工坊轨道：StudioRail 侧轨 + compact TopBar

### 组件 Props 结构性验证

- [ ] M2-09: TopBar 的 5 种布局变体（classic/title-first/search-first/reader/compact）均可正确渲染
- [ ] M2-10: LeftWing 的 4 种布局（bookmarks/quiet-bookmarks/research-stack/studio-rail）均可正确渲染
- [ ] M2-11: StatusBar 的 4 种布局（full/quiet/save-only/compact）均可正确渲染
- [ ] M2-12: RightWing 的 sections 排序和默认展开在不同主题中正确（对比 M1）

### 亮暗色

- [ ] M2-13: 每个主题亮色 ↔ 暗色切换正常

### 数据安全

- [ ] M2-14: 打开笔记 → 输入文字 → 切换主题 → 内容保留
- [ ] M2-15: 切换主题不触发页面刷新

### 回归检查

- [ ] M2-16: Ctrl+K 搜索、Ctrl+B 加粗在非默认主题下正常
- [ ] M2-17: 导出功能在非默认主题下正常
- [ ] M2-18: 动作按钮放置（actionPlacements）在每个主题中正确路由

## L2 验证

| 检查项             |           结果           |
| ------------------ | :----------------------: |
| `vue-tsc --noEmit` |         ✅ PASS          |
| `eslint`           |         ✅ PASS          |
| `prettier --check` |         ✅ PASS          |
| `vitest run`       | ✅ 167 passed / 11 files |

## 验收结论

- [ ] 全部通过 — Props 重构无回归
- [ ] 存在问题（详见备注）

备注:
