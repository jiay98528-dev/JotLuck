# M4 GUI E2E 验收清单

> 里程碑: 文档清理 + L3.5 审计 (Documentation & Audit)
> 完成日期: 2026-06-26
> Dev Server: http://localhost:5173

## 快速启动
```bash
cd D:\VibeCoding\MarkLuck
npm run dev
```
打开 http://localhost:5173

## 验收项

### 文档一致性
- [ ] M4-01: `doc/standards-css.md` 无 construct/glass 旧主题残留
- [ ] M4-02: `spec/milestones.md` M5 描述为"主题系统"（非"双主题"）
- [ ] M4-03: `spec/frontend/pages.md` 的 `useThemeStore` 描述与实际 v2 实现一致
- [ ] M4-04: `spec/frontend/components.md` 的 TopBar/LeftWing/RightWing/StatusBar/EditorControlStrip Props 表使用 `:region` 对象
- [ ] M4-05: `tool.md` 主题系统说明包含 v2 重构日期
- [ ] M4-06: `spec/progress.md` M5 状态为已完成，包含 M1-M4 重构详情

### L3.5 审计
- [ ] M4-07: L3.5 审计报告的 3 个一般问题（F1-F3）已修复
- [ ] M4-08: RightWing.vue 的 `@ts-nocheck` 已移除，vue-tsc 零错误

### 回归
- [ ] M4-09: 应用正常启动，Console 无红色错误
- [ ] M4-10: 5 个主题切换正常，布局/颜色/动效与 M3 一致
- [ ] M4-11: 全功能冒烟：新建笔记 → 编辑 → 搜索 → 导出 → 切换主题（V6 用户旅程）

## 验收结论

- [ ] 全部通过
- [ ] 存在问题（详见备注）

备注:
