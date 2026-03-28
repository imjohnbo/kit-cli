/**
 * Tests for src/output.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatOutput,
  printDetail,
  printSuccess,
  printError,
  printPagination,
  withErrorHandler,
} from '../src/output.js';
import { KitApiError } from '../src/client.js';

// ── helpers ────────────────────────────────────────────────────────────────

/** Redirect console.log + console.error and return captured lines. */
function capture() {
  const logs = [];
  const errors = [];
  const origLog = console.log;
  const origErr = console.error;
  console.log = (...args) => logs.push(args.join(' '));
  console.error = (...args) => errors.push(args.join(' '));
  return {
    logs,
    errors,
    restore() {
      console.log = origLog;
      console.error = origErr;
    },
  };
}

const SAMPLE_COLUMNS = [
  { header: 'ID',    accessor: (r) => r.id },
  { header: 'Email', accessor: (r) => r.email },
];

const SAMPLE_FIELDS = [
  { label: 'ID',    accessor: (d) => d.id },
  { label: 'Email', accessor: (d) => d.email },
  { label: 'State', accessor: (d) => d.state },
];

// ── printSuccess ───────────────────────────────────────────────────────────

describe('printSuccess', () => {
  test('logs the message text', () => {
    const c = capture();
    printSuccess('Subscriber created');
    c.restore();
    assert.equal(c.logs.length, 1);
    assert.ok(c.logs[0].includes('Subscriber created'));
  });

  test('includes a Unicode checkmark (✓)', () => {
    const c = capture();
    printSuccess('Done');
    c.restore();
    assert.ok(c.logs[0].includes('\u2713'));
  });

  test('writes to console.log, not console.error', () => {
    const c = capture();
    printSuccess('OK');
    c.restore();
    assert.equal(c.errors.length, 0);
  });
});

// ── printError ─────────────────────────────────────────────────────────────

describe('printError', () => {
  test('formats a KitApiError with status and message', () => {
    const c = capture();
    printError(new KitApiError(404, ['Not found']));
    c.restore();
    assert.equal(c.errors.length, 1);
    assert.ok(c.errors[0].includes('404'));
    assert.ok(c.errors[0].includes('Not found'));
  });

  test('formats a KitApiError with multiple errors', () => {
    const c = capture();
    printError(new KitApiError(422, ['Email invalid', 'Name too long']));
    c.restore();
    assert.ok(c.errors[0].includes('Email invalid'));
    assert.ok(c.errors[0].includes('Name too long'));
  });

  test('formats a generic Error with its message', () => {
    const c = capture();
    printError(new Error('Network failure'));
    c.restore();
    assert.equal(c.errors.length, 1);
    assert.ok(c.errors[0].includes('Network failure'));
  });

  test('writes to console.error, not console.log', () => {
    const c = capture();
    printError(new Error('Oops'));
    c.restore();
    assert.equal(c.logs.length, 0);
  });
});

// ── printPagination ────────────────────────────────────────────────────────

describe('printPagination', () => {
  test('prints nothing for null', () => {
    const c = capture();
    printPagination(null);
    c.restore();
    assert.equal(c.logs.length, 0);
  });

  test('prints nothing when no next or previous page', () => {
    const c = capture();
    printPagination({ has_next_page: false, has_previous_page: false });
    c.restore();
    assert.equal(c.logs.length, 0);
  });

  test('shows next cursor when has_next_page is true', () => {
    const c = capture();
    printPagination({ has_next_page: true, end_cursor: 'abc123', has_previous_page: false });
    c.restore();
    assert.equal(c.logs.length, 1);
    assert.ok(c.logs[0].includes('--after abc123'));
  });

  test('shows prev cursor when has_previous_page is true', () => {
    const c = capture();
    printPagination({ has_previous_page: true, start_cursor: 'xyz789', has_next_page: false });
    c.restore();
    assert.equal(c.logs.length, 1);
    assert.ok(c.logs[0].includes('--before xyz789'));
  });

  test('shows both cursors when both pages are available', () => {
    const c = capture();
    printPagination({
      has_previous_page: true,  start_cursor: 'prev-cur',
      has_next_page:     true,  end_cursor:   'next-cur',
    });
    c.restore();
    assert.equal(c.logs.length, 1);
    assert.ok(c.logs[0].includes('--before prev-cur'));
    assert.ok(c.logs[0].includes('--after next-cur'));
  });

  test('cursor values appear verbatim', () => {
    const c = capture();
    printPagination({ has_next_page: true, end_cursor: 'eyJpZCI6OTl9' });
    c.restore();
    assert.ok(c.logs[0].includes('eyJpZCI6OTl9'));
  });
});

