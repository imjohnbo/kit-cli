/**
 * Tests for src/completion.js and src/commands/completion.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { complete } from '../src/completion.js';
import { buildProgram } from '../src/program.js';

describe('complete', () => {
  test('suggests top-level commands matching the partial word', () => {
    const results = complete(buildProgram(), ['subscr']);
    assert.ok(results.includes('subscribers'));
    assert.ok(!results.includes('tags'));
  });

  test('suggests every top-level command for an empty partial', () => {
    const results = complete(buildProgram(), ['']);
    assert.ok(results.includes('login'));
    assert.ok(results.includes('subscribers'));
  });

  test('excludes the auto-generated help command', () => {
    assert.ok(!complete(buildProgram(), ['']).includes('help'));
  });

  test('excludes the internal __complete command', () => {
    assert.ok(!complete(buildProgram(), ['']).includes('__complete'));
  });

  test('descends into a matched subcommand', () => {
    const results = complete(buildProgram(), ['subscribers', 'l']);
    assert.ok(results.includes('list'));
    assert.ok(results.includes('location'));
    assert.ok(!results.includes('create'));
  });

  test('descends two levels deep', () => {
    const results = complete(buildProgram(), ['sequences', 'emails', 'cr']);
    assert.ok(results.includes('create'));
  });

  test('returns nothing once a word does not match any known subcommand', () => {
    assert.deepEqual(complete(buildProgram(), ['not-a-real-command', 'x']), []);
  });

  test('suggests matching option flags when the partial starts with a dash', () => {
    const results = complete(buildProgram(), ['subscribers', 'list', '--pe']);
    assert.ok(results.includes('--per-page'));
  });

  test('does not suggest flags for a non-dash partial', () => {
    const results = complete(buildProgram(), ['subscribers', 'list', 'pe']);
    assert.ok(!results.includes('--per-page'));
  });
});
