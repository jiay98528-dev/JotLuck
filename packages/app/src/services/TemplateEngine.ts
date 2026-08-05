/**
 * TemplateEngine — 模板渲染引擎
 *
 * 支持 7 种占位符: {{date}} {{time}} {{year}} {{month}} {{day}} {{datetime}} {{week}}
 * 3 套内置模板: 日记 / 会议纪要 / 周报
 * 自定义模板: 当前笔记本内 .jotluck/templates 文件持久化
 *
 * @see migration-map.md §4
 */
import type { IFileSystemService, SupportedLocale, TemplateItem } from '@/types';
import { createLocaleCollator, getCurrentLocale, translate, translateForLocale } from '@/i18n';
import { createUserMessageError } from './command-errors';

const CUSTOM_TEMPLATES_KEY = 'jotluck-custom-templates';
export const CUSTOM_TEMPLATE_DIR = '/.jotluck/templates';

// === Placeholder Replacement ===

const PADDED = (n: number): string => String(n).padStart(2, '0');

export function renderTemplate(
  template: string,
  date: Date = new Date(),
  locale: SupportedLocale = getCurrentLocale(),
): string {
  const dayKeys = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
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
    .replace(
      /\{\{week\}\}/g,
      translateForLocale(locale, 'templates.weekLabel', {
        week: Math.ceil(date.getDate() / 7),
      }),
    )
    .replace(
      /\{\{weekday\}\}/g,
      // i18n-dynamic-key: dayKeys is a closed tuple matching templates.weekdays.
      translateForLocale(locale, `templates.weekdays.${dayKeys[date.getDay()]}`),
    )
    .replace(
      /\{\{weekRange\}\}/g,
      `${weekStart.toISOString().slice(0, 10)} ~ ${weekEnd.toISOString().slice(0, 10)}`,
    );
}

export function previewTemplate(
  template: string,
  locale: SupportedLocale = getCurrentLocale(),
): string {
  return renderTemplate(template, new Date(), locale);
}

// === Built-in Templates ===

function tr(locale: SupportedLocale, key: string): string {
  // i18n-dynamic-key: callers construct keys from the closed built-in template families below.
  return translateForLocale(locale, key);
}

export function getBuiltInTemplates(locale: SupportedLocale = getCurrentLocale()): TemplateItem[] {
  const diary = (key: string): string => tr(locale, `templates.diary.${key}`);
  const meeting = (key: string): string => tr(locale, `templates.meeting.${key}`);
  const weekly = (key: string): string => tr(locale, `templates.weekly.${key}`);
  return [
    {
      id: 'diary',
      name: diary('name'),
      description: diary('description'),
      content: `---
title: ${diary('title').replace('{date}', '{{date}}')}
tags: [${diary('tag')}]
created: {{date}}
---

# ${diary('title').replace('{date}', '{{date}}')}

## ${diary('summary')}


## ${diary('todos')}

- [ ]
- [ ]
- [ ]

## ${diary('notes')}


## ${diary('conclusion')}

`,
      isBuiltin: true,
    },
    {
      id: 'meeting',
      name: meeting('name'),
      description: meeting('description'),
      content: `---
title: ${meeting('title')} — {{date}}
tags: [${meeting('tag')}]
created: {{date}}
---

# ${meeting('title')}

**${meeting('date')}**: {{date}}
**${meeting('time')}**: {{time}}
**${meeting('attendees')}**:

---

## ${meeting('agenda')}

1.

## ${meeting('discussion')}


## ${meeting('decisions')}


## ${meeting('actions')}

- [ ]  ${meeting('owner')}:  ${meeting('due')}:
- [ ]  ${meeting('owner')}:  ${meeting('due')}:

## ${meeting('next')}

`,
      isBuiltin: true,
    },
    {
      id: 'weekly',
      name: weekly('name'),
      description: weekly('description'),
      content: `---
title: ${weekly('title')} — {{weekRange}}
tags: [${weekly('tag')}]
created: {{date}}
---

# ${weekly('title')} ({{weekRange}})

## ${weekly('completed')}


## ${weekly('inProgress')}


## ${weekly('problems')}


## ${weekly('nextWeek')}


## ${weekly('coordination')}

`,
      isBuiltin: true,
    },
  ];
}

export function getBuiltInTemplateContent(
  templatePath: string,
  locale: SupportedLocale = getCurrentLocale(),
): string {
  const tpl = getBuiltInTemplates(locale).find((t) => t.id === templatePath);
  return tpl?.content ?? '';
}

// === Custom Templates (notebook files) ===

function sanitizeTemplateFileName(name: string): string {
  const safe = name
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, '-')
    .replace(/\s+/g, ' ')
    .slice(0, 80);
  return `${safe || translate('templates.customFallback')}.md`;
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
      ?.replace(/\.(md|markdown|mdx|txt)$/i, '') || translate('templates.customFallback');
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
    const collator = createLocaleCollator();
    return templates.sort((a, b) => collator.compare(a.name, b.name));
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
    throw createUserMessageError('templates.invalidPath');
  }
  await fs.deleteFile(templatePath);
}
