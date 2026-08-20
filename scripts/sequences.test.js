/**
 * Tests for src/commands/sequences.js and src/commands/sequence-emails.js
 *
 * Covers the sequence CRUD endpoints added in issue #4 and the sequence email
 * CRUD endpoints added in issue #6.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { sequencesCommand } from '../src/commands/sequences.js';
import { runCommand, onlyCall, findSubcommand, optionFlags } from './helpers.js';

const SEQUENCE = {
  id: 23,
  name: 'Welcome sequence',
  hold: false,
  repeat: false,
  created_at: '2026-02-17T11:43:55Z',
  updated_at: '2026-02-17T11:43:55Z',
  email_address: null,
  email_template_id: null,
  send_days: ['monday', 'tuesday'],
  send_hour: 11,
  time_zone: 'America/New_York',
  active: true,
  exclude_subscriber_sources: [],
  email_count: 3,
  subscriber_count: 42,
};

const EMAIL = {
  id: 7,
  sequence_id: 23,
  subject: 'Day one',
  preview_text: 'Welcome aboard',
  email_address: 'hi@example.com',
  email_template_id: null,
  published: true,
  position: 0,
  delay_value: 2,
  delay_unit: 'days',
  send_days: ['monday'],
  content: '<p>hello</p>',
};

const run = (argv, responses) => runCommand(sequencesCommand, argv, { responses });

// ── sequences list ─────────────────────────────────────────────────────────

describe('sequences list', () => {
  test('requests GET /sequences', async () => {
    const res = await run(['list'], { sequences: [SEQUENCE], pagination: {} });
    const call = onlyCall(res);
    assert.equal(call.method, 'GET');
    assert.equal(call.path, '/v4/sequences');
  });

  test('passes --include through as a query parameter', async () => {
    const res = await run(['list', '--include', 'stats'], { sequences: [], pagination: {} });
    assert.equal(onlyCall(res).query.include, 'stats');
  });

  test('renders the active and subscriber count columns', async () => {
    const res = await run(['list'], { sequences: [SEQUENCE], pagination: {} });
    assert.match(res.out, /Active/);
    assert.match(res.out, /Subscribers/);
    assert.match(res.out, /42/);
  });
});

// ── sequences get ──────────────────────────────────────────────────────────

describe('sequences get', () => {
  test('requests GET /sequences/{id}', async () => {
    const res = await run(['get', '23'], { sequence: SEQUENCE });
    const call = onlyCall(res);
    assert.equal(call.method, 'GET');
    assert.equal(call.path, '/v4/sequences/23');
  });

  test('passes --include through as a query parameter', async () => {
    const res = await run(['get', '23', '--include', 'stats'], { sequence: SEQUENCE });
    assert.equal(onlyCall(res).query.include, 'stats');
  });

  test('prints the sequence detail fields', async () => {
    const res = await run(['get', '23'], { sequence: SEQUENCE });
    assert.match(res.out, /Welcome sequence/);
    assert.match(res.out, /America\/New_York/);
    assert.match(res.out, /monday, tuesday/);
  });

  test('prints the stats block when the response includes stats', async () => {
    const res = await run(['get', '23'], {
      sequence: { ...SEQUENCE, stats: { recipients: 100, opens: 40, open_rate: 40.0 } },
    });
    assert.match(res.out, /Recipients/);
    assert.match(res.out, /Open Rate/);
  });

  test('omits the stats block when the response has no stats', async () => {
    const res = await run(['get', '23'], { sequence: SEQUENCE });
    assert.doesNotMatch(res.out, /Recipients/);
  });

  test('rejects a path-traversing ID', async () => {
    const res = await run(['get', '../account'], { sequence: SEQUENCE });
    assert.equal(res.calls.length, 0);
    assert.equal(res.exitCode, 1);
  });
});

// ── sequences create ───────────────────────────────────────────────────────

describe('sequences create', () => {
  test('POSTs to /sequences with the name', async () => {
    const res = await run(['create', '--name', 'Onboarding'], { sequence: SEQUENCE });
    const call = onlyCall(res);
    assert.equal(call.method, 'POST');
    assert.equal(call.path, '/v4/sequences');
    assert.equal(call.body.name, 'Onboarding');
  });

  test('sends only the fields the user set', async () => {
    const res = await run(['create', '--name', 'Onboarding'], { sequence: SEQUENCE });
    assert.deepEqual(Object.keys(onlyCall(res).body), ['name']);
  });

  test('maps --send-days to a lowercase array', async () => {
    const res = await run(
      ['create', '--name', 'X', '--send-days', 'Monday, friday'],
      { sequence: SEQUENCE }
    );
    assert.deepEqual(onlyCall(res).body.send_days, ['monday', 'friday']);
  });

  test('rejects an unknown send day', async () => {
    const res = await run(['create', '--name', 'X', '--send-days', 'funday'], { sequence: SEQUENCE });
    assert.equal(res.calls.length, 0);
    assert.equal(res.exitCode, 1);
    assert.match(res.err, /funday/);
  });

  test('sends send_hour as a number', async () => {
    const res = await run(['create', '--name', 'X', '--send-hour', '9'], { sequence: SEQUENCE });
    assert.equal(onlyCall(res).body.send_hour, 9);
  });

  test('accepts send hour 0', async () => {
    const res = await run(['create', '--name', 'X', '--send-hour', '0'], { sequence: SEQUENCE });
    assert.equal(onlyCall(res).body.send_hour, 0);
  });

  test('rejects a send hour above 23', async () => {
    const res = await run(['create', '--name', 'X', '--send-hour', '24'], { sequence: SEQUENCE });
    assert.equal(res.calls.length, 0);
    assert.equal(res.exitCode, 1);
  });

  test('--active sends active true', async () => {
    const res = await run(['create', '--name', 'X', '--active'], { sequence: SEQUENCE });
    assert.equal(onlyCall(res).body.active, true);
  });

  test('--no-active sends active false', async () => {
    const res = await run(['create', '--name', 'X', '--no-active'], { sequence: SEQUENCE });
    assert.equal(onlyCall(res).body.active, false);
  });

  test('omits active when neither flag is given', async () => {
    const res = await run(['create', '--name', 'X'], { sequence: SEQUENCE });
    assert.ok(!('active' in onlyCall(res).body));
  });

  test('builds exclude_subscriber_sources from the exclude flags', async () => {
    const res = await run(
      ['create', '--name', 'X', '--exclude-tag-ids', '1,2', '--exclude-form-ids', '9'],
      { sequence: SEQUENCE }
    );
    assert.deepEqual(onlyCall(res).body.exclude_subscriber_sources, [
      { type: 'tag', ids: [1, 2] },
      { type: 'form', ids: [9] },
    ]);
  });

  test('rejects a non-numeric exclude ID', async () => {
    const res = await run(['create', '--name', 'X', '--exclude-tag-ids', 'abc'], { sequence: SEQUENCE });
    assert.equal(res.calls.length, 0);
    assert.equal(res.exitCode, 1);
  });

  test('reports the new sequence ID', async () => {
    const res = await run(['create', '--name', 'X'], { sequence: SEQUENCE });
    assert.match(res.out, /Sequence created: 23/);
  });
});

// ── sequences update ───────────────────────────────────────────────────────

describe('sequences update', () => {
  test('PUTs to /sequences/{id}', async () => {
    const res = await run(['update', '23', '--name', 'Renamed'], { sequence: SEQUENCE });
    const call = onlyCall(res);
    assert.equal(call.method, 'PUT');
    assert.equal(call.path, '/v4/sequences/23');
    assert.deepEqual(call.body, { name: 'Renamed' });
  });

  test('does not clobber fields the user did not mention', async () => {
    const res = await run(['update', '23', '--send-hour', '6'], { sequence: SEQUENCE });
    assert.deepEqual(Object.keys(onlyCall(res).body), ['send_hour']);
  });

  test('refuses an update with no fields', async () => {
    const res = await run(['update', '23'], { sequence: SEQUENCE });
    assert.equal(res.calls.length, 0);
    assert.equal(res.exitCode, 1);
    assert.match(res.err, /Nothing to update/);
  });

  test('--no-hold sends hold false', async () => {
    const res = await run(['update', '23', '--no-hold'], { sequence: SEQUENCE });
    assert.equal(onlyCall(res).body.hold, false);
  });
});

// ── sequences delete ───────────────────────────────────────────────────────

describe('sequences delete', () => {
  test('DELETEs /sequences/{id}', async () => {
    const res = await run(['delete', '23'], { __status: 204 });
    const call = onlyCall(res);
    assert.equal(call.method, 'DELETE');
    assert.equal(call.path, '/v4/sequences/23');
  });

  test('confirms the deletion', async () => {
    const res = await run(['delete', '23'], { __status: 204 });
    assert.match(res.out, /Sequence 23 deleted/);
  });

  test('sends no request body', async () => {
    const res = await run(['delete', '23'], { __status: 204 });
    assert.equal(onlyCall(res).body, undefined);
  });
});

// ── sequences emails list ──────────────────────────────────────────────────

describe('sequences emails list', () => {
  test('requests GET /sequences/{id}/emails', async () => {
    const res = await run(['emails', 'list', '23'], { emails: [EMAIL], pagination: {} });
    const call = onlyCall(res);
    assert.equal(call.method, 'GET');
    assert.equal(call.path, '/v4/sequences/23/emails');
  });

  test('--include-content sets include_content=true', async () => {
    const res = await run(['emails', 'list', '23', '--include-content'], { emails: [], pagination: {} });
    assert.equal(onlyCall(res).query.include_content, 'true');
  });

  test('omits include_content when the flag is absent', async () => {
    const res = await run(['emails', 'list', '23'], { emails: [], pagination: {} });
    assert.ok(!('include_content' in onlyCall(res).query));
  });

  test('renders the delay as a value and unit', async () => {
    const res = await run(['emails', 'list', '23'], { emails: [EMAIL], pagination: {} });
    assert.match(res.out, /2 days/);
  });
});

// ── sequences emails get ───────────────────────────────────────────────────

describe('sequences emails get', () => {
  test('requests GET /sequences/{sequenceId}/emails/{id}', async () => {
    const res = await run(['emails', 'get', '23', '7'], { email: EMAIL });
    assert.equal(onlyCall(res).path, '/v4/sequences/23/emails/7');
  });

  test('prints the stats block when present', async () => {
    const res = await run(['emails', 'get', '23', '7'], {
      email: { ...EMAIL, stats: { recipients: 10, opens: 5 } },
    });
    assert.match(res.out, /Recipients/);
  });

  test('rejects a path-traversing sequence ID', async () => {
    const res = await run(['emails', 'get', '../../account', '7'], { email: EMAIL });
    assert.equal(res.calls.length, 0);
    assert.equal(res.exitCode, 1);
  });
});

// ── sequences emails create ────────────────────────────────────────────────

describe('sequences emails create', () => {
  test('POSTs to /sequences/{id}/emails', async () => {
    const res = await run(
      ['emails', 'create', '23', '--subject', 'Day one', '--delay-value', '2', '--delay-unit', 'days'],
      { email: EMAIL }
    );
    const call = onlyCall(res);
    assert.equal(call.method, 'POST');
    assert.equal(call.path, '/v4/sequences/23/emails');
  });

  test('sends the three required fields', async () => {
    const res = await run(
      ['emails', 'create', '23', '--subject', 'Day one', '--delay-value', '2', '--delay-unit', 'days'],
      { email: EMAIL }
    );
    assert.deepEqual(onlyCall(res).body, {
      subject: 'Day one',
      delay_value: 2,
      delay_unit: 'days',
    });
  });

  test('sends delay_value as a number', async () => {
    const res = await run(
      ['emails', 'create', '23', '--subject', 'S', '--delay-value', '5', '--delay-unit', 'hours'],
      { email: EMAIL }
    );
    assert.equal(typeof onlyCall(res).body.delay_value, 'number');
  });

  test('rejects an unknown delay unit', async () => {
    const res = await run(
      ['emails', 'create', '23', '--subject', 'S', '--delay-value', '1', '--delay-unit', 'weeks'],
      { email: EMAIL }
    );
    assert.equal(res.calls.length, 0);
    assert.equal(res.exitCode, 1);
    assert.match(res.err, /weeks/);
  });

  test('--published sends published true', async () => {
    const res = await run(
      ['emails', 'create', '23', '--subject', 'S', '--delay-value', '1', '--delay-unit', 'days', '--published'],
      { email: EMAIL }
    );
    assert.equal(onlyCall(res).body.published, true);
  });

  test('accepts position zero', async () => {
    const res = await run(
      ['emails', 'create', '23', '--subject', 'S', '--delay-value', '1', '--delay-unit', 'days', '--position', '0'],
      { email: EMAIL }
    );
    assert.equal(onlyCall(res).body.position, 0);
  });
});

// ── sequences emails update and delete ─────────────────────────────────────

describe('sequences emails update', () => {
  test('PUTs to /sequences/{sequenceId}/emails/{id}', async () => {
    const res = await run(['emails', 'update', '23', '7', '--subject', 'New'], { email: EMAIL });
    const call = onlyCall(res);
    assert.equal(call.method, 'PUT');
    assert.equal(call.path, '/v4/sequences/23/emails/7');
    assert.deepEqual(call.body, { subject: 'New' });
  });

  test('refuses an update with no fields', async () => {
    const res = await run(['emails', 'update', '23', '7'], { email: EMAIL });
    assert.equal(res.calls.length, 0);
    assert.equal(res.exitCode, 1);
  });

  test('--no-published sends published false', async () => {
    const res = await run(['emails', 'update', '23', '7', '--no-published'], { email: EMAIL });
    assert.equal(onlyCall(res).body.published, false);
  });
});

describe('sequences emails delete', () => {
  test('DELETEs /sequences/{sequenceId}/emails/{id}', async () => {
    const res = await run(['emails', 'delete', '23', '7'], { __status: 204 });
    const call = onlyCall(res);
    assert.equal(call.method, 'DELETE');
    assert.equal(call.path, '/v4/sequences/23/emails/7');
  });
});

// ── command wiring ─────────────────────────────────────────────────────────

describe('sequences command wiring', () => {
  test('keeps the pre-existing subcommands', () => {
    const cmd = sequencesCommand();
    for (const name of ['list', 'subscribers', 'add', 'add-by-email']) {
      assert.ok(findSubcommand(cmd, name), `missing subcommand: ${name}`);
    }
  });

  test('adds the CRUD subcommands', () => {
    const cmd = sequencesCommand();
    for (const name of ['get', 'create', 'update', 'delete']) {
      assert.ok(findSubcommand(cmd, name), `missing subcommand: ${name}`);
    }
  });

  test('nests the emails subcommands under sequences', () => {
    const cmd = sequencesCommand();
    for (const name of ['list', 'get', 'create', 'update', 'delete']) {
      assert.ok(findSubcommand(cmd, 'emails', name), `missing emails subcommand: ${name}`);
    }
  });

  test('create exposes every writable sequence field', () => {
    const flags = optionFlags(findSubcommand(sequencesCommand(), 'create'));
    for (const flag of [
      '--name', '--email-address', '--email-template-id', '--send-days',
      '--send-hour', '--time-zone', '--active', '--repeat', '--hold',
    ]) {
      assert.ok(flags.includes(flag), `missing flag: ${flag}`);
    }
  });

  test('emails create requires subject, delay value, and delay unit', () => {
    const cmd = findSubcommand(sequencesCommand(), 'emails', 'create');
    const required = cmd.options.filter((o) => o.mandatory).map((o) => o.long);
    assert.deepEqual(required.sort(), ['--delay-unit', '--delay-value', '--subject']);
  });
});
