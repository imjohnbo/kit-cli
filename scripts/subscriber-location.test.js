/**
 * Tests for `kit subscribers location`, the three endpoints from issue #24.
 *
 * The API treats a pinned location as a whole: PATCH is a full replacement, not
 * a partial update, so both write commands require all six fields.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { subscribersCommand } from '../src/commands/subscribers.js';
import { runCommand, onlyCall, findSubcommand, optionFlags } from './helpers.js';

const RESPONSE = {
  subscriber: {
    id: 1100,
    location: {
      city: 'Boise',
      state_province: 'Idaho',
      country_code: 'US',
      latitude: 43.62,
      longitude: -116.2,
      timezone: 'America/Denver',
    },
  },
};

const FULL = [
  '--city', 'Boise',
  '--state-province', 'Idaho',
  '--country-code', 'US',
  '--latitude', '43.62',
  '--longitude', '-116.2',
  '--time-zone', 'America/Denver',
];

const run = (argv, responses) => runCommand(subscribersCommand, argv, { responses });

// ── pin ────────────────────────────────────────────────────────────────────

describe('subscribers location pin', () => {
  test('POSTs to /subscribers/{id}/location', async () => {
    const res = await run(['location', 'pin', '1100', ...FULL], RESPONSE);
    const call = onlyCall(res);
    assert.equal(call.method, 'POST');
    assert.equal(call.path, '/v4/subscribers/1100/location');
  });

  test('nests the fields under a location key', async () => {
    const res = await run(['location', 'pin', '1100', ...FULL], RESPONSE);
    assert.deepEqual(onlyCall(res).body, {
      location: {
        city: 'Boise',
        state_province: 'Idaho',
        country_code: 'US',
        latitude: 43.62,
        longitude: -116.2,
        timezone: 'America/Denver',
      },
    });
  });

  test('sends the coordinates as numbers, not strings', async () => {
    const res = await run(['location', 'pin', '1100', ...FULL], RESPONSE);
    const loc = onlyCall(res).body.location;
    assert.equal(typeof loc.latitude, 'number');
    assert.equal(typeof loc.longitude, 'number');
  });

  test('upper-cases the country code', async () => {
    const argv = ['location', 'pin', '1100', ...FULL];
    argv[argv.indexOf('US')] = 'us';
    const res = await run(argv, RESPONSE);
    assert.equal(onlyCall(res).body.location.country_code, 'US');
  });

  test('prints the pinned location back', async () => {
    const res = await run(['location', 'pin', '1100', ...FULL], RESPONSE);
    assert.match(res.out, /Boise/);
    assert.match(res.out, /America\/Denver/);
  });

  test('--format json prints only JSON', async () => {
    const res = await run(['location', 'pin', '1100', ...FULL, '--format', 'json'], RESPONSE);
    assert.deepEqual(JSON.parse(res.out), RESPONSE.subscriber);
  });
});

// ── validation ─────────────────────────────────────────────────────────────

describe('subscribers location validation', () => {
  /** FULL with one flag's value replaced. */
  function withValue(flag, value) {
    const argv = ['location', 'pin', '1100', ...FULL];
    argv[argv.indexOf(flag) + 1] = value;
    return argv;
  }

  test('rejects a latitude above 90', async () => {
    const res = await run(withValue('--latitude', '91'), RESPONSE);
    assert.equal(res.calls.length, 0);
    assert.equal(res.exitCode, 1);
    assert.match(res.err, /latitude/);
  });

  test('rejects a latitude below -90', async () => {
    const res = await run(withValue('--latitude', '-90.1'), RESPONSE);
    assert.equal(res.calls.length, 0);
    assert.equal(res.exitCode, 1);
  });

  test('accepts latitude zero, which is falsy but valid', async () => {
    const res = await run(withValue('--latitude', '0'), RESPONSE);
    assert.equal(onlyCall(res).body.location.latitude, 0);
  });

  test('rejects a longitude above 180', async () => {
    const res = await run(withValue('--longitude', '181'), RESPONSE);
    assert.equal(res.calls.length, 0);
    assert.equal(res.exitCode, 1);
  });

  test('accepts a longitude of -180', async () => {
    const res = await run(withValue('--longitude', '-180'), RESPONSE);
    assert.equal(onlyCall(res).body.location.longitude, -180);
  });

  test('rejects a non-numeric latitude', async () => {
    const res = await run(withValue('--latitude', 'north'), RESPONSE);
    assert.equal(res.calls.length, 0);
    assert.equal(res.exitCode, 1);
  });

  test('rejects a three-letter country code', async () => {
    const res = await run(withValue('--country-code', 'USA'), RESPONSE);
    assert.equal(res.calls.length, 0);
    assert.equal(res.exitCode, 1);
    assert.match(res.err, /two letters/);
  });

  test('rejects a country name', async () => {
    const res = await run(withValue('--country-code', 'United States'), RESPONSE);
    assert.equal(res.calls.length, 0);
    assert.equal(res.exitCode, 1);
  });

  test('rejects an unknown time zone', async () => {
    const res = await run(withValue('--time-zone', 'Mars/Olympus'), RESPONSE);
    assert.equal(res.calls.length, 0);
    assert.equal(res.exitCode, 1);
    assert.match(res.err, /IANA/);
  });

  test('rejects a UTC offset in place of a zone name', async () => {
    const res = await run(withValue('--time-zone', '-07:00'), RESPONSE);
    assert.equal(res.calls.length, 0);
    assert.equal(res.exitCode, 1);
  });

  test('accepts UTC', async () => {
    const res = await run(withValue('--time-zone', 'UTC'), RESPONSE);
    assert.equal(onlyCall(res).body.location.timezone, 'UTC');
  });

  test('rejects a path-traversing subscriber ID', async () => {
    const res = await run(['location', 'pin', '../account', ...FULL], RESPONSE);
    assert.equal(res.calls.length, 0);
    assert.equal(res.exitCode, 1);
  });

  for (const flag of ['--city', '--state-province', '--country-code', '--latitude', '--longitude', '--time-zone']) {
    test(`requires ${flag}`, async () => {
      const argv = ['location', 'pin', '1100', ...FULL];
      const i = argv.indexOf(flag);
      argv.splice(i, 2);
      const res = await run(argv, RESPONSE);
      assert.equal(res.calls.length, 0);
    });
  }
});

