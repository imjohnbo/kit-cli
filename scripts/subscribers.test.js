/**
 * Tests for src/commands/subscribers.js
 *
 * Covers the slim list parameter from issue #9, the create and update request
 * body changes from issue #8, and the filter endpoint from issue #13.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { subscribersCommand } from '../src/commands/subscribers.js';
import { runCommand, onlyCall, findSubcommand, optionFlags } from './helpers.js';

const SUBSCRIBER = {
  id: 41,
  first_name: 'Ada',
  email_address: 'ada@example.com',
  state: 'active',
  created_at: '2026-01-05T10:00:00Z',
  fields: { last_name: 'Lovelace' },
};

const run = (argv, responses) => runCommand(subscribersCommand, argv, { responses });

/** Writes a JSON fixture to a temp file and returns its path. */
function tempJson(value) {
  const dir = mkdtempSync(join(tmpdir(), 'kit-cli-test-'));
  const path = join(dir, 'filter.json');
  writeFileSync(path, JSON.stringify(value));
  return path;
}

// ── list --slim ────────────────────────────────────────────────────────────
// Slim is the default now. See scripts/slim.test.js for the shared behavior
// across every list command that supports it.

describe('subscribers list', () => {
  test('--slim sets slim=true', async () => {
    const res = await run(['list', '--slim'], { subscribers: [], pagination: {} });
    assert.equal(onlyCall(res).query.slim, 'true');
  });

  test('sends slim=true by default', async () => {
    const res = await run(['list'], { subscribers: [], pagination: {} });
    assert.equal(onlyCall(res).query.slim, 'true');
  });

  test('accepts every documented list status', async () => {
    for (const state of ['active', 'inactive', 'bounced', 'complained', 'cancelled', 'all']) {
      const res = await run(['list', '--state', state], { subscribers: [], pagination: {} });
      assert.equal(onlyCall(res).query.status, state);
    }
  });

  test('rejects an unknown state', async () => {
    const res = await run(['list', '--state', 'pending'], { subscribers: [], pagination: {} });
    assert.equal(res.calls.length, 0);
    assert.equal(res.exitCode, 1);
    assert.match(res.err, /pending/);
  });

  test('still forwards the other list filters', async () => {
    const res = await run(
      ['list', '--email', 'ada@example.com', '--created-after', '2026-01-01', '--sort-order', 'desc'],
      { subscribers: [], pagination: {} }
    );
    const query = onlyCall(res).query;
    assert.equal(query.email_address, 'ada@example.com');
    assert.equal(query.created_after, '2026-01-01');
    assert.equal(query.sort_order, 'desc');
  });
});

// ── create and update body changes ─────────────────────────────────────────

describe('subscribers create', () => {
  test('POSTs to /subscribers with the email address', async () => {
    const res = await run(['create', 'ada@example.com'], { subscriber: SUBSCRIBER });
    const call = onlyCall(res);
    assert.equal(call.method, 'POST');
    assert.equal(call.path, '/v4/subscribers');
    assert.deepEqual(call.body, { email_address: 'ada@example.com' });
  });

  test('accepts every documented create state', async () => {
    for (const state of ['active', 'inactive', 'bounced', 'complained', 'cancelled']) {
      const res = await run(['create', 'ada@example.com', '--state', state], { subscriber: SUBSCRIBER });
      assert.equal(onlyCall(res).body.state, state);
    }
  });

  test('rejects "all", which is a list filter and not a real state', async () => {
    const res = await run(['create', 'ada@example.com', '--state', 'all'], { subscriber: SUBSCRIBER });
    assert.equal(res.calls.length, 0);
    assert.equal(res.exitCode, 1);
  });

  test('sends custom fields as an object', async () => {
    const res = await run(
      ['create', 'ada@example.com', '--fields', '{"last_name":"Lovelace"}'],
      { subscriber: SUBSCRIBER }
    );
    assert.deepEqual(onlyCall(res).body.fields, { last_name: 'Lovelace' });
  });

  test('rejects malformed custom field JSON', async () => {
    const res = await run(['create', 'ada@example.com', '--fields', '{oops'], { subscriber: SUBSCRIBER });
    assert.equal(res.calls.length, 0);
    assert.equal(res.exitCode, 1);
  });

  test('surfaces the warnings the API returns for unknown field keys', async () => {
    const res = await run(
      ['create', 'ada@example.com', '--fields', '{"nickname":"Ada"}'],
      { subscriber: SUBSCRIBER, warnings: ['Unknown field key: nickname'] }
    );
    assert.match(res.err, /Unknown field key: nickname/);
  });

  test('prints warnings to stderr, leaving stdout clean for JSON', async () => {
    const res = await run(
      ['create', 'ada@example.com', '--format', 'json'],
      { subscriber: SUBSCRIBER, warnings: ['Unknown field key: nickname'] }
    );
    assert.match(res.err, /nickname/);
    const jsonLine = res.logs.find((l) => l.trim().startsWith('{'));
    assert.doesNotMatch(jsonLine ?? '', /nickname/);
  });

  test('says nothing when the API returns no warnings', async () => {
    const res = await run(['create', 'ada@example.com'], { subscriber: SUBSCRIBER });
    assert.equal(res.err, '');
  });
});

