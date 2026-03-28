/**
 * Tests for src/client.js
 *
 * HTTP method tests (get, post, put, del, paginate) require KIT_API_KEY env var
 * and work best without an active OAuth session. In CI, set KIT_API_KEY=test-key.
 * If an OAuth session exists, fetch is still mocked so no real API calls are made.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  validatePathSegment,
  validateNumericId,
  safeJsonParse,
  KitApiError,
  get,
  post,
  put,
  del,
  paginate,
} from '../src/client.js';
import config from '../src/config.js';

const TEST_API_KEY = 'test-api-key-abcde12345';
const _originalFetch = globalThis.fetch;

/**
 * Save and restore the config's OAuth token fields around a block of tests.
 * This prevents an existing (possibly expired) stored token from triggering a
 * real network refresh during tests that mock fetch.
 */
function oauthSnapshot() {
  return {
    accessToken:    config.get('accessToken'),
    refreshToken:   config.get('refreshToken'),
    tokenExpiresAt: config.get('tokenExpiresAt'),
  };
}
function clearOAuth() {
  config.set('accessToken', '');
  config.set('refreshToken', '');
  config.set('tokenExpiresAt', 0);
}
function restoreOAuth(snap) {
  config.set('accessToken',    snap.accessToken);
  config.set('refreshToken',   snap.refreshToken);
  config.set('tokenExpiresAt', snap.tokenExpiresAt);
}

// ── helpers ────────────────────────────────────────────────────────────────

/**
 * Intercept process.exit so tests that exercise error paths don't kill the
 * process. Returns a restore function and accessors for what was recorded.
 */
function mockExit() {
  const orig = process.exit;
  let _called = false;
  let _code;
  process.exit = (code) => {
    _called = true;
    _code = code;
    throw new Error(`process.exit(${code})`);
  };
  return {
    called: () => _called,
    code: () => _code,
    restore: () => { process.exit = orig; },
  };
}

/** Intercept console.error so test output stays clean. */
function captureConsoleError() {
  const orig = console.error;
  const lines = [];
  console.error = (...args) => lines.push(args.join(' '));
  return { lines, restore: () => { console.error = orig; } };
}

/** Build a minimal fetch mock that returns a successful response. */
function mockFetchOk(body, status = 200) {
  globalThis.fetch = async () => ({
    ok: true,
    status,
    statusText: 'OK',
    json: async () => body,
  });
}

// ── KitApiError ────────────────────────────────────────────────────────────

describe('KitApiError', () => {
  test('is an instance of Error', () => {
    assert.ok(new KitApiError(500, ['Oops']) instanceof Error);
  });

  test('sets name to KitApiError', () => {
    assert.equal(new KitApiError(400, ['Bad']).name, 'KitApiError');
  });

  test('sets status property', () => {
    assert.equal(new KitApiError(403, ['Forbidden']).status, 403);
  });

  test('sets errors array', () => {
    const err = new KitApiError(422, ['Email invalid', 'Name too long']);
    assert.deepEqual(err.errors, ['Email invalid', 'Name too long']);
  });

  test('joins errors with semicolon for message', () => {
    const err = new KitApiError(422, ['Email invalid', 'Name too long']);
    assert.equal(err.message, 'Email invalid; Name too long');
  });

  test('single error becomes message directly', () => {
    assert.equal(new KitApiError(404, ['Not found']).message, 'Not found');
  });
});

// ── validatePathSegment ────────────────────────────────────────────────────

