/**
 * Tests for src/commands/init.js
 *
 * runInit() takes injectable input/output streams and a login function
 * specifically so this file can script a full session without a real
 * terminal or a real browser: a PassThrough for input, pre-loaded with the
 * answers a user would type (one write per prompt), a PassThrough for
 * output whose bytes are captured for assertions, and a fake login function
 * so the OAuth path never opens a browser or waits on a local callback
 * server.
 *
 * Masked input (the API key prompt) is exercised here too, but note: these
 * PassThrough streams are not TTYs, and readline only does the
 * keystroke-level echo that promptMasked() suppresses when its output
 * stream is a real terminal. So this suite proves the masking code doesn't
 * corrupt the captured value and doesn't write the key to output in
 * non-terminal mode — it can't prove the on-screen behavior in a real
 * terminal. Verify that by hand: run `kit init`, choose the API key path,
 * and confirm the key doesn't appear as you type it.
 *
 * scriptedSession() paces its writes (one per event-loop tick, via
 * setImmediate) rather than writing every answer synchronously and ending
 * the stream immediately. readline/promises' question() attaches its 'line'
 * listener only once awaited; writing every line up front — with the
 * PassThrough already flowing — lets readline emit every buffered line as
 * 'line' events before the second question() call ever attaches its
 * listener, so later lines are silently dropped, and ending the stream
 * immediately after closes the interface before those question() calls can
 * even run (ERR_USE_AFTER_CLOSE). Pacing the writes gives runInit's own
 * await between prompts a chance to attach the next listener first — the
 * same way a human typing answers one at a time naturally would.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { runInit } from '../src/commands/init.js';
import config, { getApiKey, getOAuthClientId, getOAuthRedirectUri } from '../src/config.js';

const _originalFetch = globalThis.fetch;

function scriptedSession(answers) {
  const input = new PassThrough();
  const output = new PassThrough();
  let outText = '';
  output.on('data', (chunk) => { outText += chunk.toString(); });
  (async () => {
    for (const line of answers) {
      await new Promise((resolve) => setImmediate(resolve));
      input.write(`${line}\n`);
    }
    await new Promise((resolve) => setImmediate(resolve));
    input.end();
  })();
  return { input, output, getOutput: () => outText };
}

describe('runInit — API key path', () => {
  let savedApiKey;
  before(() => {
    savedApiKey = config.get('apiKey');
    globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ account: { id: 1 } }) });
  });
  after(() => {
    config.set('apiKey', savedApiKey);
    globalThis.fetch = _originalFetch;
  });

  test('saves the entered API key', async () => {
    const { input, output } = scriptedSession(['2', 'test-api-key-123']);
    await runInit({ input, output });
    assert.equal(getApiKey(), 'test-api-key-123');
  });

  test('does not write the key to output', async () => {
    const { input, output, getOutput } = scriptedSession(['2', 'super-secret-key']);
    await runInit({ input, output });
    assert.ok(!getOutput().includes('super-secret-key'));
  });

  test('runs the doctor checks at the end', async () => {
    const { input, output, getOutput } = scriptedSession(['2', 'test-api-key-123']);
    await runInit({ input, output });
    assert.match(getOutput(), /Authentication/);
    assert.match(getOutput(), /API reachability/);
  });

  test('rejects an empty API key', async () => {
    const { input, output } = scriptedSession(['2', '']);
    await assert.rejects(() => runInit({ input, output }), /API key is required/);
  });
});

describe('runInit — OAuth path', () => {
  let savedClientId, savedRedirectUri;
  before(() => {
    savedClientId = config.get('oauthClientId');
    savedRedirectUri = config.get('oauthRedirectUri');
  });
  after(() => {
    config.set('oauthClientId', savedClientId);
    config.set('oauthRedirectUri', savedRedirectUri);
  });

  test('saves the client ID and redirect URI, then calls the login function', async () => {
    config.set('oauthRedirectUri', '');
    let loginCalledWith;
    const loginFn = async (clientId) => { loginCalledWith = clientId; };
    const { input, output } = scriptedSession(['1', 'test-client-id', 'https://example.com/callback']);
    await runInit({ input, output, loginFn });
    assert.equal(loginCalledWith, 'test-client-id');
    assert.equal(getOAuthClientId(), 'test-client-id');
    assert.equal(getOAuthRedirectUri(), 'https://example.com/callback');
  });

  test('skips the redirect URI prompt when one is already configured', async () => {
    config.set('oauthRedirectUri', 'https://existing.example.com/callback');
    let loginCalled = false;
    const loginFn = async () => { loginCalled = true; };
    const { input, output } = scriptedSession(['1', 'test-client-id']);
    await runInit({ input, output, loginFn });
    assert.ok(loginCalled);
    assert.equal(getOAuthRedirectUri(), 'https://existing.example.com/callback');
  });

  test('surfaces a login failure as a thrown error', async () => {
    config.set('oauthRedirectUri', 'https://existing.example.com/callback');
    const loginFn = async () => { throw new Error('Authorization failed: access_denied'); };
    const { input, output } = scriptedSession(['1', 'test-client-id']);
    await assert.rejects(() => runInit({ input, output, loginFn }), /Authorization failed/);
  });

  test('rejects an invalid menu choice', async () => {
    const { input, output } = scriptedSession(['9']);
    await assert.rejects(() => runInit({ input, output }), /Invalid choice/);
  });

  test('rejects a non-numeric menu choice', async () => {
    const { input, output } = scriptedSession(['banana']);
    await assert.rejects(() => runInit({ input, output }), /Invalid choice/);
  });
});
