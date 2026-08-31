/**
 * Tests for src/commands/doctor.js
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { doctorCommand, runChecks } from '../src/commands/doctor.js';
import { runCommand } from './helpers.js';
import config, { setApiKey } from '../src/config.js';

const _originalFetch = globalThis.fetch;

describe('runChecks', () => {
  let savedApiKey;
  before(() => {
    savedApiKey = config.get('apiKey');
    config.set('apiKey', '');
    delete process.env.KIT_API_KEY;
  });
  after(() => {
    config.set('apiKey', savedApiKey);
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

  test('reports a failed reachability check without throwing', async () => {
    setApiKey('test-key');
    globalThis.fetch = async () => { throw new Error('network down'); };
    const results = await runChecks();
    const reach = results.find((r) => r.label === 'API reachability');
    assert.equal(reach.ok, false);
    assert.match(reach.detail, /network down/);
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

  test('always reports update-check and telemetry status as informational, not failing', async () => {
    const results = await runChecks();
    assert.equal(results.find((r) => r.label === 'Update check').ok, true);
    assert.equal(results.find((r) => r.label === 'Telemetry').ok, true);
  });
});

describe('kit doctor', () => {
  let savedExitCode;
  before(() => { savedExitCode = process.exitCode; });
  after(() => { process.exitCode = savedExitCode; globalThis.fetch = _originalFetch; });

  test('prints one line per check', async () => {
    const res = await runCommand(doctorCommand, [], { responses: { account: { id: 1 } } });
    assert.ok(res.logs.length >= 5);
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
