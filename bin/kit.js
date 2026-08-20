#!/usr/bin/env node

import { buildProgram } from '../src/program.js';
import { noticeIfOutdated, refreshLatestInBackground } from '../src/update-check.js';

// `kit upgrade` reports the new version itself, so the notice would say it twice.
const runningUpgrade = process.argv[2] === 'upgrade';

// Reads the cache only, so it never adds latency or a failure mode.
if (!runningUpgrade) noticeIfOutdated();

await buildProgram().parseAsync();

// Warms the cache for the next run. Not awaited, and at most once a day.
if (!runningUpgrade) refreshLatestInBackground();