describe('subscribers update', () => {
  test('PUTs only the given fields', async () => {
    const res = await run(['update', '41', '--first-name', 'Ada'], { subscriber: SUBSCRIBER });
    const call = onlyCall(res);
    assert.equal(call.method, 'PUT');
    assert.equal(call.path, '/v4/subscribers/41');
    assert.deepEqual(call.body, { first_name: 'Ada' });
  });

  test('surfaces warnings from the response', async () => {
    const res = await run(
      ['update', '41', '--fields', '{"nickname":"Ada"}'],
      { subscriber: SUBSCRIBER, warnings: ['Unknown field key: nickname'] }
    );
    assert.match(res.err, /nickname/);
  });

  test('does not send a state, which the update endpoint rejects', () => {
    const flags = optionFlags(findSubcommand(subscribersCommand(), 'update'));
    assert.ok(!flags.includes('--state'));
  });
});

// ── filter ─────────────────────────────────────────────────────────────────

describe('subscribers filter', () => {
  const CONDITIONS = [{ type: 'subscriber_state', states: ['active'] }];

  test('POSTs to /subscribers/filter', async () => {
    const res = await run(
      ['filter', '--json', JSON.stringify(CONDITIONS)],
      { subscribers: [], pagination: {} }
    );
    const call = onlyCall(res);
    assert.equal(call.method, 'POST');
    assert.equal(call.path, '/v4/subscribers/filter');
  });

  test('wraps a bare conditions array in an all object', async () => {
    const res = await run(
      ['filter', '--json', JSON.stringify(CONDITIONS)],
      { subscribers: [], pagination: {} }
    );
    assert.deepEqual(onlyCall(res).body, { all: CONDITIONS });
  });

  test('passes a full body through untouched', async () => {
    const body = { all: CONDITIONS, counting_mode: 'unique_email' };
    const res = await run(['filter', '--json', JSON.stringify(body)], { subscribers: [], pagination: {} });
    assert.deepEqual(onlyCall(res).body, body);
  });

  test('reads the filter from --file', async () => {
    const path = tempJson(CONDITIONS);
    const res = await run(['filter', '--file', path], { subscribers: [], pagination: {} });
    assert.deepEqual(onlyCall(res).body, { all: CONDITIONS });
  });

  test('rejects --file together with --json', async () => {
    const res = await run(
      ['filter', '--file', 'x.json', '--json', '[]'],
      { subscribers: [], pagination: {} }
    );
    assert.equal(res.calls.length, 0);
    assert.equal(res.exitCode, 1);
    assert.match(res.err, /not both/);
  });

  test('requires a filter', async () => {
    const res = await run(['filter'], { subscribers: [], pagination: {} });
    assert.equal(res.calls.length, 0);
    assert.equal(res.exitCode, 1);
    assert.match(res.err, /--file|--json/);
  });

  test('reports a missing file clearly', async () => {
    const res = await run(['filter', '--file', '/nope/missing.json'], { subscribers: [] });
    assert.equal(res.calls.length, 0);
    assert.equal(res.exitCode, 1);
    assert.match(res.err, /Failed to read/);
  });

  test('rejects JSON with no conditions array', async () => {
    const res = await run(['filter', '--json', '{"foo":1}'], { subscribers: [] });
    assert.equal(res.calls.length, 0);
    assert.equal(res.exitCode, 1);
    assert.match(res.err, /"all"/);
  });

  test('rejects malformed JSON', async () => {
    const res = await run(['filter', '--json', '{oops'], { subscribers: [] });
    assert.equal(res.calls.length, 0);
    assert.equal(res.exitCode, 1);
  });

  test('--counting-mode goes into the body', async () => {
    const res = await run(
      ['filter', '--json', JSON.stringify(CONDITIONS), '--counting-mode', 'unique_email'],
      { subscribers: [], pagination: {} }
    );
    assert.equal(onlyCall(res).body.counting_mode, 'unique_email');
  });

  test('rejects an unknown counting mode', async () => {
    const res = await run(
      ['filter', '--json', JSON.stringify(CONDITIONS), '--counting-mode', 'weighted'],
      { subscribers: [] }
    );
    assert.equal(res.calls.length, 0);
    assert.equal(res.exitCode, 1);
  });

  test('--include becomes an array of typed objects', async () => {
    const res = await run(
      ['filter', '--json', JSON.stringify(CONDITIONS), '--include', 'tags,location'],
      { subscribers: [], pagination: {} }
    );
    assert.deepEqual(onlyCall(res).body.include, [{ type: 'tags' }, { type: 'location' }]);
  });

  test('attaches a range to the stats include', async () => {
    const res = await run(
      [
        'filter', '--json', JSON.stringify(CONDITIONS),
        '--include', 'stats', '--stats-start', '2026-05-01', '--stats-end', '2026-06-30',
      ],
      { subscribers: [], pagination: {} }
    );
    assert.deepEqual(onlyCall(res).body.include, [
      { type: 'stats', range: { start: '2026-05-01', end: '2026-06-30' } },
    ]);
  });

  test('omits the range when no stats dates are given', async () => {
    const res = await run(
      ['filter', '--json', JSON.stringify(CONDITIONS), '--include', 'stats'],
      { subscribers: [], pagination: {} }
    );
    assert.deepEqual(onlyCall(res).body.include, [{ type: 'stats' }]);
  });

  test('rejects an unknown include type', async () => {
    const res = await run(
      ['filter', '--json', JSON.stringify(CONDITIONS), '--include', 'purchases'],
      { subscribers: [] }
    );
    assert.equal(res.calls.length, 0);
    assert.equal(res.exitCode, 1);
  });

  test('forwards pagination as query parameters', async () => {
    const res = await run(
      ['filter', '--json', JSON.stringify(CONDITIONS), '--per-page', '5', '--after', 'cur'],
      { subscribers: [], pagination: {} }
    );
    const call = onlyCall(res);
    assert.equal(call.query.per_page, '5');
    assert.equal(call.query.after, 'cur');
  });

  test('renders the tag names the filter response returns', async () => {
    const res = await run(
      ['filter', '--json', JSON.stringify(CONDITIONS)],
      {
        subscribers: [{ id: '1', email_address: 'ada@example.com', tag_names: ['vip', 'beta'], created_at: '2026-01-01T00:00:00Z' }],
        pagination: {},
      }
    );
    assert.match(res.out, /vip, beta/);
  });
});

