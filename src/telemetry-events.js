/**
 * Maps every CLI command to its event name, in Kit's {Object} {Action}
 * Title Case convention (e.g. "Subscriber Created", "Tags Listed"). These
 * events land in the same Segment -> Mixpanel pipeline as the rest of the
 * product, so the naming follows Kit's event taxonomy standard rather than
 * inventing a CLI-specific shape.
 *
 * scripts/telemetry-events.test.js holds this map to the command tree the
 * same way spec/coverage.js is held to the API spec: a command added
 * without an entry here fails a test until someone names its event, or adds
 * it to NO_EVENT with a reason.
 *
 * A name is reused across several commands on purpose — e.g. every
 * `config set-*` command fires "CLI Config Updated". The object should stay
 * as generic as possible; specifics belong in trackCommand()'s properties,
 * not in a longer event name. That's not a hand-wave: trackCommand() sends
 * the actual command path as a `command` property on every event (see
 * telemetry.js), so a reused name never loses the ability to tell
 * `config set-telemetry` apart from `config set-base-url` — Kit's data team
 * can always filter or group by it.
 */
export const EVENT_NAMES = {
  // ── Account ──────────────────────────────────────────────────────────────
  'account':                     'Account Viewed',
  'account colors':              'Account Colors Viewed',
  'account creator-profile':     'Creator Profile Viewed',
  'account email-stats':         'Account Email Stats Viewed',
  'account growth-stats':        'Account Growth Stats Viewed',
  'account set-colors':          'Account Colors Updated',

  // ── API escape hatch ─────────────────────────────────────────────────────
  'api':                         'API Request Sent',

  // ── Broadcasts ───────────────────────────────────────────────────────────
  'broadcasts clicks':           'Broadcast Clicks Viewed',
  'broadcasts create':           'Broadcast Created',
  'broadcasts delete':           'Broadcast Deleted',
  'broadcasts get':              'Broadcast Viewed',
  'broadcasts list':             'Broadcasts Listed',
  'broadcasts stats':            'Broadcast Stats Viewed',
  'broadcasts update':           'Broadcast Updated',

  // ── Bulk ─────────────────────────────────────────────────────────────────
  'bulk custom-fields create':          'Custom Fields Created',
  'bulk custom-fields update-values':   'Custom Field Values Updated',
  'bulk forms add':                     'Subscribers Added to Forms',
  'bulk subscribers create':            'Subscribers Created',
  'bulk tags add':                      'Subscribers Tagged',
  'bulk tags create':                   'Tags Created',
  'bulk tags delete':                   'Tags Deleted',
  'bulk tags remove':                   'Subscribers Untagged',

  // ── CLI config and utility commands ─────────────────────────────────────
  'config set-api-key':          'CLI Config Updated',
  'config set-base-url':         'CLI Config Updated',
  'config set-client-id':        'CLI Config Updated',
  'config set-format':           'CLI Config Updated',
  'config set-per-page':         'CLI Config Updated',
  'config set-redirect-uri':     'CLI Config Updated',
  'config set-telemetry':        'CLI Config Updated',
  'config set-update-check':     'CLI Config Updated',
  'config show':                 'CLI Config Viewed',
  'doctor':                      'CLI Doctor Run',
  'init':                        'CLI Onboarding Started',
  'login':                       'CLI Signed In',
  'logout':                      'CLI Signed Out',
  'setup-skill':                 'Claude Skill Installed',
  'upgrade':                     'CLI Upgrade Run',

  // ── Custom fields ────────────────────────────────────────────────────────
  'custom-fields create':        'Custom Field Created',
  'custom-fields delete':        'Custom Field Deleted',
  'custom-fields list':          'Custom Fields Listed',
  'custom-fields update':        'Custom Field Renamed',

  // ── Email templates ──────────────────────────────────────────────────────
  'email-templates list':        'Email Templates Listed',

  // ── Forms ────────────────────────────────────────────────────────────────
  'forms add':                   'Subscriber Added to Form',
  'forms add-by-email':          'Subscriber Added to Form',
  'forms list':                  'Forms Listed',
  'forms subscribers':           'Form Subscribers Listed',

  // ── Posts ────────────────────────────────────────────────────────────────
  'posts get':                   'Post Viewed',
  'posts list':                  'Posts Listed',

  // ── Purchases ────────────────────────────────────────────────────────────
  'purchases create':            'Purchase Created',
  'purchases get':               'Purchase Viewed',
  'purchases list':              'Purchases Listed',

  // ── Segments ─────────────────────────────────────────────────────────────
  'segments list':               'Segments Listed',

  // ── Sequences ────────────────────────────────────────────────────────────
  'sequences add':                'Subscriber Added to Sequence',
  'sequences add-by-email':       'Subscriber Added to Sequence',
  'sequences create':             'Sequence Created',
  'sequences delete':             'Sequence Deleted',
  'sequences emails create':      'Sequence Email Created',
  'sequences emails delete':      'Sequence Email Deleted',
  'sequences emails get':         'Sequence Email Viewed',
  'sequences emails list':        'Sequence Emails Listed',
  'sequences emails update':      'Sequence Email Updated',
  'sequences get':                'Sequence Viewed',
  'sequences list':               'Sequences Listed',
  'sequences subscribers':        'Sequence Subscribers Listed',
  'sequences update':             'Sequence Updated',

  // ── Snippets ─────────────────────────────────────────────────────────────
  'snippets create':             'Snippet Created',
  'snippets get':                'Snippet Viewed',
  'snippets list':               'Snippets Listed',
  'snippets update':             'Snippet Updated',

  // ── Subscribers ──────────────────────────────────────────────────────────
  'subscribers create':               'Subscriber Created',
  'subscribers filter':               'Subscribers Filtered',
  'subscribers get':                  'Subscriber Viewed',
  'subscribers list':                 'Subscribers Listed',
  'subscribers location delete':      'Subscriber Location Unpinned',
  'subscribers location pin':         'Subscriber Location Pinned',
  'subscribers location update':      'Subscriber Location Updated',
  'subscribers stats':                'Subscriber Stats Viewed',
  'subscribers tags':                 'Subscriber Tags Listed',
  'subscribers unsubscribe':          'Subscriber Unsubscribed',
  'subscribers update':               'Subscriber Updated',

  // ── Tags ─────────────────────────────────────────────────────────────────
  'tags add':                    'Subscriber Tagged',
  'tags add-by-email':           'Subscriber Tagged',
  'tags create':                 'Tag Created',
  'tags list':                   'Tags Listed',
  'tags remove':                 'Subscriber Untagged',
  'tags remove-by-email':        'Subscriber Untagged',
  'tags subscribers':            'Tag Subscribers Listed',
  'tags update':                 'Tag Renamed',

  // ── Webhooks ─────────────────────────────────────────────────────────────
  'webhooks create':                    'Webhook Created',
  'webhooks delete':                    'Webhook Deleted',
  'webhooks get':                       'Webhook Viewed',
  'webhooks list':                      'Webhooks Listed',
  'webhooks revoke-previous-secret':    'Webhook Previous Secret Revoked',
  'webhooks rotate-secret':             'Webhook Secret Rotated',
  'webhooks update':                    'Webhook Updated',
};

