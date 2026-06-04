/**
 * TemplateEngine — 模板引擎
 *
 * M4-01~04: 占位符替换 + 内置模板 + 自定义模板。
 *
 * @module TemplateEngine
 * @see milestones.md M4-01~04
 */

import type { TemplateItem } from '@/types';

/** localStorage key for custom templates */
const CUSTOM_TEMPLATES_KEY = 'markluck-custom-templates';

/** Custom template storage shape */
interface CustomTemplateEntry {
  id: string;
  name: string;
  description: string;
  content: string;
  createdAt: string;
}

/** 占位符 → 替换值 */
interface PlaceholderContext {
  date: string;
  time: string;
  year: string;
  month: string;
  day: string;
  week: string;
  datetime: string;
}

/** 生成占位符上下文 */
function buildContext(date = new Date()): PlaceholderContext {
  const pad = (n: number) => String(n).padStart(2, '0');
  const weekNames = ['日', '一', '二', '三', '四', '五', '六'];
  const y = date.getFullYear();
  const m = pad(date.getMonth() + 1);
  const d = pad(date.getDate());
  const h = pad(date.getHours());
  const min = pad(date.getMinutes());
  const s = pad(date.getSeconds());

  return {
    date: `${y}-${m}-${d}`,
    time: `${h}:${min}:${s}`,
    year: String(y),
    month: m,
    day: d,
    week: `周${weekNames[date.getDay()] ?? '?'}`,
    datetime: `${y}-${m}-${d} ${h}:${min}:${s}`,
  };
}

/** 占位符映射表 */
const PLACEHOLDERS: Array<{ key: string; field: keyof PlaceholderContext }> = [
  { key: '{{datetime}}', field: 'datetime' },
  { key: '{{date}}', field: 'date' },
  { key: '{{time}}', field: 'time' },
  { key: '{{year}}', field: 'year' },
  { key: '{{month}}', field: 'month' },
  { key: '{{day}}', field: 'day' },
  { key: '{{week}}', field: 'week' },
];

/**
 * 渲染模板内容：替换所有占位符
 */
export function renderTemplate(template: string, date?: Date): string {
  const ctx = buildContext(date);
  let result = template;
  for (const { key, field } of PLACEHOLDERS) {
    result = result.replace(new RegExp(key.replace(/[{}]/g, '\\$&'), 'g'), ctx[field]);
  }
  return result;
}

/**
 * 预览模板（占位符替换为当前值，但不创建笔记）
 */
export function previewTemplate(template: string): string {
  return renderTemplate(template);
}

/**
 * 内置模板列表
 */
export function getBuiltInTemplates(): TemplateItem[] {
  return [
    {
      name: '日记',
      path: '_builtin_/diary',
      description: '每日日记模板',
    },
    {
      name: '会议纪要',
      path: '_builtin_/meeting',
      description: '会议记录模板',
    },
    {
      name: '周报',
      path: '_builtin_/weekly',
      description: '每周工作总结',
    },
  ];
}

/** 获取内置模板内容 */
export function getBuiltInTemplateContent(templatePath: string): string {
  switch (templatePath) {
    case '_builtin_/diary':
      return `---
title: {{date}} 日记
tags: [diary]
created: {{date}}
---

# {{date}} {{week}}

## 今日待办

- [ ] 任务一
- [ ] 任务二
- [ ] 任务三

## 笔记

开始记录今天的想法...

## 总结

今天完成了什么？学到了什么？
`;

    case '_builtin_/meeting':
      return `---
title: 会议纪要 — {{date}}
tags: [meeting]
created: {{date}}
---

# 会议纪要

- **日期**: {{date}} {{time}}
- **参会人**:
- **主题**:

## 议程

1.
2.
3.

## 讨论要点

### 议题一



### 议题二



## 决议

- [ ]
- [ ]

## 下一步行动

| 行动项 | 负责人 | 截止日期 |
|--------|--------|----------|
| | | |
`;

    case '_builtin_/weekly':
      return `---
title: 周报 — {{date}}
tags: [weekly]
created: {{date}}
---

# 周报 {{date}}

> 周期：本周

## 本周完成

-
-
-

## 进行中

-
-

## 遇到的问题

-

## 下周计划

-
-
-

## 思考与收获

`;
    default:
      return '';
  }
}

/**
 * 获取自定义模板列表
 */
export function getCustomTemplates(): TemplateItem[] {
  try {
    const raw = localStorage.getItem(CUSTOM_TEMPLATES_KEY);
    if (!raw) return [];
    const entries: CustomTemplateEntry[] = JSON.parse(raw);
    return entries.map((e) => ({
      name: e.name,
      path: `_custom_/${e.id}`,
      description: e.description,
    }));
  } catch {
    return [];
  }
}

/**
 * 获取自定义模板内容
 */
export function getCustomTemplateContent(templatePath: string): string {
  const id = templatePath.replace('_custom_/', '');
  try {
    const raw = localStorage.getItem(CUSTOM_TEMPLATES_KEY);
    if (!raw) return '';
    const entries: CustomTemplateEntry[] = JSON.parse(raw);
    return entries.find((e) => e.id === id)?.content ?? '';
  } catch {
    return '';
  }
}

/**
 * 保存自定义模板
 */
export function saveCustomTemplate(
  name: string,
  description: string,
  content: string,
): TemplateItem {
  const entries = loadCustomEntries();
  const id = `tpl_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

  entries.push({
    id,
    name,
    description,
    content,
    createdAt: new Date().toISOString(),
  });

  localStorage.setItem(CUSTOM_TEMPLATES_KEY, JSON.stringify(entries));

  return { name, path: `_custom_/${id}`, description };
}

/**
 * 删除自定义模板
 */
export function deleteCustomTemplate(path: string): boolean {
  const id = path.replace('_custom_/', '');
  try {
    const raw = localStorage.getItem(CUSTOM_TEMPLATES_KEY);
    if (!raw) return false;
    const entries: CustomTemplateEntry[] = JSON.parse(raw);
    const filtered = entries.filter((e) => e.id !== id);
    if (filtered.length === entries.length) return false;
    localStorage.setItem(CUSTOM_TEMPLATES_KEY, JSON.stringify(filtered));
    return true;
  } catch {
    return false;
  }
}

/** 加载原始条目 */
function loadCustomEntries(): CustomTemplateEntry[] {
  try {
    const raw = localStorage.getItem(CUSTOM_TEMPLATES_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}
