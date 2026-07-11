import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('release RC autocomplete quality gate', () => {
  it('returns non-zero while the checked-in public model is quality-ineligible', () => {
    const rootDir = existsSync(path.resolve(process.cwd(), 'scripts/release-rc-gate.mjs'))
      ? process.cwd()
      : path.resolve(process.cwd(), '..', '..');
    const result = spawnSync(
      process.execPath,
      ['scripts/release-rc-gate.mjs', '--autocomplete-only'],
      { cwd: rootDir, encoding: 'utf8' },
    );
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toMatch(
      /Autocomplete release evidence verification failed|RC requires a verified v4 autocomplete model/u,
    );
  });
});
