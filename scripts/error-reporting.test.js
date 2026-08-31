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
});