describe('validatePathSegment', () => {
  test('returns the value unchanged for a plain identifier', () => {
    assert.equal(validatePathSegment('12345'), '12345');
  });

  test('returns URL-encoded value for a string with spaces', () => {
    assert.equal(validatePathSegment('hello world'), 'hello%20world');
  });

  test('rejects value containing forward slash', () => {
    const { restore } = mockExit();
    const err = captureConsoleError();
    assert.throws(() => validatePathSegment('../etc/passwd'), /process\.exit/);
    err.restore();
    restore();
  });

  test('rejects value containing backslash', () => {
    const m = mockExit();
    const err = captureConsoleError();
    assert.throws(() => validatePathSegment('foo\\bar'), /process\.exit/);
    err.restore();
    m.restore();
  });

  test('rejects value containing a dot', () => {
    const m = mockExit();
    const err = captureConsoleError();
    assert.throws(() => validatePathSegment('foo.bar'), /process\.exit/);
    err.restore();
    m.restore();
  });

  test('rejects value containing hash', () => {
    const m = mockExit();
    const err = captureConsoleError();
    assert.throws(() => validatePathSegment('foo#bar'), /process\.exit/);
    err.restore();
    m.restore();
  });

  test('rejects value containing question mark', () => {
    const m = mockExit();
    const err = captureConsoleError();
    assert.throws(() => validatePathSegment('foo?bar'), /process\.exit/);
    err.restore();
    m.restore();
  });

  test('rejects value containing ampersand', () => {
    const m = mockExit();
    const err = captureConsoleError();
    assert.throws(() => validatePathSegment('foo&bar'), /process\.exit/);
    err.restore();
    m.restore();
  });

  test('rejects empty string', () => {
    const m = mockExit();
    const err = captureConsoleError();
    assert.throws(() => validatePathSegment(''), /process\.exit/);
    err.restore();
    m.restore();
  });

  test('includes custom label in error message', () => {
    const m = mockExit();
    const err = captureConsoleError();
    assert.throws(() => validatePathSegment('bad/id', 'Subscriber ID'), /process\.exit/);
    err.restore();
    m.restore();
    assert.ok(err.lines[0].includes('Subscriber ID'));
  });

  test('exits with code 1', () => {
    const m = mockExit();
    const err = captureConsoleError();
    assert.throws(() => validatePathSegment('bad/id'), /process\.exit/);
    err.restore();
    assert.equal(m.code(), 1);
    m.restore();
  });
});

// ── validateNumericId ──────────────────────────────────────────────────────

describe('validateNumericId', () => {
  test('returns the number for a valid integer string', () => {
    assert.equal(validateNumericId('42'), 42);
  });

  test('returns the number for a valid integer number', () => {
    assert.equal(validateNumericId(100), 100);
  });

  test('returns the number for a large integer', () => {
    assert.equal(validateNumericId('999999999'), 999999999);
  });

  test('rejects zero', () => {
    const m = mockExit();
    const err = captureConsoleError();
    assert.throws(() => validateNumericId(0), /process\.exit/);
    err.restore();
    m.restore();
  });

  test('rejects negative integer', () => {
    const m = mockExit();
    const err = captureConsoleError();
    assert.throws(() => validateNumericId(-1), /process\.exit/);
    err.restore();
    m.restore();
  });

  test('rejects float', () => {
    const m = mockExit();
    const err = captureConsoleError();
    assert.throws(() => validateNumericId(1.5), /process\.exit/);
    err.restore();
    m.restore();
  });

  test('rejects non-numeric string', () => {
    const m = mockExit();
    const err = captureConsoleError();
    assert.throws(() => validateNumericId('abc'), /process\.exit/);
    err.restore();
    m.restore();
  });

  test('rejects NaN', () => {
    const m = mockExit();
    const err = captureConsoleError();
    assert.throws(() => validateNumericId(NaN), /process\.exit/);
    err.restore();
    m.restore();
  });

  test('rejects empty string', () => {
    const m = mockExit();
    const err = captureConsoleError();
    assert.throws(() => validateNumericId(''), /process\.exit/);
    err.restore();
    m.restore();
  });

  test('includes custom label in error message', () => {
    const m = mockExit();
    const err = captureConsoleError();
    assert.throws(() => validateNumericId('bad', 'Tag ID'), /process\.exit/);
    err.restore();
    m.restore();
    assert.ok(err.lines[0].includes('Tag ID'));
  });

  test('exits with code 1', () => {
    const m = mockExit();
    const err = captureConsoleError();
    assert.throws(() => validateNumericId(-5), /process\.exit/);
    err.restore();
    assert.equal(m.code(), 1);
    m.restore();
  });
});

