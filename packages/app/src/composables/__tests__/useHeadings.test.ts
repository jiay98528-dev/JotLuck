/**
 * WO-B2 useHeadings 测试 — AST 消费后行为契约
 *
 * 覆盖：ATX 1-6 级树形嵌套、setext 规则线与行号、同名 occurrence id 递增、
 * fence / frontmatter 内 `# 注释` 过滤、getActiveHeadingId 定位。
 */
import { describe, expect, it } from 'vitest';
import { useHeadings } from '../useHeadings';
import { effectScope } from 'vue';
import { EditorState } from '@codemirror/state';
import type { DocumentAnalysis, DocumentAnalysisResult } from '@/services/document-analysis';
import { parseDocument } from '@jotluck/renderer';

it('maps pending heading locations through edits without rescanning on cursor moves', () => {
  let publish!: (result: DocumentAnalysisResult) => void;
  const analysis = {
    subscribe: (listener: typeof publish) => {
      publish = listener;
      return () => {};
    },
  } as DocumentAnalysis;
  const scope = effectScope();
  const headings = scope.run(() => useHeadings(analysis))!;
  const source = '# One\n\ntext\n\n## Two\n\nend';
  publish({ revision: 1, ast: parseDocument(source), wordCount: 6 });
  const state = EditorState.create({ doc: source });
  const change = state.update({ changes: { from: 0, insert: 'intro\n\n' } });
  headings.mapChanges(change.changes, change.state.doc, 2);
  expect(headings.atPosition(0)).toBeNull();
  expect(headings.atPosition(source.indexOf('end') + 7)?.id).toBe('heading-two');
  const items = headings.ordered.value;
  headings.atPosition(7);
  headings.atPosition(20);
  expect(headings.ordered.value).toBe(items);
  scope.stop();
});

function flatten(items: ReturnType<typeof useHeadings>['headings']['value']): Array<{
  id: string;
  level: number;
  text: string;
  lineNumber: number;
  depth: number;
}> {
  const out: Array<{ id: string; level: number; text: string; lineNumber: number; depth: number }> =
    [];
  const walk = (list: ReturnType<typeof useHeadings>['headings']['value'], depth: number): void => {
    for (const item of list) {
      out.push({
        id: item.id,
        level: item.level,
        text: item.text,
        lineNumber: item.lineNumber,
        depth,
      });
      walk(item.children, depth + 1);
    }
  };
  walk(items, 0);
  return out;
}

describe('useHeadings.parseHeadings — ATX', () => {
  it('识别 1-6 级 ATX 标题并保持文档序', () => {
    const { parseHeadings } = useHeadings();
    const tree = parseHeadings('# h1\n## h2\n### h3\n#### h4\n##### h5\n###### h6');
    expect(
      flatten(tree).map((n) => ({ level: n.level, text: n.text, lineNumber: n.lineNumber })),
    ).toEqual([
      { level: 1, text: 'h1', lineNumber: 1 },
      { level: 2, text: 'h2', lineNumber: 2 },
      { level: 3, text: 'h3', lineNumber: 3 },
      { level: 4, text: 'h4', lineNumber: 4 },
      { level: 5, text: 'h5', lineNumber: 5 },
      { level: 6, text: 'h6', lineNumber: 6 },
    ]);
  });

  it('按 level 嵌套成树', () => {
    const { parseHeadings } = useHeadings();
    const tree = parseHeadings('# A\n## A1\n## A2\n### A2a\n# B');
    expect(tree.map((n) => n.text)).toEqual(['A', 'B']);
    expect(tree[0]!.children.map((n) => n.text)).toEqual(['A1', 'A2']);
    expect(tree[0]!.children[1]!.children.map((n) => n.text)).toEqual(['A2a']);
    expect(tree[1]!.children).toEqual([]);
  });

  it('同名标题 id occurrence 递增', () => {
    const { parseHeadings } = useHeadings();
    const tree = parseHeadings('## 概要\n内容\n## 概要\n## 概要');
    const flat = flatten(tree);
    const summaryNodes = flat.filter((n) => n.text === '概要');
    expect(summaryNodes.map((n) => n.id)).toEqual([
      'heading-概要',
      'heading-概要-2',
      'heading-概要-3',
    ]);
  });

  it('行尾 # 闭合符被 trim', () => {
    const { parseHeadings } = useHeadings();
    const tree = parseHeadings('## 标题 ## ');
    expect(tree[0]!.text).toBe('标题');
  });
});

describe('useHeadings.parseHeadings — setext', () => {
  it('= 规则线判为 level 1，行号指向文本行', () => {
    const { parseHeadings } = useHeadings();
    const tree = parseHeadings('主标题\n=====');
    expect(tree).toHaveLength(1);
    expect(tree[0]!.level).toBe(1);
    expect(tree[0]!.text).toBe('主标题');
    expect(tree[0]!.lineNumber).toBe(1);
  });

  it('- 规则线判为 level 2，行号指向文本行', () => {
    const { parseHeadings } = useHeadings();
    const tree = parseHeadings('副标题\n-----');
    expect(tree[0]!.level).toBe(2);
    expect(tree[0]!.text).toBe('副标题');
    expect(tree[0]!.lineNumber).toBe(1);
  });

  it('setext 与 ATX 混合时按文档序入树', () => {
    const { parseHeadings } = useHeadings();
    const tree = parseHeadings('Setext 一级\n===\n## 后续二级\n又行\n### 又二级 a');
    expect(flatten(tree).map((n) => ({ level: n.level, text: n.text }))).toEqual([
      { level: 1, text: 'Setext 一级' },
      { level: 2, text: '后续二级' },
      { level: 3, text: '又二级 a' },
    ]);
  });
});

describe('useHeadings.parseHeadings — 屏蔽块', () => {
  it('fence 内的 `# 注释` 不进 TOC', () => {
    const { parseHeadings } = useHeadings();
    const tree = parseHeadings('```md\n# 这是注释不是标题\ninside\n```\n## 真标题');
    expect(flatten(tree).map((n) => n.text)).toEqual(['真标题']);
  });

  it('frontmatter 内的 `# x` 不进 TOC', () => {
    const { parseHeadings } = useHeadings();
    const tree = parseHeadings('---\ntitle: x\n# 元数据\n---\n## 真标题');
    expect(flatten(tree).map((n) => n.text)).toEqual(['真标题']);
  });
});

describe('useHeadings.getActiveHeadingId', () => {
  it('定位光标所在标题：选中层级内最后出现的标题', () => {
    const { update, getActiveHeadingId } = useHeadings();
    // 行号语义：标题行本身即激活该标题（lineNumber <= cursorLine，与现网实现一致）
    update('# A\n段落\n## A1\n段落\n## A2\n### A2a');
    expect(getActiveHeadingId(1)).toBe('heading-a');
    expect(getActiveHeadingId(2)).toBe('heading-a');
    expect(getActiveHeadingId(3)).toBe('heading-a1');
    expect(getActiveHeadingId(5)).toBe('heading-a2');
    expect(getActiveHeadingId(7)).toBe('heading-a2a');
    expect(getActiveHeadingId(99)).toBe('heading-a2a');
  });

  it('空文档返回 null', () => {
    const { getActiveHeadingId } = useHeadings();
    expect(getActiveHeadingId(1)).toBeNull();
  });
});
