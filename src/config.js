import Conf from 'conf';
import { chmodSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

// KIT_CONFIG_DIR moves the config file somewhere else. Point it at a directory
// per Kit account to keep separate profiles, or at a throwaway directory to keep
// a script from touching your real credentials. The test suite uses it for that.
const config = new Conf({
  // Deliberately a fixed string, not the package name. This names the directory
  // that holds a user's credentials. Renaming the package must not orphan it.
  projectName: 'kit-cli',
  cwd: process.env.KIT_CONFIG_DIR || undefined,
  // Conf defaults to 0o666, applied via fs.writeFileSync's `mode` option —
  // which only takes effect when a file is newly created, not on later
  // writes to an existing one (verified directly against Node's fs
  // behavior). So this closes the gap for a brand-new config file only; an
  // existing file still needs the explicit chmodSync calls below after every
  // write that might have recreated it at a looser mode.
  configFileMode: 0o600,
  schema: {
    apiKey:         { type: 'string', default: '' },
    baseUrl:        { type: 'string', default: 'https://api.kit.com/v4' },
    defaultFormat:  { type: 'string', default: 'table', enum: ['table', 'json'] },
    perPage:        { type: 'number', default: 50, minimum: 1, maximum: 1000 },
    oauthClientId:  { type: 'string', default: '' },
    oauthRedirectUri: { type: 'string', default: '' },
    accessToken:    { type: 'string', default: '' },
    refreshToken:   { type: 'string', default: '' },
    tokenExpiresAt: { type: 'number', default: 0 }, // unix ms
    updateCheck:    { type: 'boolean', default: true },
    updateCheckedAt: { type: 'number', default: 0 }, // unix ms
    updateLatestVersion: { type: 'string', default: '' },
    updateLatestPackage: { type: 'string', default: '' },
    telemetry:      { type: 'boolean', default: true },
    installId:      { type: 'string', default: '' },
    accountId:      { type: 'string', default: '' },
    telemetryNoticeShown: { type: 'boolean', default: false },
  },
});

// Restrict config file permissions to owner-only (contains API key / tokens)
try {
  chmodSync(config.path, 0o600);
} catch {
  // May fail on Windows or if file doesn't exist yet — non-fatal
}

// --- API base URL ---
//
// Defaults to production. Override for other environments (e.g. QA) via the
// KIT_API_BASE env var or `kit config set-base-url`. The env var wins so you
// can target a different host for a single invocation without mutating stored
// config. All API requests and OAuth endpoints derive from this value.

const DEFAULT_BASE_URL = 'https://api.kit.com/v4';

function normalizeBaseUrl(url) {
  return url.trim().replace(/\/+$/, ''); // strip trailing slashes so path joins don't double up
}

export function getBaseUrl() {
  const fromEnv = process.env.KIT_API_BASE;
  const value = (fromEnv && fromEnv.trim()) || config.get('baseUrl') || DEFAULT_BASE_URL;
  return normalizeBaseUrl(value);
}

export function setBaseUrl(url) {
  if (!url || typeof url !== 'string' || url.trim().length === 0) {
    throw new Error('Base URL must be a non-empty string.');
  }
  let parsed;
  try {
    parsed = new URL(url.trim());
  } catch {
    throw new Error(`Invalid base URL: "${url}". Must be a full URL like https://api.kit.com/v4.`);
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('Base URL must use http or https.');
  }
  config.set('baseUrl', normalizeBaseUrl(url));
}

// --- API key ---

export function getApiKey() {
  return process.env.KIT_API_KEY || config.get('apiKey');
}

export function setApiKey(key) {
  if (!key || typeof key !== 'string' || key.trim().length === 0) {
    throw new Error('API key must be a non-empty string.');
  }
  if (key.length > 256) {
    throw new Error('API key is too long (max 256 characters).');
  }
  if (/[\x00-\x1f\x7f]/.test(key)) {
    throw new Error('API key contains invalid control characters.');
  }
  config.set('apiKey', key.trim());
  clearCachedAccountId();
  secureConfig();
}

// --- OAuth client ID ---

export function getOAuthClientId() {
  return process.env.KIT_CLIENT_ID || config.get('oauthClientId');
}

export function setOAuthClientId(id) {
  config.set('oauthClientId', id.trim());
}

// --- OAuth redirect URI ---

export function getOAuthRedirectUri() {
  return process.env.KIT_REDIRECT_URI || config.get('oauthRedirectUri') || '';
}

export function setOAuthRedirectUri(uri) {
  config.set('oauthRedirectUri', uri.trim());
}

// --- OAuth tokens ---

export function getAccessToken() {
  return config.get('accessToken');
}

export function getRefreshToken() {
  return config.get('refreshToken');
}

export function isTokenExpired() {
  const expiresAt = config.get('tokenExpiresAt');
  if (!expiresAt) return true;
  // Treat as expired 5 minutes early to avoid races
  return Date.now() > expiresAt - 5 * 60 * 1000;
}

export function setTokens(accessToken, refreshToken, createdAt, expiresIn) {
  // Kit returns created_at as unix seconds, expires_in as seconds
  config.set('accessToken', accessToken);
  config.set('refreshToken', refreshToken);
  config.set('tokenExpiresAt', (createdAt + expiresIn) * 1000);
  secureConfig();
}

export function clearTokens() {
  config.set('accessToken', '');
  config.set('refreshToken', '');
  config.set('tokenExpiresAt', 0);
  clearCachedAccountId();
  secureConfig();
}

// --- Preferences ---

export function getDefaultFormat() {
  return config.get('defaultFormat');
}

export function setDefaultFormat(format) {
  config.set('defaultFormat', format);
}

export function getPerPage() {
  return config.get('perPage');
}

export function setPerPage(n) {
  config.set('perPage', n);
}

// --- Update checks ---
//
// The CLI keeps the newest published version in config and prints a notice when
// the running version is older. Set `updateCheck` to false, or set the
// KIT_NO_UPDATE_CHECK env var, to stop the check and the request it makes.

export function getUpdateCheckEnabled() {
  return config.get('updateCheck');
}

export function setUpdateCheckEnabled(enabled) {
  config.set('updateCheck', Boolean(enabled));
}

export function getCachedLatestVersion() {
  return config.get('updateLatestVersion');
}

/** The package the cached version was read from. */
export function getCachedLatestPackage() {
  return config.get('updateLatestPackage');
}

export function getUpdateCheckedAt() {
  return config.get('updateCheckedAt');
}

export function setCachedLatestVersion(version, packageName) {
  config.set('updateLatestVersion', version);
  config.set('updateLatestPackage', packageName);
  config.set('updateCheckedAt', Date.now());
}

// --- Telemetry ---
//
// One combined opt-out for both usage telemetry and error reporting (see
// src/telemetry.js and src/error-reporting.js). Mirrors the updateCheck
// preference above: a config key, plus KIT_NO_TELEMETRY for a single
// invocation, CI, or containers — see telemetryAllowed() in telemetry.js.

export function getTelemetryEnabled() {
  return config.get('telemetry');
}

export function setTelemetryEnabled(enabled) {
  config.set('telemetry', Boolean(enabled));
}

export function getTelemetryNoticeShown() {
  return config.get('telemetryNoticeShown');
}

export function setTelemetryNoticeShown() {
  config.set('telemetryNoticeShown', true);
}

/**
 * A random ID that identifies this install, not this person. Generated once,
 * on first use, and persisted — never derived from or linked to a Kit
 * account or email address.
 */
export function getOrCreateInstallId() {
  const existing = config.get('installId');
  if (existing) return existing;
  const id = randomUUID();
  config.set('installId', id);
  return id;
}

/**
 * The authenticated account's ID, cached so telemetry looks it up at most
 * once per set of credentials rather than on every command. Cleared by
 * setApiKey, clearTokens, and login() (in auth.js) — covering a new API key,
 * an explicit logout, and a fresh OAuth login.
 *
 * Known gap, accepted rather than engineered around: switching accounts via
 * the KIT_API_KEY env var, or switching environments via KIT_API_BASE /
 * setBaseUrl, does not clear this cache, since neither goes through a
 * function this module controls. A cached ID could then be misattributed
 * until the cache is next cleared by one of the paths above. Low-harm since
 * this only affects anonymous usage-analytics attribution, never anything
 * the CLI itself does with the value — but real, so it's written down here
 * rather than implied away.
 */
export function getCachedAccountId() {
  return config.get('accountId') || '';
}

export function setCachedAccountId(id) {
  config.set('accountId', id == null ? '' : String(id));
}

/**
 * Exported (unlike the module-private uses in setApiKey/clearTokens above)
 * so login() in auth.js can call it too — starting a fresh OAuth flow is the
 * one case setTokens() itself deliberately doesn't cover, since setTokens()
 * also runs on routine token refresh, where clearing would be wrong.
 */
export function clearCachedAccountId() {
  config.set('accountId', '');
}

// --- Misc ---

export function getAll() {
  const accessToken = getAccessToken();
  const expiresAt = config.get('tokenExpiresAt');
  let oauthStatus = '(not logged in)';
  if (accessToken) {
    const expiry = expiresAt ? new Date(expiresAt).toISOString() : 'unknown';
    oauthStatus = isTokenExpired() ? `(expired at ${expiry})` : `****${accessToken.slice(-4)} (expires ${expiry})`;
  }

  return {
    baseUrl:         getBaseUrl(),
    apiKey:          getApiKey() ? '****' + getApiKey().slice(-4) : '(not set)',
    oauthClientId:   getOAuthClientId() || '(not set)',
    oauthRedirectUri: getOAuthRedirectUri(),
    oauthToken:      oauthStatus,
    defaultFormat:   getDefaultFormat(),
    perPage:         getPerPage(),
    updateCheck:     getUpdateCheckEnabled(),
    telemetry:       getTelemetryEnabled(),
    configPath:      config.path,
  };
}

function secureConfig() {
  try {
    chmodSync(config.path, 0o600);
  } catch {
    // non-fatal
  }
}

export default config;
