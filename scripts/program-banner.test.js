/**
 * Tests for the root help banner added to src/program.js.
 *
 * Commander's addHelpText() output isn't visible through
 * program.helpInformation() (confirmed directly against the installed
 * Commander version) — only the real help-output path renders it, so this
 * spawns the actual binary rather than calling into the module.
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
  try {
    return execFileSync(process.execPath, [BIN, ...args], {
      env: { ...process.env, KIT_CONFIG_DIR: mkdtempSync(join(tmpdir(), 'kit-cli-banner-')), KIT_NO_UPDATE_CHECK: '1' },
      encoding: 'utf8',
    });
  } catch (err) {
    // Bare `kit` with no arguments is a real Commander default: unlike
    // `--help` (exit 0), it treats a missing command as a usage error —
    // writes the same help text to stderr instead of stdout, and exits 1.
    // execFileSync throws on any non-zero exit; the output is still
    // captured on err.stdout/err.stderr.
    if (err.stdout !== undefined || err.stderr !== undefined) {
      return (err.stdout ?? '') + (err.stderr ?? '');
    }
    throw err;
  }
}

describe('root help banner', () => {
  // "CLI for Kit" (no "the") is the banner's own wording, distinct from
  // program.description()'s "CLI for the Kit (ConvertKit) email marketing
  // API (V4)" — a bare /kit/ match would pass even without the banner, since
  // "Usage: kit ..." already contains the word.
  test('shows on kit --help', () => {
    assert.match(run(['--help']), /CLI for Kit/);
  });

  test('shows on bare kit with no arguments', () => {
    assert.match(run([]), /CLI for Kit/);
  });

  test('does not show on a subcommand\'s --help', () => {
    const subHelp = run(['tags', '--help']);
    // The banner text is a distinct, longer line; a subcommand's own help
    // still legitimately contains the word "kit" in its usage line
    // ("Usage: kit tags..."), so this checks for the banner's specific
    // wording rather than the bare word.
    assert.ok(!subHelp.includes('CLI for Kit'));
  });

  test('the usual usage line still prints after the banner', () => {
    assert.match(run(['--help']), /Usage: kit \[options\] \[command\]/);
  });
});
