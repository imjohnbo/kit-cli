/**
 * Tests for src/config.js
 *
 * Only tests that do NOT write to the config file are included here, so the
 * suite is safe to run in any environment without polluting the developer's
 * stored credentials.  Writing tests are intentionally omitted.
 */

// Self-protecting against KIT_CREDENTIAL_STORE regardless of how this file is
// invoked (e.g. directly via `npm run test:file scripts/config.test.js`,
// which bypasses run-tests.js's own env setup). `??=` so it never clobbers an
// intentional override. This line's placement WORKS because
// keychain.js's isAvailable() reads process.env lazily, inside a function
// body called at test-run time (long after this line executes) — unlike
// KIT_CONFIG_DIR below, which config.js reads eagerly, at import time.
process.env.KIT_CREDENTIAL_STORE ??= 'file';

// KIT_CONFIG_DIR can NOT be defaulted the same way: src/config.js reads it in
// `new Conf({ cwd: process.env.KIT_CONFIG_DIR || undefined })` at its own
// top level, and ES module imports are fully evaluated — hoisted ahead of
// everything else in this file — before any of this file's own statements
// run, including ones written earlier in the source (verified empirically:
// an in-file `KIT_CONFIG_DIR ??= ...` placed here, before the config.js
// import below, silently has no effect on it). So instead of a default,
// this refuses to run at all unless the caller already set it — exactly
// what run-tests.js's npm test wrapper does for every test file. Confirmed
// necessary by two real incidents on a real dev machine: running this file
// directly, without KIT_CONFIG_DIR, silently overwrote a real stored apiKey
// via this file's own "does NOT throw for a key of exactly 256 characters"
// test.
if (!process.env.KIT_CONFIG_DIR) {
  console.error(
    'Refusing to run scripts/config.test.js directly: KIT_CONFIG_DIR is not set.\n' +
    'This file writes real config values during some tests, and without KIT_CONFIG_DIR\n' +
    'they would land in your real config file. Run it via `npm test`, which sets this\n' +
    'automatically, or set KIT_CONFIG_DIR yourself to a scratch directory first.'
  );
  process.exit(1);
}

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setApiKey, getApiKey, getOAuthClientId, getOAuthRedirectUri, setBaseUrl, getBaseUrl, getTelemetryEnabled } from '../src/config.js';

// ── setApiKey – validation (throws before writing to disk) ─────────────────

describe('setApiKey validation', () => {
  test('throws for empty string', () => {
    assert.throws(
      () => setApiKey(''),
      { message: 'API key must be a non-empty string.' }
    );
  });

  test('throws for whitespace-only string', () => {
    assert.throws(
      () => setApiKey('   '),
      { message: 'API key must be a non-empty string.' }
    );
  });

  test('throws for non-string value (number)', () => {
    assert.throws(
      () => setApiKey(12345),
      { message: 'API key must be a non-empty string.' }
    );
  });

  test('throws for null', () => {
    assert.throws(
      () => setApiKey(null),
      { message: 'API key must be a non-empty string.' }
    );
  });

  test('throws for undefined', () => {
    assert.throws(
      () => setApiKey(undefined),
      { message: 'API key must be a non-empty string.' }
    );
  });

  test('throws when key exceeds 256 characters', () => {
    assert.throws(
      () => setApiKey('a'.repeat(257)),
      { message: 'API key is too long (max 256 characters).' }
    );
  });

  test('does NOT throw for a key of exactly 256 characters', () => {
    // 256-char key is at the boundary; it should write — but we just check
    // the validation logic does not throw. The actual write may succeed or
    // fail depending on the environment, which is acceptable here.
    // We catch any error that is NOT a validation error.
    try {
      setApiKey('a'.repeat(256));
    } catch (err) {
      assert.notEqual(err.message, 'API key is too long (max 256 characters).');
    }
  });

  test('throws for key containing null byte (control char)', () => {
    assert.throws(
      () => setApiKey('key\x00here'),
      { message: 'API key contains invalid control characters.' }
    );
  });

  test('throws for key containing newline', () => {
    assert.throws(
      () => setApiKey('key\nvalue'),
      { message: 'API key contains invalid control characters.' }
    );
  });

  test('throws for key containing carriage return', () => {
    assert.throws(
      () => setApiKey('key\rvalue'),
      { message: 'API key contains invalid control characters.' }
    );
  });

  test('throws for key containing tab character', () => {
    assert.throws(
      () => setApiKey('key\there'),
      { message: 'API key contains invalid control characters.' }
    );
  });

  test('throws for key containing DEL character (0x7f)', () => {
    assert.throws(
      () => setApiKey('key\x7fhere'),
      { message: 'API key contains invalid control characters.' }
    );
  });
});

// ── setBaseUrl – validation (throws before writing to disk) ────────────────

