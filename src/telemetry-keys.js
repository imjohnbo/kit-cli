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
export const SEGMENT_WRITE_KEY = process.env.KIT_SEGMENT_WRITE_KEY || '';
export const SENTRY_DSN = process.env.KIT_SENTRY_DSN || '';
