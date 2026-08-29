/**
 * Tests for src/commands/webhooks.js
 *
 * Covers the current-generation /webhook_endpoints resource, exposed as
 * `kit webhooks`: list, get, create, update, delete, rotate-secret, and
 * revoke-previous-secret. The legacy /webhooks resource is intentionally
 * not exposed (see spec/coverage.js).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { webhooksCommand } from '../src/commands/webhooks.js';
import { runCommand, onlyCall, findSubcommand, optionFlags } from './helpers.js';

const WE = {
  id: 13,
  name: 'My webhook',
  url: 'https://hooks.example.com/incoming',
  events: ['subscriber.created'],
  status: 'active',
  source: 'creator',
  description: 'A test webhook',
  created_by_app: null,
  created_at: '2023-02-17T11:43:55Z',
  previous_secret_expires_at: null,
};

const run = (argv, responses) => runCommand(webhooksCommand, argv, { responses });

// ── list ─────────────────────────────────────────────────────────────────

describe('webhooks list', () => {
  test('GETs /webhook_endpoints', async () => {
    const res = await run(['list'], { webhook_endpoints: [WE], pagination: {} });
    const call = onlyCall(res);
    assert.equal(call.method, 'GET');
    assert.equal(call.path, '/v4/webhook_endpoints');
  });

  test('forwards the status filter', async () => {
    const res = await run(['list', '--status', 'disabled'], { webhook_endpoints: [], pagination: {} });
    assert.equal(onlyCall(res).query.status, 'disabled');
  });

  test('rejects an unknown status', async () => {
    const res = await run(['list', '--status', 'paused'], { webhook_endpoints: [] });
    assert.equal(res.calls.length, 0);
    assert.equal(res.exitCode, 1);
  });
});

// ── get ──────────────────────────────────────────────────────────────────

describe('webhooks get', () => {
  test('GETs /webhook_endpoints/{id}', async () => {
    const res = await run(['get', '13'], { webhook_endpoint: WE });
    const call = onlyCall(res);
    assert.equal(call.method, 'GET');
    assert.equal(call.path, '/v4/webhook_endpoints/13');
  });

  test('rejects a path-traversing ID', async () => {
    const res = await run(['get', '../account'], { webhook_endpoint: WE });
    assert.equal(res.calls.length, 0);
    assert.equal(res.exitCode, 1);
  });

  test('--format json prints the endpoint object', async () => {
    const res = await run(['get', '13', '--format', 'json'], { webhook_endpoint: WE });
    assert.equal(JSON.parse(res.out).id, 13);
  });
});

// ── create ───────────────────────────────────────────────────────────────

describe('webhooks create', () => {
  test('POSTs to /webhook_endpoints', async () => {
    const res = await run(
      ['create', 'https://hooks.example.com/incoming', 'subscriber.created,custom_field.created'],
      { webhook_endpoint: { ...WE, secret: 'whsec_abc' } }
    );
    const call = onlyCall(res);
    assert.equal(call.method, 'POST');
    assert.equal(call.path, '/v4/webhook_endpoints');
  });

  test('splits the events argument into an array', async () => {
    const res = await run(
      ['create', 'https://hooks.example.com/incoming', 'subscriber.created,custom_field.created'],
      { webhook_endpoint: { ...WE, secret: 'whsec_abc' } }
    );
    assert.deepEqual(onlyCall(res).body, {
      url: 'https://hooks.example.com/incoming',
      events: ['subscriber.created', 'custom_field.created'],
    });
  });

  test('includes name and description when given', async () => {
    const res = await run(
      [
        'create',
        'https://hooks.example.com/incoming',
        'subscriber.created',
        '--name',
        'My webhook',
        '--description',
        'Listens for things',
      ],
      { webhook_endpoint: { ...WE, secret: 'whsec_abc' } }
    );
    const body = onlyCall(res).body;
    assert.equal(body.name, 'My webhook');
    assert.equal(body.description, 'Listens for things');
  });

  test('rejects an invalid URL', async () => {
    const res = await run(['create', 'not-a-url', 'subscriber.created'], {});
    assert.equal(res.calls.length, 0);
    assert.equal(res.exitCode, 1);
  });

  test('warns that the secret is shown only once', async () => {
    const res = await run(
      ['create', 'https://hooks.example.com/incoming', 'subscriber.created'],
      { webhook_endpoint: { ...WE, secret: 'whsec_abc' } }
    );
    assert.match(res.out, /will not be shown again/);
  });

  test('omits the secret warning under --format json', async () => {
    const res = await run(
      ['create', 'https://hooks.example.com/incoming', 'subscriber.created', '--format', 'json'],
      { webhook_endpoint: { ...WE, secret: 'whsec_abc' } }
    );
    assert.doesNotMatch(res.out, /will not be shown again/);
    assert.equal(JSON.parse(res.out).secret, 'whsec_abc');
  });
});

// ── update ───────────────────────────────────────────────────────────────

describe('webhooks update', () => {
  test('PATCHes /webhook_endpoints/{id}', async () => {
    const res = await run(['update', '13', '--status', 'disabled'], {
      webhook_endpoint: { ...WE, status: 'disabled' },
    });
    const call = onlyCall(res);
    assert.equal(call.method, 'PATCH');
    assert.equal(call.path, '/v4/webhook_endpoints/13');
  });

  test('sends only the fields that were passed', async () => {
    const res = await run(['update', '13', '--name', 'Renamed'], {
      webhook_endpoint: { ...WE, name: 'Renamed' },
    });
    assert.deepEqual(onlyCall(res).body, { name: 'Renamed' });
  });

  test('splits --events into an array', async () => {
    const res = await run(['update', '13', '--events', 'subscriber.created,tag.added'], {
      webhook_endpoint: WE,
    });
    assert.deepEqual(onlyCall(res).body.events, ['subscriber.created', 'tag.added']);
  });

  test('validates --status', async () => {
    const res = await run(['update', '13', '--status', 'paused'], { webhook_endpoint: WE });
    assert.equal(res.calls.length, 0);
    assert.equal(res.exitCode, 1);
  });

  test('validates --url', async () => {
    const res = await run(['update', '13', '--url', 'not-a-url'], { webhook_endpoint: WE });
    assert.equal(res.calls.length, 0);
    assert.equal(res.exitCode, 1);
  });

  test('rejects an update with no fields', async () => {
    const res = await run(['update', '13'], { webhook_endpoint: WE });
    assert.equal(res.calls.length, 0);
    assert.equal(res.exitCode, 1);
    assert.match(res.err, /Nothing to update/);
  });
});

// ── delete ───────────────────────────────────────────────────────────────

describe('webhooks delete', () => {
  test('DELETEs /webhook_endpoints/{id}', async () => {
    const res = await run(['delete', '13'], { __status: 204 });
    const call = onlyCall(res);
    assert.equal(call.method, 'DELETE');
    assert.equal(call.path, '/v4/webhook_endpoints/13');
  });

  test('confirms the deletion', async () => {
    const res = await run(['delete', '13'], { __status: 204 });
    assert.match(res.out, /Webhook 13 deleted/);
  });
});

// ── rotate-secret ────────────────────────────────────────────────────────

describe('webhooks rotate-secret', () => {
  test('POSTs to the rotate_secret endpoint', async () => {
    const res = await run(['rotate-secret', '13'], {
      webhook_endpoint: { ...WE, secret: 'whsec_new' },
    });
    const call = onlyCall(res);
    assert.equal(call.method, 'POST');
    assert.equal(call.path, '/v4/webhook_endpoints/13/rotate_secret');
  });

  test('sends no body without --force', async () => {
    const res = await run(['rotate-secret', '13'], {
      webhook_endpoint: { ...WE, secret: 'whsec_new' },
    });
    assert.equal(onlyCall(res).body, undefined);
  });

  test('sends force: true with --force', async () => {
    const res = await run(['rotate-secret', '13', '--force'], {
      webhook_endpoint: { ...WE, secret: 'whsec_new' },
    });
    assert.deepEqual(onlyCall(res).body, { force: true });
  });

  test('warns that the new secret is shown only once', async () => {
    const res = await run(['rotate-secret', '13'], {
      webhook_endpoint: { ...WE, secret: 'whsec_new' },
    });
    assert.match(res.out, /will not be shown again/);
  });
});

// ── revoke-previous-secret ───────────────────────────────────────────────

describe('webhooks revoke-previous-secret', () => {
  test('POSTs to the revoke_previous_secret endpoint with no body', async () => {
    const res = await run(['revoke-previous-secret', '13'], { webhook_endpoint: WE });
    const call = onlyCall(res);
    assert.equal(call.method, 'POST');
    assert.equal(call.path, '/v4/webhook_endpoints/13/revoke_previous_secret');
    assert.equal(call.body, undefined);
  });

  test('confirms the revocation', async () => {
    const res = await run(['revoke-previous-secret', '13'], { webhook_endpoint: WE });
    assert.match(res.out, /Previous secret revoked for webhook 13/);
  });
});

// ── wiring ───────────────────────────────────────────────────────────────

describe('webhooks command wiring', () => {
  test('exposes every subcommand', () => {
    const cmd = webhooksCommand();
    for (const name of [
      'list',
      'get',
      'create',
      'update',
      'delete',
      'rotate-secret',
      'revoke-previous-secret',
    ]) {
      assert.ok(findSubcommand(cmd, name), `missing subcommand: ${name}`);
    }
  });

  test('list exposes the status filter', () => {
    const flags = optionFlags(findSubcommand(webhooksCommand(), 'list'));
    assert.ok(flags.includes('--status'));
  });

  test('update exposes every documented field', () => {
    const flags = optionFlags(findSubcommand(webhooksCommand(), 'update'));
    for (const flag of ['--name', '--url', '--description', '--status', '--events']) {
      assert.ok(flags.includes(flag), `missing flag: ${flag}`);
    }
  });
});
