/**
 * Tests for src/update-check.js
 *
 * Narrow coverage: just the new User-Agent header. The rest of the module's
 * behavior (caching, CI detection, KIT_NO_UPDATE_CHECK) has no existing test
 * file and is out of scope for this change.
 */
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { refreshLatest } from '../src/update-check.js';

const _originalFetch = globalThis.fetch;

describe('refreshLatest', () => {
  after(() => { globalThis.fetch = _originalFetch; });

  test('sends a descriptive User-Agent header to the registry', async () => {
    let captured;
    globalThis.fetch = async (url, opts) => {
      captured = opts;
      return { status: 200, ok: true, json: async () => ({ version: '9.9.9' }) };
    };
    await refreshLatest({ force: true, automatic: false });
    assert.match(captured.headers['User-Agent'], /^kit-cli\//);
  });
});
