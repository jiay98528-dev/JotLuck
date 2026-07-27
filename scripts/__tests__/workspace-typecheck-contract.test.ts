import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(import.meta.dirname, '../..');

describe('fresh-checkout typecheck contract', () => {
  it('builds the renderer project reference before checking the app', () => {
    const packageJson = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
    expect(packageJson.scripts.typecheck).toBe(
      'pnpm --filter @jotluck/renderer build && pnpm --filter @jotluck/app typecheck',
    );
  });
});
