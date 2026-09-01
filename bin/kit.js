#!/usr/bin/env node

import chalk from 'chalk';
import { buildProgram } from '../src/program.js';
import { noticeIfOutdated, refreshLatestInBackground } from '../src/update-check.js';

if (process.argv.includes('--kit')) {
  console.log('');
  console.log(chalk.hex('#44B1FF').bold('  kit'));
  console.log(chalk.dim('  you found the hidden corner of the CLI.'));
  console.log(chalk.dim('  thanks for using kit — happy sending.'));
  console.log('');
  process.exit(0);
}

// `kit upgrade` reports the new version itself, so the notice would say it twice.
const runningUpgrade = process.argv[2] === 'upgrade';

// Reads the cache only, so it never adds latency or a failure mode.
if (!runningUpgrade) noticeIfOutdated();

await buildProgram().parseAsync();

// Warms the cache for the next run. Not awaited, and at most once a day.
if (!runningUpgrade) refreshLatestInBackground();
