# macOS Keychain credential storage — design

## Problem

`kit login` and `kit config set-api-key` store the OAuth tokens and API key as
plaintext JSON, via the `conf` package
([`src/config.js`](../../../src/config.js)). The only protection is
`chmodSync(config.path, 0o600)` — owner-only file permissions, which is access
control, not encryption at rest. Anyone with root, a home-directory backup, or
another process running as the same user can read the file directly.

This design adds real encryption-at-rest for these secrets on macOS by storing
them in the user's login Keychain instead, while leaving every other platform
exactly as it is today.

## Scope

**macOS only for v1.** CI runs exclusively on `ubuntu-latest`
(`.github/workflows/test.yml`, `release.yml`, `check-api-spec.yml`), and
desktop Linux keyrings (GNOME Keyring / KWallet via `secret-tool`) are
unreliable outside a live GUI session, so a Linux implementation would mostly
hit the fallback path anyway. Windows Credential Manager has no scriptable
retrieval via a built-in CLI (`cmdkey` can't read a stored secret back), and a
proper implementation needs either a native dependency or a
DPAPI-via-PowerShell shell-out — deferred. Every non-macOS platform keeps
today's file-based storage, completely unchanged, no regression risk.

Only three fields are treated as secrets and move behind the new storage
layer: `apiKey`, `accessToken`, `refreshToken`. Everything else in the config
(`baseUrl`, `tokenExpiresAt`, `oauthClientId`, `oauthRedirectUri`,
`defaultFormat`, `perPage`, the update-check cache) stays in the plaintext
`conf` JSON file exactly as today — none of it is sensitive.

## Architecture

One new module, `src/keychain.js`, wraps macOS's built-in `/usr/bin/security`
CLI via `spawnSync` with an argv array (never a shell string — the secret
value is never interpolated into a shell command, which would risk injection;
it's passed as a literal argv element to `security` directly).

`/usr/bin/security` was chosen over a native dependency
(e.g. `@napi-rs/keyring`) for two reasons:

1. **Zero new dependencies.** This repo currently depends on only `chalk`,
   `cli-table3`, `commander`, and `conf` — deliberately lean, with an
   emphasis on install reliability (`npm install -g github:imjohnbo/kit-cli`)
   and reproducible releases (`docs/RELEASING.md`'s tarball verification).
2. **Stable Keychain ACL identity.** macOS ties a Keychain item's "Always
   Allow" grant to the calling process's code signature/path. `/usr/bin/security`
   is a fixed, Apple-signed binary at a fixed path — the grant is stable
   forever. A native Node addon runs in-process, so the grant would instead be
   tied to node's own binary path, which changes across nvm/Homebrew/Volta
   installs and Node upgrades — meaning the permission prompt could
   reappear unpredictably, and in principle any script run with that same
   node binary shares the same grant.

**Accepted trade-off:** `security add-generic-password -w <secret>` takes the
secret as a literal command-line argument, which is briefly visible to other
processes owned by the same local user (e.g. via `ps -ww`) for the
subprocess's short lifetime. This was weighed against the native-dependency
option and explicitly accepted in exchange for the two benefits above.

## Storage shape

All three secrets for one profile live in a **single Keychain item** as a
JSON blob: `{"apiKey": "...", "accessToken": "...", "refreshToken": "..."}`.
Service name: `kit-cli`.

**Account name = the resolved config directory itself**
(`dirname(config.path)`). This one rule automatically isolates every
`KIT_CONFIG_DIR` profile (e.g. `~/.kit/work`, `~/.kit/personal`, or the
default `~/Library/Preferences/kit-cli-nodejs`) into its own Keychain entry
with no extra bookkeeping, and it's human-readable when inspecting the item in
Keychain Access.app.

## `src/keychain.js` interface

```js
// All functions are macOS-appropriate no-ops / graceful failures on other
// platforms — callers in config.js check isAvailable() first.

/** True on macOS, when KIT_CREDENTIAL_STORE !== 'file'. Does not itself
 *  probe `security` — availability of the *binary* is assumed on macOS. */
export function isAvailable();

/** Reads and JSON-parses the blob for `account`. Returns null if the item
 *  doesn't exist (security exit code 44) or the account has never been used.
 *  Throws KeychainError for any other failure (locked, denied, timeout). */
export function readCredentials(account);

/** JSON-stringifies `obj` and stores it, adding (-U to update in place if
 *  the item already exists). Throws KeychainError on failure. */
export function writeCredentials(account, obj);

/** Deletes the item for `account`. A missing item (exit 44) is not an
 *  error. Throws KeychainError for any other failure. */
export function deleteCredentials(account);
```

Every `security` invocation runs with a **10-second timeout**
(`spawnSync(..., { timeout: 10_000 })`), so a permission prompt with no GUI to
answer it (e.g. an SSH session) can't hang the CLI indefinitely — a timeout is
treated the same as any other `KeychainError`.

Exit code 44 (`errSecItemNotFound`) is the one expected, non-error outcome
across all three functions (read → `null`, delete → no-op). Every other
non-zero exit becomes a thrown `KeychainError` with the captured stderr, for
the caller to decide how to react.

## `src/config.js` changes

A small internal layer sits in front of the three secret fields:

- `readSecretField(field)` — for `apiKey`, the `KIT_API_KEY` env var still
  wins first, exactly as today (`accessToken`/`refreshToken` have no env
  override, before or after this change). Otherwise: if Keychain is available, try
  `readCredentials(account)` and return `blob?.[field]`. On any
  `KeychainError`, print a one-line warning to stderr and fall through to the
  legacy plaintext `conf` field for that read. If Keychain is unavailable
  (non-macOS, or `KIT_CREDENTIAL_STORE=file`), read the plaintext `conf`
  field directly — today's exact behavior.

- `writeSecretField(field, value)` — if Keychain is available: read the
  existing blob (or `{}` if none), set `field`, write it back via
  `writeCredentials`. On `KeychainError`, print a one-line warning and fall
  back to writing the plaintext `conf` field instead (the value is never
  lost). If Keychain is unavailable, write the plaintext `conf` field
  directly.

- **Migration**, performed inside the read path: if Keychain is available,
  the blob doesn't exist yet (fresh account), and the legacy plaintext file
  has a non-empty value for `apiKey`, `accessToken`, or `refreshToken`,
  build a blob from whatever of those three is present and
  `writeCredentials(account, blob)`. **Only after that write succeeds**,
  blank the corresponding plaintext fields in the file
  (`config.set('apiKey', '')`, etc.) — if the Keychain write throws, the
  plaintext fields are left untouched and nothing is migrated this run (it
  will be retried on the next invocation).

`getApiKey`/`setApiKey`, `getAccessToken`/`getRefreshToken`/`setTokens`
route through `readSecretField`/`writeSecretField`. `clearTokens()` /
`kit logout` write the blob with `accessToken` and `refreshToken` blanked but
`apiKey` preserved — matching `clearTokens()`'s existing scope exactly — and
still zero the plaintext `tokenExpiresAt` field as today.

`chmodSync(config.path, 0o600)` stays exactly as it is (belt-and-suspenders,
and still the *only* protection on non-macOS platforms).

## User-facing surface

- **`KIT_CREDENTIAL_STORE=file`** env var forces plaintext-file storage on
  any platform, including macOS. No new CLI flag or persisted config setting
  — this one env var is the entire manual override, checked fresh on every
  invocation.
- **`kit config show`** gains one line reporting which backend is actually
  active: `macOS Keychain`, `file (plaintext)`, or
  `file (plaintext, forced via KIT_CREDENTIAL_STORE)`. This becomes the
  CLI's live, honest answer to "are my credentials encrypted at rest."
- No new commands, no new flags on existing commands — `spec/coverage.js` and
  `spec/cli-surface.json` need no changes.

## Testing

`scripts/run-tests.js` sets `KIT_CREDENTIAL_STORE=file` for the whole test
run. Combined with the existing `KIT_CONFIG_DIR` sandboxing in
`scripts/helpers.js`, this makes the plaintext file the real storage layer
during every existing test — **no existing test file needs to change**, and
critically, `npm test` will never invoke the real `security` binary or pop a
Keychain permission prompt on a contributor's Mac.

New coverage:

- **`scripts/keychain.test.js`** — exercises `src/keychain.js` against a
  fake `security` runner injected in place of the real `spawnSync` call
  (never the real binary): the blob read/write/delete shape, exit-code-44
  treated as "not found" rather than an error, the 10-second timeout being
  applied, and any other non-zero exit surfacing as `KeychainError`.
- **Additions to `scripts/config.test.js`** — the migration logic
  (plaintext-present + empty-Keychain-blob → migrates and blanks the file;
  Keychain write failure → file is left untouched) and the
  `writeSecretField`/`readSecretField` fallback-with-warning behavior, all
  against the same fake backend.

## Explicit non-goals for this iteration

- Windows Credential Manager / DPAPI support.
- Linux Secret Service (`secret-tool`) support.
- A persisted "always use file storage" config setting — the env var is the
  only override.
- Encrypting the non-secret config fields (`baseUrl`, preferences, etc.) —
  they were never sensitive.
- Re-encrypting or rotating already-migrated Keychain blobs.
