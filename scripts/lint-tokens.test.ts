import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { lintSpacingTokens } from './lint-tokens.mjs';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

function createFixture(files: Record<string, string>) {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'jotluck-token-lint-'));
  const sourceDir = path.join(directory, 'src');
  temporaryDirectories.push(directory);

  for (const [relativePath, contents] of Object.entries(files)) {
    const destination = path.join(directory, relativePath);
    mkdirSync(path.dirname(destination), { recursive: true });
    writeFileSync(destination, contents, 'utf8');
  }

  return {
    sourceDir,
    tokensPath: path.join(directory, 'tokens.css'),
  };
}

describe('lintSpacingTokens', () => {
  it('allows declared spacing tokens in CSS, Vue, and official theme TypeScript CSS strings', () => {
    const fixture = createFixture({
      'tokens.css': ':root {\n  --space-2: 2px;\n  --space-8: 8px;\n}',
      'src/Surface.css': '.surface { padding: var(--space-2) var(--space-8); }',
      'src/Panel.vue': '<style>.panel { gap: var(--space-8); }</style>',
      'src/theme.ts':
        'export const officialTheme: OfficialThemeModule = { css: `.frame { inset: var(--space-2); }` };',
    });

    expect(lintSpacingTokens(fixture).unknownReferences).toEqual([]);
  });

  it('reports an unknown token referenced in an official theme TypeScript CSS string', () => {
    const fixture = createFixture({
      'tokens.css': ':root {\n  --space-8: 8px;\n}',
      'src/theme.ts':
        'export const officialTheme: OfficialThemeModule = { css: `.frame { inset: var(--space-9); }` };',
    });

    expect(lintSpacingTokens(fixture).unknownReferences).toEqual([
      expect.objectContaining({ line: 1, token: '--space-9' }),
    ]);
  });
});
