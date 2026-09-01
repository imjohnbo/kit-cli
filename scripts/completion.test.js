/**
 * Tests for src/completion.js and src/commands/completion.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { complete } from '../src/completion.js';
import { completionCommand } from '../src/commands/completion.js';
import { buildProgram } from '../src/program.js';
import { runCommand } from './helpers.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BIN = join(__dirname, '..', 'bin', 'kit.js');

function scratchConfigDir() {
  return mkdtempSync(join(tmpdir(), 'kit-cli-completion-'));
}

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

describe('kit completion', () => {
  test('prints the bash script for "bash"', async () => {
    const res = await runCommand(completionCommand, ['bash']);
    assert.match(res.out, /_kit_completion/);
    assert.match(res.out, /complete -F/);
  });

  test('prints the zsh script for "zsh"', async () => {
    const res = await runCommand(completionCommand, ['zsh']);
    assert.match(res.out, /compdef/);
  });

  test('prints the fish script for "fish"', async () => {
    const res = await runCommand(completionCommand, ['fish']);
    assert.match(res.out, /complete -c kit/);
  });

  test('rejects an unsupported shell', async () => {
    const res = await runCommand(completionCommand, ['powershell']);
    assert.equal(res.exitCode, 1);
    assert.match(res.err, /Unsupported shell/);
  });
});

describe('kit __complete (hidden command)', () => {
  test('is not listed in --help', () => {
    const help = buildProgram().helpInformation();
    assert.ok(!help.includes('__complete'));
  });

  test('prints one candidate per line', async () => {
    const out = execFileSync(process.execPath, [BIN, '__complete', 'subscribers', 'l'], {
      env: { ...process.env, KIT_CONFIG_DIR: scratchConfigDir() },
      encoding: 'utf8',
    }).trim().split('\n').sort();
    assert.deepEqual(out, ['list', 'location']);
  });
});

describe('the generated bash script, run against the real CLI', () => {
  test('completes a nested subcommand name end to end', () => {
    const scriptOutput = execFileSync(process.execPath, [BIN, 'completion', 'bash'], {
      env: { ...process.env, KIT_CONFIG_DIR: scratchConfigDir() },
      encoding: 'utf8',
    });

    const bashSession = `
      kit() { "${process.execPath}" "${BIN}" "$@"; }
      ${scriptOutput}
      COMP_WORDS=(kit subscribers l)
      COMP_CWORD=2
      _kit_completion
      echo "\${COMPREPLY[@]}"
    `;

    const result = execFileSync('bash', ['-c', bashSession], {
      env: { ...process.env, KIT_CONFIG_DIR: scratchConfigDir() },
      encoding: 'utf8',
    }).trim();

    assert.deepEqual(result.split(' ').sort(), ['list', 'location']);
  });
});
