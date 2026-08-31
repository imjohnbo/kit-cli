#!/usr/bin/env node
/**
 * Runs `node --test` against the given file(s) with an isolated
 * KIT_CONFIG_DIR.
 *
 * scripts/run-tests.js already gives every file this isolation when run
 * through `npm test`, spawning each in its own process with its own scratch
 * config directory. `npm run test:file -- <file>` is the single-file escape
 * hatch for running just one test file directly, and without this wrapper it
 * had no such isolation — a test that touches config.js (directly, or via a
 * function that writes to it, like refreshAccessToken()) would write straight
 * into the developer's real stored credentials.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const scratch = mkdtempSync(join(tmpdir(), 'kit-cli-test-file-'));

const result = spawnSync(process.execPath, ['--test', ...process.argv.slice(2)], {
  env: { ...process.env, KIT_CONFIG_DIR: scratch },
  stdio: 'inherit',
});

rmSync(scratch, { recursive: true, force: true });
process.exit(result.status ?? 1);
