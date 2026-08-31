/**
 * Tests for the `config` command in src/commands/account.js
 */
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { configCommand } from '../src/commands/account.js';
import { runCommand } from './helpers.js';
import { getTelemetryEnabled, setTelemetryEnabled } from '../src/config.js';

const cfg = (argv) => runCommand(configCommand, argv);

describe('config set-telemetry', () => {
  after(() => setTelemetryEnabled(true)); // restore the default for later tests in this run

  test('true enables telemetry', async () => {
    const res = await cfg(['set-telemetry', 'true']);
    assert.equal(getTelemetryEnabled(), true);
    assert.match(res.out, /Telemetry enabled/);
  });

  test('false disables telemetry', async () => {
    const res = await cfg(['set-telemetry', 'false']);
    assert.equal(getTelemetryEnabled(), false);
    assert.match(res.out, /Telemetry disabled/);
  });

  test('rejects a value that is not true or false', async () => {
    const res = await cfg(['set-telemetry', 'maybe']);
    assert.equal(res.exitCode, 1);
  });
});

describe('config show', () => {
  test('includes a telemetry line', async () => {
    const res = await cfg(['show']);
    assert.match(res.out, /telemetry/i);
  });
});

describe('config set-base-url', () => {
  test('rejects an invalid URL with a clear error', async () => {
    const res = await cfg(['set-base-url', 'not-a-url']);
    assert.equal(res.exitCode, 1);
    assert.match(res.err, /Invalid base URL/);
  });
});
