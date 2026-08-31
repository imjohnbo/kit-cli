/**
 * Tests for src/program.js
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Command } from 'commander';
import { buildProgram, commandPath, commandPaths } from '../src/program.js';
import { getCurrentCommand, setCurrentCommand } from '../src/current-command.js';
import { runCommand } from './helpers.js';

describe('commandPaths', () => {
  test('lists a top-level command', () => {
    assert.ok(commandPaths(buildProgram()).includes('login'));
  });

  test('lists a nested subcommand, space-separated', () => {
    assert.ok(commandPaths(buildProgram()).includes('subscribers list'));
  });

  test('lists a doubly-nested subcommand', () => {
    assert.ok(commandPaths(buildProgram()).includes('sequences emails create'));
  });

  test('excludes a command literally named "help", even though the real tree never has one', () => {
    // Commander 13 stashes its own auto-generated help command in
    // `_helpCommand`, never in `.commands` — so this guard is never exercised
    // by the real tree. Build a synthetic one so the filter itself is
    // actually tested, not just its absence of effect.
    const root = new Command('root');
    root.addCommand(new Command('help'));
    root.addCommand(new Command('real'));
    assert.deepEqual(commandPaths(root), ['real']);
  });

  test('includes the api command', () => {
    assert.ok(commandPaths(buildProgram()).includes('api'));
  });
});

describe('commandPath', () => {
  test('returns a single-level path for a top-level command', () => {
    const login = buildProgram().commands.find((c) => c.name() === 'login');
    assert.equal(commandPath(login), 'login');
  });

  test('returns a space-separated path for a nested command', () => {
    const subscribers = buildProgram().commands.find((c) => c.name() === 'subscribers');
    const list = subscribers.commands.find((c) => c.name() === 'list');
    assert.equal(commandPath(list), 'subscribers list');
  });
});

describe('preAction hook', () => {
  // Independence is structural, not incidental: each test's expected value
  // is distinct today, but without a reset, a future test asserting a path
  // an earlier test already set would keep passing even with the hook
  // deleted.
  beforeEach(() => setCurrentCommand(''));

  test('records a top-level command before its action runs', async () => {
    await runCommand(buildProgram, ['logout']);
    assert.equal(getCurrentCommand(), 'logout');
  });

  test('records a nested subcommand path', async () => {
    await runCommand(buildProgram, ['tags', 'list'], { responses: { tags: [] } });
    assert.equal(getCurrentCommand(), 'tags list');
  });

  test('records a doubly-nested subcommand path', async () => {
    await runCommand(buildProgram, ['sequences', 'emails', 'list', '1'], { responses: { sequence_emails: [] } });
    assert.equal(getCurrentCommand(), 'sequences emails list');
  });

  test('is set before the action runs, not after', async () => {
    // The three tests above only assert *after* the command finishes, which
    // can't tell buildProgram()'s real preAction hook from a postAction hook
    // (or one that fires too late) — withErrorHandler needs the value
    // available from *inside* the running action, since that's where it
    // reads it. Captures getCurrentCommand() from inside the fetch call
    // `tags list`'s own action makes (via get('/tags') in client.js) — that
    // only happens while the action's body is still executing, so this
    // exercises the real, actual hook registration in buildProgram(), not a
    // reimplementation of it.
    const originalFetch = globalThis.fetch;
    const originalApiKey = process.env.KIT_API_KEY;
    process.env.KIT_API_KEY = 'test-key';
    let capturedDuringAction;
    globalThis.fetch = async () => {
      capturedDuringAction = getCurrentCommand();
      return { ok: true, status: 200, json: async () => ({ tags: [] }) };
    };
    try {
      const program = buildProgram();
      program.exitOverride();
      await program.parseAsync(['tags', 'list'], { from: 'user' });
    } finally {
      globalThis.fetch = originalFetch;
      if (originalApiKey === undefined) delete process.env.KIT_API_KEY;
      else process.env.KIT_API_KEY = originalApiKey;
    }
    assert.equal(capturedDuringAction, 'tags list');
  });
});
