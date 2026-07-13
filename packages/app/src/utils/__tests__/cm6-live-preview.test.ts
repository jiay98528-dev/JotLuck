import { describe, expect, it } from 'vitest';
import { __parseLiveBlocksForTest } from '../cm6-live-preview';

describe('cm6 live preview table rendering', () => {
  it('renders table rows with a shared grid template instead of fake table cells', () => {
    const blocks = __parseLiveBlocksForTest(
      ['| 维度 | 评分 | 说明 |', '| :--- | ---: | :--- |', '| 前端开发 | 85 | React 主力栈 |'].join(
        '\n',
      ),
    );

    const rows = blocks.filter((block) => block.type === 'tableRow');
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ tableColumnCount: 3, tableHeader: true });
    expect(rows[1]).toMatchObject({ position: 'separator' });
    expect(rows[2]?.tableGridTemplate).toBe(rows[0]?.tableGridTemplate);
    expect(rows[0]?.html).toContain('ml-table-cell--header');
    expect(rows[0]?.html).toContain('data-table-column-count="3"');
    expect(rows[2]?.html).toContain('ml-table-cell--align-right');
    expect(rows[2]?.html).not.toContain('ml-td');
  });

  it('marks table rows without a separator as unclosed', () => {
    const rows = __parseLiveBlocksForTest('| A | B |\n| C | D |').filter(
      (block) => block.type === 'tableRow',
    );

    expect(rows.every((row) => row.unclosed)).toBe(true);
  });
});

describe('cm6 live preview markdown block boundaries', () => {
  it('keeps setext heading text and rule as paired heading blocks', () => {
    const blocks = __parseLiveBlocksForTest('Release Notes\n---\n\nBody text');

    expect(blocks[0]).toMatchObject({
      type: 'setextHeadingText',
      raw: 'Release Notes',
    });
    expect(blocks[0]?.html).toContain('Release Notes');
    expect(blocks[0]?.html).toContain('<h2 id="heading-release-notes">');
    expect(blocks[1]).toMatchObject({
      type: 'setextHeadingRule',
      raw: '---',
    });
    expect(blocks[1]?.html).toBe('');
  });

  it('keeps fenced JSON as code fence lines instead of wrapping it as bare JSON', () => {
    const blocks = __parseLiveBlocksForTest(
      ['```json', '{', '  "ok": true', '}', '```'].join('\n'),
    );

    expect(blocks).toHaveLength(5);
    expect(blocks.every((block) => block.type === 'codeFenceLine')).toBe(true);
    expect(blocks[0]?.html).toContain('cm-code-lang');
    expect(blocks[2]?.html).toContain('"ok": true');
  });

  it('renders a bare JSON block with preserved indentation', () => {
    const blocks = __parseLiveBlocksForTest(['{', '  "ok": true', '}'].join('\n'));

    expect(blocks).toHaveLength(3);
    expect(blocks.every((block) => block.type === 'jsonBlockLine')).toBe(true);
    expect(blocks[0]?.html).toContain('cm-json-line');
    expect(blocks[1]?.html).toContain('&nbsp;&nbsp;');
  });

  it('recognizes GFM tables without outer pipes', () => {
    const rows = __parseLiveBlocksForTest(
      ['Name | Score', '--- | ---:', 'JotLuck | 95'].join('\n'),
    ).filter((block) => block.type === 'tableRow');

    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ tableHeader: true, tableColumnCount: 2 });
    expect(rows[2]?.html).toContain('ml-table-cell--align-right');
  });
});

describe('cm6 live preview list rendering', () => {
  it('renders ordered list numbers in a dedicated marker column', () => {
    const rows = __parseLiveBlocksForTest('1. Alpha\n1. Beta').filter(
      (block) => block.type === 'orderedListItem',
    );

    expect(rows).toHaveLength(2);
    expect(rows[0]?.html).toContain('cm-list-marker-slot');
    expect(rows[0]?.html).toContain('cm-list-content');
    expect(rows[0]?.html).toContain('>1.</span>');
    expect(rows[1]?.html).toContain('>2.</span>');
  });

  it('renders unordered list bullets in the same stable list structure', () => {
    const [row] = __parseLiveBlocksForTest('- Alpha').filter(
      (block) => block.type === 'unorderedListItem',
    );

    expect(row?.html).toContain('cm-list-marker-slot');
    expect(row?.html).toContain('cm-list-content');
    expect(row?.html).toContain('Alpha');
  });
});
