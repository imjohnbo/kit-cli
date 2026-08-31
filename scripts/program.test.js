/**
 * Tests for src/program.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Command } from 'commander';
import { buildProgram, commandPath, commandPaths } from '../src/program.js';

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
