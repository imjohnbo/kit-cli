import { Command } from 'commander';
import chalk from 'chalk';
import { statSync } from 'node:fs';
import config, {
  getApiKey,
  getAccessToken,
  isTokenExpired,
  getBaseUrl,
  getUpdateCheckEnabled,
  getTelemetryEnabled,
  getCachedLatestVersion,
} from '../config.js';
import { USER_AGENT } from '../package-info.js';
import { withErrorHandler } from '../output.js';
import { cacheIsStale } from '../update-check.js';

function checkNodeVersion() {
  const major = Number(process.versions.node.split('.')[0]);
  const ok = major >= 18;
  return {
    label: 'Node.js version',
    ok,
    detail: ok ? `${process.version} (>= 18 required)` : `${process.version} is too old — Node 18+ is required.`,
  };
}

function checkConfigPermissions() {
  if (process.platform === 'win32') {
    return { label: 'Config file permissions', ok: true, detail: 'Not checked on Windows.' };
  }
  try {
    const mode = statSync(config.path).mode & 0o777;
    const ok = mode === 0o600;
    return {
      label: 'Config file permissions',
      ok,
      detail: ok ? `${config.path} is 0600.` : `${config.path} is 0${mode.toString(8)}, expected 0600.`,
    };
  } catch {
    return { label: 'Config file permissions', ok: true, detail: 'No config file yet.' };
  }
}

function checkAuthConfigured() {
  const accessToken = getAccessToken();
  if (accessToken) {
    return isTokenExpired()
      ? { label: 'Authentication', ok: false, detail: 'OAuth token expired — run `kit login` to re-authenticate.' }
      : { label: 'Authentication', ok: true, detail: 'OAuth token present and not expired.' };
  }
  if (getApiKey()) {
    return { label: 'Authentication', ok: true, detail: 'API key configured.' };
  }
  return {
    label: 'Authentication',
    ok: false,
    detail: 'Not configured — run `kit init`, `kit login`, or `kit config set-api-key <key>`.',
  };
}

/**
 * A minimal, non-exiting reachability check. Deliberately does not reuse
 * client.js's get() — that function calls process.exit(1) when credentials
 * are missing or a token refresh fails, which is correct for a command the
 * user is actively running, and wrong here: doctor must finish printing
 * every check regardless of what this one finds.
 */
async function checkReachability() {
  const accessToken = !isTokenExpired() ? getAccessToken() : '';
  const apiKey = getApiKey();
  const headers = accessToken
    ? { Authorization: `Bearer ${accessToken}` }
    : apiKey
      ? { 'X-Kit-Api-Key': apiKey }
      : null;

  if (!headers) {
    return { label: 'API reachability', ok: false, detail: 'Skipped — no usable credentials.' };
  }

  try {
    const res = await fetch(`${getBaseUrl()}/account`, {
      headers: { ...headers, Accept: 'application/json', 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(5000),
    });
    return res.ok
      ? { label: 'API reachability', ok: true, detail: `Connected to ${getBaseUrl()}.` }
      : { label: 'API reachability', ok: false, detail: `Server responded with ${res.status}.` };
  } catch (err) {
    return { label: 'API reachability', ok: false, detail: `Could not reach ${getBaseUrl()}: ${err.message}` };
  }
}

function checkUpdateStatus() {
  const detail = !getUpdateCheckEnabled()
    ? 'Update checks are disabled.'
    : cacheIsStale()
      ? 'No recent check yet — one will run in the background shortly.'
      : `Latest known version: ${getCachedLatestVersion()}.`;
  return { label: 'Update check', ok: true, detail };
}

function checkTelemetryStatus() {
  return { label: 'Telemetry', ok: true, detail: getTelemetryEnabled() ? 'Enabled.' : 'Disabled.' };
}

export async function runChecks() {
  return [
    checkNodeVersion(),
    checkConfigPermissions(),
    checkAuthConfigured(),
    await checkReachability(),
    checkUpdateStatus(),
    checkTelemetryStatus(),
  ];
}

export function doctorCommand() {
  const cmd = new Command('doctor')
    .description("Check the CLI's setup: Node version, config, authentication, and API connectivity");

  cmd.action(
    withErrorHandler(async () => {
      const results = await runChecks();
      for (const r of results) {
        const mark = r.ok ? chalk.green('✓') : chalk.red('✗');
        console.log(`${mark} ${r.label.padEnd(24)}${r.detail}`);
      }
      // process.exitCode, not process.exit(): this lets withErrorHandler's
      // success-path telemetry still run — doctor finding a problem means
      // the environment is unhealthy, not that the doctor command itself
      // failed, the same distinction `grep` makes when it exits 1 for "no
      // matches" without that being a crash.
      if (results.some((r) => !r.ok)) {
        process.exitCode = 1;
      }
    })
  );

  return cmd;
}