// ── wiring ─────────────────────────────────────────────────────────────────

describe('subscribers command wiring', () => {
  test('keeps every pre-existing subcommand', () => {
    const cmd = subscribersCommand();
    for (const name of ['list', 'get', 'create', 'update', 'unsubscribe', 'tags', 'stats']) {
      assert.ok(findSubcommand(cmd, name), `missing subcommand: ${name}`);
    }
  });

  test('adds filter', () => {
    assert.ok(findSubcommand(subscribersCommand(), 'filter'));
  });

  test('list exposes --slim and --no-slim', () => {
    const flags = optionFlags(findSubcommand(subscribersCommand(), 'list'));
    assert.ok(flags.includes('--slim'));
    assert.ok(flags.includes('--no-slim'));
  });
});

// ── json output stays parseable ────────────────────────────────────────────

describe('subscribers create with --format json', () => {
  test('prints only JSON on stdout', async () => {
    const res = await run(
      ['create', 'ada@example.com', '--format', 'json'],
      { subscriber: SUBSCRIBER, warnings: ['Unknown field key: nickname'] }
    );
    assert.deepEqual(JSON.parse(res.out), SUBSCRIBER);
  });

  test('still reports warnings on stderr', async () => {
    const res = await run(
      ['create', 'ada@example.com', '--format', 'json'],
      { subscriber: SUBSCRIBER, warnings: ['Unknown field key: nickname'] }
    );
    assert.match(res.err, /nickname/);
  });
});

describe('subscribers update with --format json', () => {
  test('prints only JSON on stdout', async () => {
    const res = await run(
      ['update', '41', '--first-name', 'Ada', '--format', 'json'],
      { subscriber: SUBSCRIBER }
    );
    assert.deepEqual(JSON.parse(res.out), SUBSCRIBER);
  });
});
