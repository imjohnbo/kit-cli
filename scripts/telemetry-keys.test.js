/**
 * Tests for src/telemetry-keys.js
 *
 * SEGMENT_WRITE_KEY and SENTRY_DSN are read once, at module-load time, so
 * each test imports the module fresh (a cache-busting query string forces
 * Node's ESM loader to re-evaluate it) after setting the env var it cares
 * about.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

describe('telemetry keys', () => {
  let savedSegment, savedSentry;

  before(() => {
    savedSegment = process.env.KIT_SEGMENT_WRITE_KEY;
    savedSentry = process.env.KIT_SENTRY_DSN;
  });

  after(() => {
    if (savedSegment !== undefined) process.env.KIT_SEGMENT_WRITE_KEY = savedSegment;
    else delete process.env.KIT_SEGMENT_WRITE_KEY;
    if (savedSentry !== undefined) process.env.KIT_SENTRY_DSN = savedSentry;
    else delete process.env.KIT_SENTRY_DSN;
  });

  test('SEGMENT_WRITE_KEY defaults to an empty string', async () => {
    delete process.env.KIT_SEGMENT_WRITE_KEY;
    const mod = await import(`../src/telemetry-keys.js?t=${Date.now()}-a`);
    assert.equal(mod.SEGMENT_WRITE_KEY, '');
  });

  test('KIT_SEGMENT_WRITE_KEY overrides the default', async () => {
    process.env.KIT_SEGMENT_WRITE_KEY = 'test-write-key';
    const mod = await import(`../src/telemetry-keys.js?t=${Date.now()}-b`);
    assert.equal(mod.SEGMENT_WRITE_KEY, 'test-write-key');
  });

  test('SENTRY_DSN defaults to an empty string', async () => {
    delete process.env.KIT_SENTRY_DSN;
    const mod = await import(`../src/telemetry-keys.js?t=${Date.now()}-c`);
    assert.equal(mod.SENTRY_DSN, '');
  });

  test('KIT_SENTRY_DSN overrides the default', async () => {
    process.env.KIT_SENTRY_DSN = 'https://key@o0.ingest.sentry.io/1';
    const mod = await import(`../src/telemetry-keys.js?t=${Date.now()}-d`);
    assert.equal(mod.SENTRY_DSN, 'https://key@o0.ingest.sentry.io/1');
  });
});
