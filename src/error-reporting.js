/**
 * Crash reports, sent to Sentry.
 *
 * Hand-rolled rather than @sentry/node: this only ever needs to send one
 * event per invocation, right before the process exits, which is a much
 * smaller problem than the SDK's breadcrumbs/session tracking/source maps
 * solve. See the design doc for the full tradeoff.
 *
 * Same invariant as telemetry.js: nothing here can throw past its own
 * boundary, and reports never carry argv, headers, tokens, or API keys —
 * only the exception itself, the command name, and version info.
 */
import { randomUUID } from 'node:crypto';
import { VERSION, USER_AGENT } from './package-info.js';
import { telemetryAllowed } from './telemetry.js';
import { KitApiError } from './client.js';
import { freshKeys } from './telemetry-keys.js';

// See freshKeys()'s own comment in telemetry-keys.js for why this can't be a
// plain static `import { SENTRY_DSN } from './telemetry-keys.js'`.
//
// Same top-level-await caveat as telemetry.js: anything that require()s this
// module, or a module that imports it, fails with ERR_REQUIRE_ASYNC_MODULE.
// No current impact — see telemetry.js's own note on why.
const { SENTRY_DSN } = await freshKeys(import.meta.url);

/** Parses https://<publicKey>@<host>/<projectId>, Sentry's DSN format. */
function parseDsn(dsn) {
  const match = (dsn || '').match(/^https:\/\/([^@]+)@([^/]+)\/(.+)$/);
  if (!match) return null;
  const [, publicKey, host, projectId] = match;
  return { publicKey, host, projectId };
}

/**
 * Uncaught exceptions are always worth reporting. A KitApiError below 500 is
 * an expected user/input error (bad ID, validation failure, auth problem) —
 * its message sometimes echoes user-entered values, and it isn't a CLI bug.
 * 500+ means the API itself had a problem, which is worth knowing about.
 */
function shouldReport(err) {
  if (err instanceof KitApiError) return err.status >= 500;
  return true;
}

/**
 * Parses one V8 stack trace line ("at fn (file:line:col)", or the anonymous
 * "at file:line:col") into Sentry's frame shape. Falls back to a bare
 * filename when the line doesn't match either form — still a valid frame,
 * just without line/column data.
 */
function parseStackFrame(line) {
  const trimmed = line.trim();
  const m = trimmed.match(/^at\s+(?:(.+?)\s+\()?(.+?)\)?$/);
  if (!m) return { filename: trimmed };
  const [, fn, location] = m;
  const loc = location.match(/^(.*):(\d+):(\d+)$/);
  if (!loc) return { function: fn, filename: location };
  const [, filename, lineno, colno] = loc;
  return { function: fn, filename, lineno: Number(lineno), colno: Number(colno) };
}

/**
 * V8's err.stack is "Error: message\n<optional more message lines>\n    at
 * ...\n    at ...". Filtering to lines that actually look like a frame
 * (rather than assuming the message is always exactly one line) handles a
 * multi-line message correctly. Sentry's frame order is oldest-to-youngest,
 * the reverse of V8's youngest-first — get this backwards and Sentry blames
 * the wrong line for every report.
 */
function parseStackFrames(stack) {
  if (!stack) return undefined;
  const frames = stack
    .split('\n')
    .filter((line) => /^\s*at\s+/.test(line))
    .map(parseStackFrame)
    .reverse();
  return frames.length ? frames : undefined;
}

export async function maybeReportError(err, { command } = {}) {
  if (!telemetryAllowed()) return;
  if (!shouldReport(err)) return;

  const dsn = parseDsn(SENTRY_DSN);
  if (!dsn) return;

  try {
    const eventId = randomUUID().replace(/-/g, '');
    const timestamp = new Date().toISOString();

    const frames = parseStackFrames(err?.stack);

    const event = {
      event_id: eventId,
      timestamp,
      platform: 'node',
      release: `kit-cli@${VERSION}`,
      tags: { command: command || '(unknown)' },
      exception: {
        values: [
          {
            type: err?.name || 'Error',
            // err.message can be undefined for a non-Error thrown value (a
            // string, a plain object) — String(err) still gives Sentry
            // something to show rather than a content-free report.
            value: err?.message || String(err),
            stacktrace: frames ? { frames } : undefined,
          },
        ],
      },
    };

    const envelopeHeader = JSON.stringify({ event_id: eventId, sent_at: timestamp, dsn: SENTRY_DSN });
    const itemHeader = JSON.stringify({ type: 'event' });
    const body = `${envelopeHeader}\n${itemHeader}\n${JSON.stringify(event)}\n`;

    await fetch(`https://${dsn.host}/api/${dsn.projectId}/envelope/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-sentry-envelope',
        'User-Agent': USER_AGENT,
        'X-Sentry-Auth': `Sentry sentry_version=7, sentry_client=kit-cli/${VERSION}, sentry_key=${dsn.publicKey}`,
      },
      body,
      // Not the 300ms flushTelemetry() uses — that bounds flushing work
      // already in flight, this fetch starts from a cold connection at the
      // exact moment of a crash. Measured ~180ms for DNS+TCP+TLS to Sentry's
      // ingest host alone on a fast connection, leaving no real budget for
      // the request itself at 300ms. The command has already failed and
      // printed its error by this point, so the extra latency costs little.
      signal: AbortSignal.timeout(2000),
    });
  } catch {
    // Best-effort only.
  }
}
