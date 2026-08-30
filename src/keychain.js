import { spawnSync } from 'node:child_process';

const SERVICE = 'kit-cli';
const SECURITY_PATH = '/usr/bin/security';
const TIMEOUT_MS = 10_000;
const ERR_ITEM_NOT_FOUND = 44;

export class KeychainError extends Error {
  constructor(message) {
    super(message);
    this.name = 'KeychainError';
  }
}

/** True only on macOS, and only when KIT_CREDENTIAL_STORE hasn't forced the
 *  plaintext file instead. */
export function isAvailable() {
  return process.platform === 'darwin' && process.env.KIT_CREDENTIAL_STORE !== 'file';
}

/** The real call to /usr/bin/security. A named function (not inlined) so
 *  tests can substitute a fake one via the `run` option below — real ES
 *  module exports can't be monkey-patched, so this is plain dependency
 *  injection instead of a mocking library. */
function defaultRun(args) {
  return spawnSync(SECURITY_PATH, args, { encoding: 'utf8', timeout: TIMEOUT_MS });
}

function invoke(args, run) {
  const result = run(args);
  // Check signal before error: a timeout sets both, and "killed by signal"
  // is the more accurate message for that case.
  if (result.signal) {
    throw new KeychainError(`${SECURITY_PATH} was killed by signal ${result.signal} (it may have timed out)`);
  }
  if (result.error) {
    throw new KeychainError(`${SECURITY_PATH} failed to run: ${result.error.message}`);
  }
  return result;
}

/**
 * Reads and JSON-parses the Keychain item for `account`. Returns null if no
 * such item exists yet. Throws KeychainError for anything else (locked
 * Keychain, denied prompt, timeout, corrupt stored value).
 */
export function readCredentials(account, { run = defaultRun } = {}) {
  const result = invoke(['find-generic-password', '-a', account, '-s', SERVICE, '-w'], run);

  if (result.status === ERR_ITEM_NOT_FOUND) return null;
  if (result.status !== 0) {
    throw new KeychainError(`security find-generic-password exited ${result.status}: ${(result.stderr || '').trim()}`);
  }

  try {
    return JSON.parse(result.stdout.trim());
  } catch (err) {
    throw new KeychainError(`Keychain item for "${account}" is not valid JSON: ${err.message}`);
  }
}

/**
 * JSON-stringifies `credentials` and stores it for `account`, replacing any
 * existing item (-U, so a second write doesn't fail as a duplicate). Throws
 * KeychainError on failure.
 */
export function writeCredentials(account, credentials, { run = defaultRun } = {}) {
  const result = invoke(
    ['add-generic-password', '-a', account, '-s', SERVICE, '-w', JSON.stringify(credentials), '-U'],
    run
  );

  if (result.status !== 0) {
    throw new KeychainError(`security add-generic-password exited ${result.status}: ${(result.stderr || '').trim()}`);
  }
}
