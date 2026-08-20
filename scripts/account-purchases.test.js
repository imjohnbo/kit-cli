/**
 * Tests for the account and purchases commands.
 *
 * Issue #12 named nine endpoints in these two families. Four account endpoints
 * and the purchase create endpoint had no CLI command at all, and the account
 * detail output read a plan field the API does not return.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { accountCommand } from '../src/commands/account.js';
import { purchasesCommand } from '../src/commands/purchases.js';
import { runCommand, onlyCall, findSubcommand } from './helpers.js';

const ACCOUNT_RESPONSE = {
  user: { email: 'ada@example.com', id: 29 },
  account: {
    id: 29,
    name: 'Kit Greetings',
    plan_type: 'creator',
    primary_email_address: 'ada@example.com',
    created_at: '2026-02-17T11:43:55Z',
    timezone: { name: 'America/New_York', friendly_name: 'Eastern Time', utc_offset: '-05:00' },
    sending_addresses: [
      { email_address: 'joe@example.com', from_name: 'Joe', status: 'pending', is_default: true, is_verified: false, is_dmarc_configured: false },
    ],
    plan: {
      plan_type: 'creator',
      interval: 'month',
      subscriber_limit: 1000,
      on_trial: false,
      trial_lapse_date: null,
      renews_at: '2026-03-17T11:43:55Z',
      cancels_at: null,
    },
  },
};

const VALID_PURCHASE = {
  email_address: 'ada@example.com',
  transaction_id: 'txn-1',
  status: 'paid',
  subtotal: 10.0,
  tax: 1.0,
  shipping: 0,
  discount: 0.0,
  total: 11.0,
  currency: 'USD',
  transaction_time: '2026-03-01T10:00:00Z',
  products: [{ name: 'Book', pid: 'p1', lid: 'l1', quantity: 1, unit_price: 10.0, sku: 'sku1' }],
};

const account = (argv, responses) => runCommand(accountCommand, argv, { responses });
const purchases = (argv, responses) => runCommand(purchasesCommand, argv, { responses });

function tempJson(value) {
  const dir = mkdtempSync(join(tmpdir(), 'kit-cli-test-'));
  const path = join(dir, 'purchase.json');
  writeFileSync(path, JSON.stringify(value));
  return path;
}

// ── account ────────────────────────────────────────────────────────────────

describe('account', () => {
  test('requests GET /account', async () => {
    const res = await account([], ACCOUNT_RESPONSE);
    const call = onlyCall(res);
    assert.equal(call.method, 'GET');
    assert.equal(call.path, '/v4/account');
  });

  test('prints the plan from plan_type', async () => {
    const res = await account([], ACCOUNT_RESPONSE);
    const planLine = res.logs.find((l) => l.startsWith('Plan'));
    assert.match(planLine, /creator/);
  });

  test('never prints a stringified plan object', async () => {
    const res = await account([], ACCOUNT_RESPONSE);
    assert.doesNotMatch(res.out, /\[object Object\]/);
  });

  test('prints the billing details from the nested plan object', async () => {
    const res = await account([], ACCOUNT_RESPONSE);
    assert.match(res.out, /Billing Interval/);
    assert.match(res.out, /month/);
    assert.match(res.out, /1000/);
  });

  test('prints the time zone name', async () => {
    const res = await account([], ACCOUNT_RESPONSE);
    assert.match(res.out, /America\/New_York/);
  });

  test('marks the default sending address and flags unverified ones', async () => {
    const res = await account([], ACCOUNT_RESPONSE);
    const line = res.logs.find((l) => l.includes('joe@example.com'));
    assert.match(line, /\(default\)/);
    assert.match(line, /\[unverified\]/);
  });
});

describe('account colors', () => {
  test('requests GET /account/colors', async () => {
    const res = await account(['colors'], { colors: ['#fff', '#123456'] });
    const call = onlyCall(res);
    assert.equal(call.method, 'GET');
    assert.equal(call.path, '/v4/account/colors');
  });

  test('renders one row per color', async () => {
    const res = await account(['colors'], { colors: ['#fff', '#123456'] });
    assert.match(res.out, /#fff/);
    assert.match(res.out, /#123456/);
    assert.match(res.out, /2 result/);
  });
});

describe('account set-colors', () => {
  test('PUTs the colors to /account/colors', async () => {
    const res = await account(['set-colors', '#fff', '#123456'], { colors: ['#fff', '#123456'] });
    const call = onlyCall(res);
    assert.equal(call.method, 'PUT');
    assert.equal(call.path, '/v4/account/colors');
    assert.deepEqual(call.body, { colors: ['#fff', '#123456'] });
  });

  test('accepts three-digit and six-digit hex codes', async () => {
    const res = await account(['set-colors', '#ABC', '#aabbcc'], { colors: [] });
    assert.equal(res.calls.length, 1);
  });

  test('rejects a value that is not a hex color', async () => {
    const res = await account(['set-colors', 'red'], { colors: [] });
    assert.equal(res.calls.length, 0);
    assert.equal(res.exitCode, 1);
    assert.match(res.err, /red/);
  });

  test('rejects a hex code without the leading hash', async () => {
    const res = await account(['set-colors', 'ffffff'], { colors: [] });
    assert.equal(res.calls.length, 0);
    assert.equal(res.exitCode, 1);
  });

  test('rejects more than ten colors', async () => {
    const eleven = Array.from({ length: 11 }, (_, i) => `#00000${i % 10}`);
    const res = await account(['set-colors', ...eleven], { colors: [] });
    assert.equal(res.calls.length, 0);
    assert.equal(res.exitCode, 1);
    assert.match(res.err, /at most 10/);
  });

  test('accepts exactly ten colors', async () => {
    const ten = Array.from({ length: 10 }, (_, i) => `#00000${i}`);
    const res = await account(['set-colors', ...ten], { colors: ten });
    assert.equal(res.calls.length, 1);
  });

  test('confirms the update', async () => {
    const res = await account(['set-colors', '#fff'], { colors: ['#fff'] });
    assert.match(res.out, /Brand colors updated/);
  });
});

describe('account creator-profile', () => {
  test('requests GET /account/creator_profile', async () => {
    const res = await account(['creator-profile'], { profile: { name: 'Ada', byline: 'Writer', bio: 'Hi', image_url: 'u', profile_url: 'p' } });
    assert.equal(onlyCall(res).path, '/v4/account/creator_profile');
  });

  test('prints the byline', async () => {
    const res = await account(['creator-profile'], { profile: { name: 'Ada', byline: 'Writer' } });
    assert.match(res.out, /Writer/);
  });
});

describe('account email-stats', () => {
  test('requests GET /account/email_stats', async () => {
    const res = await account(['email-stats'], { stats: { sent: 10, opened: 5, clicked: 2 } });
    assert.equal(onlyCall(res).path, '/v4/account/email_stats');
  });

  test('prints the send and open counts', async () => {
    const res = await account(['email-stats'], { stats: { sent: 10, opened: 5, open_rate: 50.0 } });
    assert.match(res.out, /Sent/);
    assert.match(res.out, /10/);
    assert.match(res.out, /50/);
  });
});

describe('account growth-stats', () => {
  test('requests GET /account/growth_stats', async () => {
    const res = await account(['growth-stats'], { stats: { subscribers: 100, new_subscribers: 10, cancellations: 1, net_new_subscribers: 9 } });
    assert.equal(onlyCall(res).path, '/v4/account/growth_stats');
  });

  test('forwards the reporting window', async () => {
    const res = await account(
      ['growth-stats', '--starting', '2026-01-01', '--ending', '2026-02-01'],
      { stats: {} }
    );
    const query = onlyCall(res).query;
    assert.equal(query.starting, '2026-01-01');
    assert.equal(query.ending, '2026-02-01');
  });

  test('omits the window when not given', async () => {
    const res = await account(['growth-stats'], { stats: {} });
    assert.deepEqual(onlyCall(res).query, {});
  });
});

// ── purchases create ───────────────────────────────────────────────────────

describe('purchases create', () => {
  test('POSTs to /purchases', async () => {
    const path = tempJson(VALID_PURCHASE);
    const res = await purchases(['create', '--file', path], { purchase: { id: 1, ...VALID_PURCHASE } });
    const call = onlyCall(res);
    assert.equal(call.method, 'POST');
    assert.equal(call.path, '/v4/purchases');
  });

  test('wraps a bare purchase object in a purchase key', async () => {
    const path = tempJson(VALID_PURCHASE);
    const res = await purchases(['create', '--file', path], { purchase: { id: 1 } });
    assert.deepEqual(onlyCall(res).body, { purchase: VALID_PURCHASE });
  });

  test('accepts a body that already has the purchase key', async () => {
    const path = tempJson({ purchase: VALID_PURCHASE });
    const res = await purchases(['create', '--file', path], { purchase: { id: 1 } });
    assert.deepEqual(onlyCall(res).body, { purchase: VALID_PURCHASE });
  });

  test('names the missing required fields', async () => {
    const { total, currency, ...rest } = VALID_PURCHASE;
    const path = tempJson(rest);
    const res = await purchases(['create', '--file', path], {});
    assert.equal(res.calls.length, 0);
    assert.equal(res.exitCode, 1);
    assert.match(res.err, /total/);
    assert.match(res.err, /currency/);
  });

  test('rejects an empty products array', async () => {
    const path = tempJson({ ...VALID_PURCHASE, products: [] });
    const res = await purchases(['create', '--file', path], {});
    assert.equal(res.calls.length, 0);
    assert.equal(res.exitCode, 1);
    assert.match(res.err, /products/);
  });

  test('rejects a top-level array', async () => {
    const path = tempJson([VALID_PURCHASE]);
    const res = await purchases(['create', '--file', path], {});
    assert.equal(res.calls.length, 0);
    assert.equal(res.exitCode, 1);
  });

  test('reports a missing file clearly', async () => {
    const res = await purchases(['create', '--file', '/nope/missing.json'], {});
    assert.equal(res.calls.length, 0);
    assert.equal(res.exitCode, 1);
    assert.match(res.err, /Failed to read/);
  });

  test('accepts a zero amount, which is falsy but valid', async () => {
    const path = tempJson({ ...VALID_PURCHASE, discount: 0, shipping: 0, tax: 0 });
    const res = await purchases(['create', '--file', path], { purchase: { id: 1 } });
    assert.equal(res.calls.length, 1);
  });

  test('reports the new purchase ID', async () => {
    const path = tempJson(VALID_PURCHASE);
    const res = await purchases(['create', '--file', path], { purchase: { id: 77 } });
    assert.match(res.out, /Purchase recorded: 77/);
  });
});

// ── wiring ─────────────────────────────────────────────────────────────────

describe('command wiring', () => {
  test('account exposes the four endpoints it was missing', () => {
    const cmd = accountCommand();
    for (const name of ['colors', 'set-colors', 'creator-profile', 'email-stats']) {
      assert.ok(findSubcommand(cmd, name), `missing subcommand: ${name}`);
    }
  });

  test('account still works with no subcommand', () => {
    assert.equal(typeof accountCommand()._actionHandler, 'function');
  });

  test('purchases exposes list, get, and create', () => {
    const cmd = purchasesCommand();
    for (const name of ['list', 'get', 'create']) {
      assert.ok(findSubcommand(cmd, name), `missing subcommand: ${name}`);
    }
  });
});
