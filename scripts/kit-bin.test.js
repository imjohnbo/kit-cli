/**
 * Tests for bin/kit.js
 *
 * A top-level script, not an importable module — spawning it is the only
 * way to exercise it.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BIN = join(__dirname, '..', 'bin', 'kit.js');

function run(args) {
  return execFileSync(process.execPath, [BIN, ...args], {
    env: { ...process.env, KIT_CONFIG_DIR: mkdtempSync(join(tmpdir(), 'kit-cli-bin-')), KIT_NO_UPDATE_CHECK: '1' },
    encoding: 'utf8',
  });
}

describe('kit --kit', () => {
  test('exits 0 and prints something', () => {
    // execFileSync throws on a non-zero exit, so not throwing proves the
    // exit code; the flag has no purpose if it prints nothing.
    const out = run(['--kit']);
    assert.ok(out.trim().length > 0);
  });

  test('is not mentioned anywhere in --help output', () => {
    assert.ok(!run(['--help']).includes('--kit'));
  });

  test('short-circuits before Commander parses the rest of argv', () => {
    // "subscribers list" with no credentials configured would otherwise
    // exit 1 (no API key/token) or hang on a real network call. Not
    // throwing here proves --kit intercepted before any of that ran.
    assert.doesNotThrow(() => run(['subscribers', 'list', '--kit']));
  });
});
