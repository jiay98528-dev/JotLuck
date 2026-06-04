/**
 * YAMLParser — YAML frontmatter 解析器
 *
 * M2-02: 从 Markdown 内容中提取和解析 YAML frontmatter。
 * 支持 title, tags, created, updated 等标准字段。
 *
 * @module YAMLParser
 * @see milestones.md M2-02
 */

import yaml from 'js-yaml';

/** 解析后的 frontmatter 数据 */
export interface FrontmatterData {
  title?: string;
  tags?: string[];
  created?: string;
  updated?: string;
  [key: string]: unknown;
}

/** Frontmatter 解析结果 */
export interface FrontmatterResult {
  /** 解析后的数据 */
  data: FrontmatterData;
  /** frontmatter 原始文本 */
  raw: string;
  /** frontmatter 结束后的正文起始偏移 */
  contentStart: number;
  /** 是否有 frontmatter */
  hasFrontmatter: boolean;
}

/** 空 frontmatter 结果常量 */
const EMPTY_RESULT: FrontmatterResult = {
  data: {},
  raw: '',
  contentStart: 0,
  hasFrontmatter: false,
};

/** Frontmatter 分隔符正则 */
const FRONTMATTER_RE = /^---\s*\n([\s\S]*?)\n---\s*\n/;

/**
 * 从 Markdown 内容中解析 YAML frontmatter
 *
 * @param content - Markdown 原始内容
 * @returns 解析结果（含数据和正文起始位置）
 */
export function parseFrontmatter(content: string): FrontmatterResult {
  const match = content.match(FRONTMATTER_RE);
  if (!match) {
    return EMPTY_RESULT;
  }

  const raw = match[1] ?? '';
  let data: FrontmatterData = {};

  try {
    const parsed = yaml.load(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      data = normalizeFrontmatter(parsed as Record<string, unknown>);
    }
  } catch {
    // YAML 解析失败时返回空数据（非崩溃，仅记录原始文本）
    data = {};
  }

  return {
    data,
    raw,
    contentStart: match[0].length,
    hasFrontmatter: true,
  };
}

/**
 * 规范化 frontmatter 数据：
 * - tags 字段可以是 YAML 数组 `[a, b]` 或逗号分隔字符串 `"a, b"`
 * - 确保 title 是字符串
 */
function normalizeFrontmatter(raw: Record<string, unknown>): FrontmatterData {
  const result: FrontmatterData = {};

  if (typeof raw.title === 'string') {
    result.title = raw.title;
  }

  if (Array.isArray(raw.tags)) {
    result.tags = raw.tags.map((t) => String(t));
  } else if (typeof raw.tags === 'string') {
    result.tags = raw.tags
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
  }

  if (typeof raw.created === 'string' || typeof raw.created === 'number') {
    result.created = String(raw.created);
  }
  if (typeof raw.updated === 'string' || typeof raw.updated === 'number') {
    result.updated = String(raw.updated);
  }

  // 透传其他自定义字段
  for (const [key, value] of Object.entries(raw)) {
    if (!(key in result)) {
      result[key] = value;
    }
  }

  return result;
}

/**
 * 从 Markdown 内容中剥离 frontmatter，返回纯正文
 */
export function stripFrontmatter(content: string): string {
  const match = content.match(FRONTMATTER_RE);
  if (!match) return content;
  return content.slice(match[0].length);
}

/**
 * 从 Markdown 内容中提取标题（首个 H1）
 */
export function extractTitle(content: string): string {
  // 跳过 frontmatter
  const body = stripFrontmatter(content);
  const h1Match = body.match(/^#\s+(.+)$/m);
  return h1Match?.[1]?.trim() ?? 'Untitled';
}
