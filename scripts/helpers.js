/**
 * Shared test helpers.
 *
 * Not a test file itself — `npm test` only globs `scripts/*.test.js`.
 *
 * The command harness below lets a test drive a real commander command tree
 * with `fetch` mocked, so tests assert on the HTTP request the CLI would send
 * (method, path, query, body) and on what it prints.
 */
import config from '../src/config.js';

const TEST_BASE = 'https://api.test.invalid/v4';

// ── config isolation ───────────────────────────────────────────────────────

/**
 * Snapshot the OAuth token fields so a stored (possibly expired) token can't
 * trigger a real network refresh while fetch is mocked.
 */
export function oauthSnapshot() {
  return {
    accessToken: config.get('accessToken'),
    refreshToken: config.get('refreshToken'),
    tokenExpiresAt: config.get('tokenExpiresAt'),
  };
}

export function clearOAuth() {
  config.set('accessToken', '');
  config.set('refreshToken', '');
  config.set('tokenExpiresAt', 0);
}

export function restoreOAuth(snap) {
  config.set('accessToken', snap.accessToken);
  config.set('refreshToken', snap.refreshToken);
  config.set('tokenExpiresAt', snap.tokenExpiresAt);
}

// ── capture ────────────────────────────────────────────────────────────────

/** Redirect console.log + console.error and return captured lines. */
export function capture() {
  const logs = [];
  const errors = [];
  const origLog = console.log;
  const origErr = console.error;
  console.log = (...args) => logs.push(args.join(' '));
  console.error = (...args) => errors.push(args.join(' '));
  return {
    logs,
    errors,
    out: () => logs.join('\n'),
    err: () => errors.join('\n'),
    restore() {
      console.log = origLog;
      console.error = origErr;
    },
  };
}

// ── command harness ────────────────────────────────────────────────────────

/**
 * Runs a commander command with fetch mocked.
 *
 * @param {() => import('commander').Command} factory command factory, e.g. `tagsCommand`
 * @param {string[]} argv arguments as a user would type them, e.g. ['list', '--per-page', '5']
 * @param {object} [options]
 * @param {object|object[]} [options.responses] response body (or bodies, in call
 *   order) to return. Use `{ __status: 204 }` for an empty response.
 * @returns {Promise<{calls: object[], logs: string[], errors: string[], out: string, err: string, exitCode: number|undefined}>}
 */
export async function runCommand(factory, argv, { responses = {} } = {}) {
  const bodies = Array.isArray(responses) ? responses : [responses];
  const calls = [];

  const origFetch = globalThis.fetch;
  const origExit = process.exit;
  const origApiKey = process.env.KIT_API_KEY;
  const origBase = process.env.KIT_API_BASE;
  const snap = oauthSnapshot();

  process.env.KIT_API_KEY = 'test-api-key';
  process.env.KIT_API_BASE = TEST_BASE;
  clearOAuth();

  let exitCode;
  process.exit = (code) => {
    exitCode = code;
    throw new ExitSignal(code);
  };

  globalThis.fetch = async (url, opts = {}) => {
    const parsed = new URL(url);
    calls.push({
      method: opts.method,
      url: String(url),
      path: parsed.pathname,
      query: Object.fromEntries(parsed.searchParams.entries()),
      headers: opts.headers || {},
      body: opts.body ? JSON.parse(opts.body) : undefined,
    });

    const body = bodies[Math.min(calls.length - 1, bodies.length - 1)] ?? {};
    const status = body.__status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: status === 200 ? 'OK' : 'Error',
      json: async () => body,
    };
  };

  const cap = capture();
  try {
    const cmd = factory();
    cmd.exitOverride();
    await cmd.parseAsync(argv, { from: 'user' });
  } catch (err) {
    if (!(err instanceof ExitSignal)) {
      cap.restore();
      restoreState();
      throw err;
    }
  } finally {
    cap.restore();
    restoreState();
  }

  function restoreState() {
    globalThis.fetch = origFetch;
    process.exit = origExit;
    restoreOAuth(snap);
    if (origApiKey === undefined) delete process.env.KIT_API_KEY;
    else process.env.KIT_API_KEY = origApiKey;
    if (origBase === undefined) delete process.env.KIT_API_BASE;
    else process.env.KIT_API_BASE = origBase;
  }

  return {
    calls,
    logs: cap.logs,
    errors: cap.errors,
    out: cap.logs.join('\n'),
    err: cap.errors.join('\n'),
    exitCode,
  };
}

class ExitSignal extends Error {
  constructor(code) {
    super(`process.exit(${code})`);
    this.name = 'ExitSignal';
  }
}

/** The single request a command made. Fails loudly if it made a different number. */
export function onlyCall(result) {
  if (result.calls.length !== 1) {
    throw new Error(
      `Expected exactly 1 request, got ${result.calls.length}: ` +
        JSON.stringify(result.calls.map((c) => `${c.method} ${c.path}`))
    );
  }
  return result.calls[0];
}

/** Walk a commander tree and return the subcommand at the given name path. */
export function findSubcommand(cmd, ...names) {
  let node = cmd;
  for (const name of names) {
    node = node.commands.find((c) => c.name() === name);
    if (!node) return undefined;
  }
  return node;
}

/** All long option flags declared on a command, e.g. ['--per-page', '--status']. */
export function optionFlags(cmd) {
  return cmd.options.map((o) => o.long).filter(Boolean);
}
