# kit-cli

A fully featured CLI for the [Kit](https://kit.com) (ConvertKit) email marketing API (V4).

Manage your subscribers, tags, forms, sequences, broadcasts, custom fields, purchases, webhooks, segments, and email templates from the terminal. Includes a [Claude Code](https://claude.ai/claude-code) skill for AI-assisted account management.

## Install

```sh
npm install -g kit-cli
```

Requires Node.js 18+.

## Setup

Get your V4 API key from [Kit Developer Settings](https://app.kit.com) and configure it:

```sh
kit config set-api-key YOUR_API_KEY
```

Or set the `KIT_API_KEY` environment variable:

```sh
export KIT_API_KEY=YOUR_API_KEY
```

## Usage

```sh
kit <command> <subcommand> [options]
```

### Account

```sh
kit account                          # View account info
kit config show                      # Show CLI config
kit config set-format json           # Default to JSON output
kit config set-per-page 100          # Default page size
```

### Subscribers

```sh
kit subscribers list                 # List all subscribers
kit subscribers list -e jane@example.com  # Find by email
kit subscribers list -s active       # Filter by state
kit subscribers get 12345            # Get subscriber details
kit subscribers create user@example.com -n "Jane"  # Create/upsert
kit subscribers update 12345 -n "Jane Doe"         # Update
kit subscribers unsubscribe 12345    # Unsubscribe
kit subscribers tags 12345           # List subscriber's tags
kit subscribers stats 12345          # Engagement stats
```

### Tags

```sh
kit tags list                        # List all tags
kit tags create "VIP"                # Create a tag
kit tags subscribers 99              # List subscribers with tag
kit tags add 99 12345                # Tag subscriber by ID
kit tags add-by-email 99 jane@example.com  # Tag by email
kit tags remove 99 12345             # Remove tag
```

### Forms

```sh
kit forms list                       # List all forms
kit forms list -s active -t embed    # Filter by status/type
kit forms subscribers 42             # List form subscribers
kit forms add 42 12345               # Add subscriber to form
kit forms add-by-email 42 jane@example.com
```

### Sequences

```sh
kit sequences list                   # List all sequences
kit sequences subscribers 7          # List sequence subscribers
kit sequences add 7 12345            # Add subscriber to sequence
kit sequences add-by-email 7 jane@example.com
```

### Broadcasts

```sh
kit broadcasts list                  # List all broadcasts
kit broadcasts get 555               # Get broadcast details
kit broadcasts stats 555             # Get engagement stats
kit broadcasts create --subject "Weekly Update" --content "<p>Hello!</p>"
kit broadcasts create --subject "Sale!" --send-at 2025-12-25T09:00:00Z --tag-ids 1,2
kit broadcasts update 555 --subject "New Subject"
kit broadcasts delete 555            # Delete draft/scheduled
```

### Custom Fields

```sh
kit custom-fields list               # List all custom fields
kit custom-fields create "Last Name" # Create a custom field
kit custom-fields update 10 "Surname"  # Update label
kit custom-fields delete 10          # Delete (removes all data)
```

### Purchases, Webhooks, Segments, Templates

```sh
kit purchases list                   # List purchases
kit purchases get 200                # Get purchase details

kit webhooks list                    # List webhooks
kit webhooks create https://example.com/hook subscriber.subscriber_activate
kit webhooks delete 300              # Delete webhook

kit segments list                    # List segments
kit email-templates list             # List email templates
```

### Global Options

All list commands support:

| Flag | Description |
|------|-------------|
| `-f, --format <table\|json>` | Output format (default: table) |
| `--per-page <n>` | Results per page, max 1000 (default: 50) |
| `--after <cursor>` | Cursor for next page |
| `--before <cursor>` | Cursor for previous page |

## Claude Code Skill

This package includes a `/kit` skill for [Claude Code](https://claude.ai/claude-code) that lets you manage your Kit account with natural language.

### Install the skill

```sh
kit setup-skill
```

This copies the skill to `~/.claude/skills/kit/`, making it available in all Claude Code sessions.

### Use it

In Claude Code, type:

```
/kit list my subscribers
/kit create a broadcast about our new product launch
/kit show me stats for broadcast 12345
/kit tag subscriber jane@example.com with "vip"
```

## Security

- **API key storage**: Your API key is stored in a config file with `600` permissions (owner read/write only). Use the `KIT_API_KEY` environment variable if you prefer not to persist it to disk.
- **Input validation**: All IDs are validated before being used in API paths to prevent path traversal. Numeric options are validated. JSON inputs are parsed safely with clear error messages.
- **Rate limiting**: Kit enforces 120 requests per 60 seconds for API key auth. The CLI does not implement client-side throttling — the API will return 429 if you exceed the limit.
- **Pagination safety**: Auto-pagination is capped at 100 pages to prevent runaway loops.

## License

MIT