// ── withErrorHandler ───────────────────────────────────────────────────────

describe('withErrorHandler', () => {
  test('returns a function', () => {
    assert.equal(typeof withErrorHandler(async () => {}), 'function');
  });

  test('passes all arguments through to the wrapped function', async () => {
    let received;
    const wrapped = withErrorHandler(async (...args) => { received = args; });
    await wrapped('a', 'b', 'c');
    assert.deepEqual(received, ['a', 'b', 'c']);
  });

  test('resolves normally when wrapped function succeeds', async () => {
    let executed = false;
    const wrapped = withErrorHandler(async () => { executed = true; });
    await wrapped();
    assert.ok(executed);
  });

  test('calls process.exit(1) when wrapped function throws', async () => {
    const origExit = process.exit;
    let exitCode;
    process.exit = (c) => { exitCode = c; };
    const c = capture();
    await withErrorHandler(async () => { throw new Error('Boom'); })();
    c.restore();
    process.exit = origExit;
    assert.equal(exitCode, 1);
  });

  test('prints the error before exiting', async () => {
    const origExit = process.exit;
    process.exit = () => {};
    const c = capture();
    await withErrorHandler(async () => { throw new Error('Test error message'); })();
    c.restore();
    process.exit = origExit;
    assert.ok(c.errors[0].includes('Test error message'));
  });

  test('handles KitApiError and includes status code', async () => {
    const origExit = process.exit;
    process.exit = () => {};
    const c = capture();
    await withErrorHandler(async () => { throw new KitApiError(403, ['Forbidden']); })();
    c.restore();
    process.exit = origExit;
    assert.ok(c.errors[0].includes('403'));
    assert.ok(c.errors[0].includes('Forbidden'));
  });
});

// ── formatOutput ───────────────────────────────────────────────────────────

