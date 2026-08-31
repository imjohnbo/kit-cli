/**
 * Anonymous usage telemetry, sent to Segment.
 *
 * Two invariants hold everywhere in this file:
 *
 *   1. Nothing here can throw past its own boundary. A telemetry failure
 *      must never be the reason a command exits non-zero.
 *   2. Properties never carry command arguments, flags, request/response
 *      bodies, or output — CLI arguments routinely carry subscriber emails
 *      and content. Only shape (command, status, timing) is sent.
 */
import { Analytics } from '@segment/analytics-node';
import { randomUUID } from 'node:crypto';
import { platform } from 'node:os';
import {
  getTelemetryEnabled,
  getTelemetryNoticeShown,
  setTelemetryNoticeShown,
  getOrCreateInstallId,
  getCachedAccountId,
  setCachedAccountId,
  getApiKey,
  getAccessToken,
  isTokenExpired,
  getBaseUrl,
} from './config.js';
import { VERSION, USER_AGENT } from './package-info.js';
import { EVENT_NAMES } from './telemetry-events.js';

// telemetry-keys.js reads its env var once, at module-load time (see its own
// header comment). A plain static `import { SEGMENT_WRITE_KEY } from
// './telemetry-keys.js'` here would only ever see that first-loaded value:
// Node's module cache keys a nested import by its own resolved URL, not by
// whatever cache-busting query string the *importer* (this file) was loaded
// with — so once anything causes telemetry-keys.js to load once, every later
// "fresh" reimport of telemetry.js (scripts/telemetry.test.js reimports it
// via a new `?t=...` query per test, since KIT_SEGMENT_WRITE_KEY is meant to
// be re-read per test) would still see that stale, cached write key.
// Forwarding this module's own query string (empty in production, where
// telemetry.js itself is loaded plainly and only once) down into the
// telemetry-keys.js import keeps the two modules' freshness in lockstep,
// while resolving to the exact same plain URL a static import would use
// whenever there's no query string to forward.
const _keysUrl = new URL('./telemetry-keys.js', import.meta.url);
_keysUrl.search = new URL(import.meta.url).search;
const { SEGMENT_WRITE_KEY } = await import(_keysUrl.href);

// ── current command tracking ────────────────────────────────────────────
//
// Set by the preAction hook in program.js, before any action runs. Reading
// it here (rather than passing it through every command file) keeps every
// existing command file untouched.

let _currentCommand = '';

export function setCurrentCommand(path) {
  _currentCommand = path;
}

export function getCurrentCommand() {
  return _currentCommand;
}

const SESSION_ID = randomUUID();

// ── consent ──────────────────────────────────────────────────────────────
//
// One combined gate for telemetry and error reporting. Mirrors
// updateCheckAllowed() in update-check.js: an env var for a single
// invocation or CI, plus a persisted config preference.

export function telemetryAllowed(env = process.env) {
  if (env.KIT_NO_TELEMETRY && env.KIT_NO_TELEMETRY !== '0') return false;
  if (env.DO_NOT_TRACK === '1') return false;
  if (env.CI && env.CI !== 'false') return false;
  return getTelemetryEnabled();
}

// ── Segment client ───────────────────────────────────────────────────────

let _client;

function getClient() {
  if (_client !== undefined) return _client;
  // Analytics() throws if writeKey is falsy, so this is skipped entirely
  // rather than constructed-and-disabled.
  _client = SEGMENT_WRITE_KEY ? new Analytics({ writeKey: SEGMENT_WRITE_KEY }) : null;
  return _client;
}

function maybeShowFirstRunNotice() {
  if (getTelemetryNoticeShown()) return;
  setTelemetryNoticeShown();
  console.error(
    'kit collects anonymous usage data to help improve the CLI. Run ' +
    '`kit config set-telemetry false` or set KIT_NO_TELEMETRY=1 to opt out.'
  );
}

// ── account ID caching ───────────────────────────────────────────────────
//
// Looked up at most once per set of credentials, never per invocation. This
// hand-rolls its own fetch rather than reusing client.js's get() — get()
// calls process.exit(1) when no credentials are configured at all, which is
// exactly right for a command the user is actively running, and exactly
// wrong for a background telemetry lookup that must never be able to end
// the process.

async function resolveAccountId() {
  if (getCachedAccountId()) return;

  const accessToken = !isTokenExpired() ? getAccessToken() : '';
  const apiKey = getApiKey();
  const headers = accessToken
    ? { Authorization: `Bearer ${accessToken}` }
    : apiKey
      ? { 'X-Kit-Api-Key': apiKey }
      : null;
  if (!headers) return; // no usable credentials yet; try again on a later command

  try {
    const res = await fetch(`${getBaseUrl()}/account`, {
      headers: { ...headers, Accept: 'application/json', 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) return;
    const body = await res.json();
    const id = body?.account?.id ?? body?.id;
    if (id) setCachedAccountId(id);
  } catch {
    // Best-effort only. account_id just stays unknown for now.
  }
}

// ── tracking ─────────────────────────────────────────────────────────────

export function trackCommand({ command, status, durationMs, statusCode }) {
  if (!telemetryAllowed()) return;

  const client = getClient();
  if (!client) return;

  maybeShowFirstRunNotice();

  const accountId = getCachedAccountId();
  if (!accountId) void resolveAccountId();

  try {
    // The SDK validates its input synchronously (e.g. it throws if
    // anonymousId were ever missing or non-string) before it ever reaches
    // the network. getOrCreateInstallId() always returns a non-empty
    // string, so this shouldn't fire in practice — but per this module's
    // own invariant #1, a telemetry call must never throw past this
    // function, so it's caught the same as every other fallible call in
    // this file (fetch, closeAndFlush) rather than trusted to hold.
    client.track({
      anonymousId: getOrCreateInstallId(),
      event: EVENT_NAMES[command] || 'Unknown Command Run',
      properties: {
        // Not command *arguments* (never sent — see the module header), just
        // which command this is. This is what actually lets a reused event
        // name (e.g. every `config set-*` command firing "CLI Config
        // Updated") stay analyzable — filter or group by `command` rather
        // than needing a separate event per command.
        command,
        // Distinguishes this from a same-named event the product itself may
        // already emit server-side (e.g. a recipient-initiated unsubscribe
        // vs. `kit subscribers unsubscribe`, both landing as "Subscriber
        // Unsubscribed") — flagged in code review of the taxonomy map.
        source: 'cli',
        session_id: SESSION_ID,
        status,
        duration_ms: durationMs,
        ...(statusCode !== undefined ? { status_code: statusCode } : {}),
        cli_version: VERSION,
        os: platform(),
        node_version: process.version,
        ...(accountId ? { account_id: accountId } : {}),
      },
    });
  } catch {
    // Best-effort only.
  }
}

/**
 * Awaited on the error path only, with a short bound, right before
 * process.exit(1) — otherwise the pending Segment request would be killed
 * before it sends. The success path needs no equivalent call: Node keeps
 * the process alive until a pending fetch settles, the same behavior
 * refreshLatestInBackground() in update-check.js already relies on.
 */
export async function flushTelemetry({ timeout = 300 } = {}) {
  const client = getClient();
  if (!client) return;
  try {
    await client.closeAndFlush({ timeout });
  } catch {
    // Best-effort only.
  }
}
