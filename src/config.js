import Conf from 'conf';
import { chmodSync } from 'node:fs';

const config = new Conf({
  projectName: 'kit-cli',
  schema: {
    apiKey: { type: 'string', default: '' },
    defaultFormat: { type: 'string', default: 'table', enum: ['table', 'json'] },
    perPage: { type: 'number', default: 50, minimum: 1, maximum: 1000 },
  },
});

// Restrict config file permissions to owner-only (contains API key)
try {
  chmodSync(config.path, 0o600);
} catch {
  // May fail on Windows or if file doesn't exist yet — non-fatal
}

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
  // Re-apply restrictive permissions after write
  try {
    chmodSync(config.path, 0o600);
  } catch {
    // non-fatal
  }
}

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

export function getAll() {
  return {
    apiKey: getApiKey() ? '****' + getApiKey().slice(-4) : '(not set)',
    defaultFormat: getDefaultFormat(),
    perPage: getPerPage(),
    configPath: config.path,
  };
}

export default config;
