import { describe, expect, it } from 'vitest';
import type { WindowBootstrapPayload } from '../window-session';

describe('WindowBootstrapPayload', () => {
  it('discriminates workspace and external window sessions', () => {
    const workspace: WindowBootstrapPayload = {
      mode: 'workspace',
      initialRelativePath: '/notes/today.md',
    };
    const external: WindowBootstrapPayload = {
      mode: 'external-readonly',
      openedFile: {
        absolutePath: 'D:/notes/today.md',
        relativePath: '/today.md',
        accessToken: 'window-bound-grant',
      },
    };

    expect(workspace.mode).toBe('workspace');
    expect(external.mode).toBe('external-readonly');
    expect(external.openedFile.relativePath).toBe('/today.md');
  });
});