// ── safeJsonParse ──────────────────────────────────────────────────────────

describe('safeJsonParse', () => {
  test('parses a valid JSON object', () => {
    assert.deepEqual(safeJsonParse('{"a":1}'), { a: 1 });
  });

  test('parses a valid JSON array', () => {
    assert.deepEqual(safeJsonParse('[1,2,3]'), [1, 2, 3]);
  });

  test('parses JSON null', () => {
    assert.equal(safeJsonParse('null'), null);
  });

  test('parses JSON number', () => {
    assert.equal(safeJsonParse('42'), 42);
  });

  test('parses nested object', () => {
    const input = '{"subscriber":{"id":1,"email":"test@example.com"}}';
    assert.deepEqual(safeJsonParse(input), { subscriber: { id: 1, email: 'test@example.com' } });
  });

  test('rejects invalid JSON', () => {
    const m = mockExit();
    const err = captureConsoleError();
    assert.throws(() => safeJsonParse('{bad json}'), /process\.exit/);
    err.restore();
    m.restore();
  });

  test('rejects empty string', () => {
    const m = mockExit();
    const err = captureConsoleError();
    assert.throws(() => safeJsonParse(''), /process\.exit/);
    err.restore();
    m.restore();
  });

  test('rejects trailing comma', () => {
    const m = mockExit();
    const err = captureConsoleError();
    assert.throws(() => safeJsonParse('{"a":1,}'), /process\.exit/);
    err.restore();
    m.restore();
  });

  test('includes custom label in error message', () => {
    const m = mockExit();
    const err = captureConsoleError();
    assert.throws(() => safeJsonParse('bad', 'Custom Fields JSON'), /process\.exit/);
    err.restore();
    m.restore();
    assert.ok(err.lines[0].includes('Custom Fields JSON'));
  });

  test('exits with code 1', () => {
    const m = mockExit();
    const err = captureConsoleError();
    assert.throws(() => safeJsonParse('oops'), /process\.exit/);
    err.restore();
    assert.equal(m.code(), 1);
    m.restore();
  });
});

// ── HTTP client methods ────────────────────────────────────────────────────

