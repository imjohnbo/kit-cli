/**
 * Tests for src/commands/tags.js and the bulk tag operations in
 * src/commands/bulk.js
 *
 * Covers bulk tag deletion from issue #10, and the tag rename plus
 * remove-by-email endpoints named in issue #12.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { tagsCommand } from '../src/commands/tags.js';
import { bulkCommand } from '../src/commands/bulk.js';
import { runCommand, onlyCall, findSubcommand, optionFlags } from './helpers.js';

const TAG = { id: 8, name: 'vip', created_at: '2026-01-01T00:00:00Z' };

const tags = (argv, responses) => runCommand(tagsCommand, argv, { responses });
const bulk = (argv, responses) => runCommand(bulkCommand, argv, { responses });

function tempJson(value) {
  const dir = mkdtempSync(join(tmpdir(), 'kit-cli-test-'));
  const path = join(dir, 'items.json');
  writeFileSync(path, JSON.stringify(value));
  return path;
}

// ── tags update ────────────────────────────────────────────────────────────

describe('tags update', () => {
  test('PUTs to /tags/{id}', async () => {
    const res = await tags(['update', '8', 'VIPs'], { tag: { ...TAG, name: 'VIPs' } });
    const call = onlyCall(res);
    assert.equal(call.method, 'PUT');
    assert.equal(call.path, '/v4/tags/8');
  });

  test('sends the new name in the body', async () => {
    const res = await tags(['update', '8', 'VIPs'], { tag: { ...TAG, name: 'VIPs' } });
    assert.deepEqual(onlyCall(res).body, { name: 'VIPs' });
  });

  test('confirms the rename with the new name', async () => {
    const res = await tags(['update', '8', 'VIPs'], { tag: { ...TAG, name: 'VIPs' } });
    assert.match(res.out, /renamed to: VIPs/);
  });

  test('--format json prints the tag object', async () => {
    const res = await tags(['update', '8', 'VIPs', '--format', 'json'], { tag: { ...TAG, name: 'VIPs' } });
    assert.equal(JSON.parse(res.out).name, 'VIPs');
  });

  test('rejects a path-traversing tag ID', async () => {
    const res = await tags(['update', '../account', 'VIPs'], { tag: TAG });
    assert.equal(res.calls.length, 0);
    assert.equal(res.exitCode, 1);
  });
});

// ── tags remove-by-email ───────────────────────────────────────────────────

describe('tags remove-by-email', () => {
  test('DELETEs /tags/{tagId}/subscribers', async () => {
    const res = await tags(['remove-by-email', '8', 'ada@example.com'], { __status: 204 });
    const call = onlyCall(res);
    assert.equal(call.method, 'DELETE');
    assert.equal(call.path, '/v4/tags/8/subscribers');
  });

  test('identifies the subscriber with an email_address query parameter', async () => {
    const res = await tags(['remove-by-email', '8', 'ada@example.com'], { __status: 204 });
    assert.equal(onlyCall(res).query.email_address, 'ada@example.com');
  });

  test('sends no request body', async () => {
    const res = await tags(['remove-by-email', '8', 'ada@example.com'], { __status: 204 });
    assert.equal(onlyCall(res).body, undefined);
  });

  test('confirms the removal', async () => {
    const res = await tags(['remove-by-email', '8', 'ada@example.com'], { __status: 204 });
    assert.match(res.out, /removed from subscriber ada@example.com/);
  });

  test('leaves the by-ID variant on its own path', async () => {
    const res = await tags(['remove', '8', '41'], { __status: 204 });
    const call = onlyCall(res);
    assert.equal(call.path, '/v4/tags/8/subscribers/41');
    assert.deepEqual(call.query, {});
  });
});

// ── tags subscribers filters ───────────────────────────────────────────────

describe('tags subscribers', () => {
  test('requests GET /tags/{tagId}/subscribers', async () => {
    const res = await tags(['subscribers', '8'], { subscribers: [], pagination: {} });
    assert.equal(onlyCall(res).path, '/v4/tags/8/subscribers');
  });

  test('forwards the state filter as status', async () => {
    const res = await tags(['subscribers', '8', '--state', 'active'], { subscribers: [], pagination: {} });
    assert.equal(onlyCall(res).query.status, 'active');
  });

  test('rejects an unknown state', async () => {
    const res = await tags(['subscribers', '8', '--state', 'pending'], { subscribers: [] });
    assert.equal(res.calls.length, 0);
    assert.equal(res.exitCode, 1);
  });

  test('forwards the tagged date filters', async () => {
    const res = await tags(
      ['subscribers', '8', '--tagged-after', '2026-01-01', '--tagged-before', '2026-02-01'],
      { subscribers: [], pagination: {} }
    );
    const query = onlyCall(res).query;
    assert.equal(query.tagged_after, '2026-01-01');
    assert.equal(query.tagged_before, '2026-02-01');
  });

  test('forwards the created date filters', async () => {
    const res = await tags(
      ['subscribers', '8', '--created-after', '2026-01-01'],
      { subscribers: [], pagination: {} }
    );
    assert.equal(onlyCall(res).query.created_after, '2026-01-01');
  });

  test('omits the filters when they are not given', async () => {
    const res = await tags(['subscribers', '8'], { subscribers: [], pagination: {} });
    const query = onlyCall(res).query;
    for (const key of ['status', 'created_after', 'created_before', 'tagged_after', 'tagged_before']) {
      assert.ok(!(key in query), `unexpected query key: ${key}`);
    }
  });
});

// ── bulk tags delete ───────────────────────────────────────────────────────

describe('bulk tags delete', () => {
  test('DELETEs /bulk/tags', async () => {
    const path = tempJson([{ id: 1 }, { id: 2 }]);
    const res = await bulk(['tags', 'delete', '--file', path], { tags: [{ id: 1 }, { id: 2 }] });
    const call = onlyCall(res);
    assert.equal(call.method, 'DELETE');
    assert.equal(call.path, '/v4/bulk/tags');
  });

  test('sends the file contents under a tags key', async () => {
    const path = tempJson([{ id: 1 }, { id: 2 }]);
    const res = await bulk(['tags', 'delete', '--file', path], { tags: [] });
    assert.deepEqual(onlyCall(res).body, { tags: [{ id: 1 }, { id: 2 }] });
  });

  test('includes the callback URL when given', async () => {
    const path = tempJson([{ id: 1 }]);
    const res = await bulk(
      ['tags', 'delete', '--file', path, '--callback-url', 'https://example.com/hook'],
      { tags: [] }
    );
    assert.equal(onlyCall(res).body.callback_url, 'https://example.com/hook');
  });

  test('omits the callback URL when not given', async () => {
    const path = tempJson([{ id: 1 }]);
    const res = await bulk(['tags', 'delete', '--file', path], { tags: [] });
    assert.ok(!('callback_url' in onlyCall(res).body));
  });

  test('reports the success and failure counts', async () => {
    const path = tempJson([{ id: 1 }, { id: 2 }]);
    const res = await bulk(['tags', 'delete', '--file', path], {
      tags: [{ id: 1 }],
      failures: [{ id: 2, errors: ['Not found'] }],
    });
    assert.match(res.out, /1 succeeded, 1 failed/);
    assert.match(res.out, /Not found/);
  });

  test('reports an async queue when the response is empty', async () => {
    const path = tempJson([{ id: 1 }]);
    const res = await bulk(['tags', 'delete', '--file', path], {});
    assert.match(res.out, /Queued for async processing/);
  });

  test('reports a missing file clearly', async () => {
    const res = await bulk(['tags', 'delete', '--file', '/nope/missing.json'], {});
    assert.equal(res.calls.length, 0);
    assert.equal(res.exitCode, 1);
    assert.match(res.err, /Failed to read/);
  });

  test('does not disturb bulk tags create', async () => {
    const path = tempJson([{ name: 'vip' }]);
    const res = await bulk(['tags', 'create', '--file', path], { tags: [{ id: 1, name: 'vip' }] });
    const call = onlyCall(res);
    assert.equal(call.method, 'POST');
    assert.equal(call.path, '/v4/bulk/tags');
  });
});

// ── wiring ─────────────────────────────────────────────────────────────────

describe('tags command wiring', () => {
  test('keeps every pre-existing subcommand', () => {
    const cmd = tagsCommand();
    for (const name of ['list', 'create', 'subscribers', 'add', 'add-by-email', 'remove']) {
      assert.ok(findSubcommand(cmd, name), `missing subcommand: ${name}`);
    }
  });

  test('adds update and remove-by-email', () => {
    const cmd = tagsCommand();
    assert.ok(findSubcommand(cmd, 'update'));
    assert.ok(findSubcommand(cmd, 'remove-by-email'));
  });

  test('subscribers exposes the documented filters', () => {
    const flags = optionFlags(findSubcommand(tagsCommand(), 'subscribers'));
    for (const flag of ['--state', '--created-after', '--created-before', '--tagged-after', '--tagged-before']) {
      assert.ok(flags.includes(flag), `missing flag: ${flag}`);
    }
  });

  test('bulk tags exposes delete alongside the existing operations', () => {
    const cmd = bulkCommand();
    for (const name of ['create', 'add', 'remove', 'delete']) {
      assert.ok(findSubcommand(cmd, 'tags', name), `missing bulk tags subcommand: ${name}`);
    }
  });
});
