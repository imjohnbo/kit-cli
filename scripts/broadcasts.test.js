/**
 * Tests for src/commands/broadcasts.js
 *
 * Covers the list filters added in issues #4 and #11, the account-wide stats
 * endpoint and its filters from issues #7 and #11, and the link clicks endpoint
 * from issue #13.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { broadcastsCommand } from '../src/commands/broadcasts.js';
import { runCommand, onlyCall, findSubcommand, optionFlags } from './helpers.js';

const BROADCAST = {
  id: 12,
  publication_id: 99,
  subject: 'Launch day',
  description: 'The big one',
  content: '<p>hi</p>',
  public: true,
  status: 'completed',
  send_at: '2026-03-01T09:00:00Z',
  created_at: '2026-02-20T09:00:00Z',
  thumbnail_url: null,
  email_template: { id: 2, name: 'Default' },
};

const STATS = {
  recipients: 1000,
  open_rate: 42.5,
  emails_opened: 425,
  click_rate: 8.1,
  unsubscribe_rate: 0.2,
  unsubscribes: 2,
  total_clicks: 81,
  show_total_clicks: true,
  status: 'completed',
  progress: 100.0,
  open_tracking_disabled: false,
  click_tracking_disabled: true,
};

const run = (argv, responses) => runCommand(broadcastsCommand, argv, { responses });

// ── list filters ───────────────────────────────────────────────────────────

describe('broadcasts list', () => {
  test('requests GET /broadcasts', async () => {
    const res = await run(['list'], { broadcasts: [BROADCAST], pagination: {} });
    const call = onlyCall(res);
    assert.equal(call.method, 'GET');
    assert.equal(call.path, '/v4/broadcasts');
  });

  test('--status filters by lifecycle status', async () => {
    const res = await run(['list', '--status', 'scheduled'], { broadcasts: [], pagination: {} });
    assert.equal(onlyCall(res).query.status, 'scheduled');
  });

  test('accepts every documented status', async () => {
    for (const status of ['draft', 'scheduled', 'sending', 'completed', 'aborted']) {
      const res = await run(['list', '--status', status], { broadcasts: [], pagination: {} });
      assert.equal(onlyCall(res).query.status, status);
    }
  });

  test('rejects an unknown status', async () => {
    const res = await run(['list', '--status', 'paused'], { broadcasts: [], pagination: {} });
    assert.equal(res.calls.length, 0);
    assert.equal(res.exitCode, 1);
    assert.match(res.err, /paused/);
  });

  test('--sent-after and --sent-before become query parameters', async () => {
    const res = await run(
      ['list', '--sent-after', '2026-01-01', '--sent-before', '2026-02-01'],
      { broadcasts: [], pagination: {} }
    );
    const call = onlyCall(res);
    assert.equal(call.query.sent_after, '2026-01-01');
    assert.equal(call.query.sent_before, '2026-02-01');
  });

  test('omits the new filters when they are not given', async () => {
    const res = await run(['list'], { broadcasts: [], pagination: {} });
    const query = onlyCall(res).query;
    assert.ok(!('status' in query));
    assert.ok(!('sent_after' in query));
    assert.ok(!('sent_before' in query));
  });

  test('still forwards pagination options', async () => {
    const res = await run(['list', '--per-page', '25'], { broadcasts: [], pagination: {} });
    assert.equal(onlyCall(res).query.per_page, '25');
  });
});

// ── single broadcast stats ─────────────────────────────────────────────────

describe('broadcasts stats <id>', () => {
  test('requests GET /broadcasts/{id}/stats', async () => {
    const res = await run(['stats', '12'], { broadcast: { id: 12, stats: STATS } });
    const call = onlyCall(res);
    assert.equal(call.method, 'GET');
    assert.equal(call.path, '/v4/broadcasts/12/stats');
  });

  test('prints the newly documented stats fields', async () => {
    const res = await run(['stats', '12'], { broadcast: { id: 12, stats: STATS } });
    assert.match(res.out, /Unsubscribe Rate/);
    assert.match(res.out, /Progress/);
    assert.match(res.out, /Open Tracking/);
    assert.match(res.out, /Click Tracking/);
  });

  test('reports tracking as enabled when the API says it is not disabled', async () => {
    const res = await run(['stats', '12'], { broadcast: { id: 12, stats: STATS } });
    const openLine = res.logs.find((l) => l.includes('Open Tracking'));
    const clickLine = res.logs.find((l) => l.includes('Click Tracking'));
    assert.match(openLine, /true/);
    assert.match(clickLine, /false/);
  });

  test('--format json keeps the nested stats shape', async () => {
    const res = await run(['stats', '12', '--format', 'json'], { broadcast: { id: 12, stats: STATS } });
    const parsed = JSON.parse(res.out);
    assert.equal(parsed.id, 12);
    assert.equal(parsed.stats.recipients, 1000);
  });

  test('sends no list filters when an ID is given', async () => {
    const res = await run(['stats', '12'], { broadcast: { id: 12, stats: STATS } });
    assert.deepEqual(onlyCall(res).query, {});
  });
});

// ── account-wide broadcast stats ───────────────────────────────────────────

describe('broadcasts stats with no ID', () => {
  test('requests GET /broadcasts/stats', async () => {
    const res = await run(['stats'], { broadcasts: [{ id: 12, stats: STATS }], pagination: {} });
    const call = onlyCall(res);
    assert.equal(call.method, 'GET');
    assert.equal(call.path, '/v4/broadcasts/stats');
  });

  test('renders one row per broadcast', async () => {
    const res = await run(['stats'], {
      broadcasts: [
        { id: 12, subject: 'One', stats: STATS },
        { id: 13, subject: 'Two', stats: { ...STATS, recipients: 5 } },
      ],
      pagination: {},
    });
    assert.match(res.out, /One/);
    assert.match(res.out, /Two/);
    assert.match(res.out, /2 result/);
  });

  test('forwards the status filter', async () => {
    const res = await run(['stats', '--status', 'completed'], { broadcasts: [], pagination: {} });
    assert.equal(onlyCall(res).query.status, 'completed');
  });

  test('forwards the sent date filters', async () => {
    const res = await run(
      ['stats', '--sent-after', '2026-01-01', '--sent-before', '2026-02-01'],
      { broadcasts: [], pagination: {} }
    );
    const call = onlyCall(res);
    assert.equal(call.query.sent_after, '2026-01-01');
    assert.equal(call.query.sent_before, '2026-02-01');
  });

  test('forwards the pagination filters', async () => {
    const res = await run(['stats', '--per-page', '5', '--after', 'cur'], { broadcasts: [], pagination: {} });
    const call = onlyCall(res);
    assert.equal(call.query.per_page, '5');
    assert.equal(call.query.after, 'cur');
  });

  test('--include-total-count sets include_total_count=true', async () => {
    const res = await run(['stats', '--include-total-count'], { broadcasts: [], pagination: {} });
    assert.equal(onlyCall(res).query.include_total_count, 'true');
  });

  test('omits include_total_count by default', async () => {
    const res = await run(['stats'], { broadcasts: [], pagination: {} });
    assert.ok(!('include_total_count' in onlyCall(res).query));
  });

  test('rejects an unknown status', async () => {
    const res = await run(['stats', '--status', 'paused'], { broadcasts: [], pagination: {} });
    assert.equal(res.calls.length, 0);
    assert.equal(res.exitCode, 1);
  });
});

// ── link clicks ────────────────────────────────────────────────────────────

describe('broadcasts clicks', () => {
  test('requests GET /broadcasts/{id}/clicks', async () => {
    const res = await run(['clicks', '12'], {
      broadcast: { id: 12, clicks: [] },
      pagination: {},
    });
    const call = onlyCall(res);
    assert.equal(call.method, 'GET');
    assert.equal(call.path, '/v4/broadcasts/12/clicks');
  });

  test('renders one row per clicked link', async () => {
    const res = await run(['clicks', '12'], {
      broadcast: {
        id: 12,
        clicks: [
          { url: 'https://example.com/a', unique_clicks: 10, click_to_delivery_rate: 1.0, click_to_open_rate: 2.5 },
          { url: 'https://example.com/b', unique_clicks: 4, click_to_delivery_rate: 0.4, click_to_open_rate: 1.0 },
        ],
      },
      pagination: {},
    });
    assert.match(res.out, /example\.com\/a/);
    assert.match(res.out, /example\.com\/b/);
    assert.match(res.out, /2 result/);
  });

  test('reports a broadcast with no clicks', async () => {
    const res = await run(['clicks', '12'], { broadcast: { id: 12, clicks: [] }, pagination: {} });
    assert.match(res.out, /No results found/);
  });

  test('rejects a path-traversing ID', async () => {
    const res = await run(['clicks', '../account'], { broadcast: { id: 1, clicks: [] } });
    assert.equal(res.calls.length, 0);
    assert.equal(res.exitCode, 1);
  });
});

// ── unchanged behavior ─────────────────────────────────────────────────────

describe('broadcasts create and update still work', () => {
  test('create POSTs to /broadcasts', async () => {
    const res = await run(['create', '--subject', 'Hi'], { broadcast: BROADCAST });
    const call = onlyCall(res);
    assert.equal(call.method, 'POST');
    assert.equal(call.path, '/v4/broadcasts');
    assert.equal(call.body.subject, 'Hi');
  });

  test('create maps --tag-ids to a subscriber filter', async () => {
    const res = await run(['create', '--subject', 'Hi', '--tag-ids', '3, 4'], { broadcast: BROADCAST });
    assert.deepEqual(onlyCall(res).body.subscriber_filter, [{ type: 'tag', ids: [3, 4] }]);
  });

  test('create rejects a non-numeric tag ID', async () => {
    const res = await run(['create', '--subject', 'Hi', '--tag-ids', 'vip'], { broadcast: BROADCAST });
    assert.equal(res.calls.length, 0);
    assert.equal(res.exitCode, 1);
  });

  test('update PUTs only the given fields', async () => {
    const res = await run(['update', '12', '--subject', 'New'], { broadcast: BROADCAST });
    const call = onlyCall(res);
    assert.equal(call.method, 'PUT');
    assert.deepEqual(call.body, { subject: 'New' });
  });

  test('delete DELETEs the broadcast', async () => {
    const res = await run(['delete', '12'], { __status: 204 });
    const call = onlyCall(res);
    assert.equal(call.method, 'DELETE');
    assert.equal(call.path, '/v4/broadcasts/12');
  });
});

// ── wiring ─────────────────────────────────────────────────────────────────

describe('broadcasts command wiring', () => {
  test('stats takes an optional ID', () => {
    const cmd = findSubcommand(broadcastsCommand(), 'stats');
    assert.equal(cmd.registeredArguments.length, 1);
    assert.equal(cmd.registeredArguments[0].required, false);
  });

  test('list exposes the new filters', () => {
    const flags = optionFlags(findSubcommand(broadcastsCommand(), 'list'));
    for (const flag of ['--status', '--sent-after', '--sent-before']) {
      assert.ok(flags.includes(flag), `missing flag: ${flag}`);
    }
  });

  test('clicks is registered', () => {
    assert.ok(findSubcommand(broadcastsCommand(), 'clicks'));
  });
});
