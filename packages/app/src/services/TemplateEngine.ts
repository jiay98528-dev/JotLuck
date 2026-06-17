/**
 * TemplateEngine — 模板渲染引擎
 *
 * 支持 7 种占位符: {{date}} {{time}} {{year}} {{month}} {{day}} {{datetime}} {{week}}
 * 3 套内置模板: 日记 / 会议纪要 / 周报
 * 自定义模板: localStorage 持久化
 *
 * @see migration-map.md §4
 */
import type { TemplateItem } from '@/types';

const CUSTOM_TEMPLATES_KEY = 'markluck-custom-templates';

// === Placeholder Replacement ===

const PADDED = (n: number): string => String(n).padStart(2, '0');

export function renderTemplate(template: string, date: Date = new Date()): string {
  const dayNames = ['日', '一', '二', '三', '四', '五', '六'];
  const weekStart = new Date(date);
  weekStart.setDate(date.getDate() - date.getDay());
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);

  return template
    .replace(/\{\{date\}\}/g, date.toISOString().slice(0, 10))
    .replace(/\{\{time\}\}/g, `${PADDED(date.getHours())}:${PADDED(date.getMinutes())}`)
    .replace(/\{\{datetime\}\}/g, date.toISOString().replace('T', ' ').slice(0, 19))
    .replace(/\{\{year\}\}/g, String(date.getFullYear()))
    .replace(/\{\{month\}\}/g, PADDED(date.getMonth() + 1))
    .replace(/\{\{day\}\}/g, PADDED(date.getDate()))
    .replace(/\{\{week\}\}/g, `第${Math.ceil(date.getDate() / 7)}周`)
    .replace(/\{\{weekday\}\}/g, `星期${dayNames[date.getDay()]}`)
    .replace(
      /\{\{weekRange\}\}/g,
      `${weekStart.toISOString().slice(0, 10)} ~ ${weekEnd.toISOString().slice(0, 10)}`,
    );
}

export function previewTemplate(template: string): string {
  return renderTemplate(template, new Date());
}

// === Built-in Templates ===

const BUILTIN_TEMPLATES: TemplateItem[] = [
  {
    id: 'diary',
    name: '日记',
    description: '每日日记模板，包含日期和待办列表',
    content: `---
title: {{date}} 日记
tags: [日记]
created: {{date}}
---

# {{date}} 日记

## 今日概要


## 待办事项

- [ ]
- [ ]
- [ ]

## 笔记


## 总结

`,
    isBuiltin: true,
  },
  {
    id: 'meeting',
    name: '会议纪要',
    description: '会议记录模板，包含参会人、议题和行动项',
    content: `---
title: 会议纪要 — {{date}}
tags: [会议]
created: {{date}}
---

# 会议纪要

**日期**: {{date}}
**时间**: {{time}}
**参会人**:

---

## 议题

1.

## 讨论要点


## 决议


## 行动项

- [ ]  负责人:  截止日期:
- [ ]  负责人:  截止日期:

## 下次会议

`,
    isBuiltin: true,
  },
  {
    id: 'weekly',
    name: '周报',
    description: '每周工作总结模板',
    content: `---
title: 周报 — {{weekRange}}
tags: [周报]
created: {{date}}
---

# 周报 ({{weekRange}})

## 本周完成


## 进行中


## 遇到的问题


## 下周计划


## 需要协调

`,
    isBuiltin: true,
  },
];

export function getBuiltInTemplates(): TemplateItem[] {
  return BUILTIN_TEMPLATES;
}

export function getBuiltInTemplateContent(templatePath: string): string {
  const tpl = BUILTIN_TEMPLATES.find((t) => t.id === templatePath);
  return tpl?.content ?? '';
}

// === Custom Templates (localStorage) ===

function loadCustomTemplates(): TemplateItem[] {
  try {
    const raw = localStorage.getItem(CUSTOM_TEMPLATES_KEY);
    return raw ? (JSON.parse(raw) as TemplateItem[]) : [];
  } catch {
    return [];
  }
}

function saveCustomTemplates(templates: TemplateItem[]): void {
  localStorage.setItem(CUSTOM_TEMPLATES_KEY, JSON.stringify(templates));
}

export function getCustomTemplates(): TemplateItem[] {
  return loadCustomTemplates();
}

export function getCustomTemplateContent(templatePath: string): string {
  const templates = loadCustomTemplates();
  const tpl = templates.find((t) => t.id === templatePath);
  return tpl?.content ?? '';
}

export function saveCustomTemplate(
  name: string,
  description: string,
  content: string,
): TemplateItem {
  const templates = loadCustomTemplates();
  const item: TemplateItem = {
    id: `custom-${Date.now()}`,
    name,
    description,
    content,
    isBuiltin: false,
  };
  templates.push(item);
  saveCustomTemplates(templates);
  return item;
}

export function deleteCustomTemplate(id: string): boolean {
  const templates = loadCustomTemplates();
  const idx = templates.findIndex((t) => t.id === id);
  if (idx === -1) return false;
  templates.splice(idx, 1);
  saveCustomTemplates(templates);
  return true;
}
