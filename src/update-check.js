/**
 * Update notices.
 *
 * Two halves, deliberately kept apart so no command ever waits on the network:
 *
 *   noticeIfOutdated()   reads the cache only. Synchronous, no I/O beyond config.
 *   refreshLatest()      fetches the registry and writes the cache for next time.
 *
 * The notice goes to stderr, so `--format json` output stays parseable.
 */
import {
  getUpdateCheckEnabled,
  getCachedLatestVersion,
  getUpdateCheckedAt,
  setCachedLatestVersion,
} from './config.js';
import { VERSION, PACKAGE_NAME } from './package-info.js';
import { isNewer } from './semver.js';

const DEFAULT_REGISTRY = 'https://registry.npmjs.org';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 2000;

/**
 * Whether the update check may run at all.
 *
 * KIT_NO_UPDATE_CHECK covers one invocation, CI, and containers.
 * `kit config set-update-check false` turns it off for good.
 */
export function updateCheckAllowed(env = process.env) {
  if (env.KIT_NO_UPDATE_CHECK && env.KIT_NO_UPDATE_CHECK !== '0') return false;
  if (env.CI && env.CI !== 'false') return false;
  return getUpdateCheckEnabled();
}

function registryBase(env = process.env) {
  const value = (env.KIT_REGISTRY || '').trim();
  return (value || DEFAULT_REGISTRY).replace(/\/+$/, '');
}

// Re-exported so callers that already import from this module keep working.
export { isNewer };

/** True when the cached version is older than the TTL. */
export function cacheIsStale(now = Date.now()) {
  return now - getUpdateCheckedAt() > CACHE_TTL_MS;
}

/**
 * Prints a one-line notice when the cache says a newer version exists.
 * Reads the cache only. Never touches the network. Returns the notice or null.
 */
export function noticeIfOutdated({ write = (s) => console.error(s), current = VERSION } = {}) {
  if (!updateCheckAllowed()) return null;

  const latest = getCachedLatestVersion();
  if (!latest || !isNewer(latest, current)) return null;

  const notice = `Update available: ${current} -> ${latest}. Run \`kit upgrade\`.`;
  write(notice);
  return notice;
}

/**
 * Asks the registry for the latest version and caches it.
 *
 * Resolves to the version string, or null on any failure. It never throws, so a
 * caller can leave it unawaited without risking an unhandled rejection.
 */
export async function refreshLatest({ force = false } = {}) {
  if (!updateCheckAllowed()) return null;
  if (!force && !cacheIsStale()) return getCachedLatestVersion() || null;

  try {
    const res = await fetch(`${registryBase()}/${PACKAGE_NAME}/latest`, {
      headers: { Accept: 'application/vnd.npm.install-v1+json, application/json' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return null;

    const body = await res.json();
    const version = typeof body?.version === 'string' ? body.version : null;
    if (version) setCachedLatestVersion(version);
    return version;
  } catch {
    // Offline, blocked, slow, or malformed. An update notice is never worth an error.
    return null;
  }
}

/**
 * Warms the cache without blocking the command that is running.
 *
 * Node keeps the process alive until the request settles, which is why the fetch
 * carries a short timeout. It runs at most once per TTL.
 */
export function refreshLatestInBackground() {
  if (!updateCheckAllowed() || !cacheIsStale()) return;
  void refreshLatest();
}
