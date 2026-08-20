import { Command } from 'commander';
import {
  get,
  post,
  put,
  del,
  validatePathSegment,
  validateNumericId,
  validateEnum,
  parseIdList,
} from '../client.js';
import {
  formatOutput,
  printDetail,
  printSuccess,
  printPagination,
  addFormatOption,
  addPaginationOptions,
  withErrorHandler,
} from '../output.js';

const BROADCAST_STATUSES = ['draft', 'scheduled', 'sending', 'completed', 'aborted'];

const BROADCAST_COLUMNS = [
  { header: 'ID', accessor: (d) => d.id },
  { header: 'Subject', accessor: (d) => d.subject },
  { header: 'Description', accessor: (d) => truncate(d.description, 30) },
  { header: 'Status', accessor: (d) => d.status || (d.send_at ? 'scheduled' : 'draft') },
  { header: 'Send At', accessor: (d) => d.send_at?.slice(0, 16) },
  { header: 'Created', accessor: (d) => d.created_at?.slice(0, 10) },
];

const DETAIL_FIELDS = [
  { label: 'ID', accessor: (d) => d.id },
  { label: 'Subject', accessor: (d) => d.subject },
  { label: 'Description', accessor: (d) => d.description },
  { label: 'Content', accessor: (d) => truncate(d.content, 200) },
  { label: 'Public', accessor: (d) => d.public },
  { label: 'Status', accessor: (d) => d.status || (d.send_at ? 'scheduled' : d.published_at ? 'sent' : 'draft') },
  { label: 'Send At', accessor: (d) => d.send_at },
  { label: 'Thumbnail URL', accessor: (d) => d.thumbnail_url },
  { label: 'Email Template', accessor: (d) => d.email_template?.name || d.email_template_id },
  { label: 'Created At', accessor: (d) => d.created_at },
];

// Mirrors the stats object the API documents for a single broadcast. The
// accessors read through `stats` so the response shape stays intact under
// --format json.
const STATS_FIELDS = [
  { label: 'ID', accessor: (d) => d.id },
  { label: 'Recipients', accessor: (d) => d.stats?.recipients },
  { label: 'Opens', accessor: (d) => d.stats?.emails_opened },
  { label: 'Open Rate', accessor: (d) => d.stats?.open_rate },
  { label: 'Total Clicks', accessor: (d) => d.stats?.total_clicks },
  { label: 'Click Rate', accessor: (d) => d.stats?.click_rate },
  { label: 'Unsubscribes', accessor: (d) => d.stats?.unsubscribes },
  { label: 'Unsubscribe Rate', accessor: (d) => d.stats?.unsubscribe_rate },
  { label: 'Status', accessor: (d) => d.stats?.status },
  { label: 'Progress', accessor: (d) => d.stats?.progress },
  { label: 'Open Tracking', accessor: (d) => negate(d.stats?.open_tracking_disabled) },
  { label: 'Click Tracking', accessor: (d) => negate(d.stats?.click_tracking_disabled) },
];

/** Reports tracking as enabled or disabled, leaving an absent value absent. */
function negate(value) {
  return value === undefined || value === null ? value : !value;
}

const STATS_COLUMNS = [
  { header: 'ID', accessor: (d) => d.id },
  { header: 'Subject', accessor: (d) => truncate(d.subject, 30) },
  { header: 'Status', accessor: (d) => d.stats?.status },
  { header: 'Recipients', accessor: (d) => d.stats?.recipients },
  { header: 'Opens', accessor: (d) => d.stats?.emails_opened },
  { header: 'Open Rate', accessor: (d) => d.stats?.open_rate },
  { header: 'Clicks', accessor: (d) => d.stats?.total_clicks },
  { header: 'Click Rate', accessor: (d) => d.stats?.click_rate },
  { header: 'Unsubs', accessor: (d) => d.stats?.unsubscribes },
];

const CLICK_COLUMNS = [
  { header: 'URL', accessor: (d) => d.url },
  { header: 'Unique Clicks', accessor: (d) => d.unique_clicks },
  { header: 'Click To Delivery', accessor: (d) => d.click_to_delivery_rate },
  { header: 'Click To Open', accessor: (d) => d.click_to_open_rate },
];

function truncate(str, len) {
  if (!str) return null;
  return str.length > len ? str.slice(0, len) + '...' : str;
}

