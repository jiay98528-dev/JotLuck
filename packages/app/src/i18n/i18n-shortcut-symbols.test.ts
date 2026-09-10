import { afterEach, describe, expect, it } from 'vitest';
import { translate } from '@/i18n';
import {
  currentPlatformOS as currentPlatform,
  type PlatformOS as OsPlatform,
} from '@/utils/platform-signal';

describe('macOS shortcut modifier symbolization (i18n postTranslation)', () => {
  const original = currentPlatform.value;

  afterEach(() => {
    currentPlatform.value = original;
  });

  function withPlatform(platform: OsPlatform, run: () => void): void {
    currentPlatform.value = platform;
    run();
  }

  it('renders Cmd symbols on macOS for visible shortcut text', () => {
    withPlatform('macos', () => {
      expect(translate('notebook.actions.searchWithShortcut')).toContain('⌘K');
      expect(translate('notebook.actions.searchWithShortcut')).not.toContain('Ctrl');
      expect(translate('editor.toolbar.inlineCodeTitle')).toContain('⌘`');
    });
  });

  it('normalizes existing Ctrl/Cmd dual-written labels to a single Cmd symbol', () => {
    withPlatform('macos', () => {
      const gate = translate('workspace.gate.shortcut');
      expect(gate).toContain('⌘');
      expect(gate).not.toContain('Ctrl');
      expect(gate).not.toContain('Cmd');
    });
  });

  it('keeps Ctrl text untouched on Windows and Linux', () => {
    withPlatform('windows', () => {
      expect(translate('notebook.actions.searchWithShortcut')).toContain('Ctrl+K');
    });
    withPlatform('linux', () => {
      expect(translate('editor.toolbar.inlineCodeTitle')).toContain('Ctrl+`');
    });
  });

  it('maps Ctrl+Click hints and preserves unrelated text', () => {
    withPlatform('macos', () => {
      const hint = translate('editor.status.selectionHint');
      expect(hint).toContain('⌘点击');
      expect(hint).not.toContain('Ctrl');
    });
  });
});
