import { describe, expect, it } from 'vitest';
import {
  compareSemVer,
  isSemVerAtLeast,
  isSemVerNewer,
  normalizeReleaseVersion,
  parseSemVer,
} from '../semver';

describe('semver', () => {
  it('parses only strict SemVer 2.0.0 input', () => {
    expect(parseSemVer('1.2.3-preview.4+build.9')).toMatchObject({
      major: 1n,
      minor: 2n,
      patch: 3n,
      prerelease: ['preview', '4'],
      build: ['build', '9'],
    });
    expect(parseSemVer(undefined)).toBeNull();
    for (const invalid of ['v1.2.3', ' 1.2.3', '1.2.3 ', '1.2', '01.2.3', '1.2.3-01']) {
      expect(parseSemVer(invalid)).toBeNull();
    }
  });

  it('compares prerelease identifiers according to SemVer precedence', () => {
    expect(compareSemVer('1.0.0-alpha', '1.0.0-alpha.1')).toBe(-1);
    expect(compareSemVer('1.0.0-alpha.1', '1.0.0-alpha.beta')).toBe(-1);
    expect(compareSemVer('1.0.0-alpha.beta', '1.0.0-beta')).toBe(-1);
    expect(compareSemVer('1.0.0-beta', '1.0.0-beta.2')).toBe(-1);
    expect(compareSemVer('1.0.0-beta.11', '1.0.0-rc.1')).toBe(-1);
    expect(compareSemVer('1.0.0-rc.1', '1.0.0')).toBe(-1);
    expect(compareSemVer('1.0.0+build.1', '1.0.0+build.2')).toBe(0);
    expect(
      compareSemVer(
        '999999999999999999999.0.0-999999999999999999999',
        '999999999999999999998.0.0-1',
      ),
    ).toBe(1);
  });

  it('fails closed for invalid comparisons and normalizes only release-tag prefixes', () => {
    expect(compareSemVer('1.0.0', 'invalid')).toBeNull();
    expect(isSemVerNewer('invalid', '1.0.0')).toBe(false);
    expect(isSemVerAtLeast('1.0.0', 'invalid')).toBe(false);
    expect(normalizeReleaseVersion('v0.1.0-preview')).toBe('0.1.0-preview');
    expect(normalizeReleaseVersion('V0.1.0+build.1')).toBe('0.1.0+build.1');
    expect(normalizeReleaseVersion('vv0.1.0')).toBeNull();
    expect(normalizeReleaseVersion({ tag: 'v0.1.0' })).toBeNull();
  });
});
