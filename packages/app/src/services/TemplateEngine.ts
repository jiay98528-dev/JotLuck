/**
 * TemplateEngine — 模板渲染引擎
 *
 * 支持 7 种占位符: {{date}} {{time}} {{year}} {{month}} {{day}} {{datetime}} {{week}}
 * 3 套内置模板: 日记 / 会议纪要 / 周报
 * 自定义模板: 当前笔记本内 .jotluck/templates 文件持久化
 *
 * @see migration-map.md §4
 */
import type { IFileSystemService, TemplateItem } from '@/types';

const CUSTOM_TEMPLATES_KEY = 'jotluck-custom-templates';
export const CUSTOM_TEMPLATE_DIR = '/.jotluck/templates';

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

// === Custom Templates (notebook files) ===

function sanitizeTemplateFileName(name: string): string {
  const safe = name
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, '-')
    .replace(/\s+/g, ' ')
    .slice(0, 80);
  return `${safe || '自定义模板'}.md`;
}

function customTemplatePath(name: string): string {
  return `${CUSTOM_TEMPLATE_DIR}/${sanitizeTemplateFileName(name)}`;
}

function serializeCustomTemplate(name: string, description: string, content: string): string {
  const meta = JSON.stringify({ name, description });
  return `<!-- jotluck-template ${meta} -->\n${content}`;
}

function parseCustomTemplateFile(path: string, raw: string): TemplateItem {
  const firstLineEnd = raw.indexOf('\n');
  const firstLine = firstLineEnd >= 0 ? raw.slice(0, firstLineEnd).trim() : raw.trim();
  const body = firstLine.startsWith('<!-- jotluck-template ') ? raw.slice(firstLineEnd + 1) : raw;
  let name =
    path
      .split('/')
      .pop()
      ?.replace(/\.(md|markdown|mdx|txt)$/i, '') || '自定义模板';
  let description = '';
  const match = firstLine.match(/^<!-- jotluck-template (.+) -->$/);
  if (match) {
    try {
      const meta = JSON.parse(match[1]!) as { name?: unknown; description?: unknown };
      if (typeof meta.name === 'string' && meta.name.trim()) name = meta.name.trim();
      if (typeof meta.description === 'string') description = meta.description;
    } catch {
      // User-editable template files are allowed to have a broken marker.
    }
  }
  return {
    id: path,
    name,
    description,
    content: body,
    isBuiltin: false,
  };
}

async function ensureCustomTemplateDirectory(fs: IFileSystemService): Promise<void> {
  await fs.createDirectory('/.jotluck');
  await fs.createDirectory(CUSTOM_TEMPLATE_DIR);
}

function loadCustomTemplates(): TemplateItem[] {
  try {
    const raw = localStorage.getItem(CUSTOM_TEMPLATES_KEY);
    return raw ? (JSON.parse(raw) as TemplateItem[]) : [];
  } catch {
    return [];
  }
}

export async function loadCustomTemplatesFromFiles(
  fs: IFileSystemService,
): Promise<TemplateItem[]> {
  try {
    const entries = await fs.listDirectory(CUSTOM_TEMPLATE_DIR);
    const templateFiles = entries.filter((entry) => entry.isFile);
    const templates: TemplateItem[] = [];
    for (const entry of templateFiles) {
      const raw = await fs.readFile(entry.path);
      templates.push(parseCustomTemplateFile(entry.path, raw));
    }
    return templates.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
  } catch {
    return [];
  }
}

export async function migrateLegacyCustomTemplates(fs: IFileSystemService): Promise<void> {
  const legacy = loadCustomTemplates();
  if (legacy.length === 0) return;
  await ensureCustomTemplateDirectory(fs);
  for (const template of legacy) {
    const path = customTemplatePath(template.name);
    await fs.writeFile(
      path,
      serializeCustomTemplate(template.name, template.description ?? '', template.content),
    );
  }
  localStorage.removeItem(CUSTOM_TEMPLATES_KEY);
}

export async function saveCustomTemplateToFiles(
  fs: IFileSystemService,
  name: string,
  description: string,
  content: string,
): Promise<TemplateItem> {
  await ensureCustomTemplateDirectory(fs);
  const path = customTemplatePath(name);
  await fs.writeFile(path, serializeCustomTemplate(name, description, content));
  return {
    id: path,
    name,
    description,
    content,
    isBuiltin: false,
  };
}

export async function deleteCustomTemplateFile(
  fs: IFileSystemService,
  templatePath: string,
): Promise<void> {
  if (!templatePath.startsWith(`${CUSTOM_TEMPLATE_DIR}/`)) {
    throw new Error('模板路径不在受控目录内');
  }
  await fs.deleteFile(templatePath);
}
