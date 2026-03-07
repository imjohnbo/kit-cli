import { Command } from 'commander';
import { get, post, put, validatePathSegment, safeJsonParse } from '../client.js';
import {
  formatOutput,
  printDetail,
  printSuccess,
  printPagination,
  addFormatOption,
  addPaginationOptions,
  withErrorHandler,
} from '../output.js';

const COLUMNS = [
  { header: 'ID', accessor: (d) => d.id },
  { header: 'Email', accessor: (d) => d.email_address },
  { header: 'First Name', accessor: (d) => d.first_name },
  { header: 'State', accessor: (d) => d.state },
  { header: 'Created', accessor: (d) => d.created_at?.slice(0, 10) },
];

const DETAIL_FIELDS = [
  { label: 'ID', accessor: (d) => d.id },
  { label: 'Email', accessor: (d) => d.email_address },
  { label: 'First Name', accessor: (d) => d.first_name },
  { label: 'State', accessor: (d) => d.state },
  { label: 'Created At', accessor: (d) => d.created_at },
  { label: 'Fields', accessor: (d) => d.fields ? JSON.stringify(d.fields) : null },
];

export function subscribersCommand() {
  const cmd = new Command('subscribers').description('Manage subscribers');

  // List subscribers
  const list = cmd
    .command('list')
    .description('List subscribers');
  addFormatOption(list);
  addPaginationOptions(list);
  list
    .option('-e, --email <email>', 'filter by email address')
    .option('-s, --state <state>', 'filter by state (active, inactive, cancelled, bounced, complained)')
    .option('--created-after <date>', 'filter by created after (ISO8601)')
    .option('--created-before <date>', 'filter by created before (ISO8601)')
    .option('--updated-after <date>', 'filter by updated after (ISO8601)')
    .option('--updated-before <date>', 'filter by updated before (ISO8601)')
    .option('--sort-field <field>', 'sort field (id, updated_at, cancelled_at)')
    .option('--sort-order <order>', 'sort order (asc, desc)')
    .action(
      withErrorHandler(async (opts) => {
        const query = {
          per_page: opts.perPage,
          after: opts.after,
          before: opts.before,
          email_address: opts.email,
          status: opts.state,
          created_after: opts.createdAfter,
          created_before: opts.createdBefore,
          updated_after: opts.updatedAfter,
          updated_before: opts.updatedBefore,
          sort_field: opts.sortField,
          sort_order: opts.sortOrder,
        };
        const res = await get('/subscribers', query);
        formatOutput(res.subscribers, COLUMNS, opts);
        printPagination(res.pagination);
      })
    );

  // Get subscriber
  const show = cmd
    .command('get <id>')
    .description('Get a subscriber by ID');
  addFormatOption(show);
  show.action(
    withErrorHandler(async (id, opts) => {
      const safeId = validatePathSegment(id, 'subscriber ID');
      const res = await get(`/subscribers/${safeId}`);
      printDetail(res.subscriber || res, DETAIL_FIELDS, opts);
    })
  );

  // Create subscriber
  cmd
    .command('create <email>')
    .description('Create or update a subscriber')
    .option('-n, --first-name <name>', 'subscriber first name')
    .option('-s, --state <state>', 'subscriber state (active, inactive)')
    .option('--fields <json>', 'custom fields as JSON object')
    .action(
      withErrorHandler(async (email, opts) => {
        const body = { email_address: email };
        if (opts.firstName) body.first_name = opts.firstName;
        if (opts.state) body.state = opts.state;
        if (opts.fields) body.fields = safeJsonParse(opts.fields, 'custom fields JSON');
        const res = await post('/subscribers', body);
        printSuccess(`Subscriber created/updated: ${(res.subscriber || res).id}`);
        printDetail(res.subscriber || res, DETAIL_FIELDS, opts);
      })
    );

  // Update subscriber
  cmd
    .command('update <id>')
    .description('Update a subscriber')
    .option('-e, --email <email>', 'new email address')
    .option('-n, --first-name <name>', 'new first name')
    .option('--fields <json>', 'custom fields as JSON object')
    .action(
      withErrorHandler(async (id, opts) => {
        const safeId = validatePathSegment(id, 'subscriber ID');
        const body = {};
        if (opts.email) body.email_address = opts.email;
        if (opts.firstName) body.first_name = opts.firstName;
        if (opts.fields) body.fields = safeJsonParse(opts.fields, 'custom fields JSON');
        const res = await put(`/subscribers/${safeId}`, body);
        printSuccess(`Subscriber ${id} updated.`);
        printDetail(res.subscriber || res, DETAIL_FIELDS, opts);
      })
    );

  // Unsubscribe
  cmd
    .command('unsubscribe <id>')
    .description('Unsubscribe a subscriber by ID')
    .action(
      withErrorHandler(async (id) => {
        const safeId = validatePathSegment(id, 'subscriber ID');
        await post(`/subscribers/${safeId}/unsubscribe`);
        printSuccess(`Subscriber ${id} unsubscribed.`);
      })
    );

  // List tags for subscriber
  const tags = cmd
    .command('tags <id>')
    .description('List tags for a subscriber');
  addFormatOption(tags);
  addPaginationOptions(tags);
  tags.action(
    withErrorHandler(async (id, opts) => {
      const safeId = validatePathSegment(id, 'subscriber ID');
      const query = { per_page: opts.perPage, after: opts.after, before: opts.before };
      const res = await get(`/subscribers/${safeId}/tags`, query);
      formatOutput(res.tags, [
        { header: 'ID', accessor: (d) => d.id },
        { header: 'Name', accessor: (d) => d.name },
        { header: 'Tagged At', accessor: (d) => d.tagged_at?.slice(0, 10) },
      ], opts);
      printPagination(res.pagination);
    })
  );

  // Subscriber stats
  const stats = cmd
    .command('stats <id>')
    .description('Get engagement stats for a subscriber');
  addFormatOption(stats);
  stats
    .option('--sent-after <date>', 'filter stats by emails sent after (ISO8601)')
    .option('--sent-before <date>', 'filter stats by emails sent before (ISO8601)')
    .action(
      withErrorHandler(async (id, opts) => {
        const safeId = validatePathSegment(id, 'subscriber ID');
        const query = {
          email_sent_after: opts.sentAfter,
          email_sent_before: opts.sentBefore,
        };
        const res = await get(`/subscribers/${safeId}/stats`, query);
        const data = res.subscriber || res;
        printDetail(data, [
          { label: 'ID', accessor: (d) => d.id },
          { label: 'Emails Sent', accessor: (d) => d.stats?.emails_sent },
          { label: 'Emails Opened', accessor: (d) => d.stats?.emails_opened },
          { label: 'Emails Clicked', accessor: (d) => d.stats?.emails_clicked },
          { label: 'Open Rate', accessor: (d) => d.stats?.open_rate },
          { label: 'Click Rate', accessor: (d) => d.stats?.click_rate },
          { label: 'Bounces', accessor: (d) => d.stats?.bounces },
        ], opts);
      })
    );

  return cmd;
}
