/**
 * Tests for src/commands/doctor.js
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { statSync, chmodSync } from 'node:fs';
import { doctorCommand, runChecks } from '../src/commands/doctor.js';
import { runCommand, oauthSnapshot, clearOAuth, restoreOAuth } from './helpers.js';
import config, { setApiKey, setTokens } from '../src/config.js';

const _originalFetch = globalThis.fetch;

describe('runChecks', () => {
  let savedApiKey, oauthSnap;
  before(() => {
    savedApiKey = config.get('apiKey');
    config.set('apiKey', '');
    delete process.env.KIT_API_KEY;
    // Every test below deals in OAuth/API-key state directly, so snapshot
    // and restore around the whole block the same way client.test.js and
    // auth.test.js do for exactly this reason — a stray real access token
    // reaching these tests (outside the isolated KIT_CONFIG_DIR npm test
    // provides) would otherwise be the credential doctor actually tests.
    oauthSnap = oauthSnapshot();
    clearOAuth();
  });
  after(() => {
    config.set('apiKey', savedApiKey);
    restoreOAuth(oauthSnap);
    globalThis.fetch = _originalFetch;
  });

  test('reports the running Node.js version as ok (test suite requires 18+)', async () => {
    const results = await runChecks();
    const node = results.find((r) => r.label === 'Node.js version');
    assert.equal(node.ok, true);
  });

  test('flags missing authentication', async () => {
    const results = await runChecks();
    const auth = results.find((r) => r.label === 'Authentication');
    assert.equal(auth.ok, false);
  });

  test('reports a valid, unexpired OAuth token as ok', async () => {
    setTokens('access-tok', 'refresh-tok', Math.floor(Date.now() / 1000), 3600);
    const results = await runChecks();
    const auth = results.find((r) => r.label === 'Authentication');
    assert.equal(auth.ok, true);
    assert.match(auth.detail, /not expired/);
    clearOAuth();
  });

  test('reports an expired OAuth token with a refresh token as ok, not a failure', async () => {
    setTokens('access-tok', 'refresh-tok', 0, 1); // expires practically immediately
    const results = await runChecks();
    const auth = results.find((r) => r.label === 'Authentication');
    assert.equal(auth.ok, true);
    assert.match(auth.detail, /refresh automatically/);
    clearOAuth();
  });

  test('reports an expired OAuth token with no refresh token as a real failure', async () => {
    setTokens('access-tok', '', 0, 1);
    const results = await runChecks();
    const auth = results.find((r) => r.label === 'Authentication');
    assert.equal(auth.ok, false);
    assert.match(auth.detail, /no refresh token is stored/);
    clearOAuth();
  });

  test('skips reachability, rather than exiting the process, when no credentials exist', async () => {
    const results = await runChecks();
    const reach = results.find((r) => r.label === 'API reachability');
    assert.equal(reach.ok, false);
    assert.match(reach.detail, /Skipped/);
  });

  test('checks reachability when an API key is present and the server responds', async () => {
    setApiKey('test-key');
    globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ account: { id: 1 } }) });
    const results = await runChecks();
    const reach = results.find((r) => r.label === 'API reachability');
    assert.equal(reach.ok, true);
    config.set('apiKey', '');
  });

  test('an OAuth token takes precedence over an API key, even when both are configured', async () => {
    // Mirrors client.js's getAuthHeader(): an access token always wins, the
    // API key is a fallback only used when no OAuth token exists at all.
    setApiKey('test-key');
    setTokens('access-tok', 'refresh-tok', Math.floor(Date.now() / 1000), 3600);
    let capturedHeaders;
    globalThis.fetch = async (url, opts) => {
      capturedHeaders = opts.headers;
      return { ok: true, status: 200, json: async () => ({ account: { id: 1 } }) };
    };
    await runChecks();
    assert.equal(capturedHeaders.Authorization, 'Bearer access-tok');
    assert.ok(!('X-Kit-Api-Key' in capturedHeaders));
    config.set('apiKey', '');
    clearOAuth();
  });

  test('skips the network call (does not fall back to the API key) when the token is expired but refreshable', async () => {
    setApiKey('test-key');
    setTokens('access-tok', 'refresh-tok', 0, 1);
    let called = false;
    globalThis.fetch = async () => { called = true; return { ok: true, status: 200, json: async () => ({}) }; };
    const results = await runChecks();
    assert.equal(called, false);
    const reach = results.find((r) => r.label === 'API reachability');
    assert.equal(reach.ok, true);
    assert.match(reach.detail, /refresh automatically/);
    config.set('apiKey', '');
    clearOAuth();
  });

  test('reports a failed reachability check without throwing', async () => {
    setApiKey('test-key');
    globalThis.fetch = async () => { throw new Error('network down'); };
    const results = await runChecks();
    const reach = results.find((r) => r.label === 'API reachability');
    assert.equal(reach.ok, false);
    assert.match(reach.detail, /network down/);
    config.set('apiKey', '');
  });

  test('prefers the underlying cause message over the generic "fetch failed" wrapper', async () => {
    setApiKey('test-key');
    globalThis.fetch = async () => {
      const err = new Error('fetch failed');
      err.cause = new Error('getaddrinfo ENOTFOUND api.kit.com');
      throw err;
    };
    const results = await runChecks();
    const reach = results.find((r) => r.label === 'API reachability');
    assert.match(reach.detail, /ENOTFOUND/);
    config.set('apiKey', '');
  });

  test('reports a non-2xx reachability response as a failure', async () => {
    setApiKey('test-key');
    globalThis.fetch = async () => ({ ok: false, status: 500, json: async () => ({}) });
    const results = await runChecks();
    const reach = results.find((r) => r.label === 'API reachability');
    assert.equal(reach.ok, false);
    assert.match(reach.detail, /500/);
    config.set('apiKey', '');
  });

  test('always reports update-check and telemetry status as informational, not failing, with a real detail', async () => {
    const results = await runChecks();
    const update = results.find((r) => r.label === 'Update check');
    const telemetry = results.find((r) => r.label === 'Telemetry');
    assert.equal(update.ok, true);
    assert.equal(typeof update.detail, 'string');
    assert.ok(update.detail.length > 0);
    assert.equal(telemetry.ok, true);
    assert.match(telemetry.detail, /^(Enabled|Disabled)\.$/);
  });

  test('reports the effective (allowed) state, not just the stored preference', async () => {
    process.env.KIT_NO_UPDATE_CHECK = '1';
    process.env.KIT_NO_TELEMETRY = '1';
    const results = await runChecks();
    assert.match(results.find((r) => r.label === 'Update check').detail, /disabled/);
    assert.equal(results.find((r) => r.label === 'Telemetry').detail, 'Disabled.');
    delete process.env.KIT_NO_UPDATE_CHECK;
    delete process.env.KIT_NO_TELEMETRY;
  });
});

describe('checkConfigPermissions', () => {
  test('flags a config file that is not 0600', async () => {
    if (process.platform === 'win32') return;
    const originalMode = statSync(config.path).mode & 0o777;
    chmodSync(config.path, 0o644);
    const results = await runChecks();
    const perms = results.find((r) => r.label === 'Config file permissions');
    assert.equal(perms.ok, false);
    assert.match(perms.detail, /0644/);
    assert.match(perms.detail, /chmod 600/);
    chmodSync(config.path, originalMode);
  });
});

describe('kit doctor', () => {
  let savedExitCode;
  before(() => { savedExitCode = process.exitCode; });
  after(() => { process.exitCode = savedExitCode; globalThis.fetch = _originalFetch; });

  test('prints one line per check', async () => {
    const res = await runCommand(doctorCommand, [], { responses: { account: { id: 1 } } });
    assert.equal(res.logs.length, 6);
  });

  test('never prints the configured API key', async () => {
    const res = await runCommand(doctorCommand, [], { responses: { account: { id: 1 } } });
    assert.ok(!res.out.includes('test-api-key')); // the fake key runCommand configures
  });

  test('sets a non-zero exit code when a check fails, without throwing', async () => {
    process.exitCode = undefined;
    const res = await runCommand(doctorCommand, [], { responses: { __status: 500 } });
    assert.equal(res.exitCode, undefined); // no process.exit() call — see doctor.js's comment on why
    assert.equal(process.exitCode, 1);
  });

  test('leaves the exit code untouched when every check passes', async () => {
    process.exitCode = undefined;
    await runCommand(doctorCommand, [], { responses: { account: { id: 1 } } });
    assert.notEqual(process.exitCode, 1);
  });
});
