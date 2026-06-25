import { describe, expect, it } from 'vitest';
import { isLikelySystemNotebookScope, sanitizeRecentNotebookPaths } from '../TauriIPCService';

describe('TauriIPCService recent notebook sanitizer', () => {
  it('filters system-wide folders that should not auto-open as notebooks', () => {
    expect(isLikelySystemNotebookScope('C:/Users/alice')).toBe(true);
    expect(isLikelySystemNotebookScope('C:/Users/alice/Desktop')).toBe(true);
    expect(isLikelySystemNotebookScope('C:/Users/alice/Downloads/')).toBe(true);
    expect(isLikelySystemNotebookScope('D:/')).toBe(true);
    expect(isLikelySystemNotebookScope('D:/VibeCoding/MarkLuck')).toBe(false);
  });

  it('deduplicates and preserves normal notebook paths', () => {
    const result = sanitizeRecentNotebookPaths([
      'C:/Users/alice/Desktop',
      'D:/Notes/Project',
      'D:/Notes/Project/',
      'D:/Notes/Research',
    ]);

    expect(result).toEqual(['D:/Notes/Project', 'D:/Notes/Research']);
  });
});
