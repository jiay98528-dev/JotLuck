/**
 * useVersionCheck — GitHub Releases 版本检查组合式函数
 *
 * 检查 GitHub Releases 是否有新版本，使用 localStorage 做 24 小时缓存。
 * 所有状态为模块级单例，多个组件调用共享同一份数据，避免重复请求。
 *
 * @remarks
 * - autoInstall 功能当前锁定（签名证书未获取），`autoInstallAvailable` 始终返回 false
 * - 网络错误静默失败，不抛出异常
 */

import { ref, computed } from 'vue';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CURRENT_VERSION = '0.1.0';
const GITHUB_API_URL = 'https://api.github.com/repos/jiay98528-dev/MarkLuck/releases/latest';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

const LS_KEYS = {
  lastCheck: 'markluck:version:lastCheck',
  latestInfo: 'markluck:version:latestInfo',
  autoCheck: 'markluck:version:autoCheck',
  autoInstall: 'markluck:version:autoInstall',
  dismissedVersion: 'markluck:version:dismissedVersion',
} as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SemverParts {
  major: number;
  minor: number;
  patch: number;
}

interface CachedLatestInfo {
  latest: string;
  releaseUrl: string;
  releaseNotes: string;
  checkedAt: number;
}

interface GitHubRelease {
  tag_name: string;
  html_url: string;
  body: string | null;
}

// ---------------------------------------------------------------------------
// Module-level reactive state (singleton — shared across all consumers)
// ---------------------------------------------------------------------------

const hasUpdate = ref(false);
const latestVersion = ref('');
const currentVersion = ref(CURRENT_VERSION);
const releaseUrl = ref('');
const releaseNotes = ref('');
const checking = ref(false);
const error = ref<string | null>(null);
const lastChecked = ref<number | null>(null);

const autoInstallAvailable = computed(() => false);

/** Guard to prevent concurrent fetch requests */
let pendingCheck: Promise<void> | null = null;
/** Guard to ensure init() only runs once */
let initialized = false;

// ---------------------------------------------------------------------------
// Semver utilities
// ---------------------------------------------------------------------------

/**
 * Strip leading 'v'/'V' and return the clean version string.
 */
function cleanVersion(raw: string): string {
  return raw.replace(/^[vV]/, '');
}

/**
 * Parse a semver string into { major, minor, patch }.
 * Returns null if the string is not valid semver.
 */
function parseSemver(version: string): SemverParts | null {
  const cleaned = cleanVersion(version);
  const match = cleaned.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  // Destructure with defaults — groups always present when match succeeds
  const [, majorStr = '0', minorStr = '0', patchStr = '0'] = match;
  return {
    major: parseInt(majorStr, 10),
    minor: parseInt(minorStr, 10),
    patch: parseInt(patchStr, 10),
  };
}

/**
 * Compare two semver strings.
 * @returns negative if a < b, 0 if equal, positive if a > b
 */
function compareSemver(a: string, b: string): number {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa || !pb) return 0;
  if (pa.major !== pb.major) return pa.major - pb.major;
  if (pa.minor !== pb.minor) return pa.minor - pb.minor;
  return pa.patch - pb.patch;
}

/**
 * @returns true if `latest` is a strictly newer version than `current`.
 */
function isNewer(latest: string, current: string): boolean {
  return compareSemver(latest, current) > 0;
}

// ---------------------------------------------------------------------------
// localStorage helpers
// ---------------------------------------------------------------------------

function safeGetItem(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSetItem(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* localStorage may be unavailable or full — silently ignore */
  }
}

function getDismissedVersion(): string | null {
  return safeGetItem(LS_KEYS.dismissedVersion);
}

/**
 * Check whether the given latest version has been dismissed by the user.
 * Compares after stripping 'v' prefix so both '0.2.0' and 'v0.2.0' match.
 */
function isDismissed(latest: string): boolean {
  const dismissed = getDismissedVersion();
  if (!dismissed) return false;
  return cleanVersion(dismissed) === cleanVersion(latest);
}

