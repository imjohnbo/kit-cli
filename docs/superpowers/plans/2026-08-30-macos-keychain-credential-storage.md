# macOS Keychain Credential Storage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Store `kit login`'s OAuth tokens and `kit config set-api-key`'s API key in the macOS Keychain instead of plaintext JSON, with automatic migration of existing credentials and an unchanged plaintext-file fallback everywhere else.

**Architecture:** A new `src/keychain.js` module shells out to `/usr/bin/security` (no new dependency) to read/write one JSON blob per config profile. `src/config.js` gets a thin credential layer in front of the three secret fields (`apiKey`, `accessToken`, `refreshToken`) that reads/writes through that blob when available, transparently migrates existing plaintext secrets into it on first use, and falls back to today's plaintext file (with a one-line warning) on any failure or on non-macOS platforms.

**Tech Stack:** Node.js (`node:child_process`, `node:path`), the existing `conf` package, `node:test` for tests. Zero new dependencies.

**Design doc:** [`docs/superpowers/specs/2026-08-29-macos-keychain-credential-storage-design.md`](../specs/2026-08-29-macos-keychain-credential-storage-design.md)

---

## Before you start

All commands below assume the working directory is the repo root. Run `git status` first — the repo should be clean before Task 1.

Two things worth knowing about this codebase's test setup before touching it:

1. **`npm test` (`scripts/run-tests.js`) spawns each `scripts/*.test.js` file in its own child process**, with `KIT_CONFIG_DIR` pointed at a fresh scratch directory per file. This is the *only* thing that makes it safe to run tests against real `src/config.js` code without touching a developer's actual stored credentials — a bare `node --test scripts/some-command.test.js` run outside that wrapper does **not** get this protection.
2. **Real ES module exports cannot be monkey-patched.** `t.mock.method()` throws `Cannot redefine property` when pointed at another module's named export (this was verified empirically while designing this plan, not assumed) — this applies to built-ins like `node:child_process` *and* to your own `.js` files. Every test below works around this with plain dependency injection (an optional `{ run }` parameter on `src/keychain.js`'s functions, and a swappable module-level variable in `src/config.js`) — not a mocking library, and not `t.mock.method` on a named export.

---

## Task 1: `src/keychain.js` — the macOS Keychain wrapper

**Files:**
- Create: `src/keychain.js`
- Test: `scripts/keychain.test.js`

This module is self-contained: it knows nothing about `conf`, config profiles, or fallback logic. It only knows how to read/write one JSON blob per Keychain "account" via `/usr/bin/security`, with a real timeout and real error typing. Every exported function takes an optional `{ run }` override in place of the real subprocess call, so tests never invoke the real `security` binary.

**Deviation from the design doc:** the spec's sketch of this interface includes a `deleteCredentials` function. It's left out here — nothing in Task 2's `src/config.js` changes ever needs to delete a profile's entire Keychain item (`clearTokens`/`kit logout` only blank two fields inside the blob, keeping `apiKey`), so an unused export would just be untested dead code. Add it back (with a matching test in Step 1) if a future feature needs it.

- [ ] **Step 1: Write the failing test file**

Create `scripts/keychain.test.js`:

