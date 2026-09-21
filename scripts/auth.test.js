/**
 * Tests for src/auth.js
 *
 * login() itself opens a real browser, so it stays out of scope. The pieces
 * under it are covered on their own: token refresh, the browser-launch
 * command, and the local OAuth callback server.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { refreshAccessToken, browserCommand, openBrowser, waitForCallback } from '../src/auth.js';
import config, { setOAuthClientId } from '../src/config.js';
import { oauthSnapshot, restoreOAuth, capture } from './helpers.js';

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

// ── browser launch ─────────────────────────────────────────────────────────

describe('browserCommand', () => {
  const url = 'https://app.kit.com/oauth/authorize?client_id=abc&state=xyz&redirect_uri=https%3A%2F%2Fx';

  test('uses open on macOS', () => {
    assert.deepEqual(browserCommand(url, 'darwin'), { file: 'open', args: [url] });
  });

  test('uses xdg-open on Linux', () => {
    assert.deepEqual(browserCommand(url, 'linux'), { file: 'xdg-open', args: [url] });
  });

  test('on Windows, launches through rundll32 rather than the cmd.exe builtin start', () => {
    // `start` is a cmd.exe builtin, not a program, so execFile('start') fails
    // with ENOENT. rundll32 is a real executable and takes the URL as a plain
    // argument, so the & and % in the query string need no shell escaping.
    assert.deepEqual(browserCommand(url, 'win32'), {
      file: 'rundll32',
      args: ['url.dll,FileProtocolHandler', url],
    });
  });
});

describe('openBrowser', () => {
  test('prints the URL on stderr when the browser cannot be launched', () => {
    const url = 'https://app.kit.com/oauth/authorize?client_id=abc';
    const cap = capture();
    try {
      openBrowser(url, {
        platform: 'win32',
        run: (_file, _args, cb) => cb(Object.assign(new Error('spawn rundll32 ENOENT'), { code: 'ENOENT' })),
      });
    } finally {
      cap.restore();
    }
    assert.match(cap.err(), /open this URL/i);
    assert.ok(cap.err().includes(url), 'the URL itself is printed so the user can paste it');
  });

  test('stays quiet when the launch succeeds', () => {
    const cap = capture();
    try {
      openBrowser('https://example.com', { platform: 'darwin', run: (_f, _a, cb) => cb(null) });
    } finally {
      cap.restore();
    }
    assert.equal(cap.err(), '');
  });
});

// ── OAuth callback server ──────────────────────────────────────────────────

describe('waitForCallback', () => {
  const STATE = 'expected-state';

  /** Starts the callback server on a free port. `address` resolves once it listens. */
  function start(expectedState = STATE, opts = {}) {
    let onListening;
    const address = new Promise((resolve) => (onListening = resolve));
    const code = waitForCallback(expectedState, { port: 0, timeoutMs: 5000, onListening, ...opts });
    // A rejection can land while the test is still awaiting the HTTP round
    // trip, before it reaches assert.rejects(). Mark it handled so node:test
    // does not fail the test on an unhandled rejection.
    code.catch(() => {});
    return { code, address };
  }

  /** GETs /callback?<query> over a fresh connection and resolves the status code. */
  function hit(addr, query) {
    return new Promise((resolve, reject) => {
      const req = httpRequest(
        { host: '127.0.0.1', port: addr.port, path: `/callback?${query}`, agent: false },
        (res) => {
          res.resume();
          res.on('end', () => resolve(res.statusCode));
        }
      );
      req.on('error', reject);
      req.end();
    });
  }

  test('listens on the IPv4 loopback address only', async () => {
    const { code, address } = start();
    const addr = await address;
    assert.equal(addr.address, '127.0.0.1');
    await hit(addr, `code=abc&state=${STATE}`);
    await code;
  });

  test('resolves with the code when the state matches', async () => {
    const { code, address } = start();
    assert.equal(await hit(await address, `code=abc&state=${STATE}`), 200);
    assert.equal(await code, 'abc');
  });

  test('rejects a callback whose state does not match', async () => {
    const { code, address } = start();
    assert.equal(await hit(await address, 'code=abc&state=forged'), 400);
    await assert.rejects(code, /state/i);
  });

  test('rejects a callback that carries a code but no state', async () => {
    const { code, address } = start();
    assert.equal(await hit(await address, 'code=abc'), 400);
    await assert.rejects(code, /state/i);
  });

  test('reports the provider error when the callback carries one', async () => {
    const { code, address } = start();
    assert.equal(await hit(await address, 'error=access_denied'), 400);
    await assert.rejects(code, /access_denied/);
  });

  test('times out when no callback arrives', async () => {
    const { code, address } = start(STATE, { timeoutMs: 50 });
    await address;
    await assert.rejects(code, /timed out/);
  });

  test('clears its timeout after a successful callback so the process can exit', async () => {
    const timeouts = () => process.getActiveResourcesInfo().filter((r) => r === 'Timeout').length;
    const before = timeouts();
    const { code, address } = start();
    assert.equal(timeouts(), before + 1, 'the login timer is armed while waiting');
    await hit(await address, `code=abc&state=${STATE}`);
    await code;
    assert.equal(timeouts(), before, 'the login timer is gone once the callback lands');
  });
});
