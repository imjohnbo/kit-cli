/**
 * Tests for the Keychain-aware credential handling added to src/config.js:
 * reading/writing apiKey and OAuth tokens through a Keychain-shaped backend,
 * migrating pre-existing plaintext secrets into it, falling back to the
 * plaintext file on any failure, and reporting which backend is active.
 *
 * Every test swaps in a fully fake backend via _setKeychainStoreForTests —
 * this file never touches the real src/keychain.js or a real Keychain,
 * regardless of platform or KIT_CREDENTIAL_STORE. (Real ES module exports
 * can't be monkey-patched with t.mock.method — see the plan's "Before you
 * start" section.)
 */
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import config, {
  getApiKey,
  setApiKey,
  getAccessToken,
  getRefreshToken,
  setTokens,
  clearTokens,
  getAll,
  _setKeychainStoreForTests,
} from '../src/config.js';
import { KeychainError } from '../src/keychain.js';

function fakeStore({ available = true, blob = null, failWith = null } = {}) {
  const store = {
    blob,
    reads: 0,
    writes: 0,
    isAvailable: () => available,
    readCredentials: () => {
      store.reads++;
      if (failWith) throw failWith;
      return store.blob;
    },
    writeCredentials: (account, value) => {
      store.writes++;
      if (failWith) throw failWith;
      store.blob = value;
    },
  };
  return store;
}

let originalApiKeyEnv;

beforeEach(() => {
  originalApiKeyEnv = process.env.KIT_API_KEY;
  delete process.env.KIT_API_KEY;
});

afterEach(() => {
  _setKeychainStoreForTests(); // restore the real backend + reset the cache
  if (originalApiKeyEnv === undefined) delete process.env.KIT_API_KEY;
  else process.env.KIT_API_KEY = originalApiKeyEnv;
  // Some tests write directly to the plaintext fields (via the `config`
  // default export) to set up a "pre-existing legacy credential" scenario.
  // Blank them after every test so that never leaks into the next one.
  config.set('apiKey', '');
  config.set('accessToken', '');
  config.set('refreshToken', '');
});

// ── reading and writing through the Keychain ────────────────────────────

describe('credentials, Keychain available', () => {
  test('setApiKey writes into the blob and getApiKey reads it back', () => {
    const store = fakeStore({ blob: {} });
    _setKeychainStoreForTests(store);

    setApiKey('sk-test-123');

    assert.equal(getApiKey(), 'sk-test-123');
    assert.deepEqual(store.blob, { apiKey: 'sk-test-123' });
  });

  test('setTokens preserves apiKey already in the blob', () => {
    const store = fakeStore({ blob: { apiKey: 'sk-existing' } });
    _setKeychainStoreForTests(store);

    setTokens('access-1', 'refresh-1', 1_700_000_000, 3600);

    assert.deepEqual(store.blob, {
      apiKey: 'sk-existing',
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
    });
    assert.equal(getAccessToken(), 'access-1');
    assert.equal(getRefreshToken(), 'refresh-1');
  });

  test('clearTokens blanks the tokens but keeps apiKey', () => {
    const store = fakeStore({
      blob: { apiKey: 'sk-existing', accessToken: 'access-1', refreshToken: 'refresh-1' },
    });
    _setKeychainStoreForTests(store);

    clearTokens();

    assert.deepEqual(store.blob, { apiKey: 'sk-existing', accessToken: '', refreshToken: '' });
  });

  test('the blob is read once per process and cached, not once per field read', () => {
    const store = fakeStore({ blob: { apiKey: 'sk-existing' } });
    _setKeychainStoreForTests(store);

    getApiKey();
    getAccessToken();
    getRefreshToken();

    assert.equal(store.reads, 1);
  });

  test('KIT_API_KEY env var still wins over the Keychain', () => {
    const store = fakeStore({ blob: { apiKey: 'sk-from-keychain' } });
    _setKeychainStoreForTests(store);
    process.env.KIT_API_KEY = 'sk-from-env';

    assert.equal(getApiKey(), 'sk-from-env');
  });
});

// ── migration of pre-existing plaintext secrets ─────────────────────────