```js
/**
 * Tests for src/keychain.js
 *
 * Every test injects a fake `run` function in place of the real
 * /usr/bin/security call, so this file never touches the real macOS
 * Keychain and is safe to run on any platform, including Linux CI.
 * (Real ES module exports can't be monkey-patched with t.mock.method —
 * see the plan's "Before you start" section for why this uses plain
 * dependency injection instead.)
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { isAvailable, readCredentials, writeCredentials, KeychainError } from '../src/keychain.js';

const ACCOUNT = '/Users/test/.config/kit-cli';

/** A fake `run` that returns `result` and records every call it received. */
function fakeRun(result) {
  const calls = [];
  const run = (args) => {
    calls.push(args);
    return result;
  };
  run.calls = calls;
  return run;
}

// ── isAvailable ──────────────────────────────────────────────────────────

describe('isAvailable', () => {
  test('is false when KIT_CREDENTIAL_STORE=file, regardless of platform', () => {
    const original = process.env.KIT_CREDENTIAL_STORE;
    process.env.KIT_CREDENTIAL_STORE = 'file';
    try {
      assert.equal(isAvailable(), false);
    } finally {
      if (original === undefined) delete process.env.KIT_CREDENTIAL_STORE;
      else process.env.KIT_CREDENTIAL_STORE = original;
    }
  });

  test('is false on non-macOS platforms', { skip: process.platform === 'darwin' }, () => {
    assert.equal(isAvailable(), false);
  });
});

// ── readCredentials ──────────────────────────────────────────────────────

describe('readCredentials', () => {
  test('sends the expected security arguments', () => {
    const run = fakeRun({ status: 0, stdout: '{}', stderr: '' });
    readCredentials(ACCOUNT, { run });
    assert.deepEqual(run.calls[0], [
      'find-generic-password', '-a', ACCOUNT, '-s', 'kit-cli', '-w',
    ]);
  });

  test('parses the stored JSON blob', () => {
    const run = fakeRun({ status: 0, stdout: '{"apiKey":"abc123"}\n', stderr: '' });
    const result = readCredentials(ACCOUNT, { run });
    assert.deepEqual(result, { apiKey: 'abc123' });
  });

  test('returns null when the item does not exist (exit 44)', () => {
    const run = fakeRun({ status: 44, stdout: '', stderr: 'security: item not found' });
    assert.equal(readCredentials(ACCOUNT, { run }), null);
  });

  test('throws KeychainError on any other non-zero exit', () => {
    const run = fakeRun({ status: 51, stdout: '', stderr: 'security: something failed' });
    assert.throws(() => readCredentials(ACCOUNT, { run }), KeychainError);
  });

  test('throws KeychainError when the stored value is not valid JSON', () => {
    const run = fakeRun({ status: 0, stdout: 'not-json', stderr: '' });
    assert.throws(() => readCredentials(ACCOUNT, { run }), KeychainError);
  });

  test('throws KeychainError when the subprocess fails to start', () => {
    const run = fakeRun({ error: new Error('spawn ENOENT'), status: null, stdout: '', stderr: '' });
    assert.throws(() => readCredentials(ACCOUNT, { run }), KeychainError);
  });

  test('throws KeychainError when the call is killed by a signal (e.g. timeout)', () => {
    const run = fakeRun({ signal: 'SIGTERM', status: null, stdout: '', stderr: '' });
    assert.throws(() => readCredentials(ACCOUNT, { run }), KeychainError);
  });
});

// ── writeCredentials ─────────────────────────────────────────────────────

describe('writeCredentials', () => {
  test('sends the JSON-stringified blob and -U to update in place', () => {
    const run = fakeRun({ status: 0, stdout: '', stderr: '' });
    writeCredentials(ACCOUNT, { apiKey: 'abc123' }, { run });
    assert.deepEqual(run.calls[0], [
      'add-generic-password', '-a', ACCOUNT, '-s', 'kit-cli', '-w', '{"apiKey":"abc123"}', '-U',
    ]);
  });

  test('throws KeychainError on a non-zero exit', () => {
    const run = fakeRun({ status: 1, stdout: '', stderr: 'security: denied' });
    assert.throws(() => writeCredentials(ACCOUNT, {}, { run }), KeychainError);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test scripts/keychain.test.js`
