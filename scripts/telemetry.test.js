/**
 * Tests for src/telemetry.js
 *
 * The Segment SDK runs for real here rather than being mocked away — its
 * outgoing HTTP call is what's mocked, the same fetch-mocking convention
 * used everywhere else in this suite (confirmed empirically: the SDK POSTs
 * to https://api.segment.io/v1/batch with a `{ batch: [...] }` body). Each
 * test imports src/telemetry.js fresh, via a cache-busting query string,
 * after setting KIT_SEGMENT_WRITE_KEY — the write key is read once at
 * module-load time in telemetry-keys.js.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setTelemetryEnabled, setCachedAccountId } from '../src/config.js';

const _originalFetch = globalThis.fetch;
let _seq = 0;

async function freshTelemetry() {
  process.env.KIT_SEGMENT_WRITE_KEY = 'test-write-key';
  _seq += 1;
  return import(`../src/telemetry.js?t=${Date.now()}-${_seq}`);
}

function mockSegmentFetch() {
  let captured;
  globalThis.fetch = async (url, opts) => {
    captured = JSON.parse(opts.body);
    return { ok: true, status: 200, statusText: 'OK', text: async () => '{}', json: async () => ({}) };
  };
  return () => captured;
}

describe('telemetryAllowed', () => {
  let savedEnv;
  before(() => { savedEnv = { ...process.env }; });
  after(() => {
    for (const k of Object.keys(process.env)) if (!(k in savedEnv)) delete process.env[k];
    Object.assign(process.env, savedEnv);
    setTelemetryEnabled(true);
  });

  test('true by default', async () => {
    delete process.env.KIT_NO_TELEMETRY;
    delete process.env.DO_NOT_TRACK;
    delete process.env.CI;
    setTelemetryEnabled(true);
    const { telemetryAllowed } = await freshTelemetry();
    assert.equal(telemetryAllowed(), true);
  });

  test('false when KIT_NO_TELEMETRY is set to a truthy value', async () => {
    process.env.KIT_NO_TELEMETRY = '1';
    const { telemetryAllowed } = await freshTelemetry();
    assert.equal(telemetryAllowed(), false);
    delete process.env.KIT_NO_TELEMETRY;
  });

  test('true when KIT_NO_TELEMETRY=0', async () => {
    process.env.KIT_NO_TELEMETRY = '0';
    const { telemetryAllowed } = await freshTelemetry();
    assert.equal(telemetryAllowed(), true);
    delete process.env.KIT_NO_TELEMETRY;
  });

  test('false when DO_NOT_TRACK=1', async () => {
    process.env.DO_NOT_TRACK = '1';
    const { telemetryAllowed } = await freshTelemetry();
    assert.equal(telemetryAllowed(), false);
    delete process.env.DO_NOT_TRACK;
  });

  test('false when CI is set to a truthy value', async () => {
    process.env.CI = 'true';
    const { telemetryAllowed } = await freshTelemetry();
    assert.equal(telemetryAllowed(), false);
    delete process.env.CI;
  });

  test('false when the telemetry config key is off', async () => {
    setTelemetryEnabled(false);
    const { telemetryAllowed } = await freshTelemetry();
    assert.equal(telemetryAllowed(), false);
    setTelemetryEnabled(true);
  });
});

describe('trackCommand', () => {
  before(() => {
    delete process.env.KIT_NO_TELEMETRY;
    delete process.env.DO_NOT_TRACK;
    delete process.env.CI;
    delete process.env.KIT_API_KEY;
    setTelemetryEnabled(true);
    setCachedAccountId('');
  });
  after(() => { globalThis.fetch = _originalFetch; });

  test('sends the mapped event name for a known command', async () => {
    const getCaptured = mockSegmentFetch();
    const { trackCommand, flushTelemetry } = await freshTelemetry();
    trackCommand({ command: 'subscribers list', status: 'success', durationMs: 42 });
    await flushTelemetry({ timeout: 2000 });
    assert.equal(getCaptured().batch[0].event, 'Subscribers Listed');
  });

  test('never includes argv or output in properties', async () => {
    const getCaptured = mockSegmentFetch();
    const { trackCommand, flushTelemetry } = await freshTelemetry();
    trackCommand({ command: 'subscribers create', status: 'success', durationMs: 10 });
    await flushTelemetry({ timeout: 2000 });
    const props = getCaptured().batch[0].properties;
    assert.ok(!('argv' in props));
    assert.ok(!('output' in props));
    assert.ok(!('email' in props));
  });

  test('includes status, duration, and version/platform properties', async () => {
    const getCaptured = mockSegmentFetch();
    const { trackCommand, flushTelemetry } = await freshTelemetry();
    trackCommand({ command: 'tags create', status: 'failure', durationMs: 7, statusCode: 422 });
    await flushTelemetry({ timeout: 2000 });
    const props = getCaptured().batch[0].properties;
    assert.equal(props.command, 'tags create');
    assert.equal(props.source, 'cli');
    assert.equal(props.status, 'failure');
    assert.equal(props.duration_ms, 7);
    assert.equal(props.status_code, 422);
    assert.equal(typeof props.cli_version, 'string');
    assert.equal(typeof props.os, 'string');
    assert.equal(typeof props.node_version, 'string');
  });

  test('falls back to a generic event name for an unmapped command', async () => {
    const getCaptured = mockSegmentFetch();
    const { trackCommand, flushTelemetry } = await freshTelemetry();
    trackCommand({ command: 'not-a-real-command', status: 'success', durationMs: 1 });
    await flushTelemetry({ timeout: 2000 });
    assert.equal(getCaptured().batch[0].event, 'Unknown Command Run');
  });

  test('includes the cached account_id when one is already known', async () => {
    setCachedAccountId('acct_42');
    const getCaptured = mockSegmentFetch();
    const { trackCommand, flushTelemetry } = await freshTelemetry();
    trackCommand({ command: 'account', status: 'success', durationMs: 1 });
    await flushTelemetry({ timeout: 2000 });
    assert.equal(getCaptured().batch[0].properties.account_id, 'acct_42');
    setCachedAccountId('');
  });

  test('omits account_id when none is cached and no credentials exist', async () => {
    setCachedAccountId('');
    delete process.env.KIT_API_KEY;
    const getCaptured = mockSegmentFetch();
    const { trackCommand, flushTelemetry } = await freshTelemetry();
    trackCommand({ command: 'account', status: 'success', durationMs: 1 });
    await flushTelemetry({ timeout: 2000 });
    assert.ok(!('account_id' in getCaptured().batch[0].properties));
  });

  test('sends nothing when telemetry is disabled', async () => {
    let called = false;
    globalThis.fetch = async () => { called = true; return { ok: true, status: 200, json: async () => ({}) }; };
    setTelemetryEnabled(false);
    const { trackCommand, flushTelemetry } = await freshTelemetry();
    trackCommand({ command: 'account', status: 'success', durationMs: 1 });
    await flushTelemetry({ timeout: 300 });
    assert.equal(called, false);
    setTelemetryEnabled(true);
  });

  test('sends nothing when no write key is configured', async () => {
    let called = false;
    delete process.env.KIT_SEGMENT_WRITE_KEY;
    globalThis.fetch = async () => { called = true; return { ok: true, status: 200, json: async () => ({}) }; };
    _seq += 1;
    const { trackCommand, flushTelemetry } = await import(`../src/telemetry.js?t=${Date.now()}-${_seq}`);
    trackCommand({ command: 'account', status: 'success', durationMs: 1 });
    await flushTelemetry({ timeout: 300 });
    assert.equal(called, false);
  });
});
