import Conf from 'conf';
import { chmodSync } from 'node:fs';
import { dirname } from 'node:path';
import * as realKeychainStore from './keychain.js';

// The real backend, unless a test swaps it out via _setKeychainStoreForTests
// below. A plain local variable, not an export — reassigning it is ordinary
// JS, unlike trying to monkey-patch an ES module's own named export (which
// throws "Cannot redefine property").
let keychainStore = realKeychainStore;

// Populated lazily, once per process, the first time a secret is read while
// the Keychain is in use. null means "not loaded yet"; after that it's
// always an object (possibly {}).
let credentialBlob = null;

// Set for the rest of the process once any Keychain operation fails, so a
// paginated run doesn't retry a broken Keychain (and re-print the warning)
// on every single request.
let keychainDisabledForProcess = false;
let warnedAboutFallback = false;

const SECRET_FIELDS = ['apiKey', 'accessToken', 'refreshToken'];

// KIT_CONFIG_DIR moves the config file somewhere else. Point it at a directory
// per Kit account to keep separate profiles, or at a throwaway directory to keep
// a script from touching your real credentials. The test suite uses it for that.
const config = new Conf({
  // Deliberately a fixed string, not the package name. This names the directory
  // that holds a user's credentials. Renaming the package must not orphan it.
  projectName: 'kit-cli',
  cwd: process.env.KIT_CONFIG_DIR || undefined,
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
  },
});

// Restrict config file permissions to owner-only (contains API key / tokens)
try {
  chmodSync(config.path, 0o600);
} catch {
  // May fail on Windows or if file doesn't exist yet — non-fatal
}

/** One Keychain item per config profile: the resolved config directory
 *  itself is the account name, so KIT_CONFIG_DIR profiles (work, personal,
 *  default) never collide in the single shared Keychain. */
function credentialAccount() {
  return dirname(config.path);
}

function warnKeychainFallback(err) {
  if (warnedAboutFallback) return;
  warnedAboutFallback = true;
  console.error(
    `Warning: Keychain access failed (${err.message}). Using the local config file instead.\n` +
    `If you were previously logged in, this may be a transient Keychain issue rather than a ` +
    `missing credential — try \`kit login\` again, or check Keychain Access for a "kit-cli" item.`
  );
}

function keychainUsable() {
  return keychainStore.isAvailable() && !keychainDisabledForProcess;
}

/**
 * Returns the cached credential blob, loading it on first use. If no
 * Keychain item exists yet, migrates any plaintext secrets already in the
 * config file into a new one — but only blanks those plaintext fields after
 * the Keychain write actually succeeds, so a failed migration never loses
 * data.
 */
function loadCredentialBlob() {
  if (credentialBlob !== null) return credentialBlob;

  let blob = keychainStore.readCredentials(credentialAccount());

  if (blob === null) {
    const legacy = {};
    for (const field of SECRET_FIELDS) {
      const value = config.get(field);
      if (value) legacy[field] = value;
    }

    if (Object.keys(legacy).length > 0) {
      keychainStore.writeCredentials(credentialAccount(), legacy);
      for (const field of Object.keys(legacy)) config.set(field, '');
      blob = legacy;
    } else {
      blob = {};
    }
  }

  credentialBlob = blob;
  return credentialBlob;
}

function readSecretField(field) {
  if (!keychainUsable()) return config.get(field);

  try {
    return loadCredentialBlob()[field] || '';
  } catch (err) {
    keychainDisabledForProcess = true;
    warnKeychainFallback(err);
    return config.get(field);
  }
}

function writeSecretField(field, value) {
  writeSecretFields({ [field]: value });
}

/**
 * Like writeSecretField, but for setting several fields at once (e.g. both
 * OAuth tokens) with a single Keychain read-modify-write round trip instead
 * of one per field.
 */
function writeSecretFields(fields) {
  if (!keychainUsable()) {
    for (const [field, value] of Object.entries(fields)) config.set(field, value);
    return;
  }

  try {
    const blob = { ...loadCredentialBlob(), ...fields };
    keychainStore.writeCredentials(credentialAccount(), blob);
    credentialBlob = blob;
  } catch (err) {
    keychainDisabledForProcess = true;
    warnKeychainFallback(err);
    for (const [field, value] of Object.entries(fields)) config.set(field, value);
  }
}

/**
 * Test-only: swap the Keychain backend for a fake one, and reset the
 * in-process cache/fallback state. Call with no arguments to restore the
 * real backend. Not used outside the test suite.
 */
export function _setKeychainStoreForTests(fake) {
  keychainStore = fake || realKeychainStore;
  credentialBlob = null;
  keychainDisabledForProcess = false;
  warnedAboutFallback = false;
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
  return process.env.KIT_API_KEY || readSecretField('apiKey');
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
  writeSecretField('apiKey', key.trim());
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
  return readSecretField('accessToken');
}

export function getRefreshToken() {
  return readSecretField('refreshToken');
}

export function isTokenExpired() {
  const expiresAt = config.get('tokenExpiresAt');
  if (!expiresAt) return true;
  // Treat as expired 5 minutes early to avoid races
  return Date.now() > expiresAt - 5 * 60 * 1000;
}

export function setTokens(accessToken, refreshToken, createdAt, expiresIn) {
  // Kit returns created_at as unix seconds, expires_in as seconds
  writeSecretFields({ accessToken, refreshToken });
  config.set('tokenExpiresAt', (createdAt + expiresIn) * 1000);
  secureConfig();
}

export function clearTokens() {
  writeSecretFields({ accessToken: '', refreshToken: '' });
  config.set('tokenExpiresAt', 0);
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
    credentialStore: credentialStoreLabel(),
    oauthClientId:   getOAuthClientId() || '(not set)',
    oauthRedirectUri: getOAuthRedirectUri(),
    oauthToken:      oauthStatus,
    defaultFormat:   getDefaultFormat(),
    perPage:         getPerPage(),
    updateCheck:     getUpdateCheckEnabled(),
    configPath:      config.path,
  };
}

function credentialStoreLabel() {
  return keychainUsable() ? 'macOS Keychain' : 'file (plaintext)';
}

function secureConfig() {
  try {
    chmodSync(config.path, 0o600);
  } catch {
    // non-fatal
  }
}

export default config;
