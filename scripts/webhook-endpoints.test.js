/**
 * Tests for src/commands/webhook-endpoints.js
 *
 * Only the pure helpers (event parsing + validation) are tested here — they
 * require no network or config, matching the conventions of the other suites.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { EVENT_TYPES, parseEvents, invalidEvents } from '../src/commands/webhook-endpoints.js';

describe('EVENT_TYPES', () => {
  test('includes the Webhooks 2.0 subscriber.created event', () => {
    assert.ok(EVENT_TYPES.includes('subscriber.created'));
  });

  test('uses the new naming scheme (subscriber.tag_added, not subscriber.tag_add)', () => {
    assert.ok(EVENT_TYPES.includes('subscriber.tag_added'));
    assert.ok(!EVENT_TYPES.includes('subscriber.tag_add'));
  });

  test('has no duplicates', () => {
    assert.equal(EVENT_TYPES.length, new Set(EVENT_TYPES).size);
  });
});

describe('parseEvents', () => {
  test('splits a comma-separated string', () => {
    assert.deepEqual(parseEvents('subscriber.created,tag.created'), [
      'subscriber.created',
      'tag.created',
    ]);
  });

  test('trims whitespace and drops empty segments', () => {
    assert.deepEqual(parseEvents(' subscriber.created , , tag.created ,'), [
      'subscriber.created',
      'tag.created',
    ]);
  });

  test('de-duplicates repeated events', () => {
    assert.deepEqual(parseEvents('subscriber.created,subscriber.created'), [
      'subscriber.created',
    ]);
  });

  test('handles a single event', () => {
    assert.deepEqual(parseEvents('subscriber.created'), ['subscriber.created']);
  });
});

describe('invalidEvents', () => {
  test('returns empty array when all events are valid', () => {
    assert.deepEqual(invalidEvents(['subscriber.created', 'tag.created']), []);
  });

  test('returns only the unrecognized events', () => {
    assert.deepEqual(
      invalidEvents(['subscriber.created', 'subscriber.subscriber_activate', 'bogus.event']),
      ['subscriber.subscriber_activate', 'bogus.event']
    );
  });
});
