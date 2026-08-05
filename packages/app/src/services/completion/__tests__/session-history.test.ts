import { describe, expect, it } from 'vitest';
import { CompletionSessionHistory } from '../session-history';

describe('CompletionSessionHistory', () => {
  it('is scoped, deduplicated and capped at 100 retained entries', () => {
    const history = new CompletionSessionHistory();
    for (let index = 0; index < 105; index++) {
      history.record('workspace-a', `shared context ${index}`, ` result-${index}`);
    }
    history.record('workspace-b', 'shared context 104', ' other');

    expect(history.size('workspace-a')).toBe(100);
    expect(history.size('workspace-b')).toBe(1);
    expect(history.match('workspace-a', 'shared context 104')[0]?.insertText).toBe(' result-104');
    expect(history.match('workspace-b', 'shared context 104')[0]?.insertText).toBe(' other');
  });

  it('never writes to browser persistence', () => {
    const history = new CompletionSessionHistory();
    history.record('workspace', 'release context', ' approved');
    expect(history.size('workspace')).toBe(1);
    history.clear();
    expect(history.size('workspace')).toBe(0);
  });
});
