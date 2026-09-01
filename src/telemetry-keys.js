/**
 * Plain, committed defaults for two third-party identifiers that are meant
 * to be embedded in a shipped client — a Segment write key and a Sentry
 * DSN carry the same public trust model as a Stripe publishable key, not a
 * secret.
 *
 * There's no publish-time injection step here on purpose: docs/RELEASING.md
 * guarantees no build step and no generated files, so the published tarball
 * stays byte-for-byte the checked-in source. Both default to empty, which
 * leaves telemetry and error reporting off (see telemetryAllowed() in
 * telemetry.js). Turning them on for a real release is a one-line, plain,
 * reviewable edit to the literal default below — set the env var instead
 * for local testing without touching source.
 */
export const SEGMENT_WRITE_KEY = (process.env.KIT_SEGMENT_WRITE_KEY || '').trim();
export const SENTRY_DSN = (process.env.KIT_SENTRY_DSN || '').trim();

/**
 * Re-imports this module fresh, forwarding the caller's own cache-busting
 * query string (if any).
 *
 * A plain `import { X } from './telemetry-keys.js'` in telemetry.js or
 * error-reporting.js would only ever see the value from this module's
 * *first* load: Node's module cache keys a nested import by its own
 * resolved URL, not by whatever cache-busting query string the importer was
 * loaded with. scripts/telemetry.test.js and scripts/error-reporting.test.js
 * each reimport their module fresh via a new `?t=...` query per test, since
 * KIT_SEGMENT_WRITE_KEY/KIT_SENTRY_DSN are meant to be re-read per test —
 * forwarding the importer's own query string down into this import keeps
 * the two freshnesses in lockstep, while resolving to the exact same plain
 * URL a static import would use whenever there's no query string to
 * forward (i.e. in production, where each importer is loaded plainly once).
 *
 * Centralized here rather than duplicated in both callers, each of which
 * needs the identical `await import(...)`, and so the identical top-level
 * await — meaning anything that does `require()` either of them (or a
 * module that imports them) fails with ERR_REQUIRE_ASYNC_MODULE. Not a
 * concern today — package.json has no `exports`/`main` for library
 * consumers, and nothing in this codebase uses require() — but worth
 * knowing if that ever changes.
 */
export async function freshKeys(importerUrl) {
  const url = new URL('./telemetry-keys.js', importerUrl);
  url.search = new URL(importerUrl).search;
  return import(url.href);
}
