# kit-cli

A fully featured CLI for the [Kit](https://kit.com) (ConvertKit) email marketing API (V4). Includes a [Claude Code](https://claude.ai/claude-code) skill for AI-assisted account management.

## Install

```
npm i && npm link
```

Requires Node.js 18+.

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

## Commands

```
kit login                     Authenticate via OAuth (PKCE)
kit logout                    Clear stored OAuth tokens
kit account                   View account info
kit config show               Show all config and auth status
```

### subscribers

```
list [options]
get [options] <id>
create [options] <email>
update [options] <id>
unsubscribe <id>
tags [options] <id>
stats [options] <id>
```

### tags

```
list [options]
create <name>
subscribers [options] <tagId>
add <tagId> <subscriberId>
add-by-email <tagId> <email>
remove <tagId> <subscriberId>
```

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
subscribers [options] <sequenceId>
add <sequenceId> <subscriberId>
add-by-email <sequenceId> <email>
```

### broadcasts

```
list [options]
get [options] <id>
create [options]
update [options] <id>
delete <id>
stats [options] <id>
```

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
```

### webhooks

```
list [options]
create [options] <targetUrl> <eventName>
delete <id>
```

### segments · email-templates

```
list [options]
```

### bulk (requires OAuth)

All bulk commands take `--file <path>` (JSON array) and optional `--callback-url <url>`. Batches of ≤100 are processed synchronously (results returned immediately); larger batches are queued asynchronously and POSTed to the callback URL when complete.

```
bulk subscribers create --file <path>           [{email_address, first_name?, state?}, ...]
bulk tags create        --file <path>           [{name}, ...]
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

## Security

- Config file is stored with `600` permissions (owner-only). Contains API key and OAuth tokens.
- OAuth tokens auto-refresh 5 minutes before expiry. Run `kit logout` to clear.
- All IDs are validated before URL interpolation to prevent path traversal.
- Auto-pagination is capped at 100 pages.

## License

MIT
