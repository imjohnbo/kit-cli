/**
 * Update notices.
 *
 * Two halves, deliberately kept apart so no command ever waits on the network:
 *
 *   noticeIfOutdated()   reads the cache only. Synchronous, no I/O beyond config.
 *   refreshLatest()      asks the registry and writes the cache for next time.
 *
 * The notice goes to stderr, so `--format json` output stays parseable.
 */
import {
  getUpdateCheckEnabled,
  getCachedLatestVersion,
  getCachedLatestPackage,
  getUpdateCheckedAt,
  setCachedLatestVersion,
} from './config.js';
import { VERSION, PACKAGE_NAME, USER_AGENT } from './package-info.js';
import { isNewer } from './semver.js';

export { isNewer };

const DEFAULT_REGISTRY = 'https://registry.npmjs.org';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 2000;

/** Outcomes of asking the registry for the newest version. */
export const OK = 'ok';
export const NOT_FOUND = 'not-found';
export const UNREACHABLE = 'unreachable';
export const DISABLED = 'disabled';

/**
 * Whether the environment looks like CI or another unattended container.
 * Shared by updateCheckAllowed() below and telemetryAllowed() in
 * telemetry.js, so the definition of "CI" can't drift between the two.
 */
export function isCI(env = process.env) {
  return Boolean(env.CI) && env.CI !== 'false';
}

/**
 * Whether an automatic update check may run.
 *
 * KIT_NO_UPDATE_CHECK covers one invocation, CI, and containers.
 * `kit config set-update-check false` turns it off for good.
 *
 * This governs the background check only. An explicit `kit upgrade` still works,
 * because the preference is about unattended requests, not about the command the
 * user just typed.
 */
export function updateCheckAllowed(env = process.env) {
  if (env.KIT_NO_UPDATE_CHECK && env.KIT_NO_UPDATE_CHECK !== '0') return false;
  if (isCI(env)) return false;
  return getUpdateCheckEnabled();
}

function registryBase(env = process.env) {
  const value = (env.KIT_REGISTRY || '').trim();
  return (value || DEFAULT_REGISTRY).replace(/\/+$/, '');
}

/**
 * The cached version, but only when it came from the package running now.
 *
 * Renaming the package would otherwise keep serving the old name's version. That
 * is not hypothetical: this package was briefly named `kit-cli`, which belongs to
 * a different author on npm, so the stale entry pointed at a stranger's release.
 */
function cachedVersion() {
  if (getCachedLatestPackage() !== PACKAGE_NAME) return '';
  return getCachedLatestVersion();
}

/** True when the cache is missing, from another package, or past the TTL. */
export function cacheIsStale(now = Date.now()) {
  if (getCachedLatestPackage() !== PACKAGE_NAME) return true;
  return now - getUpdateCheckedAt() > CACHE_TTL_MS;
}

/**
 * Prints a one-line notice when the cache holds a newer version.
 * Reads the cache only. Never touches the network. Returns the notice or null.
 */
export function noticeIfOutdated({ write = (s) => console.error(s), current = VERSION } = {}) {
  if (!updateCheckAllowed()) return null;

  const latest = cachedVersion();
  if (!latest || !isNewer(latest, current)) return null;

  const notice = `Update available: ${current} -> ${latest}. Run \`kit upgrade\`.`;
  write(notice);
  return notice;
}

/**
 * Asks the registry for the newest published version.
 *
 * Returns `{ status, version }`. The status separates a package that is not
 * published from a registry that could not be reached, so a caller can say which
 * happened. It never throws, so a caller can leave it unawaited.
 *
 * @param {object} [options]
 * @param {boolean} [options.force] ignore a fresh cache and ask anyway
 * @param {boolean} [options.automatic] false when the user asked for this
 *   directly, which skips the update-check preference
 */
export async function refreshLatest({ force = false, automatic = true } = {}) {
  if (automatic && !updateCheckAllowed()) return { status: DISABLED, version: null };

  if (!force && !cacheIsStale()) {
    const cached = cachedVersion();
    if (cached) return { status: OK, version: cached };
  }

  try {
    const res = await fetch(`${registryBase()}/${PACKAGE_NAME}/latest`, {
      headers: {
        Accept: 'application/vnd.npm.install-v1+json, application/json',
        'User-Agent': USER_AGENT,
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (res.status === 404) return { status: NOT_FOUND, version: null };
    if (!res.ok) return { status: UNREACHABLE, version: null };

    const body = await res.json();
    const version = typeof body?.version === 'string' ? body.version : null;
    if (!version) return { status: UNREACHABLE, version: null };

    setCachedLatestVersion(version, PACKAGE_NAME);
    return { status: OK, version };
  } catch {
    // Offline, blocked, slow, or malformed. A notice is never worth an error.
    return { status: UNREACHABLE, version: null };
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
