/**
 * Tests for the cached-account-ID wiring in src/config.js: setApiKey() and
 * clearTokens() both clear it, and neither leaves the config file world-
 * readable in the process.
 *
 * scripts/config.test.js states a "no writing tests" policy for itself, so
 * these live in their own file instead of there. Like every config-writing
 * test in this suite (scripts/auth.test.js, scripts/upgrade.test.js), they
 * rely on the per-file KIT_CONFIG_DIR isolation that scripts/run-tests.js
 * and scripts/run-single-test.js (npm test / npm run test:file --) provide
 * — always use one of those two entry points, never a bare `node --test`,
 * for any file that writes to config.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { statSync } from 'node:fs';
import config, { setApiKey, setBaseUrl, clearTokens, setCachedAccountId, getCachedAccountId } from '../src/config.js';

describe('account ID cache clearing', () => {
  let snap;

  before(() => {
    snap = {
      apiKey: config.get('apiKey'),
      accessToken: config.get('accessToken'),
      refreshToken: config.get('refreshToken'),
      tokenExpiresAt: config.get('tokenExpiresAt'),
      accountId: config.get('accountId'),
    };
  });

  after(() => {
    config.set('apiKey', snap.apiKey);
    config.set('accessToken', snap.accessToken);
    config.set('refreshToken', snap.refreshToken);
    config.set('tokenExpiresAt', snap.tokenExpiresAt);
    config.set('accountId', snap.accountId);
  });

  test('setApiKey clears a cached account ID', () => {
    setCachedAccountId('acct_1');
    setApiKey('a-new-key');
    assert.equal(getCachedAccountId(), '');
  });

  test('clearTokens clears a cached account ID', () => {
    setCachedAccountId('acct_2');
    clearTokens();
    assert.equal(getCachedAccountId(), '');
  });

  test('setApiKey leaves the config file at 0600, not the looser mode Conf defaults to', () => {
    setApiKey('another-new-key');
    if (process.platform === 'win32') return; // POSIX file modes don't apply
    const mode = statSync(config.path).mode & 0o777;
    assert.equal(mode.toString(8), '600');
  });

  test('clearTokens leaves the config file at 0600', () => {
    clearTokens();
    if (process.platform === 'win32') return;
    const mode = statSync(config.path).mode & 0o777;
    assert.equal(mode.toString(8), '600');
  });

  test('setCachedAccountId treats null and undefined as empty, not the literal strings', () => {
    setCachedAccountId(null);
    assert.equal(getCachedAccountId(), '');
    setCachedAccountId(undefined);
    assert.equal(getCachedAccountId(), '');
  });

  test('setBaseUrl clears a cached account ID', () => {
    const savedBaseUrl = config.get('baseUrl');
    setCachedAccountId('acct_3');
    setBaseUrl('https://api.example.com/v4');
    assert.equal(getCachedAccountId(), '');
    config.set('baseUrl', savedBaseUrl);
  });
});