describe('migration', () => {
  test('is a no-op when there is nothing to migrate', () => {
    const store = fakeStore({ blob: null });
    _setKeychainStoreForTests(store);

    assert.equal(getApiKey(), '');
    assert.equal(store.writes, 0);
  });

  test('migrates a pre-existing plaintext apiKey into a new Keychain blob, then blanks the file', () => {
    config.set('apiKey', 'sk-legacy-plaintext');
    const store = fakeStore({ blob: null });
    _setKeychainStoreForTests(store);

    assert.equal(getApiKey(), 'sk-legacy-plaintext');
    assert.deepEqual(store.blob, { apiKey: 'sk-legacy-plaintext' });
    assert.equal(config.get('apiKey'), '');
  });

  test('does not blank the plaintext field when the migration write fails', () => {
    config.set('apiKey', 'sk-legacy-plaintext');
    _setKeychainStoreForTests({
      isAvailable: () => true,
      readCredentials: () => null, // no Keychain item yet
      writeCredentials: () => { throw new KeychainError('locked'); },
    });

    assert.equal(getApiKey(), 'sk-legacy-plaintext'); // falls back to the file
    assert.equal(config.get('apiKey'), 'sk-legacy-plaintext'); // never blanked
  });
});

// ── fallback on failure ──────────────────────────────────────────────────

describe('fallback when the Keychain is unavailable or fails', () => {
  test('unavailable backend reads/writes the plaintext field directly', () => {
    const store = fakeStore({ available: false });
    _setKeychainStoreForTests(store);

    setApiKey('sk-plaintext');

    assert.equal(getApiKey(), 'sk-plaintext');
    assert.equal(store.reads, 0);
    assert.equal(store.writes, 0);
  });

  test('a read failure falls back to the plaintext field instead of throwing', () => {
    const store = fakeStore({ failWith: new KeychainError('locked') });
    _setKeychainStoreForTests(store);

    assert.doesNotThrow(() => getApiKey());
  });

  test('a write failure falls back to writing the plaintext field', () => {
    const store = fakeStore({ blob: {}, failWith: new KeychainError('locked') });
    _setKeychainStoreForTests(store);

    assert.doesNotThrow(() => setApiKey('sk-fallback'));
    assert.equal(getApiKey(), 'sk-fallback');
  });
});

// ── kit config show ──────────────────────────────────────────────────────

describe('getAll credentialStore label', () => {
  test('reports macOS Keychain when available', () => {
    // blob: {} so this fake is a genuinely working backend — getAll() calls
    // getApiKey() before computing the label, and a fake with no working
    // readCredentials/writeCredentials would throw internally, get caught,
    // and silently fall back, making this test pass for the wrong reason.
    _setKeychainStoreForTests(fakeStore({ available: true, blob: {} }));
    assert.equal(getAll().credentialStore, 'macOS Keychain');
  });

  test('reports the plaintext file when unavailable', () => {
    _setKeychainStoreForTests(fakeStore({ available: false }));
    assert.equal(getAll().credentialStore, 'file (plaintext)');
  });

  test('reports the plaintext file after a mid-process fallback, even though isAvailable() still says true', () => {
    // A working-looking backend (isAvailable() -> true) that fails on the
    // very first real operation. That failure sets keychainDisabledForProcess,
    // which credentialStoreLabel() must reflect — not just static availability.
    const store = fakeStore({ available: true, failWith: new KeychainError('locked') });
    _setKeychainStoreForTests(store);

    getApiKey(); // triggers the failure and the fallback

    assert.equal(getAll().credentialStore, 'file (plaintext)');
  });
});

// ── warn-once dedupe ──────────────────────────────────────────────────────

describe('Keychain fallback warning', () => {
  test('is printed only once per process, even across repeated failures', (t) => {
    const store = fakeStore({ failWith: new KeychainError('locked') });
    _setKeychainStoreForTests(store);
    const errorMock = t.mock.method(console, 'error', () => {});

    getApiKey();
    getApiKey();

    assert.equal(errorMock.mock.callCount(), 1);
    assert.match(errorMock.mock.calls[0].arguments[0], /Keychain access failed \(locked\)/);
  });
});
