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
import { isCI } from './update-check.js';
import { freshKeys } from './telemetry-keys.js';

// See freshKeys()'s own comment in telemetry-keys.js for why this can't be a
// plain static `import { SEGMENT_WRITE_KEY } from './telemetry-keys.js'`.
// This top-level await means anything that does `require()` this module (or
// any module that imports it) fails with ERR_REQUIRE_ASYNC_MODULE. Not a
// concern today — package.json has no `exports`/`main` for library
// consumers, and nothing in this codebase uses require() — but worth
// knowing if that ever changes.
const { SEGMENT_WRITE_KEY } = await freshKeys(import.meta.url);

const SESSION_ID = randomUUID();

// ── consent ──────────────────────────────────────────────────────────────
//
// One combined gate for telemetry and error reporting. Mirrors
// updateCheckAllowed() in update-check.js: an env var for a single
// invocation or CI, plus a persisted config preference.

export function telemetryAllowed(env = process.env) {
  if (env.KIT_NO_TELEMETRY && env.KIT_NO_TELEMETRY !== '0') return false;
  // The convention (consoledonottrack.com) is: any value other than unset
  // or an explicit "0" opts out — not just the literal "1".
  if (env.DO_NOT_TRACK && env.DO_NOT_TRACK !== '0') return false;
  if (isCI(env)) return false;
  return getTelemetryEnabled();
}

// ── Segment client ───────────────────────────────────────────────────────

let _client;

function getClient() {
  if (_client !== undefined) return _client;
  // Analytics() throws if writeKey is falsy, so this is skipped entirely
  // rather than constructed-and-disabled.
  //
  // flushAt: 1 — the SDK's default batches up to 15 events or waits up to
  // flushInterval (10s) before sending. A CLI process tracks at most one
  // event in its whole lifetime, so batching only adds latency: without
  // this, a successful command would sit alive for up to 10 seconds after
  // printing its result, waiting on a pending flush timer that
  // trackCommand()'s success path never explicitly triggers (only the
  // error path calls flushTelemetry()/closeAndFlush() — see below).
  // Confirmed empirically: without flushAt, the process lingered ~10.2s
  // past a successful command; with it, ~0.2s.
  _client = SEGMENT_WRITE_KEY ? new Analytics({ writeKey: SEGMENT_WRITE_KEY, flushAt: 1 }) : null;
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
  // The whole body is one try/catch, not just the fetch: this function is
  // always invoked as `void resolveAccountId()` (fire-and-forget), so a
  // throw anywhere in here — including the synchronous config reads below —
  // would surface as an unhandled promise rejection and could crash the
  // process, violating this module's invariant #1.
  try {
    if (getCachedAccountId()) return;

    const accessToken = !isTokenExpired() ? getAccessToken() : '';
    const apiKey = getApiKey();
    const headers = accessToken
      ? { Authorization: `Bearer ${accessToken}` }
      : apiKey
        ? { 'X-Kit-Api-Key': apiKey }
        : null;
    if (!headers) return; // no usable credentials yet; try again on a later command

    const res = await fetch(`${getBaseUrl()}/account`, {
      headers: { ...headers, Accept: 'application/json', 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) return;
    const body = await res.json();
    const id = body?.account?.id ?? body?.id;
    if (id != null) setCachedAccountId(id);
  } catch {
    // Best-effort only. account_id just stays unknown for now.
  }
}

// ── tracking ─────────────────────────────────────────────────────────────

export function trackCommand({ command, status, durationMs, statusCode }) {
  if (!telemetryAllowed()) return;

  // The whole body is one try/catch, not just the final client.track() call:
  // getClient() and maybeShowFirstRunNotice() (which writes to the config
  // file) can throw too, and per this module's own invariant #1, a
  // telemetry failure must never be the reason a command exits non-zero —
  // the same reasoning resolveAccountId() documents for its own try/catch.
  try {
    const client = getClient();
    if (!client) return;

    maybeShowFirstRunNotice();

    const accountId = getCachedAccountId();
    if (!accountId) void resolveAccountId();

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
  if (!telemetryAllowed()) return;

  const client = getClient();
  if (!client) return;
  try {
    await client.closeAndFlush({ timeout });
  } catch {
    // Best-effort only.
  }
}
