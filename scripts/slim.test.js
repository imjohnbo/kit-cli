/**
 * Tests for the slim list parameter.
 *
 * `slim=true` is a V4 query parameter on four list endpoints. In slim mode the
 * API omits expensive fields and skips the joins behind them, so it's both
 * smaller and faster. The Kit MCP server sends it by default; these tests hold
 * the CLI to the same default, with `--no-slim` as the way back to full
 * responses and `--slim` kept accepted for scripts that already pass it.
 *
 * The four endpoints, and what slim drops:
 *   GET /broadcasts                 content, public_url, email_address,
 *                                   email_template, subscriber_filter
 *   GET /subscribers                fields (custom field values)
 *   GET /tags/:id/subscribers       fields
 *   GET /forms/:id/subscribers      fields
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { broadcastsCommand } from '../src/commands/broadcasts.js';
import { subscribersCommand } from '../src/commands/subscribers.js';
import { tagsCommand } from '../src/commands/tags.js';
import { formsCommand } from '../src/commands/forms.js';
import { runCommand, onlyCall, findSubcommand, optionFlags } from './helpers.js';

/** Every list command that accepts slim, with the argv that invokes it. */
const CASES = [
  {
    label: 'broadcasts list',
    factory: broadcastsCommand,
    argv: ['list'],
    subcommand: 'list',
    path: '/v4/broadcasts',
    response: { broadcasts: [], pagination: {} },
  },
  {
    label: 'subscribers list',
    factory: subscribersCommand,
    argv: ['list'],
    subcommand: 'list',
    path: '/v4/subscribers',
    response: { subscribers: [], pagination: {} },
  },
  {
    label: 'tags subscribers',
    factory: tagsCommand,
    argv: ['subscribers', '7'],
    subcommand: 'subscribers',
    path: '/v4/tags/7/subscribers',
    response: { subscribers: [], pagination: {} },
  },
  {
    label: 'forms subscribers',
    factory: formsCommand,
    argv: ['subscribers', '7'],
    subcommand: 'subscribers',
    path: '/v4/forms/7/subscribers',
    response: { subscribers: [], pagination: {} },
  },
];

for (const { label, factory, argv, subcommand, path, response } of CASES) {
  describe(`${label} slim`, () => {
    const run = (extra = []) => runCommand(factory, [...argv, ...extra], { responses: response });

    test('sends slim=true by default', async () => {
      const call = onlyCall(await run());
      assert.equal(call.path, path);
      assert.equal(call.query.slim, 'true');
    });

    test('--slim sends slim=true', async () => {
      assert.equal(onlyCall(await run(['--slim'])).query.slim, 'true');
    });

    test('--no-slim omits the parameter, so the API returns full records', async () => {
      assert.ok(!('slim' in onlyCall(await run(['--no-slim'])).query));
    });

    test('exposes --slim and --no-slim', () => {
      const flags = optionFlags(findSubcommand(factory(), subcommand));
      assert.ok(flags.includes('--slim'), 'missing --slim');
      assert.ok(flags.includes('--no-slim'), 'missing --no-slim');
    });

    test('--slim is hidden from help, --no-slim is not', () => {
      const cmd = findSubcommand(factory(), subcommand);
      const byLong = (long) => cmd.options.find((o) => o.long === long);
      assert.equal(byLong('--slim').hidden, true);
      assert.ok(!byLong('--no-slim').hidden);
    });
  });
}