export function broadcastsCommand() {
  const cmd = new Command('broadcasts').description('Manage broadcasts');

  // List broadcasts
  const list = cmd.command('list').description('List broadcasts');
  addFormatOption(list);
  addPaginationOptions(list);
  list
    .option('-s, --status <status>', `filter by status (${BROADCAST_STATUSES.join(', ')})`)
    .option('--sent-after <date>', 'only broadcasts sent after this date (yyyy-mm-dd)')
    .option('--sent-before <date>', 'only broadcasts sent before this date (yyyy-mm-dd)')
    .action(
      withErrorHandler(async (opts) => {
        if (opts.status) validateEnum(opts.status, BROADCAST_STATUSES, 'status');
        const query = {
          per_page: opts.perPage,
          after: opts.after,
          before: opts.before,
          status: opts.status,
          sent_after: opts.sentAfter,
          sent_before: opts.sentBefore,
        };
        const res = await get('/broadcasts', query);
        formatOutput(res.broadcasts, BROADCAST_COLUMNS, opts);
        printPagination(res.pagination);
      })
    );

  // Get broadcast
  const show = cmd.command('get <id>').description('Get a broadcast by ID');
  addFormatOption(show);
  show.action(
    withErrorHandler(async (id, opts) => {
      const safeId = validatePathSegment(id, 'broadcast ID');
      const res = await get(`/broadcasts/${safeId}`);
      printDetail(res.broadcast || res, DETAIL_FIELDS, opts);
    })
  );

  // Create broadcast
  cmd
    .command('create')
    .description('Create a new broadcast (draft or scheduled)')
    .requiredOption('--subject <subject>', 'email subject line')
    .option('--content <content>', 'email content (HTML)')
    .option('--description <desc>', 'internal description')
    .option('--public', 'publish to the web')
    .option('--send-at <datetime>', 'schedule send time (ISO8601)')
    .option('--email-template-id <id>', 'email template ID')
    .option('--segment-ids <ids>', 'comma-separated segment IDs to target')
    .option('--tag-ids <ids>', 'comma-separated tag IDs to target')
    .action(
      withErrorHandler(async (opts) => {
        const body = {
          subject: opts.subject,
          content: opts.content,
          description: opts.description,
          public: opts.public || false,
          send_at: opts.sendAt || null,
        };
        if (opts.emailTemplateId) body.email_template_id = validateNumericId(opts.emailTemplateId, 'email template ID');
        if (opts.segmentIds)
          body.subscriber_filter = [{ type: 'segment', ids: parseIdList(opts.segmentIds, 'segment ID') }];
        if (opts.tagIds)
          body.subscriber_filter = [{ type: 'tag', ids: parseIdList(opts.tagIds, 'tag ID') }];

        const res = await post('/broadcasts', body);
        const bc = res.broadcast || res;
        printSuccess(`Broadcast created: ${bc.id}`);
        printDetail(bc, DETAIL_FIELDS, opts);
      })
    );

  // Update broadcast
  cmd
    .command('update <id>')
    .description('Update a broadcast')
    .option('--subject <subject>', 'email subject line')
    .option('--content <content>', 'email content (HTML)')
    .option('--description <desc>', 'internal description')
    .option('--public', 'publish to the web')
    .option('--no-public', 'save as draft')
    .option('--send-at <datetime>', 'schedule send time (ISO8601)')
    .option('--email-template-id <id>', 'email template ID')
    .action(
      withErrorHandler(async (id, opts) => {
        const safeId = validatePathSegment(id, 'broadcast ID');
        const body = {};
        if (opts.subject) body.subject = opts.subject;
        if (opts.content) body.content = opts.content;
        if (opts.description) body.description = opts.description;
        if (opts.public !== undefined) body.public = opts.public;
        if (opts.sendAt) body.send_at = opts.sendAt;
        if (opts.emailTemplateId) body.email_template_id = validateNumericId(opts.emailTemplateId, 'email template ID');

        const res = await put(`/broadcasts/${safeId}`, body);
        const bc = res.broadcast || res;
        printSuccess(`Broadcast ${id} updated.`);
        printDetail(bc, DETAIL_FIELDS, opts);
      })
    );

  // Delete broadcast
  cmd
    .command('delete <id>')
    .description('Delete a draft or scheduled broadcast')
    .action(
      withErrorHandler(async (id) => {
        const safeId = validatePathSegment(id, 'broadcast ID');
        await del(`/broadcasts/${safeId}`);
        printSuccess(`Broadcast ${id} deleted.`);
      })
    );

  // Broadcast stats, for one broadcast or across the account
  const stats = cmd
    .command('stats [id]')
    .description('Get stats for one broadcast, or for every broadcast when no ID is given');
  addFormatOption(stats);
  addPaginationOptions(stats);
  stats
    .option('-s, --status <status>', `filter by status (${BROADCAST_STATUSES.join(', ')})`)
    .option('--sent-after <date>', 'only broadcasts sent after this date (yyyy-mm-dd)')
    .option('--sent-before <date>', 'only broadcasts sent before this date (yyyy-mm-dd)')
    .option('--include-total-count', 'include total_count in the response (slower)')
    .action(
      withErrorHandler(async (id, opts) => {
        if (id !== undefined) {
          const safeId = validatePathSegment(id, 'broadcast ID');
          const res = await get(`/broadcasts/${safeId}/stats`);
          printDetail(res.broadcast || res, STATS_FIELDS, opts);
          return;
        }

        if (opts.status) validateEnum(opts.status, BROADCAST_STATUSES, 'status');
        const query = {
          per_page: opts.perPage,
          after: opts.after,
          before: opts.before,
          status: opts.status,
          sent_after: opts.sentAfter,
          sent_before: opts.sentBefore,
          include_total_count: opts.includeTotalCount ? 'true' : undefined,
        };
        const res = await get('/broadcasts/stats', query);
        formatOutput(res.broadcasts, STATS_COLUMNS, opts);
        printPagination(res.pagination);
      })
    );

  // Link clicks for a broadcast
  const clicks = cmd
    .command('clicks <id>')
    .description('Get link click stats for a broadcast');
  addFormatOption(clicks);
  clicks.action(
    withErrorHandler(async (id, opts) => {
      const safeId = validatePathSegment(id, 'broadcast ID');
      const res = await get(`/broadcasts/${safeId}/clicks`);
      const data = res.broadcast || res;
      formatOutput(data.clicks, CLICK_COLUMNS, opts);
      printPagination(res.pagination);
    })
  );

  return cmd;
}
