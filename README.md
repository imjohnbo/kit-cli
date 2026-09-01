# kit-cli

A fully featured CLI for the [Kit](https://kit.com) (ConvertKit) email marketing API (V4). Includes a [Claude Code](https://claude.ai/claude-code) skill for AI-assisted account management.

## Install

> **Not on npm yet.** The release pipeline is ready but nothing is published, so
> install from GitHub for now. The version is `0.0.x` and the command surface may
> still change. See [`docs/RELEASING.md`](docs/RELEASING.md).

Requires Node.js 20+. Every method installs the same `kit` command.

### From GitHub

```
npm install -g github:imjohnbo/kit-cli
```

This installs the current `main`. To move to a newer `main`, run the same command
again. `kit upgrade` cannot help until the package is on npm, and it says so.

Pin to a commit or tag if you want a fixed version:

```
npm install -g github:imjohnbo/kit-cli#<commit-or-tag>
```

### From a clone, for development

```
git clone https://github.com/imjohnbo/kit-cli
cd kit-cli
npm install
npm link
```

`npm link` points the global `kit` at your working tree, so edits take effect
with no reinstall. `kit upgrade` detects this and tells you to use `git pull`
rather than trying to install over your checkout.

Run `npm unlink -g @imjohnbo/kit-cli` to undo it.

### From npm, once published

```
npm install -g @imjohnbo/kit-cli
```

Then `kit upgrade` keeps it current. It hands the work to whichever package
manager installed the CLI, so npm keeps verifying the download.

### Verifying what you installed

A GitHub install carries no attestation, because npm builds it from the git tree
on your machine. Published releases do:

```
npm audit signatures
```

CI also proves the published tarball is byte-for-byte the source tree before it
publishes. See [`docs/RELEASING.md`](docs/RELEASING.md).

## Authentication

### OAuth (recommended)

1. Register an OAuth app at [Kit Developer Settings](https://app.kit.com/account_settings/developer_settings)
2. Set up a redirect shim — an HTTPS page that forwards the browser back to your local CLI server. See [`docs/callback.html`](docs/callback.html) for a template you can host (e.g. GitHub Pages). Register its URL as the app's Redirect URI.
3. Configure and log in:

```
kit config set-client-id <id>
kit config set-redirect-uri <https://your-shim-url>
kit login
```

Tokens are stored locally and refreshed automatically. Run `kit logout` to clear them.

### API key

```
kit config set-api-key <key>
# or: export KIT_API_KEY=<key>
```

When both are present, OAuth takes priority.

### Separate profiles

`KIT_CONFIG_DIR` moves the config file. Point it at one directory per Kit account
to keep credentials apart:

```
KIT_CONFIG_DIR=~/.kit/work kit login
KIT_CONFIG_DIR=~/.kit/personal kit login
```

### Targeting a different environment

By default the CLI talks to production (`https://api.kit.com/v4`). To point it at a different environment (e.g. a staging or test instance), override the API base URL:

```
kit config set-base-url https://api.example.com/v4
# or, per-invocation without changing stored config:
export KIT_API_BASE=https://api.example.com/v4
```

OAuth authorize/token endpoints derive from this base, so logging in targets the same environment. OAuth apps and credentials are environment-specific — register an app in that environment's developer settings and use its client ID.

### Where credentials are stored

On macOS, `kit login`'s OAuth tokens and `kit config set-api-key`'s API key
are stored in your login Keychain (service `kit-cli`), not in the config
file — real encryption at rest, not just file permissions. The first access
may show a one-time Keychain permission prompt; choose "Always Allow" to
avoid seeing it again.

Everywhere else, and if the Keychain is ever unavailable (locked, denied,
or a restricted environment), credentials fall back to the config file with
`0600` (owner-only) permissions — the previous behavior, unchanged. A
fallback prints a one-line warning so you know it happened.

That fallback reads whatever plaintext value is already in the config file,
which is blank once a credential has migrated into the Keychain. So if the
Keychain becomes unavailable in a *later* process — a locked login keychain
over SSH, a cron/launchd job, "Always Allow" revoked — after an *earlier*
process already migrated your credentials, you may see "Not authenticated"
even though the credential is still intact in the Keychain. Re-running
`kit login` (or `kit config set-api-key`) resolves it; nothing is lost.

Force file storage on any platform, including macOS, with:

```
export KIT_CREDENTIAL_STORE=file
```

Run `kit config show` to see which backend is actually in use — its
`credentialStore` line reports `macOS Keychain` or `file (plaintext)`.

Existing plaintext credentials from before this feature migrate into the
Keychain automatically the next time they're read; nothing to do manually.

## Shell completion

```
eval "$(kit completion bash)"   # add to ~/.bashrc
eval "$(kit completion zsh)"    # add to ~/.zshrc, after compinit
kit completion fish | source    # add to ~/.config/fish/config.fish
```

Completions cover command and subcommand names, plus flags — not argument values like subscriber IDs.

## Commands

```
kit login                     Authenticate via OAuth (PKCE)
kit logout                    Clear stored OAuth tokens
kit config show               Show all config and auth status
```

### account

```
account                       View account info
account colors
account set-colors <hex...>   Replace brand colors (up to 10)
account creator-profile
account email-stats
account growth-stats [options]
```

### subscribers

```
list [options]
get [options] <id>
filter [options]              Filter by engagement, sign-up date, state, tags
create [options] <email>
update [options] <id>
unsubscribe <id>
tags [options] <id>
stats [options] <id>
location pin [options] <id>     Pin an explicit location
location update [options] <id>  Replace a pinned location
location delete <id>            Remove a pinned location
```

Kit infers a subscriber's location from open events. `location pin` overrides that
with an explicit one. Both `pin` and `update` require `--city`,
`--state-province`, `--country-code`, `--latitude`, `--longitude`, and
`--time-zone`, because the API replaces the whole location rather than merging.

`list` returns slim responses by default, dropping the `fields` object (custom
field values). Pass `--no-slim` when you need it. The same default applies to
`broadcasts list`, `tags subscribers`, and `forms subscribers`. Those four are
the V4 endpoints that accept `slim`. Slim mode skips the joins behind those
fields, so it is faster as well as smaller.

`filter` reads its conditions from `--json <json>` or `--file <path>`, as either a
bare conditions array or a full body with an `all` key:

```
kit subscribers filter --json '[{"type":"subscriber_state","states":["active"]}]'
kit subscribers filter --file conditions.json --include tags,stats --stats-start 2026-05-01
```

`create` and `update` print a warning on stderr when the API ignores a custom
field key. Keys are the field's `key`, not its label, so `last_name` rather than
`Last Name`.

### tags

```
list [options]
create <name>
update <id> <name>            Rename a tag
subscribers [options] <tagId>
add <tagId> <subscriberId>
add-by-email <tagId> <email>
remove <tagId> <subscriberId>
remove-by-email <tagId> <email>
```

`subscribers` filters on `--state`, `--created-after`, `--created-before`,
`--tagged-after`, and `--tagged-before`.

### forms

```
list [options]
subscribers [options] <formId>
add <formId> <subscriberId>
add-by-email <formId> <email>
```

### sequences

```
list [options]
get [options] <id>
create [options] --name <name>
update [options] <id>
delete <id>
subscribers [options] <sequenceId>
add <sequenceId> <subscriberId>
add-by-email <sequenceId> <email>
emails list [options] <sequenceId>
emails get [options] <sequenceId> <id>
emails create [options] <sequenceId> --subject <s> --delay-value <n> --delay-unit <days|hours>
emails update [options] <sequenceId> <id>
emails delete <sequenceId> <id>
```

`list` and `get` take `--include stats`. `emails list` also takes
`--include-content`.

### broadcasts

```
list [options]
get [options] <id>
create [options]
update [options] <id>
delete <id>
stats [options] [id]          One broadcast, or every broadcast with no ID
clicks [options] <id>         Link click stats
```

`list` and `stats` filter on `--status <draft|scheduled|sending|completed|aborted>`,
`--sent-after`, and `--sent-before`.

### custom-fields

```
list [options]
create <label>
update <id> <label>
delete <id>
```

### purchases

```
list [options]
get [options] <id>
create --file <path>          Record a purchase from JSON
```

### webhooks

One webhook subscribes to many event types and receives signed, automatically
retried deliveries. This is the `/webhook_endpoints` resource, the current
generation of Kit webhooks — recommended for all new integrations. The older
`/webhooks` resource still works on the API but has no CLI command here.

```
list [options]                 --status <active|disabled>
get [options] <id>
create [options] <url> <events>   events is comma-separated, e.g. subscriber.created,custom_field.created
update [options] <id>          --name, --url, --description, --status, --events
delete <id>
rotate-secret [options] <id>   --force
revoke-previous-secret [options] <id>
```

`create` and `rotate-secret` are the only two responses that ever include the
signing `secret` in plaintext — store it right away. `update --events`
replaces the webhook's entire subscription list, not just the additions.

### posts

```
list [options]                --include-content for post bodies
get [options] <id>
```

### snippets

```
list [options]                --snippet-type <inline|block>, --archived
get [options] <id>
create [options] <name> --type <inline|block>
update [options] <id>         --name, --content, --html, --archive, --restore
```

An inline snippet holds Liquid text, passed with `--content`. A block snippet
holds HTML, passed with `--html`.

### upgrade

```
upgrade                       Upgrade to the newest published version
upgrade --check               Report the newest version, install nothing
upgrade --dry-run             Show the command that would run
```

`kit upgrade` detects how the CLI was installed and delegates to that package
manager. It never downloads or unpacks a release itself.

The CLI also prints a one-line notice on stderr when a newer version exists. It
reads a cached version number, so it never delays a command. A background request
refreshes the cache at most once a day. Turn it off with
`kit config set-update-check false`, or with `KIT_NO_UPDATE_CHECK=1`. It stays off
whenever `CI` is set.

### segments · email-templates

```
list [options]
```

### bulk (requires OAuth)

All bulk commands take `--file <path>` (JSON array) and optional `--callback-url <url>`. Batches of ≤100 are processed synchronously (results returned immediately); larger batches are queued asynchronously and POSTed to the callback URL when complete.

```
bulk subscribers create --file <path>           [{email_address, first_name?, state?}, ...]
bulk tags create        --file <path>           [{name}, ...]
bulk tags delete        --file <path>           [{id}, ...]
bulk tags add           --file <path>           [{tag_id, subscriber_id}, ...]
bulk tags remove        --file <path>           [{tag_id, subscriber_id}, ...]
bulk forms add          --file <path>           [{form_id, subscriber_id, referrer?}, ...]
bulk custom-fields create       --file <path>   [{label}, ...]
bulk custom-fields update-values --file <path>  [{subscriber_id, subscriber_custom_field_id, value}, ...]
```

### Global list options

```
-f, --format <table|json>   output format (default: table)
--per-page <n>              results per page, max 1000 (default: 50)
--after <cursor>            next page cursor
--before <cursor>           previous page cursor
```

Run `kit <command> --help` for full flag details on any command.

## API coverage

[`spec/coverage.js`](spec/coverage.js) maps every operation in the stored API spec
to the command that reaches it. A test holds the map to the spec and to the
command tree, so a spec change that adds or drops an endpoint fails the suite
until someone triages it, and the map can never name a command that no longer
exists. Today it covers all 73 operations.

## Claude Code Skill

```
kit setup-skill
```

Installs the `/kit` skill to `~/.claude/skills/kit/`. Then in Claude Code:

```
/kit list my subscribers
/kit create a broadcast about our new product launch
/kit tag subscriber jane@example.com with "vip"
```

## Telemetry

kit sends anonymous usage data — which command ran, whether it succeeded,
and basic environment info like CLI/Node version and OS — and, on a crash,
an error report. It never includes the arguments, flags, request/response
bodies, or output of a command, which routinely carry subscriber emails and
content.

Turn it off:

```
kit config set-telemetry false
# or, for a single invocation or in CI:
export KIT_NO_TELEMETRY=1
```

It's also off automatically when `CI` is set, and respects the `DO_NOT_TRACK`
convention some other CLIs use.

## Security

- Config file is stored with `600` permissions (owner-only). Contains API key and OAuth tokens.
- OAuth tokens auto-refresh 5 minutes before expiry. Run `kit logout` to clear.
- All IDs are validated before URL interpolation to prevent path traversal.
- Auto-pagination is capped at 100 pages.
- Releases publish only from a tagged commit, and only after a manual approval.
- Published packages carry npm provenance. CI proves the tarball equals the
  source before publishing. See [`docs/RELEASING.md`](docs/RELEASING.md).
- `kit upgrade` delegates to your package manager. It never fetches and executes
  code on its own.

## Support

Found a bug or have a feature request for the CLI itself? [Open an
issue](https://github.com/imjohnbo/kit-cli/issues).

For help with your Kit account, subscribers, or the API, use Kit's own
support channels — this project isn't an official Kit product (yet).

## License

MIT