describe('HTTP client', () => {
  let _oauthSnap;

  before(() => {
    process.env.KIT_API_KEY = TEST_API_KEY;
    _oauthSnap = oauthSnapshot();
    clearOAuth(); // force API-key auth path; avoids expired-token refresh
  });

  after(() => {
    delete process.env.KIT_API_KEY;
    restoreOAuth(_oauthSnap);
    globalThis.fetch = _originalFetch;
  });

  test('get() sends a GET request to the correct URL', async () => {
    let captured;
    globalThis.fetch = async (url, opts) => {
      captured = { url, opts };
      return { ok: true, status: 200, json: async () => ({ subscribers: [] }) };
    };
    await get('/subscribers');
    assert.ok(captured.url.startsWith('https://api.kit.com/v4/subscribers'));
    assert.equal(captured.opts.method, 'GET');
  });

  test('get() includes Accept header', async () => {
    let captured;
    globalThis.fetch = async (url, opts) => { captured = { url, opts }; return { ok: true, status: 200, json: async () => ({}) }; };
    await get('/subscribers');
    assert.equal(captured.opts.headers['Accept'], 'application/json');
  });

  test('get() appends query params to URL', async () => {
    let capturedUrl;
    globalThis.fetch = async (url) => { capturedUrl = url; return { ok: true, status: 200, json: async () => ({}) }; };
    await get('/subscribers', { per_page: 10, after: 'cursor1' });
    const parsed = new URL(capturedUrl);
    assert.equal(parsed.searchParams.get('per_page'), '10');
    assert.equal(parsed.searchParams.get('after'), 'cursor1');
  });

  test('get() skips null query params', async () => {
    let capturedUrl;
    globalThis.fetch = async (url) => { capturedUrl = url; return { ok: true, status: 200, json: async () => ({}) }; };
    await get('/subscribers', { page: 1, sort: null, filter: undefined, name: '' });
    const parsed = new URL(capturedUrl);
    assert.equal(parsed.searchParams.get('page'), '1');
    assert.ok(!parsed.searchParams.has('sort'));
    assert.ok(!parsed.searchParams.has('filter'));
    assert.ok(!parsed.searchParams.has('name'));
  });

  test('post() sends a POST request with JSON body', async () => {
    let captured;
    globalThis.fetch = async (url, opts) => {
      captured = { url, opts };
      return { ok: true, status: 200, json: async () => ({ subscriber: {} }) };
    };
    await post('/subscribers', { email: 'new@example.com' });
    assert.equal(captured.opts.method, 'POST');
    assert.equal(captured.opts.headers['Content-Type'], 'application/json');
    assert.deepEqual(JSON.parse(captured.opts.body), { email: 'new@example.com' });
  });

  test('put() sends a PUT request with JSON body', async () => {
    let captured;
    globalThis.fetch = async (url, opts) => {
      captured = { url, opts };
      return { ok: true, status: 200, json: async () => ({ subscriber: {} }) };
    };
    await put('/subscribers/123', { first_name: 'Alice' });
    assert.equal(captured.opts.method, 'PUT');
    assert.equal(captured.opts.headers['Content-Type'], 'application/json');
    assert.deepEqual(JSON.parse(captured.opts.body), { first_name: 'Alice' });
  });

  test('del() sends a DELETE request', async () => {
    let captured;
    globalThis.fetch = async (url, opts) => { captured = { url, opts }; return { ok: true, status: 204 }; };
    await del('/subscribers/123');
    assert.equal(captured.opts.method, 'DELETE');
  });

  test('returns null for 204 No Content', async () => {
    globalThis.fetch = async () => ({ ok: true, status: 204 });
    const result = await get('/something');
    assert.equal(result, null);
  });

  test('returns parsed JSON for 200 response', async () => {
    const payload = { subscribers: [{ id: 1 }] };
    mockFetchOk(payload);
    const result = await get('/subscribers');
    assert.deepEqual(result, payload);
  });

  test('throws KitApiError for 404 with errors array', async () => {
    globalThis.fetch = async () => ({
      ok: false, status: 404, statusText: 'Not Found',
      json: async () => ({ errors: ['Subscriber not found'] }),
    });
    await assert.rejects(
      () => get('/subscribers/999'),
      (err) => {
        assert.ok(err instanceof KitApiError);
        assert.equal(err.status, 404);
        assert.deepEqual(err.errors, ['Subscriber not found']);
        return true;
      }
    );
  });

  test('throws KitApiError for 401 with message field', async () => {
    globalThis.fetch = async () => ({
      ok: false, status: 401, statusText: 'Unauthorized',
      json: async () => ({ message: 'Invalid API key' }),
    });
    await assert.rejects(
      () => get('/subscribers'),
      (err) => {
        assert.ok(err instanceof KitApiError);
        assert.equal(err.status, 401);
        assert.deepEqual(err.errors, ['Invalid API key']);
        return true;
      }
    );
  });

  test('throws KitApiError with statusText when response body is not parseable', async () => {
    globalThis.fetch = async () => ({
      ok: false, status: 500, statusText: 'Internal Server Error',
      json: async () => { throw new Error('not json'); },
    });
    await assert.rejects(
      () => get('/subscribers'),
      (err) => {
        assert.ok(err instanceof KitApiError);
        assert.equal(err.status, 500);
        assert.deepEqual(err.errors, ['Internal Server Error']);
        return true;
      }
    );
  });

  test('del() sends request body when provided', async () => {
    let captured;
    globalThis.fetch = async (url, opts) => { captured = { url, opts }; return { ok: true, status: 204 }; };
    await del('/tags/subscribers', { subscriber_ids: [1, 2] });
    assert.equal(captured.opts.method, 'DELETE');
    assert.deepEqual(JSON.parse(captured.opts.body), { subscriber_ids: [1, 2] });
  });
});

