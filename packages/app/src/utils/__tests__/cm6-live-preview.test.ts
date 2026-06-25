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
