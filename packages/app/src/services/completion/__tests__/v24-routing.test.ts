import { describe, expect, it } from 'vitest';
import { DEFAULT_COMPLETION_SETTINGS } from '../../CompletionSettings';
import { buildCompletionContext } from '../context';
import { decideV24Route, detectFencedLanguage } from '../v24-routing';

function context(doc: string) {
  return buildCompletionContext({
    doc,
    cursorPos: doc.length,
    settings: DEFAULT_COMPLETION_SETTINGS,
    indexData: null,
    n: 4,
  });
}

describe('V2.4 route decision', () => {
  it('routes fenced code before writing and preserves the declared language', () => {
    const value = context('```rust\nlet value = Result::<T');
    expect(decideV24Route(value)).toMatchObject({ route: 'code', language: 'rust' });
    expect(detectFencedLanguage(value.doc, value.localCursorPos)).toBe('rust');
  });

  it('routes a stable prose line to Writing', () => {
    expect(decideV24Route(context('A stable paragraph '))).toMatchObject({
      route: 'writing',
      hardDeadlineMs: 2_000,
    });
  });

  it('keeps headings and tables silent', () => {
    expect(decideV24Route(context('# heading'))).toMatchObject({ route: 'silence' });
    expect(decideV24Route(context('| key | value |'))).toMatchObject({ route: 'silence' });
  });
});