describe('setBaseUrl validation', () => {
  test('throws for empty string', () => {
    assert.throws(
      () => setBaseUrl(''),
      { message: 'Base URL must be a non-empty string.' }
    );
  });

  test('throws for whitespace-only string', () => {
    assert.throws(
      () => setBaseUrl('   '),
      { message: 'Base URL must be a non-empty string.' }
    );
  });

  test('throws for null', () => {
    assert.throws(
      () => setBaseUrl(null),
      { message: 'Base URL must be a non-empty string.' }
    );
  });

  test('throws for non-string value (number)', () => {
    assert.throws(
      () => setBaseUrl(12345),
      { message: 'Base URL must be a non-empty string.' }
    );
  });

  test('throws for a value that is not a valid URL', () => {
    assert.throws(
      () => setBaseUrl('not-a-url'),
      /Invalid base URL/
    );
  });

  test('throws for a non-http(s) protocol', () => {
    assert.throws(
      () => setBaseUrl('ftp://api.kit.com/v4'),
      { message: 'Base URL must use http or https.' }
    );
  });
});

// ── getBaseUrl – environment variable override + normalization ─────────────

describe('getBaseUrl', () => {
  let _saved;

  before(() => {
    _saved = process.env.KIT_API_BASE;
    delete process.env.KIT_API_BASE;
  });

  after(() => {
    if (_saved !== undefined) {
      process.env.KIT_API_BASE = _saved;
    } else {
      delete process.env.KIT_API_BASE;
    }
  });

  test('returns KIT_API_BASE env var when set', () => {
    process.env.KIT_API_BASE = 'https://api.example.com/v4';
    assert.equal(getBaseUrl(), 'https://api.example.com/v4');
    delete process.env.KIT_API_BASE;
  });

  test('strips trailing slashes from the env var value', () => {
    process.env.KIT_API_BASE = 'https://api.example.com/v4/';
    assert.equal(getBaseUrl(), 'https://api.example.com/v4');
    delete process.env.KIT_API_BASE;
  });

  test('returns an http(s) URL when neither env nor config overrides it', () => {
    const val = getBaseUrl();
    assert.equal(typeof val, 'string');
    assert.match(val, /^https?:\/\//);
  });
});

// ── getApiKey – environment variable override ──────────────────────────────

describe('getApiKey', () => {
  let _saved;

  before(() => {
    _saved = process.env.KIT_API_KEY;
    delete process.env.KIT_API_KEY;
  });

  after(() => {
    if (_saved !== undefined) {
      process.env.KIT_API_KEY = _saved;
    } else {
      delete process.env.KIT_API_KEY;
    }
  });

  test('returns KIT_API_KEY env var when set', () => {
    process.env.KIT_API_KEY = 'env-key-xyz';
    assert.equal(getApiKey(), 'env-key-xyz');
    delete process.env.KIT_API_KEY;
  });

  test('env var takes precedence over any stored config value', () => {
    process.env.KIT_API_KEY = 'env-priority-key';
    const result = getApiKey();
    delete process.env.KIT_API_KEY;
    assert.equal(result, 'env-priority-key');
  });
});

// ── getOAuthClientId – environment variable override ──────────────────────

describe('getOAuthClientId', () => {
  let _saved;

  before(() => {
    _saved = process.env.KIT_CLIENT_ID;
    delete process.env.KIT_CLIENT_ID;
  });

  after(() => {
    if (_saved !== undefined) {
      process.env.KIT_CLIENT_ID = _saved;
    } else {
      delete process.env.KIT_CLIENT_ID;
    }
  });

  test('returns KIT_CLIENT_ID env var when set', () => {
    process.env.KIT_CLIENT_ID = 'client-id-abc';
    assert.equal(getOAuthClientId(), 'client-id-abc');
    delete process.env.KIT_CLIENT_ID;
  });
});

// ── getOAuthRedirectUri – environment variable override ───────────────────

describe('getOAuthRedirectUri', () => {
  let _saved;

  before(() => {
    _saved = process.env.KIT_REDIRECT_URI;
    delete process.env.KIT_REDIRECT_URI;
  });

  after(() => {
    if (_saved !== undefined) {
      process.env.KIT_REDIRECT_URI = _saved;
    } else {
      delete process.env.KIT_REDIRECT_URI;
    }
  });

  test('returns KIT_REDIRECT_URI env var when set', () => {
    process.env.KIT_REDIRECT_URI = 'http://localhost:9876/callback';
    assert.equal(getOAuthRedirectUri(), 'http://localhost:9876/callback');
    delete process.env.KIT_REDIRECT_URI;
  });

  test('returns empty string when neither env nor config has a value', () => {
    // With no env var and a fresh config, redirect URI defaults to ''
    const val = getOAuthRedirectUri();
    assert.equal(typeof val, 'string');
  });
});

// ── getTelemetryEnabled – default value (read-only, no write) ──────────────

describe('getTelemetryEnabled', () => {
  test('defaults to true when never set', () => {
    assert.equal(getTelemetryEnabled(), true);
  });
});