// ── update ─────────────────────────────────────────────────────────────────

describe('subscribers location update', () => {
  test('PATCHes /subscribers/{id}/location', async () => {
    const res = await run(['location', 'update', '1100', ...FULL], RESPONSE);
    const call = onlyCall(res);
    assert.equal(call.method, 'PATCH');
    assert.equal(call.path, '/v4/subscribers/1100/location');
  });

  test('sends every field, because the API replaces rather than merges', async () => {
    const res = await run(['location', 'update', '1100', ...FULL], RESPONSE);
    assert.deepEqual(Object.keys(onlyCall(res).body.location).sort(), [
      'city', 'country_code', 'latitude', 'longitude', 'state_province', 'timezone',
    ]);
  });

  test('requires the same six flags as pin', () => {
    const pin = findSubcommand(subscribersCommand(), 'location', 'pin');
    const update = findSubcommand(subscribersCommand(), 'location', 'update');
    const required = (c) => c.options.filter((o) => o.mandatory).map((o) => o.long).sort();
    assert.deepEqual(required(update), required(pin));
  });
});

// ── delete ─────────────────────────────────────────────────────────────────

describe('subscribers location delete', () => {
  test('DELETEs /subscribers/{id}/location', async () => {
    const res = await run(['location', 'delete', '1100'], { __status: 204 });
    const call = onlyCall(res);
    assert.equal(call.method, 'DELETE');
    assert.equal(call.path, '/v4/subscribers/1100/location');
  });

  test('sends no request body', async () => {
    const res = await run(['location', 'delete', '1100'], { __status: 204 });
    assert.equal(onlyCall(res).body, undefined);
  });

  test('confirms the removal', async () => {
    const res = await run(['location', 'delete', '1100'], { __status: 204 });
    assert.match(res.out, /Location removed for subscriber 1100/);
  });
});

// ── wiring ─────────────────────────────────────────────────────────────────

describe('location command wiring', () => {
  test('nests under subscribers', () => {
    assert.ok(findSubcommand(subscribersCommand(), 'location'));
  });

  test('exposes pin, update, and delete', () => {
    for (const name of ['pin', 'update', 'delete']) {
      assert.ok(findSubcommand(subscribersCommand(), 'location', name), `missing ${name}`);
    }
  });

  test('has no get, matching the API', () => {
    // Location comes back through `include=location` on list and filter, not
    // through an endpoint of its own.
    assert.equal(findSubcommand(subscribersCommand(), 'location', 'get'), undefined);
  });

  test('leaves the existing subscribers subcommands alone', () => {
    const cmd = subscribersCommand();
    for (const name of ['list', 'get', 'filter', 'create', 'update', 'unsubscribe', 'tags', 'stats']) {
      assert.ok(findSubcommand(cmd, name), `missing ${name}`);
    }
  });

  test('pin exposes exactly the six documented flags plus format', () => {
    const flags = optionFlags(findSubcommand(subscribersCommand(), 'location', 'pin')).sort();
    assert.deepEqual(flags, [
      '--city', '--country-code', '--format', '--latitude',
      '--longitude', '--state-province', '--time-zone',
    ]);
  });
});
