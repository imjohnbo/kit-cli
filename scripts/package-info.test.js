/**
 * Tests for src/package-info.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { USER_AGENT, VERSION } from '../src/package-info.js';

describe('USER_AGENT', () => {
  test('starts with kit-cli/<version>', () => {
    assert.ok(USER_AGENT.startsWith(`kit-cli/${VERSION} (`));
  });

  test('includes the running Node version', () => {
    assert.ok(USER_AGENT.includes(`node/${process.version}`));
  });

  test('includes the platform', () => {
    assert.ok(USER_AGENT.includes(process.platform));
  });

  test('is a single-line string with no stray whitespace', () => {
    assert.equal(USER_AGENT, USER_AGENT.trim());
    assert.ok(!USER_AGENT.includes('\n'));
  });
});