function readCachedInfo(): CachedLatestInfo | null {
  try {
    const raw = safeGetItem(LS_KEYS.latestInfo);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedLatestInfo;
    // Basic shape validation
    if (!parsed.latest || !parsed.checkedAt) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCachedInfo(info: CachedLatestInfo): void {
  safeSetItem(LS_KEYS.latestInfo, JSON.stringify(info));
  safeSetItem(LS_KEYS.lastCheck, String(info.checkedAt));
}

// ---------------------------------------------------------------------------
// State helpers
// ---------------------------------------------------------------------------

/**
 * Apply a CachedLatestInfo to the reactive state, respecting the dismissed check.
 */
function applyLatestInfo(info: CachedLatestInfo): void {
  latestVersion.value = info.latest;
  releaseUrl.value = info.releaseUrl;
  releaseNotes.value = info.releaseNotes;
  lastChecked.value = info.checkedAt;

  if (isNewer(info.latest, CURRENT_VERSION) && !isDismissed(info.latest)) {
    hasUpdate.value = true;
  } else {
    hasUpdate.value = false;
  }
}

/**
 * Determine whether an automatic check should be performed:
 * - autoCheck flag must be 'true'
 * - No previous check, OR the last check is older than 24 hours
 */
function shouldAutoCheck(): boolean {
  try {
    const autoCheck = safeGetItem(LS_KEYS.autoCheck);
    if (autoCheck !== 'true') return false;

    const lastCheckStr = safeGetItem(LS_KEYS.lastCheck);
    if (!lastCheckStr) return true;

    const lastCheckTs = parseInt(lastCheckStr, 10);
    if (isNaN(lastCheckTs)) return true;

    const elapsed = Date.now() - lastCheckTs;
    return elapsed > CACHE_TTL_MS;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function useVersionCheck() {
  // ------------------------------------------------------------------
  // checkNow — always fetches, bypassing the 24h cache and autoCheck flag
  // ------------------------------------------------------------------

  async function checkNow(): Promise<void> {
    // Deduplicate: if a check is already in flight, return that promise
    if (pendingCheck) {
      await pendingCheck;
      return;
    }

    checking.value = true;
    error.value = null;

    pendingCheck = (async () => {
      try {
        const response = await fetch(GITHUB_API_URL, {
          headers: {
            Accept: 'application/vnd.github.v3+json',
          },
        });

        if (!response.ok) {
          error.value = `GitHub API returned ${response.status}`;
          return;
        }

        const release: GitHubRelease = await response.json();
        const latest = cleanVersion(release.tag_name);
        const info: CachedLatestInfo = {
          latest,
          releaseUrl: release.html_url,
          releaseNotes: release.body ?? '',
          checkedAt: Date.now(),
        };

        writeCachedInfo(info);
        applyLatestInfo(info);
      } catch (e: unknown) {
        // Silent failure — capture the message but do not throw
        error.value = e instanceof Error ? e.message : 'Unknown error';
      } finally {
        checking.value = false;
        pendingCheck = null;
      }
    })();

    await pendingCheck;
  }

  // ------------------------------------------------------------------
  // One-time initialization
  // ------------------------------------------------------------------

  function init(): void {
    if (initialized) return;
    initialized = true;

    // Restore cached results
    const cached = readCachedInfo();
    if (cached) {
      applyLatestInfo(cached);
    }

    // Auto-check if eligible
    if (shouldAutoCheck()) {
      // Fire-and-forget — do not block the composable setup
      void checkNow();
    }
  }

  // Run init immediately (first call only due to the guard)
  init();

  return {
    /** Whether a newer version is available AND not dismissed */
    hasUpdate,
    /** Latest version string from GitHub (e.g. '0.2.0') */
    latestVersion,
    /** Current app version (hardcoded) */
    currentVersion,
    /** URL to the GitHub release page */
    releaseUrl,
    /** Release notes / changelog body from GitHub */
    releaseNotes,
    /** True while a fetch request is in-flight */
    checking,
    /** Error message if the last fetch failed, null otherwise */
    error,
    /** Timestamp (ms) of the last successful check */
    lastChecked,
    /**
     * Whether auto-install is available.
     * Currently LOCKED (certificate not obtained) — always returns false.
     */
    autoInstallAvailable,
    /** Fetch the latest release from GitHub, bypassing the 24h cache */
    checkNow,
  } as const;
}
