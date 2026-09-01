import { Command } from 'commander';
import chalk from 'chalk';
import { statSync } from 'node:fs';
import config, {
  getApiKey,
  getAccessToken,
  getRefreshToken,
  isTokenExpired,
  getBaseUrl,
  getCachedLatestVersion,
} from '../config.js';
import { USER_AGENT, MIN_NODE_MAJOR } from '../package-info.js';
import { withErrorHandler } from '../output.js';
import { cacheIsStale, updateCheckAllowed } from '../update-check.js';

function checkNodeVersion() {
  const major = Number(process.versions.node.split('.')[0]);
  const ok = major >= MIN_NODE_MAJOR;
  return {
    label: 'Node.js version',
    ok,
    detail: ok
      ? `${process.version} (>= ${MIN_NODE_MAJOR} required)`
      : `${process.version} is too old — Node ${MIN_NODE_MAJOR}+ is required.`,
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
      detail: ok
        ? `${config.path} is 0600.`
        : `${config.path} is 0${mode.toString(8)}, expected 0600. Run: chmod 600 ${config.path}`,
    };
  } catch (err) {
    if (err.code === 'ENOENT') {
      return { label: 'Config file permissions', ok: true, detail: 'No config file yet.' };
    }
    return { label: 'Config file permissions', ok: false, detail: `Could not check: ${err.message}` };
  }
}

/**
 * Both this and checkReachability() below mirror client.js's getAuthHeader()
 * precedence: an OAuth access token, even expired, always wins over the API
 * key — the real CLI never falls back to the key while any OAuth token is
 * stored. Getting this wrong here would mean doctor testing (or reporting
 * on) a credential the CLI wouldn't actually use.
 */
function checkAuthConfigured() {
  const accessToken = getAccessToken();
  if (accessToken) {
    if (!isTokenExpired()) {
      return { label: 'Authentication', ok: true, detail: 'OAuth token present and not expired.' };
    }
    // Expired alone isn't a failure: client.js's getAuthHeader() refreshes
    // transparently on the next real command as long as a refresh token is
    // stored. Only a missing refresh token means kit login is actually
    // required.
    return getRefreshToken()
      ? { label: 'Authentication', ok: true, detail: 'OAuth token expired, but will refresh automatically on the next command.' }
      : { label: 'Authentication', ok: false, detail: 'OAuth token expired and no refresh token is stored — run `kit login` to re-authenticate.' };
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
 * A minimal, non-exiting GET /account probe. Deliberately does not reuse
 * client.js's get() — that function calls process.exit(1) when credentials
 * are missing or a token refresh fails, which is correct for a command the
 * user is actively running, and wrong here: doctor must finish printing
 * every check regardless of what this one finds.
 */
async function probeAccount(authHeaders) {
  try {
    const res = await fetch(`${getBaseUrl()}/account`, {
      headers: { ...authHeaders, Accept: 'application/json', 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(5000),
    });
    return res.ok
      ? { label: 'API reachability', ok: true, detail: `Connected to ${getBaseUrl()}.` }
      : { label: 'API reachability', ok: false, detail: `Server responded with ${res.status}.` };
  } catch (err) {
    // For a fetch failure (DNS, connection refused, ...) the useful message
    // is on err.cause, not err.message — undici's err.message is just the
    // constant "fetch failed". AbortSignal.timeout()'s own error already
    // carries a real message on err.message, so the fallback still covers
    // that case correctly.
    const detail = err.cause?.message ?? err.message;
    return { label: 'API reachability', ok: false, detail: `Could not reach ${getBaseUrl()}: ${detail}` };
  }
}

async function checkReachability() {
  const accessToken = getAccessToken();

  if (accessToken) {
    if (isTokenExpired()) {
      // Same precedence question as checkAuthConfigured() above, and the
      // same answer: don't attempt a refresh here. A refresh persists new
      // tokens to config — a real, if minor, side effect a read-only
      // diagnostic command shouldn't have — and don't fall back to testing
      // the API key either, since that's a credential the real CLI
      // wouldn't use while any OAuth token is stored.
      return getRefreshToken()
        ? { label: 'API reachability', ok: true, detail: 'Skipped — OAuth token will refresh automatically on the next real command.' }
        : { label: 'API reachability', ok: false, detail: 'Skipped — OAuth token expired and no refresh token is stored.' };
    }
    return probeAccount({ Authorization: `Bearer ${accessToken}` });
  }

  const apiKey = getApiKey();
  if (!apiKey) {
    return { label: 'API reachability', ok: false, detail: 'Skipped — no usable credentials.' };
  }
  return probeAccount({ 'X-Kit-Api-Key': apiKey });
}

function checkUpdateStatus() {
  const detail = !updateCheckAllowed()
    ? 'Update checks are disabled.'
    : cacheIsStale()
      ? 'No recent check yet — one will run in the background shortly.'
      : `Latest known version: ${getCachedLatestVersion()}.`;
  return { label: 'Update check', ok: true, detail };
}

/**
 * Dynamically imports telemetry.js rather than a static top-level import:
 * program.js imports every command file eagerly (so buildProgram() can
 * assemble the full tree), so a static import here would load the Segment
 * SDK on every single CLI invocation — including --help and --version,
 * which never reach this function at all. This is the same fix Task 8 of
 * the Observability plan applied to output.js, for the same reason.
 */
async function checkTelemetryStatus() {
  const { telemetryAllowed } = await import('../telemetry.js');
  return { label: 'Telemetry', ok: true, detail: telemetryAllowed() ? 'Enabled.' : 'Disabled.' };
}

export async function runChecks() {
  // checkReachability() (a network fetch) and checkTelemetryStatus() (a
  // dynamic import) don't depend on each other or on any check around them —
  // run them concurrently rather than paying their latency one after the
  // other.
  const [reachability, telemetry] = await Promise.all([checkReachability(), checkTelemetryStatus()]);
  return [
    checkNodeVersion(),
    checkConfigPermissions(),
    checkAuthConfigured(),
    reachability,
    checkUpdateStatus(),
    telemetry,
  ];
}

/**
 * Shared with kit init, which prints the same checklist at the end of its
 * wizard. `log` defaults to console.log for doctorCommand()'s own use;
 * kit init passes a writer bound to its own injectable output stream
 * instead, since console.log always targets the real process.stdout
 * regardless of what stream init's caller supplied.
 */
export function printChecks(results, log = console.log) {
  const width = Math.max(...results.map((r) => r.label.length)) + 1;
  for (const r of results) {
    const mark = r.ok ? chalk.green('✓') : chalk.red('✗');
    log(`${mark} ${r.label.padEnd(width)}${r.detail}`);
  }
}

export function doctorCommand() {
  const cmd = new Command('doctor')
    .description("Check the CLI's setup: Node version, config, authentication, and API connectivity");

  cmd.action(
    withErrorHandler(async () => {
      const results = await runChecks();
      printChecks(results);
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