Expected: FAIL — `Cannot find module '../src/keychain.js'` (the module doesn't exist yet).

- [ ] **Step 3: Write the implementation**

Create `src/keychain.js`:

```js
import { spawnSync } from 'node:child_process';

const SERVICE = 'kit-cli';
const SECURITY_PATH = '/usr/bin/security';
const TIMEOUT_MS = 10_000;
const ERR_ITEM_NOT_FOUND = 44;

export class KeychainError extends Error {
  constructor(message) {
    super(message);
    this.name = 'KeychainError';
  }
}

/** True only on macOS, and only when KIT_CREDENTIAL_STORE hasn't forced the
 *  plaintext file instead. */
export function isAvailable() {
  return process.platform === 'darwin' && process.env.KIT_CREDENTIAL_STORE !== 'file';
}

/** The real call to /usr/bin/security. A named function (not inlined) so
 *  tests can substitute a fake one via the `run` option below — real ES
 *  module exports can't be monkey-patched, so this is plain dependency
 *  injection instead of a mocking library. */
function defaultRun(args) {
  return spawnSync(SECURITY_PATH, args, { encoding: 'utf8', timeout: TIMEOUT_MS });
}

function invoke(args, run) {
  const result = run(args);
  // Check signal before error: a timeout sets both, and "killed by signal"
  // is the more accurate message for that case.
  if (result.signal) {
    throw new KeychainError(`${SECURITY_PATH} was killed by signal ${result.signal} (it may have timed out)`);
  }
  if (result.error) {
    throw new KeychainError(`${SECURITY_PATH} failed to run: ${result.error.message}`);
  }
  return result;
}

/**
 * Reads and JSON-parses the Keychain item for `account`. Returns null if no
 * such item exists yet. Throws KeychainError for anything else (locked
 * Keychain, denied prompt, timeout, corrupt stored value).
 */
export function readCredentials(account, { run = defaultRun } = {}) {
  const result = invoke(['find-generic-password', '-a', account, '-s', SERVICE, '-w'], run);

  if (result.status === ERR_ITEM_NOT_FOUND) return null;
  if (result.status !== 0) {
    throw new KeychainError(`security find-generic-password exited ${result.status}: ${(result.stderr || '').trim()}`);
  }

  try {
    return JSON.parse(result.stdout.trim());
  } catch (err) {
    throw new KeychainError(`Keychain item for "${account}" is not valid JSON: ${err.message}`);
  }
}

/**
 * JSON-stringifies `credentials` and stores it for `account`, replacing any
 * existing item (-U, so a second write doesn't fail as a duplicate). Throws
 * KeychainError on failure.
 */
export function writeCredentials(account, credentials, { run = defaultRun } = {}) {
  const result = invoke(
    ['add-generic-password', '-a', account, '-s', SERVICE, '-w', JSON.stringify(credentials), '-U'],
    run
  );

  if (result.status !== 0) {
    throw new KeychainError(`security add-generic-password exited ${result.status}: ${(result.stderr || '').trim()}`);
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test scripts/keychain.test.js`
Expected: PASS — 10 tests green (11 on non-macOS, where the `is false on non-macOS platforms` test isn't skipped).

- [ ] **Step 5: Commit**

```bash
git add src/keychain.js scripts/keychain.test.js
git commit -m "feat: add src/keychain.js, a macOS Keychain wrapper around /usr/bin/security"
```

---

## Task 2: Wire `src/config.js` to the Keychain

**Files:**
- Modify: `scripts/run-tests.js`
- Modify: `src/config.js`
- Test: `scripts/config-credentials.test.js` (new)
- Test: `scripts/config.test.js` (add two tests)

### Step group A: protect the existing suite first

This must land *before* `src/config.js` changes, so the repo is never in a state where `npm test` could pop a real Keychain prompt on a contributor's Mac. Every existing test file that touches `apiKey`/tokens (`tags.test.js`, `webhooks.test.js`, `subscribers.test.js`, `account-purchases.test.js`, `upgrade.test.js`, `subscriber-location.test.js`) goes through `scripts/helpers.js`'s `runCommand`, which calls the real `src/config.js` functions — once those functions can reach the real Keychain, they will, unless this env var is set first.

- [ ] **Step 1: Add `KIT_CREDENTIAL_STORE: 'file'` to the per-file test environment**

Modify `scripts/run-tests.js`. Find this block (around line 37):

```js
    const child = spawn(process.execPath, ['--test', file], {
      env: { ...process.env, KIT_CONFIG_DIR: join(scratch, `cfg-${index}`) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
```

Replace it with:

```js
    const child = spawn(process.execPath, ['--test', file], {
      env: {
        ...process.env,
        KIT_CONFIG_DIR: join(scratch, `cfg-${index}`),
        // Forces plaintext-file credential storage for the whole suite, so
        // npm test never shells out to the real macOS Keychain (which would
        // pop a permission prompt on a contributor's Mac). New tests that
        // specifically want to exercise the Keychain path do so by
        // injecting a fake backend instead — see scripts/keychain.test.js
        // and scripts/config-credentials.test.js.
        KIT_CREDENTIAL_STORE: 'file',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
```

- [ ] **Step 2: Run the full suite to confirm nothing broke**

Run: `npm test`
Expected: PASS — same result as before this change (this step only adds an env var that today's code doesn't read yet).

- [ ] **Step 3: Commit**

```bash
git add scripts/run-tests.js
git commit -m "test: force plaintext credential storage in the test harness ahead of Keychain support"
```

### Step group B: the failing tests for `src/config.js`

- [ ] **Step 4: Write the failing test file**

Create `scripts/config-credentials.test.js`:

```js
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

/** A fake keychain backend. `blob` starts as the value readCredentials
 *  should return (null = no item yet). Every write updates it in place, so
 *  a test can inspect `store.blob` afterwards. */
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
    _setKeychainStoreForTests(fakeStore({ available: true }));
    assert.equal(getAll().credentialStore, 'macOS Keychain');
  });

  test('reports the plaintext file when unavailable', () => {
    _setKeychainStoreForTests(fakeStore({ available: false }));
    assert.equal(getAll().credentialStore, 'file (plaintext)');
  });
});
```

- [ ] **Step 5: Run the test to verify it fails**

Run: `node --test scripts/config-credentials.test.js`
Expected: FAIL — `_setKeychainStoreForTests is not a function` (doesn't exist in `src/config.js` yet), and `getAll()` has no `credentialStore` key.

### Step group C: implement the config.js changes

- [ ] **Step 6: Add the imports and credential-store state**

Modify `src/config.js`. Replace the top of the file (the two existing imports) with:

```js
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
```

- [ ] **Step 7: Add the credential helper functions**

Modify `src/config.js`. Add these functions right after the `chmodSync(config.path, 0o600)` try/catch block that follows the `Conf` constructor call (before the `--- API base URL ---` comment):

```js
/** One Keychain item per config profile: the resolved config directory
 *  itself is the account name, so KIT_CONFIG_DIR profiles (work, personal,
 *  default) never collide in the single shared Keychain. */
function credentialAccount() {
  return dirname(config.path);
}

function warnKeychainFallback(err) {
  if (warnedAboutFallback) return;
  warnedAboutFallback = true;
  console.error(`Warning: Keychain access failed (${err.message}). Using the local config file instead.`);
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
  if (!keychainUsable()) {
    config.set(field, value);
    return;
  }

  try {
    const blob = { ...loadCredentialBlob(), [field]: value };
    keychainStore.writeCredentials(credentialAccount(), blob);
    credentialBlob = blob;
  } catch (err) {
    keychainDisabledForProcess = true;
    warnKeychainFallback(err);
    config.set(field, value);
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
```

- [ ] **Step 8: Route the API key functions through the credential store**

Modify `src/config.js`. Replace:

```js
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
```

with:

```js
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
```

- [ ] **Step 9: Route the OAuth token functions through the credential store**

Modify `src/config.js`. Replace:

```js
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
```

with:

```js
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
  writeSecretField('accessToken', accessToken);
  writeSecretField('refreshToken', refreshToken);
  config.set('tokenExpiresAt', (createdAt + expiresIn) * 1000);
  secureConfig();
}

export function clearTokens() {
  writeSecretField('accessToken', '');
  writeSecretField('refreshToken', '');
  config.set('tokenExpiresAt', 0);
}
```

- [ ] **Step 10: Report the active backend in `getAll()`**

**Deviation from the design doc:** the spec describes a three-way label — `macOS Keychain`, `file (plaintext)`, or `file (plaintext, forced via KIT_CREDENTIAL_STORE)`. That third variant turned out to need reading `process.platform`/`process.env.KIT_CREDENTIAL_STORE` directly rather than going through the swappable `keychainStore.isAvailable()` — which broke under test injection (verified while writing this plan: `_setKeychainStoreForTests({ isAvailable: () => false })` still reported "forced" whenever the *real* process happened to have `KIT_CREDENTIAL_STORE=file` set, which is exactly what `npm test`'s harness sets for every file after Step 1 above). The fix below drops the third variant — `credentialStoreLabel()` reports only what `keychainStore.isAvailable()` says, which is simpler, and correct under injection.

Modify `src/config.js`. Replace:

```js
  return {
    baseUrl:         getBaseUrl(),
    apiKey:          getApiKey() ? '****' + getApiKey().slice(-4) : '(not set)',
    oauthClientId:   getOAuthClientId() || '(not set)',
    oauthRedirectUri: getOAuthRedirectUri(),
    oauthToken:      oauthStatus,
    defaultFormat:   getDefaultFormat(),
    perPage:         getPerPage(),
    updateCheck:     getUpdateCheckEnabled(),
    configPath:      config.path,
  };
}
```

with:

```js
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
  return keychainStore.isAvailable() ? 'macOS Keychain' : 'file (plaintext)';
}
```

- [ ] **Step 11: Run the new test file to verify it passes**

Run: `node --test scripts/config-credentials.test.js`
Expected: PASS — 13 tests green.

- [ ] **Step 12: Add the read-only `getAll()` tests to the existing config test file**

Modify `scripts/config.test.js`. This file's own header comment says it intentionally excludes tests that write to the config file — these two don't (they only read `getAll()`/`isAvailable()`, never call a `set*` function), so they belong here rather than in the new file.

Replace the two import lines at the top of the file:

```js
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setApiKey, getApiKey, getOAuthClientId, getOAuthRedirectUri, setBaseUrl, getBaseUrl } from '../src/config.js';
```

with:

```js
import { test, describe, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { setApiKey, getApiKey, getOAuthClientId, getOAuthRedirectUri, setBaseUrl, getBaseUrl, getAll, _setKeychainStoreForTests } from '../src/config.js';
```

Then add this new `describe` block at the end of the file:

```js
// ── getAll credentialStore label (read-only, safe to run anywhere) ───────

describe('getAll credentialStore label', () => {
  afterEach(() => {
    _setKeychainStoreForTests(); // restore the real backend
  });

  test('reports macOS Keychain when the backend says it is available', () => {
    _setKeychainStoreForTests({ isAvailable: () => true });
    assert.equal(getAll().credentialStore, 'macOS Keychain');
  });

  test('reports the plaintext file when the backend is unavailable', () => {
    _setKeychainStoreForTests({ isAvailable: () => false });
    assert.equal(getAll().credentialStore, 'file (plaintext)');
  });
});
```

- [ ] **Step 13: Run the full suite**

Run: `npm test`
Expected: PASS — all 17 files green (the 15 pre-existing `scripts/*.test.js` files + the new `keychain.test.js` and `config-credentials.test.js`), including the new tests added to `config.test.js`.

- [ ] **Step 14: Commit**

```bash
git add src/config.js scripts/config-credentials.test.js scripts/config.test.js
git commit -m "feat: store apiKey/OAuth tokens in the macOS Keychain, with plaintext-file fallback"
```

---

## Task 3: Document the new behavior

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add a "Where credentials are stored" subsection**

Modify `README.md`. Find the end of the Authentication section — the block that currently reads:

```markdown
### Targeting a different environment

By default the CLI talks to production (`https://api.kit.com/v4`). To point it at a different environment (e.g. a staging or test instance), override the API base URL:

```
kit config set-base-url https://api.example.com/v4
# or, per-invocation without changing stored config:
export KIT_API_BASE=https://api.example.com/v4
```

OAuth authorize/token endpoints derive from this base, so logging in targets the same environment. OAuth apps and credentials are environment-specific — register an app in that environment's developer settings and use its client ID.

## Commands
```

Insert a new subsection between the "Targeting a different environment" paragraph and the `## Commands` heading:

```markdown
### Where credentials are stored

On macOS, `kit login`'s OAuth tokens and `kit config set-api-key`'s API key
are stored in your login Keychain (service `kit-cli`), not in the config
file — real encryption at rest, not just file permissions. The first access
may show a one-time Keychain permission prompt; choose "Always Allow" to
avoid seeing it again.

Everywhere else, and if the Keychain is ever unavailable (locked, denied,
or a restricted environment), credentials fall back to the config file with
`0600` (owner-only) permissions — the previous behavior, unchanged. A
fallback prints a one-line warning so you know it happened.

Force file storage on any platform, including macOS, with:

```
export KIT_CREDENTIAL_STORE=file
```

Run `kit config show` to see which backend is actually in use — its
`credentialStore` line reports `macOS Keychain` or `file (plaintext)`.

Existing plaintext credentials from before this feature migrate into the
Keychain automatically the next time they're read; nothing to do manually.

## Commands
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: document macOS Keychain credential storage"
```

---

## Task 4: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: PASS — all files green.

- [ ] **Step 2: Confirm the CLI surface is unchanged**

Run: `npm run surface`
Expected: `git diff --stat spec/cli-surface.json` shows no changes — this feature adds no commands or flags.

- [ ] **Step 3: Manual smoke test against a throwaway profile (macOS only)**

This exercises the real `/usr/bin/security` path end-to-end, using a scratch `KIT_CONFIG_DIR` so it can't touch real stored credentials.

```bash
SCRATCH=$(mktemp -d)

KIT_CONFIG_DIR="$SCRATCH" node bin/kit.js config set-api-key sk-smoke-test-12345
KIT_CONFIG_DIR="$SCRATCH" node bin/kit.js config show
```

Expected: `config show` prints a `credentialStore` line reading `macOS Keychain`, and `apiKey` reads `****2345`.

Confirm the value actually landed in the Keychain, not the file:

```bash
grep '"apiKey"' "$SCRATCH"/config.json
```

Expected: prints `"apiKey": "",` — `conf` pretty-prints with a space after the colon, so it's an exact-substring match rather than a tight regex. The empty value confirms the real value is in the Keychain, not the file.

```bash
/usr/bin/security find-generic-password -a "$SCRATCH" -s kit-cli -w
```

Expected: prints `{"apiKey":"sk-smoke-test-12345"}`.

- [ ] **Step 4: Clean up the smoke test's Keychain item and scratch directory**

```bash
/usr/bin/security delete-generic-password -a "$SCRATCH" -s kit-cli
rm -rf "$SCRATCH"
```

Expected: the `delete-generic-password` command prints confirmation; no error.

- [ ] **Step 5: Confirm the migration path, using the same throwaway approach**

```bash
SCRATCH2=$(mktemp -d)
mkdir -p "$SCRATCH2"

# Simulate a pre-existing plaintext credential from before this feature by
# hand-writing a minimal config file. conf fills in every other schema key
# with its default the moment it's read, so this doesn't need to be complete.
cat > "$SCRATCH2/config.json" << 'EOF'
{"apiKey":"sk-legacy-plaintext","baseUrl":"https://api.kit.com/v4"}
EOF

KIT_CONFIG_DIR="$SCRATCH2" node bin/kit.js config show
```

Expected: `apiKey` reads `****text` (masked tail of `sk-legacy-plaintext`) and `credentialStore` reads `macOS Keychain` — confirming the legacy value was picked up and migrated on this first read.

```bash
/usr/bin/security find-generic-password -a "$SCRATCH2" -s kit-cli -w
grep '"apiKey"' "$SCRATCH2/config.json"
```

Expected: the `security` command prints `{"apiKey":"sk-legacy-plaintext"}`; the `grep` prints `"apiKey": "",` — the legacy plaintext field was blanked only after the Keychain write succeeded.

- [ ] **Step 6: Clean up**

```bash
/usr/bin/security delete-generic-password -a "$SCRATCH2" -s kit-cli
rm -rf "$SCRATCH2"
```

No commit for this task — it's verification only. If any step surfaces a bug, fix it in the relevant Task 1/2 file, re-run that task's tests, and commit the fix with a message describing what was wrong.
