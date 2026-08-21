#!/usr/bin/env node
/**
 * Test runner.
 *
 * Runs each test file in its own process with its own KIT_CONFIG_DIR. Two
 * reasons:
 *
 * 1. `conf` rewrites the whole config file on every set. Test files running in
 *    parallel against one file lose each other's writes.
 * 2. Without an override, the suite writes to the real config and clobbers the
 *    developer's stored API key and OAuth tokens.
 *
 * `node --test` cannot give each file a different environment, so this does.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CONCURRENCY = 4;
const SCRIPTS_DIR = 'scripts';

const files = readdirSync(SCRIPTS_DIR)
  .filter((f) => f.endsWith('.test.js'))
  .sort()
  .map((f) => join(SCRIPTS_DIR, f));

if (files.length === 0) {
  console.error('No test files found.');
  process.exit(1);
}

const scratch = mkdtempSync(join(tmpdir(), 'kit-cli-tests-'));
const totals = { tests: 0, pass: 0, fail: 0, skipped: 0, todo: 0 };
const failed = [];

function runFile(file, index) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['--test', file], {
      env: { ...process.env, KIT_CONFIG_DIR: join(scratch, `cfg-${index}`) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));

    child.on('close', (code) => {
      for (const key of Object.keys(totals)) {
        const m = new RegExp(`^# ${key} (\\d+)$`, 'm').exec(out);
        if (m) totals[key] += Number(m[1]);
      }
      if (code !== 0) {
        failed.push(file);
        // Only failing files print in full. A green run stays quiet.
        process.stdout.write(out);
      }
      console.log(`${code === 0 ? 'ok  ' : 'FAIL'}  ${file}`);
      resolve();
    });
  });
}

const queue = files.map((f, i) => () => runFile(f, i));
const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
  let next;
  while ((next = queue.shift())) await next();
});

await Promise.all(workers);
rmSync(scratch, { recursive: true, force: true });

console.log('');
console.log(`# files ${files.length}`);
console.log(`# tests ${totals.tests}`);
console.log(`# pass ${totals.pass}`);
console.log(`# fail ${totals.fail}`);

if (failed.length > 0) {
  console.log('');
  console.log(`Failing files:\n  ${failed.join('\n  ')}`);
  process.exit(1);
}
