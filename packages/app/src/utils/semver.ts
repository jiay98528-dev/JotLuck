/** Strict Semantic Versioning 2.0.0 parsing and precedence comparison. */

export interface SemVer {
  major: bigint;
  minor: bigint;
  patch: bigint;
  prerelease: readonly string[];
  build: readonly string[];
}

const SEMVER_RE =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
const NUMERIC_IDENTIFIER_RE = /^(0|[1-9]\d*)$/;

/**
 * Parses an exact SemVer 2.0.0 string. A leading `v`, whitespace, incomplete
 * versions and numeric pre-release identifiers with leading zeroes are invalid.
 */
export function parseSemVer(version: unknown): SemVer | null {
  if (typeof version !== 'string') return null;
  const match = SEMVER_RE.exec(version);
  if (!match) return null;

  const [, major, minor, patch, prerelease = '', build = ''] = match;
  return {
    major: BigInt(major!),
    minor: BigInt(minor!),
    patch: BigInt(patch!),
    prerelease: prerelease ? prerelease.split('.') : [],
    build: build ? build.split('.') : [],
  };
}

/**
 * Normalizes an external GitHub release tag to strict SemVer. Release tags may
 * use the conventional single leading `v`/`V`; all other invalid input fails.
 */
export function normalizeReleaseVersion(tag: unknown): string | null {
  if (typeof tag !== 'string') return null;
  const version = tag.startsWith('v') || tag.startsWith('V') ? tag.slice(1) : tag;
  return parseSemVer(version) ? version : null;
}

/**
 * Compares SemVer precedence. Build metadata is intentionally ignored.
 * Returns null when either operand is not strict SemVer.
 */
export function compareSemVer(a: unknown, b: unknown): number | null {
  const left = parseSemVer(a);
  const right = parseSemVer(b);
  if (!left || !right) return null;

  for (const key of ['major', 'minor', 'patch'] as const) {
    if (left[key] !== right[key]) return left[key] > right[key] ? 1 : -1;
  }

  if (left.prerelease.length === 0 || right.prerelease.length === 0) {
    if (left.prerelease.length === right.prerelease.length) return 0;
    return left.prerelease.length === 0 ? 1 : -1;
  }

  const length = Math.max(left.prerelease.length, right.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    const leftIdentifier = left.prerelease[index];
    const rightIdentifier = right.prerelease[index];
    if (leftIdentifier === undefined) return -1;
    if (rightIdentifier === undefined) return 1;
    if (leftIdentifier === rightIdentifier) continue;

    const leftNumeric = NUMERIC_IDENTIFIER_RE.test(leftIdentifier);
    const rightNumeric = NUMERIC_IDENTIFIER_RE.test(rightIdentifier);
    if (leftNumeric && rightNumeric) {
      return compareNumericIdentifier(leftIdentifier, rightIdentifier);
    }
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
    return leftIdentifier > rightIdentifier ? 1 : -1;
  }

  return 0;
}

function compareNumericIdentifier(left: string, right: string): number {
  if (left.length !== right.length) return left.length > right.length ? 1 : -1;
  return left > right ? 1 : -1;
}

/** Returns true only when both versions are valid and `latest` is newer. */
export function isSemVerNewer(latest: unknown, current: unknown): boolean {
  const comparison = compareSemVer(latest, current);
  return comparison !== null && comparison > 0;
}

/** Returns true only when both versions are valid and `actual >= minimum`. */
export function isSemVerAtLeast(actual: unknown, minimum: unknown): boolean {
  const comparison = compareSemVer(actual, minimum);
  return comparison !== null && comparison >= 0;
}