/**
 * Command paths that exist in the tree but never fire an event, with the
 * reason. These are pure grouping commands with no action of their own —
 * Commander shows help when one is invoked bare, so withErrorHandler (and
 * therefore trackCommand) never runs for them.
 */
const GROUP_ONLY = 'Group command; only its own subcommands have an action, so no event ever fires for this path.';

export const NO_EVENT = {
  'broadcasts':            GROUP_ONLY,
  'bulk':                  GROUP_ONLY,
  'bulk custom-fields':    GROUP_ONLY,
  'bulk forms':            GROUP_ONLY,
  'bulk subscribers':      GROUP_ONLY,
  'bulk tags':             GROUP_ONLY,
  'config':                GROUP_ONLY,
  'custom-fields':         GROUP_ONLY,
  'email-templates':       GROUP_ONLY,
  'forms':                 GROUP_ONLY,
  'posts':                 GROUP_ONLY,
  'purchases':             GROUP_ONLY,
  'segments':              GROUP_ONLY,
  'sequences':             GROUP_ONLY,
  'sequences emails':      GROUP_ONLY,
  'snippets':              GROUP_ONLY,
  'subscribers':           GROUP_ONLY,
  'subscribers location':  GROUP_ONLY,
  'tags':                  GROUP_ONLY,
  'webhooks':              GROUP_ONLY,
};
