import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('release RC autocomplete quality gate', () => {
  it('lets ordinary CI report the stopped unpublished architecture as fail-closed', () => {
    const rootDir = existsSync(path.resolve(process.cwd(), 'scripts/release-rc-gate.mjs'))
      ? process.cwd()
      : path.resolve(process.cwd(), '..', '..');
    const result = spawnSync(process.execPath, ['scripts/verify-autocomplete-v2s-evidence.mjs'], {
      cwd: rootDir,
      encoding: 'utf8',
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/"status": "architecture-stopped-fail-closed"/u);
    expect(result.stdout).toMatch(/"releaseEligible": false/u);
  });

  it('returns non-zero while the checked-in public model is quality-ineligible', () => {
    const rootDir = existsSync(path.resolve(process.cwd(), 'scripts/release-rc-gate.mjs'))
      ? process.cwd()
      : path.resolve(process.cwd(), '..', '..');
    const result = spawnSync(
      process.execPath,
      ['scripts/release-rc-gate.mjs', '--autocomplete-only'],
      { cwd: rootDir, encoding: 'utf8' },
    );
    expect(result.status).toBe(10);
    expect(`${result.stdout}\n${result.stderr}`).toMatch(
      /Autocomplete V2S architecture is stopped: public-v2s-mkn-v1 \(development-oracle-ceiling\)/u,
    );
  });

  it('does not route RC by the presence of stopped V2R manifests', () => {
    const rootDir = existsSync(path.resolve(process.cwd(), 'scripts/release-rc-gate.mjs'))
      ? process.cwd()
      : path.resolve(process.cwd(), '..', '..');
    const source = readFileSync(path.join(rootDir, 'scripts/release-rc-gate.mjs'), 'utf8');
    expect(source).not.toContain('hasAnyV2RPublicManifest');
    expect(source).not.toContain('verifyAutocompleteV2REvidence');
    expect(source).not.toContain('verifyAutocompleteEvidence');
    expect(source).toContain('inspectAutocompletePublicState');
    expect(source).toContain('verifyAutocompleteV2SEvidence');
  });

  it('permanently rejects the self-attested v1 machine evidence path', () => {
    const rootDir = existsSync(path.resolve(process.cwd(), 'scripts/release-rc-gate.mjs'))
      ? process.cwd()
      : path.resolve(process.cwd(), '..', '..');
    const source = readFileSync(path.join(rootDir, 'scripts/release-rc-gate.mjs'), 'utf8');
    expect(source).not.toContain('jotluck-installed-l4-evidence');
    expect(source).not.toContain('workingTreeSha256');
    expect(source).not.toContain('command.exitCode');
    expect(source).toContain('通用 RC 独立证据协议 v2 尚未实现');
  });
});
