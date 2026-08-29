import { Command } from 'commander';
import chalk from 'chalk';
import { get, post, patch, del, validatePathSegment, validateEnum, parseCsvList } from '../client.js';
import {
  formatOutput,
  printDetail,
  printSuccess,
  printPagination,
  addFormatOption,
  addPaginationOptions,
  withErrorHandler,
} from '../output.js';

const STATUSES = ['active', 'disabled'];

const WEBHOOK_COLUMNS = [
  { header: 'ID', accessor: (d) => d.id },
  { header: 'Name', accessor: (d) => d.name },
  { header: 'URL', accessor: (d) => d.url },
  { header: 'Status', accessor: (d) => d.status },
  { header: 'Events', accessor: (d) => d.events?.join(', ') },
  { header: 'Created', accessor: (d) => d.created_at?.slice(0, 10) },
];

const DETAIL_FIELDS = [
  { label: 'ID', accessor: (d) => d.id },
  { label: 'Name', accessor: (d) => d.name },
  { label: 'URL', accessor: (d) => d.url },
  { label: 'Status', accessor: (d) => d.status },
  { label: 'Source', accessor: (d) => d.source },
  { label: 'Description', accessor: (d) => d.description },
  { label: 'Events', accessor: (d) => d.events?.join(', ') },
  { label: 'Created By App', accessor: (d) => d.created_by_app },
  { label: 'Created At', accessor: (d) => d.created_at },
  { label: 'Previous Secret Expires At', accessor: (d) => d.previous_secret_expires_at },
  { label: 'Secret', accessor: (d) => d.secret },
];

function assertValidUrl(url) {
  try {
    new URL(url);
  } catch {
    console.error(`Invalid URL: "${url}". Must be a valid URL (e.g., https://example.com/webhook).`);
    process.exit(1);
  }
}

/** Warns once, right after a create or rotate response, that the secret is shown only now. */
function warnSecretShownOnce(webhook, opts) {
  if (webhook.secret && opts.format !== 'json') {
    console.log(chalk.yellow('Store this signing secret now — it will not be shown again.'));
  }
}

function buildWebhookBody({ name, url, description, status, events }) {
  const body = {};
  if (name !== undefined) body.name = name;
  if (url !== undefined) body.url = url;
  if (description !== undefined) body.description = description;
  if (status !== undefined) body.status = validateEnum(status, STATUSES, 'status');
  if (events !== undefined) body.events = parseCsvList(events);
  return body;
}

export function webhooksCommand() {
  const cmd = new Command('webhooks').description(
    'Manage webhooks: one endpoint subscribes to many event types and receives signed, retried deliveries'
  );

  // List webhooks
  const list = cmd.command('list').description('List all webhooks');
  addFormatOption(list);
  addPaginationOptions(list);
  list
    .option('-s, --status <status>', `filter by status (${STATUSES.join(', ')})`)
    .action(
      withErrorHandler(async (opts) => {
        if (opts.status) validateEnum(opts.status, STATUSES, 'status');
        const query = {
          per_page: opts.perPage,
          after: opts.after,
          before: opts.before,
          status: opts.status,
        };
        const res = await get('/webhook_endpoints', query);
        formatOutput(res.webhook_endpoints, WEBHOOK_COLUMNS, opts);
        printPagination(res.pagination);
      })
    );

  // Get webhook
  const show = cmd.command('get <id>').description('Get a webhook by ID');
  addFormatOption(show);
  show.action(
    withErrorHandler(async (id, opts) => {
      const safeId = validatePathSegment(id, 'webhook ID');
      const res = await get(`/webhook_endpoints/${safeId}`);
      printDetail(res.webhook_endpoint || res, DETAIL_FIELDS, opts);
    })
  );

  // Create webhook
  const create = cmd
    .command('create <url> <events>')
    .description('Create a webhook (events is a comma-separated list, e.g. subscriber.created,custom_field.created)')
    .option('--name <name>', 'webhook name')
    .option('--description <text>', 'webhook description');
  addFormatOption(create);
  create.action(
    withErrorHandler(async (url, events, opts) => {
      assertValidUrl(url);
      const body = { url, events: parseCsvList(events) };
      if (opts.name !== undefined) body.name = opts.name;
      if (opts.description !== undefined) body.description = opts.description;

      const res = await post('/webhook_endpoints', body);
      const webhook = res.webhook_endpoint || res;
      printSuccess(`Webhook created: ${webhook.id}`, opts);
      printDetail(webhook, DETAIL_FIELDS, opts);
      warnSecretShownOnce(webhook, opts);
    })
  );

  // Update webhook
  const update = cmd
    .command('update <id>')
    .description('Update a webhook')
    .option('--name <name>', 'new webhook name')
    .option('--url <url>', 'new webhook URL')
    .option('--description <text>', 'new webhook description')
    .option('--status <status>', `new status (${STATUSES.join(', ')})`)
    .option('--events <events>', "comma-separated event types; replaces the webhook's entire subscription list");
  addFormatOption(update);
  update.action(
    withErrorHandler(async (id, opts) => {
      const safeId = validatePathSegment(id, 'webhook ID');
      if (opts.url !== undefined) assertValidUrl(opts.url);

      const body = buildWebhookBody(opts);
      if (Object.keys(body).length === 0) {
        console.error(
          'Nothing to update. Pass at least one of --name, --url, --description, --status, or --events.'
        );
        process.exit(1);
      }

      const res = await patch(`/webhook_endpoints/${safeId}`, body);
      const webhook = res.webhook_endpoint || res;
      printSuccess(`Webhook ${id} updated.`, opts);
      printDetail(webhook, DETAIL_FIELDS, opts);
    })
  );

  // Delete webhook
  cmd
    .command('delete <id>')
    .description('Delete a webhook')
    .action(
      withErrorHandler(async (id) => {
        const safeId = validatePathSegment(id, 'webhook ID');
        await del(`/webhook_endpoints/${safeId}`);
        printSuccess(`Webhook ${id} deleted.`);
      })
    );

  // Rotate secret
  const rotate = cmd
    .command('rotate-secret <id>')
    .description('Rotate a webhook signing secret')
    .option(
      '--force',
      "rotate even if a previous rotation's overlap window is still open, expiring the older secret immediately"
    );
  addFormatOption(rotate);
  rotate.action(
    withErrorHandler(async (id, opts) => {
      const safeId = validatePathSegment(id, 'webhook ID');
      const body = opts.force ? { force: true } : undefined;
      const res = await post(`/webhook_endpoints/${safeId}/rotate_secret`, body);
      const webhook = res.webhook_endpoint || res;
      printSuccess(`Webhook ${id} secret rotated.`, opts);
      printDetail(webhook, DETAIL_FIELDS, opts);
      warnSecretShownOnce(webhook, opts);
    })
  );

  // Revoke previous secret
  const revoke = cmd
    .command('revoke-previous-secret <id>')
    .description("Revoke a webhook's previous signing secret, closing the rotation window early");
  addFormatOption(revoke);
  revoke.action(
    withErrorHandler(async (id, opts) => {
      const safeId = validatePathSegment(id, 'webhook ID');
      const res = await post(`/webhook_endpoints/${safeId}/revoke_previous_secret`);
      const webhook = res.webhook_endpoint || res;
      printSuccess(`Previous secret revoked for webhook ${id}.`, opts);
      printDetail(webhook, DETAIL_FIELDS, opts);
    })
  );

  return cmd;
}