// ── paginate ───────────────────────────────────────────────────────────────

describe('paginate', () => {
  let _oauthSnap;

  before(() => {
    process.env.KIT_API_KEY = TEST_API_KEY;
    _oauthSnap = oauthSnapshot();
    clearOAuth();
  });

  after(() => {
    delete process.env.KIT_API_KEY;
    restoreOAuth(_oauthSnap);
    globalThis.fetch = _originalFetch;
  });

  test('collects items from a single-page response', async () => {
    globalThis.fetch = async () => ({
      ok: true, status: 200,
      json: async () => ({
        tags: [{ id: 1 }, { id: 2 }],
        pagination: { has_next_page: false },
      }),
    });
    const result = await paginate('/tags', {}, 'tags');
    assert.deepEqual(result, [{ id: 1 }, { id: 2 }]);
  });

  test('collects items across multiple pages', async () => {
    let callCount = 0;
    globalThis.fetch = async (url) => {
      callCount++;
      const after = new URL(url).searchParams.get('after');
      if (!after) {
        return {
          ok: true, status: 200,
          json: async () => ({
            subscribers: [{ id: 1 }, { id: 2 }],
            pagination: { has_next_page: true, end_cursor: 'cursor1' },
          }),
        };
      }
      return {
        ok: true, status: 200,
        json: async () => ({
          subscribers: [{ id: 3 }],
          pagination: { has_next_page: false },
        }),
      };
    };
    const result = await paginate('/subscribers', {}, 'subscribers');
    assert.equal(callCount, 2);
    assert.deepEqual(result, [{ id: 1 }, { id: 2 }, { id: 3 }]);
  });

  test('returns empty array when response has no items', async () => {
    globalThis.fetch = async () => ({
      ok: true, status: 200,
      json: async () => ({ subscribers: [], pagination: { has_next_page: false } }),
    });
    const result = await paginate('/subscribers', {}, 'subscribers');
    assert.deepEqual(result, []);
  });

  test('auto-detects array key when dataKey not provided', async () => {
    globalThis.fetch = async () => ({
      ok: true, status: 200,
      json: async () => ({
        forms: [{ id: 5, name: 'My Form' }],
        pagination: { has_next_page: false },
      }),
    });
    const result = await paginate('/forms');
    assert.deepEqual(result, [{ id: 5, name: 'My Form' }]);
  });

  test('passes initial cursor from query options', async () => {
    let capturedUrl;
    globalThis.fetch = async (url) => {
      capturedUrl = url;
      return {
        ok: true, status: 200,
        json: async () => ({ subscribers: [], pagination: { has_next_page: false } }),
      };
    };
    await paginate('/subscribers', { after: 'startCursor' }, 'subscribers');
    assert.ok(new URL(capturedUrl).searchParams.get('after') === 'startCursor');
  });

  test('passes extra query params to each page request', async () => {
    const capturedParams = [];
    globalThis.fetch = async (url) => {
      capturedParams.push(Object.fromEntries(new URL(url).searchParams));
      return {
        ok: true, status: 200,
        json: async () => ({ subscribers: [], pagination: { has_next_page: false } }),
      };
    };
    await paginate('/subscribers', { email_address: 'test@example.com' }, 'subscribers');
    assert.equal(capturedParams[0].email_address, 'test@example.com');
  });
});
