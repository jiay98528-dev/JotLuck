# M3 GUI E2E 验收清单

> 里程碑: 布局深层差异化 (Deep Layout Differentiation)
> 完成日期: 2026-06-26
> Dev Server: http://localhost:5173

## 快速启动
```bash
cd D:\VibeCoding\MarkLuck
npm run dev
```
打开 http://localhost:5173

## 验收项

### 墨线书房（markluck.ink-study / focus / writing）
- [ ] M3-01: 切换到墨线书房 → writing 模式 Canvas 居中显示（带淡色背景渐变 + 羽翼阴影）
- [ ] M3-02: writing-strip 工具栏在编辑器上方居中，仅图标模式
- [ ] M3-03: RightWing 自动折叠
- [ ] M3-04: 背景纸纹可见（`mix-blend-mode: multiply`）
- [ ] M3-05: 脉冲线动效可见（ambient 级别）

### 档案馆（markluck.archive / archive）
- [ ] M3-06: search-first TopBar — 搜索框在 TopBar 居中
- [ ] M3-07: research-stack LeftWing — 笔记标题列表显示
- [ ] M3-08: RightWing 展开，标签和反链优先
- [ ] M3-09: 默认分栏视图（split mode）
- [ ] M3-10: 档案纸色 + 横线背景渐变可见

### 夜读星幕（markluck.reader-nocturne / reader）
- [ ] M3-11: reader 模式 TopBar（最小化）
- [ ] M3-12: 编辑器控件隐藏（hidden）
- [ ] M3-13: save-only StatusBar（仅显示保存状态）
- [ ] M3-14: 默认阅读视图（read mode），显示渲染预览
- [ ] M3-15: 星幕背景 + 呼吸光晕动效可见（immersive 级别）

### 工坊轨道（markluck.studio / studio）
- [ ] M3-16: StudioRail 侧轨渲染（宽 124px，在编辑器左侧）
- [ ] M3-17: StudioRail 包含 新建/模板/导出/分享/视图切换 按钮
- [ ] M3-18: compact TopBar + compact StatusBar
- [ ] M3-19: 默认分栏视图（split mode）
- [ ] M3-20: 暖橙操作强调色 + 竖线网格背景

### 动效与无障碍
- [ ] M3-21: 墨线书房有脉冲线 + 轻粒子层
- [ ] M3-22: 夜读星幕有呼吸光晕 + 粒子层
- [ ] M3-23: 羽翼布局无动效（effectProfile: none）
- [ ] M3-24: Reduced motion（系统设置）时所有动效停止

### 主题热切换
- [ ] M3-25: 羽翼布局 → 墨线书房 → RightWing 自动折叠，Canvas 居中
- [ ] M3-26: 墨线书房 → 档案馆 → RightWing 自动展开，搜索框居中，分栏模式
- [ ] M3-27: 档案馆 → 工坊轨道 → StudioRail 出现，TopBar/StatusBar 变紧凑
- [ ] M3-28: 工坊轨道 → 夜读星幕 → StudioRail 消失，reader mode
- [ ] M3-29: 所有切换保留未保存内容
- [ ] M3-30: 切换不触发页面刷新

### 回归
- [ ] M3-31: Ctrl+K 搜索在所有主题下可用
- [ ] M3-32: 导出功能在所有主题下可用
- [ ] M3-33: 外部 .md 只读模式在所有主题下可用

## 验收结论

- [ ] 全部通过
- [ ] 存在问题（详见备注）

备注:
