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
