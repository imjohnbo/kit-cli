/**
 * Tests for src/auth.js
 *
 * Only refreshAccessToken is covered here — login() opens a real browser and
 * a local callback server, which is out of scope for a unit test.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { refreshAccessToken } from '../src/auth.js';
import config, { setOAuthClientId } from '../src/config.js';
import { oauthSnapshot, restoreOAuth } from './helpers.js';

const _originalFetch = globalThis.fetch;

describe('refreshAccessToken', () => {
  let snap, savedClientId;

  before(() => {
    savedClientId = config.get('oauthClientId');
    snap = oauthSnapshot();
    setOAuthClientId('test-client-id');
    config.set('refreshToken', 'test-refresh-token');
  });

  after(() => {
    config.set('oauthClientId', savedClientId);
    restoreOAuth(snap);
    globalThis.fetch = _originalFetch;
  });

  test('sends a descriptive User-Agent header', async () => {
    let captured;
    globalThis.fetch = async (url, opts) => {
      captured = opts;
      return {
        ok: true,
        json: async () => ({
          access_token: 'new-token',
          refresh_token: 'new-refresh',
          created_at: 1000,
          expires_in: 3600,
        }),
      };
    };
    await refreshAccessToken();
    assert.match(captured.headers['User-Agent'], /^kit-cli\//);
  });

  test('still sends Content-Type and Accept headers', async () => {
    let captured;
    globalThis.fetch = async (url, opts) => {
      captured = opts;
      return { ok: true, json: async () => ({ access_token: 'a', refresh_token: 'b', created_at: 1000, expires_in: 3600 }) };
    };
    await refreshAccessToken();
    assert.equal(captured.headers['Content-Type'], 'application/json');
    assert.equal(captured.headers['Accept'], 'application/json');
  });
});

describe('loginCommand error handling', () => {
  test('routes a missing-client-ID error through withErrorHandler, not a direct process.exit', async () => {
    const { loginCommand } = await import('../src/commands/auth.js');
    const { runCommand } = await import('./helpers.js');
    delete process.env.KIT_CLIENT_ID;
    const res = await runCommand(loginCommand, []);
    assert.equal(res.exitCode, 1);
    // The "Error: " prefix only appears via printError()'s generic-Error
    // formatting, which only runs when withErrorHandler is in the call path.
    assert.match(res.err, /^Error: Client ID required/);
  });
});
