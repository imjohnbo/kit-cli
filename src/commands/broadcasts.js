import { Command } from 'commander';
import { get, post, put, del, validatePathSegment, validateNumericId } from '../client.js';
import {
  formatOutput,
  printDetail,
  printSuccess,
  printPagination,
  addFormatOption,
  addPaginationOptions,
  withErrorHandler,
} from '../output.js';

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
  list.action(
    withErrorHandler(async (opts) => {
      const query = { per_page: opts.perPage, after: opts.after, before: opts.before };
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
          body.subscriber_filter = [{ type: 'segment', ids: opts.segmentIds.split(',').map((s) => validateNumericId(s.trim(), 'segment ID')) }];
        if (opts.tagIds)
          body.subscriber_filter = [{ type: 'tag', ids: opts.tagIds.split(',').map((s) => validateNumericId(s.trim(), 'tag ID')) }];

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

  // Get broadcast stats
  const stats = cmd.command('stats <id>').description('Get stats for a broadcast');
  addFormatOption(stats);
  stats.action(
    withErrorHandler(async (id, opts) => {
      const safeId = validatePathSegment(id, 'broadcast ID');
      const res = await get(`/broadcasts/${safeId}/stats`);
      const data = res.broadcast || res;
      printDetail(data, [
        { label: 'ID', accessor: (d) => d.id },
        { label: 'Recipients', accessor: (d) => d.stats?.recipients },
        { label: 'Opens', accessor: (d) => d.stats?.emails_opened },
        { label: 'Open Rate', accessor: (d) => d.stats?.open_rate },
        { label: 'Total Clicks', accessor: (d) => d.stats?.total_clicks },
        { label: 'Click Rate', accessor: (d) => d.stats?.click_rate },
        { label: 'Unsubscribes', accessor: (d) => d.stats?.unsubscribes },
        { label: 'Status', accessor: (d) => d.stats?.status },
      ], opts);
    })
  );

  return cmd;
}
