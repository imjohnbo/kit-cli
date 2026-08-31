/**
 * Tests for the cached-account-ID wiring in src/config.js: setApiKey() and
 * clearTokens() both clear it, and neither leaves the config file world-
 * readable in the process.
 *
 * scripts/config.test.js deliberately contains no writing tests, so a bare
 * `node --test` against it can never touch a developer's real config. These
 * tests do write, which is why they live in a separate file: they rely on
 * the per-file KIT_CONFIG_DIR isolation that scripts/run-tests.js and
 * scripts/run-single-test.js (npm test / npm run test:file --) both provide
 * — the same safety net scripts/auth.test.js and scripts/upgrade.test.js
 * already depend on for their own config-writing tests.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { statSync } from 'node:fs';
import config, { setApiKey, clearTokens, setCachedAccountId, getCachedAccountId } from '../src/config.js';

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
});
