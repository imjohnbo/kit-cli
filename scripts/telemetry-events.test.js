/**
 * Holds src/telemetry-events.js to the command tree, the same way
 * scripts/spec-coverage.test.js holds spec/coverage.js to the API spec: a
 * command added without an entry here fails a test until someone names its
 * event.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { EVENT_NAMES, NO_EVENT } from '../src/telemetry-events.js';
import { buildProgram, commandPaths } from '../src/program.js';

const COMMANDS = commandPaths(buildProgram());

describe('telemetry event coverage', () => {
  test('the tree has commands to check', () => {
    assert.ok(COMMANDS.length > 50, `only found ${COMMANDS.length} commands`);
  });

  test('every command has an event name or a documented reason to skip it', () => {
    const missing = COMMANDS.filter((c) => !(c in EVENT_NAMES) && !(c in NO_EVENT));
    assert.deepEqual(
      missing,
      [],
      `Add an EVENT_NAMES or NO_EVENT entry for:\n  ${missing.join('\n  ')}`
    );
  });

  test('no entry names a command the tree no longer has', () => {
    const known = new Set(COMMANDS);
    const stale = [...Object.keys(EVENT_NAMES), ...Object.keys(NO_EVENT)].filter((c) => !known.has(c));
    assert.deepEqual(
      stale,
      [],
      `telemetry-events.js mentions commands that no longer exist:\n  ${stale.join('\n  ')}`
    );
  });

  test('a command is not both tracked and skipped', () => {
    const both = Object.keys(EVENT_NAMES).filter((c) => c in NO_EVENT);
    assert.deepEqual(both, []);
  });

  test('every NO_EVENT entry gives a reason', () => {
    const unexplained = Object.entries(NO_EVENT)
      .filter(([, reason]) => typeof reason !== 'string' || reason.trim().length === 0)
      .map(([c]) => c);
    assert.deepEqual(unexplained, []);
  });

  test('every event name is Title Case, with only "to"/"of"/"the" lowercase', () => {
    const re = /^[A-Z][A-Za-z0-9]*(?: (?:[A-Z][A-Za-z0-9]*|to|of|the))*$/;
    const bad = Object.entries(EVENT_NAMES)
      .filter(([, name]) => !re.test(name))
      .map(([c, name]) => `${c} -> "${name}"`);
    assert.deepEqual(bad, []);
  });
});
