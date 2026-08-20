/**
 * Holds spec/coverage.js to the spec and to the command tree.
 *
 * This is the test that makes an api-spec-change issue actionable. When the spec
 * gains or loses an endpoint, the first two tests here fail and name it. When a
 * command is renamed or removed, the third fails and names it.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { COVERAGE, NOT_EXPOSED, specOperations } from '../spec/coverage.js';
import { buildProgram } from '../src/program.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const spec = JSON.parse(readFileSync(join(__dirname, '..', 'spec', 'v4.json'), 'utf8'));

const OPERATIONS = specOperations(spec);

/** Every command path in the tree, as space-separated strings. */
function commandPaths(cmd, prefix = []) {
  const paths = [];
  for (const child of cmd.commands) {
    if (child.name() === 'help') continue;
    const path = [...prefix, child.name()];
    paths.push(path.join(' '));
    paths.push(...commandPaths(child, path));
  }
  return paths;
}

const COMMANDS = new Set(commandPaths(buildProgram()));

describe('spec coverage', () => {
  test('the spec has operations to check', () => {
    assert.ok(OPERATIONS.length > 40, `only found ${OPERATIONS.length} operations`);
  });

  test('every spec operation is accounted for', () => {
    const missing = OPERATIONS.filter((op) => !(op in COVERAGE) && !(op in NOT_EXPOSED));
    assert.deepEqual(
      missing,
      [],
      `The spec has operations that spec/coverage.js does not mention. Add a CLI ` +
        `command for each one, or add it to NOT_EXPOSED with a reason:\n  ` +
        missing.join('\n  ')
    );
  });

  test('no coverage entry names an operation the spec dropped', () => {
    const known = new Set(OPERATIONS);
    const stale = [...Object.keys(COVERAGE), ...Object.keys(NOT_EXPOSED)].filter((op) => !known.has(op));
    assert.deepEqual(
      stale,
      [],
      `spec/coverage.js mentions operations the spec no longer has:\n  ` + stale.join('\n  ')
    );
  });

  test('every command named in the map exists in the command tree', () => {
    const broken = Object.entries(COVERAGE)
      .filter(([, command]) => !COMMANDS.has(command))
      .map(([op, command]) => `${op} -> ${command}`);
    assert.deepEqual(
      broken,
      [],
      `spec/coverage.js names commands that do not exist:\n  ` + broken.join('\n  ')
    );
  });

  test('every NOT_EXPOSED entry gives a reason', () => {
    const unexplained = Object.entries(NOT_EXPOSED)
      .filter(([, reason]) => typeof reason !== 'string' || reason.trim().length === 0)
      .map(([op]) => op);
    assert.deepEqual(unexplained, []);
  });

  test('an operation is not both covered and skipped', () => {
    const both = Object.keys(COVERAGE).filter((op) => op in NOT_EXPOSED);
    assert.deepEqual(both, []);
  });
});

describe('command tree', () => {
  test('every top-level command has a description', () => {
    const undescribed = buildProgram()
      .commands.filter((c) => c.name() !== 'help' && !c.description())
      .map((c) => c.name());
    assert.deepEqual(undescribed, []);
  });

  test('every leaf command has a description', () => {
    const walk = (cmd, prefix = []) => {
      const bad = [];
      for (const child of cmd.commands) {
        if (child.name() === 'help') continue;
        const path = [...prefix, child.name()];
        if (!child.description()) bad.push(path.join(' '));
        bad.push(...walk(child, path));
      }
      return bad;
    };
    assert.deepEqual(walk(buildProgram()), []);
  });

  test('no two sibling commands share a name', () => {
    const walk = (cmd, prefix = []) => {
      const dupes = [];
      const seen = new Set();
      for (const child of cmd.commands) {
        const name = child.name();
        if (seen.has(name)) dupes.push([...prefix, name].join(' '));
        seen.add(name);
        dupes.push(...walk(child, [...prefix, name]));
      }
      return dupes;
    };
    assert.deepEqual(walk(buildProgram()), []);
  });

  test('the program reports its version', () => {
    assert.match(buildProgram().version(), /^\d+\.\d+\.\d+$/);
  });
});
