import Conf from 'conf';
import { chmodSync } from 'node:fs';

const config = new Conf({
  projectName: 'kit-cli',
  schema: {
    apiKey:         { type: 'string', default: '' },
    defaultFormat:  { type: 'string', default: 'table', enum: ['table', 'json'] },
    perPage:        { type: 'number', default: 50, minimum: 1, maximum: 1000 },
    oauthClientId:  { type: 'string', default: '' },
    oauthRedirectUri: { type: 'string', default: '' },
    accessToken:    { type: 'string', default: '' },
    refreshToken:   { type: 'string', default: '' },
    tokenExpiresAt: { type: 'number', default: 0 }, // unix ms
  },
});

// Restrict config file permissions to owner-only (contains API key / tokens)
try {
  chmodSync(config.path, 0o600);
} catch {
  // May fail on Windows or if file doesn't exist yet — non-fatal
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
    apiKey:          getApiKey() ? '****' + getApiKey().slice(-4) : '(not set)',
    oauthClientId:   getOAuthClientId() || '(not set)',
    oauthRedirectUri: getOAuthRedirectUri(),
    oauthToken:      oauthStatus,
    defaultFormat:   getDefaultFormat(),
    perPage:         getPerPage(),
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