describe('formatOutput', () => {
  test('emits pretty-printed JSON when format is "json"', () => {
    const data = [{ id: 1, email: 'a@b.com' }];
    const c = capture();
    formatOutput(data, SAMPLE_COLUMNS, { format: 'json' });
    c.restore();
    assert.equal(c.logs.length, 1);
    assert.deepEqual(JSON.parse(c.logs[0]), data);
  });

  test('JSON output is indented (pretty-printed)', () => {
    const c = capture();
    formatOutput([{ id: 1 }], [], { format: 'json' });
    c.restore();
    assert.ok(c.logs[0].includes('\n'));
  });

  test('prints "No results found" for an empty array in table mode', () => {
    const c = capture();
    formatOutput([], SAMPLE_COLUMNS, { format: 'table' });
    c.restore();
    assert.ok(c.logs[0].includes('No results found'));
  });

  test('prints "No results found" for null in table mode', () => {
    const c = capture();
    formatOutput(null, SAMPLE_COLUMNS, { format: 'table' });
    c.restore();
    assert.ok(c.logs[0].includes('No results found'));
  });

  test('includes column header values in table output', () => {
    const c = capture();
    formatOutput([{ id: 1, email: 'x@y.com' }], SAMPLE_COLUMNS, { format: 'table' });
    c.restore();
    const out = c.logs.join('\n');
    assert.ok(out.includes('ID'));
    assert.ok(out.includes('Email'));
  });

  test('includes row data values in table output', () => {
    const c = capture();
    formatOutput([{ id: 42, email: 'hello@example.com' }], SAMPLE_COLUMNS, { format: 'table' });
    c.restore();
    const out = c.logs.join('\n');
    assert.ok(out.includes('42'));
    assert.ok(out.includes('hello@example.com'));
  });

  test('renders null accessor value as a dash', () => {
    const c = capture();
    formatOutput([{ id: null, email: undefined }], SAMPLE_COLUMNS, { format: 'table' });
    c.restore();
    const out = c.logs.join('\n');
    assert.ok(out.includes('-'));
  });

  test('shows N result(s) count for array data', () => {
    const c = capture();
    formatOutput([{ id: 1 }, { id: 2 }, { id: 3 }], SAMPLE_COLUMNS, { format: 'table' });
    c.restore();
    const out = c.logs.join('\n');
    assert.ok(out.includes('3 result(s)'));
  });

  test('does NOT show result count for a single non-array object', () => {
    const c = capture();
    formatOutput({ id: 1, email: 'a@b.com' }, SAMPLE_COLUMNS, { format: 'table' });
    c.restore();
    const out = c.logs.join('\n');
    assert.ok(!out.includes('result(s)'));
  });

  test('renders a single object as a one-row table', () => {
    const c = capture();
    formatOutput({ id: 7, email: 'single@example.com' }, SAMPLE_COLUMNS, { format: 'table' });
    c.restore();
    const out = c.logs.join('\n');
    assert.ok(out.includes('7'));
    assert.ok(out.includes('single@example.com'));
  });
});

// ── printDetail ────────────────────────────────────────────────────────────

describe('printDetail', () => {
  test('emits pretty-printed JSON when format is "json"', () => {
    const data = { id: 1, email: 'a@b.com', state: 'active' };
    const c = capture();
    printDetail(data, SAMPLE_FIELDS, { format: 'json' });
    c.restore();
    assert.deepEqual(JSON.parse(c.logs[0]), data);
  });

  test('prints one line per field in table mode', () => {
    const data = { id: 5, email: 'x@y.com', state: 'active' };
    const c = capture();
    printDetail(data, SAMPLE_FIELDS, { format: 'table' });
    c.restore();
    assert.equal(c.logs.length, SAMPLE_FIELDS.length);
  });

  test('each line contains the field label', () => {
    const data = { id: 5, email: 'x@y.com', state: 'active' };
    const c = capture();
    printDetail(data, SAMPLE_FIELDS, { format: 'table' });
    c.restore();
    assert.ok(c.logs[0].includes('ID'));
    assert.ok(c.logs[1].includes('Email'));
    assert.ok(c.logs[2].includes('State'));
  });

  test('each line contains the field value', () => {
    const data = { id: 99, email: 'detail@example.com', state: 'inactive' };
    const c = capture();
    printDetail(data, SAMPLE_FIELDS, { format: 'table' });
    c.restore();
    assert.ok(c.logs[0].includes('99'));
    assert.ok(c.logs[1].includes('detail@example.com'));
    assert.ok(c.logs[2].includes('inactive'));
  });

  test('renders null accessor value as a dash', () => {
    const data = { id: null, email: undefined, state: 'active' };
    const c = capture();
    printDetail(data, SAMPLE_FIELDS, { format: 'table' });
    c.restore();
    assert.ok(c.logs[0].includes('-'));
    assert.ok(c.logs[1].includes('-'));
  });

  test('labels are padded to the same width', () => {
    const fields = [
      { label: 'ID',           accessor: (d) => d.id },
      { label: 'Email Address', accessor: (d) => d.email },
    ];
    const c = capture();
    printDetail({ id: 1, email: 'a@b.com' }, fields, { format: 'table' });
    c.restore();
    // Both lines should start with the label padded to the same column
    const firstLabelEnd = c.logs[0].indexOf('1');
    const secondLabelEnd = c.logs[1].indexOf('a@');
    assert.equal(firstLabelEnd, secondLabelEnd);
  });
});
