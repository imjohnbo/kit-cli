/**
 * Tests for src/error-reporting.js
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setTelemetryEnabled } from '../src/config.js';
import { KitApiError } from '../src/client.js';

const _originalFetch = globalThis.fetch;
let _seq = 0;

async function freshErrorReporting() {
  process.env.KIT_SENTRY_DSN = 'https://testkey@o0.ingest.sentry.io/123';
  _seq += 1;
  return import(`../src/error-reporting.js?t=${Date.now()}-${_seq}`);
}

describe('maybeReportError', () => {
  before(() => {
    delete process.env.KIT_NO_TELEMETRY;
    delete process.env.DO_NOT_TRACK;
    delete process.env.CI;
    setTelemetryEnabled(true);
  });
  after(() => {
    globalThis.fetch = _originalFetch;
    delete process.env.KIT_SENTRY_DSN;
  });

  test('sends an envelope for a plain Error', async () => {
    let captured;
    globalThis.fetch = async (url, opts) => {
      captured = { url: String(url), opts };
      return { ok: true, status: 200, text: async () => '{}' };
    };
    const { maybeReportError } = await freshErrorReporting();
    await maybeReportError(new Error('Something broke'), { command: 'subscribers list' });
    assert.ok(captured.url.includes('/api/123/envelope/'));
    assert.ok(captured.opts.body.includes('Something broke'));
  });

  test('includes the command as a tag, not free text', async () => {
    let captured;
    globalThis.fetch = async (url, opts) => { captured = opts; return { ok: true, status: 200, text: async () => '{}' }; };
    const { maybeReportError } = await freshErrorReporting();
    await maybeReportError(new Error('Boom'), { command: 'tags create' });
    const event = JSON.parse(captured.body.trim().split('\n')[2]);
    assert.equal(event.tags.command, 'tags create');
  });

  test('sends the auth header with the DSN public key', async () => {
    let captured;
    globalThis.fetch = async (url, opts) => { captured = opts; return { ok: true, status: 200, text: async () => '{}' }; };
    const { maybeReportError } = await freshErrorReporting();
    await maybeReportError(new Error('Boom'), { command: 'tags create' });
    assert.match(captured.headers['X-Sentry-Auth'], /sentry_key=testkey/);
  });

  test('skips a KitApiError below 500 (expected user/input errors)', async () => {
    let called = false;
    globalThis.fetch = async () => { called = true; return { ok: true, status: 200, text: async () => '{}' }; };
    const { maybeReportError } = await freshErrorReporting();
    await maybeReportError(new KitApiError(422, ['Email invalid']), { command: 'subscribers create' });
    assert.equal(called, false);
  });

  test('reports a KitApiError at or above 500', async () => {
    let called = false;
    globalThis.fetch = async () => { called = true; return { ok: true, status: 200, text: async () => '{}' }; };
    const { maybeReportError } = await freshErrorReporting();
    await maybeReportError(new KitApiError(503, ['Service unavailable']), { command: 'subscribers create' });
    assert.equal(called, true);
  });

  test('does nothing when no DSN is configured', async () => {
    let called = false;
    delete process.env.KIT_SENTRY_DSN;
    globalThis.fetch = async () => { called = true; return { ok: true, status: 200, text: async () => '{}' }; };
    _seq += 1;
    const { maybeReportError } = await import(`../src/error-reporting.js?t=${Date.now()}-${_seq}`);
    await maybeReportError(new Error('Boom'));
    assert.equal(called, false);
  });

  test('does nothing when telemetry is disabled', async () => {
    let called = false;
    globalThis.fetch = async () => { called = true; return { ok: true, status: 200, text: async () => '{}' }; };
    setTelemetryEnabled(false);
    const { maybeReportError } = await freshErrorReporting();
    await maybeReportError(new Error('Boom'));
    assert.equal(called, false);
    setTelemetryEnabled(true);
  });

  test('never throws, even when the request fails', async () => {
    globalThis.fetch = async () => { throw new Error('network down'); };
    const { maybeReportError } = await freshErrorReporting();
    await assert.doesNotReject(() => maybeReportError(new Error('Boom')));
  });

  test('the envelope is a valid 3-line structure with a trailing newline', async () => {
    let captured;
    globalThis.fetch = async (url, opts) => { captured = opts; return { ok: true, status: 200, text: async () => '{}' }; };
    const { maybeReportError } = await freshErrorReporting();
    await maybeReportError(new Error('Boom'), { command: 'tags create' });

    assert.ok(captured.body.endsWith('\n'));
    const lines = captured.body.split('\n');
    assert.equal(lines.length, 4); // 3 content lines + the empty string after the final \n
    assert.equal(lines[3], '');

    const envelopeHeader = JSON.parse(lines[0]);
    assert.equal(typeof envelopeHeader.event_id, 'string');
    assert.equal(envelopeHeader.event_id.length, 32);
    assert.equal(typeof envelopeHeader.sent_at, 'string');
    assert.equal(envelopeHeader.dsn, 'https://testkey@o0.ingest.sentry.io/123');

    assert.deepEqual(JSON.parse(lines[1]), { type: 'event' });

    const event = JSON.parse(lines[2]);
    assert.equal(event.event_id, envelopeHeader.event_id);
  });

  test("stack frames are ordered oldest-to-youngest, per Sentry's spec (V8 gives youngest-first)", async () => {
    let captured;
    globalThis.fetch = async (url, opts) => { captured = opts; return { ok: true, status: 200, text: async () => '{}' }; };
    const { maybeReportError } = await freshErrorReporting();

    function innermost() { throw new Error('deep failure'); }
    function middle() { innermost(); }
    function outer() { middle(); }
    let thrown;
    try { outer(); } catch (err) { thrown = err; }

    await maybeReportError(thrown, { command: 'tags create' });
    const event = JSON.parse(captured.body.trim().split('\n')[2]);
    const names = event.exception.values[0].stacktrace.frames.map((f) => f.function);
    assert.ok(names.indexOf('outer') < names.indexOf('middle'));
    assert.ok(names.indexOf('middle') < names.indexOf('innermost'));
  });

  test('each frame has a parsed filename/line/column, not the raw stack line', async () => {
    let captured;
    globalThis.fetch = async (url, opts) => { captured = opts; return { ok: true, status: 200, text: async () => '{}' }; };
    const { maybeReportError } = await freshErrorReporting();

    function willThrow() { throw new Error('parsed frame check'); }
    let thrown;
    try { willThrow(); } catch (err) { thrown = err; }

    await maybeReportError(thrown, { command: 'tags create' });
    const event = JSON.parse(captured.body.trim().split('\n')[2]);
    const frame = event.exception.values[0].stacktrace.frames.find((f) => f.function === 'willThrow');
    assert.ok(frame, 'expected a frame for willThrow');
    assert.equal(typeof frame.filename, 'string');
    assert.ok(!frame.filename.startsWith('at '), 'filename should not be the raw stack line');
    assert.equal(typeof frame.lineno, 'number');
    assert.equal(typeof frame.colno, 'number');
  });

  test('a non-Error thrown value still produces a usable report', async () => {
    let captured;
    globalThis.fetch = async (url, opts) => { captured = opts; return { ok: true, status: 200, text: async () => '{}' }; };
    const { maybeReportError } = await freshErrorReporting();
    await maybeReportError('a plain string was thrown', { command: 'tags create' });
    const event = JSON.parse(captured.body.trim().split('\n')[2]);
    assert.equal(event.exception.values[0].value, 'a plain string was thrown');
  });
});
