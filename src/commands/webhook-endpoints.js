import { Command } from 'commander';
import { get, post, del, validatePathSegment } from '../client.js';
import {
  formatOutput,
  printSuccess,
  printPagination,
  printDetail,
  addFormatOption,
  addPaginationOptions,
  withErrorHandler,
} from '../output.js';

// Webhooks 2.0 event types — used by POST /v4/webhook_endpoints. Mirrors
// Webhooks::EventTypes::ALL in the Kit app. These are distinct from the legacy
// /v4/webhooks event names used by `kit webhooks` (e.g. subscriber.tag_added
// here vs subscriber.tag_add there).
export const EVENT_TYPES = [
  'subscriber.activated',
  'subscriber.created',
  'subscriber.unsubscribed',
  'subscriber.bounced',
  'subscriber.complained',
  'subscriber.subscribed_to_form',
  'subscriber.added_to_sequence',
  'subscriber.sequence_completed',
  'subscriber.tag_added',
  'subscriber.tag_removed',
  'subscriber.product_purchased',
  'subscriber.link_clicked',
  'subscriber.email_opened',
  'subscriber.custom_field_value_updated',
  'tag.created',
  'tag.deleted',
  'custom_field.created',
  'custom_field.deleted',
  'broadcast.created',
  'broadcast.sent',
  'broadcast.deleted',
  'sequence.created',
  'sequence.deleted',
  'sequence.published',
  'sequence.disabled',
  'sequence.email_sent',
  'landing_page.created',
  'landing_page.deleted',
  'webhook_endpoint.test',
];

/** Parse a comma-separated --events value into a clean, de-duplicated list. */
export function parseEvents(value) {
  return [...new Set(String(value).split(',').map((s) => s.trim()).filter(Boolean))];
}

/** Return the subset of events that are not recognized event types. */
export function invalidEvents(events) {
  return events.filter((e) => !EVENT_TYPES.includes(e));
}

const WE_COLUMNS = [
  { header: 'ID', accessor: (d) => d.id },
  { header: 'Name', accessor: (d) => d.name },
  { header: 'URL', accessor: (d) => d.url },
  { header: 'Events', accessor: (d) => (d.events || []).join(', ') },
  { header: 'Status', accessor: (d) => d.status },
];

const WE_DETAIL = [
  { label: 'ID', accessor: (d) => d.id },
  { label: 'Name', accessor: (d) => d.name },
  { label: 'URL', accessor: (d) => d.url },
  { label: 'Events', accessor: (d) => (d.events || []).join(', ') },
  { label: 'Status', accessor: (d) => d.status },
  { label: 'Description', accessor: (d) => d.description },
  { label: 'Created At', accessor: (d) => d.created_at },
];

export function webhookEndpointsCommand() {
  const cmd = new Command('webhook-endpoints').description('Manage webhook endpoints (Webhooks 2.0)');

  // List webhook endpoints
  const list = cmd.command('list').description('List webhook endpoints');
  list.option('-s, --status <status>', 'filter by status (e.g. active)');
  addFormatOption(list);
  addPaginationOptions(list);
  list.action(
    withErrorHandler(async (opts) => {
      const query = {
        per_page: opts.perPage,
        after: opts.after,
        before: opts.before,
        status: opts.status,
      };
      const res = await get('/webhook_endpoints', query);
      formatOutput(res.webhook_endpoints, WE_COLUMNS, opts);
      printPagination(res.pagination);
    })
  );

  // Create webhook endpoint
  cmd
    .command('create <url>')
    .description('Create a webhook endpoint')
    .requiredOption(
      '--events <list>',
      'comma-separated event types (e.g. subscriber.created,tag.created)',
      parseEvents
    )
    .option('--name <name>', 'endpoint name (defaults to one derived from the URL)')
    .option('--description <description>', 'optional description')
    .addHelpText(
      'after',
      `\nAvailable event types:\n${EVENT_TYPES.map((e) => `  ${e}`).join('\n')}`
    )
    .action(
      withErrorHandler(async (url, opts) => {
        try {
          new URL(url);
        } catch {
          console.error(`Invalid URL: "${url}". Must be a valid URL (e.g., https://example.com/webhook).`);
          process.exit(1);
        }

        const bad = invalidEvents(opts.events);
        if (bad.length) {
          console.error(`Invalid event type(s): ${bad.join(', ')}.`);
          console.error(`Available: ${EVENT_TYPES.join(', ')}`);
          process.exit(1);
        }

        const body = { url, events: opts.events };
        if (opts.name) body.name = opts.name;
        if (opts.description) body.description = opts.description;

        const res = await post('/webhook_endpoints', body);
        const we = res.webhook_endpoint || res;
        printSuccess(`Webhook endpoint created: ${we.id}`);
        printDetail(we, WE_DETAIL);
      })
    );

  // Delete webhook endpoint
  cmd
    .command('delete <id>')
    .description('Delete a webhook endpoint')
    .action(
      withErrorHandler(async (id) => {
        const safeId = validatePathSegment(id, 'webhook endpoint ID');
        await del(`/webhook_endpoints/${safeId}`);
        printSuccess(`Webhook endpoint ${id} deleted.`);
      })
    );

  return cmd;
}
