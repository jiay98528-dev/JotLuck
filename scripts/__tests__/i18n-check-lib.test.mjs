import { describe, expect, it } from 'vitest';
import { collectScriptIssues, placeholders, splitPluralBranches } from '../i18n-check-lib.mjs';

const keys = new Set(['errors.operationFailed', 'items.count']);

describe('i18n check helpers', () => {
  it('distinguishes plural separators from escaped Markdown pipes', () => {
    expect(splitPluralBranches('one item | {count} items')).toEqual(['one item', '{count} items']);
    expect(splitPluralBranches("left {'|'} right")).toEqual(["left {'|'} right"]);
  });

  it('extracts stable interpolation placeholders', () => {
    expect(placeholders('{count} files for {name}; {{date}}')).toEqual(['count', 'name']);
  });

  it('rejects missing and unregistered dynamic translation keys', () => {
    const issues = collectScriptIssues(
      "translate('missing.key'); translate(runtimeKey); translate('errors.operationFailed');",
      'fixture.ts',
      keys,
    );

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.stringContaining('unknown i18n key missing.key'),
        expect.stringContaining('unregistered dynamic i18n key'),
      ]),
    );
    expect(issues.some((issue) => issue.includes('errors.operationFailed'))).toBe(false);
  });

  it('rejects English and French literals in known user-message sinks', () => {
    const issues = collectScriptIssues(
      "error.value = 'Unknown error'; toast.show('Échec de l’export'); const item = { label: 'Open file' };",
      'fixture.ts',
      keys,
    );

    expect(issues).toHaveLength(3);
    expect(issues.join('\n')).toContain('Unknown error');
    expect(issues.join('\n')).toContain('Échec de l’export');
    expect(issues.join('\n')).toContain('Open file');
  });

  it('allows registered technical labels', () => {
    expect(collectScriptIssues("const item = { label: 'PDF' };", 'fixture.ts', keys)).toEqual([]);
  });
});
