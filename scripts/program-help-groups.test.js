/**
 * Tests for the grouped root help in src/program.js.
 *
 * Twenty-five commands in one flat list hide the resource commands people use
 * most between setup and maintenance commands. The root help groups them under
 * four headings instead. Like program-banner.test.js this spawns the real
 * binary, because only the real help path renders Commander's group headings
 * the way a user sees them.
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

function rootHelp() {
  return execFileSync(process.execPath, [BIN, '--help'], {
    env: {
      ...process.env,
      KIT_CONFIG_DIR: mkdtempSync(join(tmpdir(), 'kit-cli-groups-')),
      KIT_NO_UPDATE_CHECK: '1',
      FORCE_COLOR: '0',
    },
    encoding: 'utf8',
  });
}

/**
 * Splits help output into { heading: [command names] }.
 *
 * A heading is an unindented line that ends in a colon ("Options:", "Setup:").
 * An item is a line indented by exactly two spaces. Wrapped descriptions
 * continue on lines indented to the description column, so they never match.
 */
function sections(help) {
  const out = {};
  let current = null;
  for (const line of help.split('\n')) {
    if (/^\S.*:$/.test(line)) {
      current = line;
      out[current] = [];
      continue;
    }
    const item = /^ {2}(\S+)/.exec(line);
    if (current && item) out[current].push(item[1]);
  }
  return out;
}

const EXPECTED = {
  'Setup:': ['init', 'login', 'logout', 'account', 'config', 'setup-skill', 'completion'],
  'Resources:': [
    'broadcasts',
    'custom-fields',
    'email-templates',
    'forms',
    'posts',
    'purchases',
    'segments',
    'sequences',
    'snippets',
    'subscribers',
    'tags',
    'webhooks',
  ],
  'Advanced:': ['api', 'bulk'],
  'Maintenance:': ['doctor', 'upgrade', 'help'],
};

describe('root help command groups', () => {
  const groups = sections(rootHelp());

  test('shows the four groups, in order, after Options', () => {
    // Also proves no command is left behind under Commander's default
    // "Commands:" heading, which would otherwise appear in this list.
    assert.deepEqual(Object.keys(groups), ['Options:', ...Object.keys(EXPECTED)]);
  });

  for (const [heading, names] of Object.entries(EXPECTED)) {
    test(`${heading} holds ${names.join(', ')}`, () => {
      assert.deepEqual(groups[heading], names);
    });
  }

  test('Resources stay alphabetical', () => {
    assert.deepEqual(groups['Resources:'], [...groups['Resources:']].sort());
  });
});

describe('root help descriptions', () => {
  test('every command description fits on one line at 80 columns', () => {
    // Commander wraps at 80 columns when stdout is not a TTY. A wrapped
    // description continues on a line indented to the description column,
    // so any line indented by three or more spaces is a description that
    // ran long. Root help should read as one line per command.
    const help = rootHelp();
    const commands = help.slice(help.indexOf('Setup:'));
    const wrapped = commands.split('\n').filter((line) => /^ {3,}\S/.test(line));
    assert.deepEqual(wrapped, []);
  });
});
