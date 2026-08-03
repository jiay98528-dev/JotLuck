import { describe, expect, it } from 'vitest';
import { summarizeActiveFileChanges } from '../file-change-events';

describe('summarizeActiveFileChanges', () => {
  it('treats an atomic temporary-file replacement as a content change', () => {
    expect(
      summarizeActiveFileChanges(
        [
          { type: 'deleted', path: '/notes/history.md' },
          {
            type: 'renamed',
            oldPath: '/notes/.history.md.123.456.0.tmp',
            path: '/notes/history.md',
          },
        ],
        '/notes/history.md',
      ),
    ).toEqual({ removed: false, destructive: true, changed: true });
  });

  it('treats a rename away from the active path as removal', () => {
    expect(
      summarizeActiveFileChanges(
        [{ type: 'renamed', oldPath: '/notes/history.md', path: '/archive/history.md' }],
        '/notes/history.md',
      ),
    ).toEqual({ removed: true, destructive: true, changed: false });
  });

  it('treats a plain active-file delete as removal', () => {
    expect(
      summarizeActiveFileChanges(
        [{ type: 'deleted', path: '/notes/history.md' }],
        '/notes/history.md',
      ),
    ).toEqual({ removed: true, destructive: true, changed: false });
  });

  it('ignores changes to unrelated files', () => {
    expect(
      summarizeActiveFileChanges(
        [{ type: 'modified', path: '/notes/other.md' }],
        '/notes/history.md',
      ),
    ).toEqual({ removed: false, destructive: false, changed: false });
  });

  it('keeps a destructive signal when a stale modify also arrives', () => {
    expect(
      summarizeActiveFileChanges(
        [
          { type: 'deleted', path: '/notes/history.md' },
          { type: 'modified', path: '/notes/history.md' },
        ],
        '/notes/history.md',
      ),
    ).toEqual({ removed: false, destructive: true, changed: true });
  });
});
