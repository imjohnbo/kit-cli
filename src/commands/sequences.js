import { Command } from 'commander';
import {
  get,
  post,
  put,
  del,
  validatePathSegment,
  validateNumericId,
  validateIntInRange,
  parseIdList,
  parseCsvList,
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
import { sequenceEmailsCommand } from './sequence-emails.js';

const SEND_DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const EXCLUDE_TYPES = ['tag', 'sequence', 'form', 'segment'];

const SEQ_COLUMNS = [
  { header: 'ID', accessor: (d) => d.id },
  { header: 'Name', accessor: (d) => d.name },
  { header: 'Active', accessor: (d) => d.active ? 'yes' : 'no' },
  { header: 'Emails', accessor: (d) => d.email_count },
  { header: 'Subscribers', accessor: (d) => d.subscriber_count },
  { header: 'Hold', accessor: (d) => d.hold ? 'yes' : 'no' },
  { header: 'Created', accessor: (d) => d.created_at?.slice(0, 10) },
];

const DETAIL_FIELDS = [
  { label: 'ID', accessor: (d) => d.id },
  { label: 'Name', accessor: (d) => d.name },
  { label: 'Active', accessor: (d) => d.active },
  { label: 'Hold', accessor: (d) => d.hold },
  { label: 'Repeat', accessor: (d) => d.repeat },
  { label: 'Send Days', accessor: (d) => d.send_days?.join(', ') },
  { label: 'Send Hour', accessor: (d) => d.send_hour },
  { label: 'Time Zone', accessor: (d) => d.time_zone },
  { label: 'Email Address', accessor: (d) => d.email_address },
  { label: 'Email Template', accessor: (d) => d.email_template_id },
  { label: 'Emails', accessor: (d) => d.email_count },
  { label: 'Subscribers', accessor: (d) => d.subscriber_count },
  { label: 'Excludes', accessor: (d) => formatExcludes(d.exclude_subscriber_sources) },
  { label: 'Created At', accessor: (d) => d.created_at },
  { label: 'Updated At', accessor: (d) => d.updated_at },
];

const STATS_FIELDS = [
  { label: 'Recipients', accessor: (d) => d.recipients },
  { label: 'Opens', accessor: (d) => d.opens },
  { label: 'Open Rate', accessor: (d) => d.open_rate },
  { label: 'Clicks', accessor: (d) => d.clicks },
  { label: 'Click Rate', accessor: (d) => d.click_rate },
  { label: 'Click To Open Rate', accessor: (d) => d.click_to_open_rate },
  { label: 'Unsubscribers', accessor: (d) => d.unsubscribers },
  { label: 'Email Unsubscribes', accessor: (d) => d.email_unsubscribes },
  { label: 'Unsubscribe Rate', accessor: (d) => d.unsubscribe_rate },
  { label: 'Bounces', accessor: (d) => d.bounces },
  { label: 'Bounce Rate', accessor: (d) => d.bounce_rate },
  { label: 'Complaints', accessor: (d) => d.complaints },
  { label: 'Complaint Rate', accessor: (d) => d.complaint_rate },
];

const SUB_COLUMNS = [
  { header: 'ID', accessor: (d) => d.id },
  { header: 'Email', accessor: (d) => d.email_address },
  { header: 'First Name', accessor: (d) => d.first_name },
  { header: 'State', accessor: (d) => d.state },
  { header: 'Added At', accessor: (d) => d.added_at?.slice(0, 10) || d.created_at?.slice(0, 10) },
];

function formatExcludes(sources) {
  if (!Array.isArray(sources) || sources.length === 0) return null;
  return sources.map((s) => `${s.type}: ${(s.ids || []).join(',')}`).join('  |  ');
}

/** Flags shared by `sequences create` and `sequences update`. */
function addSequenceBodyOptions(cmd) {
  return cmd
    .option('--email-address <email>', 'sending email address (defaults to the account address)')
    .option('--email-template-id <id>', 'email template ID')
    .option('--send-days <days>', `comma-separated send days (${SEND_DAYS.join(', ')})`)
    .option('--send-hour <hour>', 'hour of the day to send, 0-23')
    .option('--time-zone <tz>', 'IANA time zone, e.g. America/New_York')
    .option('--active', 'activate the sequence')
    .option('--no-active', 'deactivate the sequence')
    .option('--repeat', 'let subscribers restart the sequence')
    .option('--no-repeat', 'stop subscribers restarting the sequence')
    .option('--hold', 'keep Visual Automation subscribers in the sequence after the last email')
    .option('--no-hold', 'release Visual Automation subscribers after the last email')
    .option('--exclude-tag-ids <ids>', 'comma-separated tag IDs to exclude')
    .option('--exclude-sequence-ids <ids>', 'comma-separated sequence IDs to exclude')
    .option('--exclude-form-ids <ids>', 'comma-separated form IDs to exclude')
    .option('--exclude-segment-ids <ids>', 'comma-separated segment IDs to exclude');
}

/**
 * Builds the request body from the shared flags.
 *
 * Commander presents `--active`/`--no-active` as a single `active` key, and
 * leaves it undefined when neither flag is given. Only keys the user set end up
 * in the body, so an update never clobbers a field the user did not mention.
 */
function buildSequenceBody(opts) {
  const body = {};

  if (opts.name !== undefined) body.name = opts.name;
  if (opts.emailAddress !== undefined) body.email_address = opts.emailAddress;
  if (opts.emailTemplateId !== undefined)
    body.email_template_id = validateNumericId(opts.emailTemplateId, 'email template ID');
  if (opts.sendDays !== undefined) body.send_days = parseSendDays(opts.sendDays);
  if (opts.sendHour !== undefined)
    body.send_hour = validateIntInRange(opts.sendHour, 0, 23, 'send hour');
  if (opts.timeZone !== undefined) body.time_zone = opts.timeZone;
  if (opts.active !== undefined) body.active = opts.active;
  if (opts.repeat !== undefined) body.repeat = opts.repeat;
  if (opts.hold !== undefined) body.hold = opts.hold;

  const excludes = buildExcludes(opts);
  if (excludes.length > 0) body.exclude_subscriber_sources = excludes;

  return body;
}

function parseSendDays(value) {
  const days = parseCsvList(value).map((d) => d.toLowerCase());
  const invalid = days.filter((d) => !SEND_DAYS.includes(d));
  if (invalid.length > 0) {
    console.error(`Invalid send day(s): ${invalid.join(', ')}. Must be one of: ${SEND_DAYS.join(', ')}.`);
    process.exit(1);
  }
  return days;
}

function buildExcludes(opts) {
  const byType = {
    tag: opts.excludeTagIds,
    sequence: opts.excludeSequenceIds,
    form: opts.excludeFormIds,
    segment: opts.excludeSegmentIds,
  };
  const excludes = [];
  for (const type of EXCLUDE_TYPES) {
    const raw = byType[type];
    if (raw === undefined) continue;
    excludes.push({ type, ids: parseIdList(raw, `${type} ID`) });
  }
  return excludes;
}

export function sequencesCommand() {
  const cmd = new Command('sequences').description('Manage sequences');

  // List sequences
  const list = cmd.command('list').description('List all sequences');
  addFormatOption(list);
  addPaginationOptions(list);
  list
    .option('--include <fields>', 'extra data to include (stats)')
    .action(
      withErrorHandler(async (opts) => {
        const query = {
          per_page: opts.perPage,
          after: opts.after,
          before: opts.before,
          include: opts.include,
        };
        const res = await get('/sequences', query);
        formatOutput(res.sequences, SEQ_COLUMNS, opts);
        printPagination(res.pagination);
      })
    );

  // Get sequence
  const show = cmd.command('get <id>').description('Get a sequence by ID');
  addFormatOption(show);
  show
    .option('--include <fields>', 'extra data to include (stats)')
    .action(
      withErrorHandler(async (id, opts) => {
        const safeId = validatePathSegment(id, 'sequence ID');
        const res = await get(`/sequences/${safeId}`, { include: opts.include });
        const seq = res.sequence || res;
        printDetail(seq, DETAIL_FIELDS, opts);
        if (seq.stats && (opts.format || 'table') !== 'json') {
          console.log('');
          printDetail(seq.stats, STATS_FIELDS, opts);
        }
      })
    );

  // Create sequence
  const create = cmd
    .command('create')
    .description('Create a new sequence')
    .requiredOption('--name <name>', 'sequence name');
  addFormatOption(create);
  addSequenceBodyOptions(create).action(
    withErrorHandler(async (opts) => {
      const res = await post('/sequences', buildSequenceBody(opts));
      const seq = res.sequence || res;
      printSuccess(`Sequence created: ${seq.id}`);
      printDetail(seq, DETAIL_FIELDS, opts);
    })
  );

  // Update sequence
  const update = cmd
    .command('update <id>')
    .description('Update a sequence')
    .option('--name <name>', 'sequence name');
  addFormatOption(update);
  addSequenceBodyOptions(update).action(
    withErrorHandler(async (id, opts) => {
      const safeId = validatePathSegment(id, 'sequence ID');
      const body = buildSequenceBody(opts);
      if (Object.keys(body).length === 0) {
        console.error('Nothing to update. Pass at least one field, e.g. --name.');
        process.exit(1);
      }
      const res = await put(`/sequences/${safeId}`, body);
      const seq = res.sequence || res;
      printSuccess(`Sequence ${id} updated.`);
      printDetail(seq, DETAIL_FIELDS, opts);
    })
  );

  // Delete sequence
  cmd
    .command('delete <id>')
    .description('Delete a sequence')
    .action(
      withErrorHandler(async (id) => {
        const safeId = validatePathSegment(id, 'sequence ID');
        await del(`/sequences/${safeId}`);
        printSuccess(`Sequence ${id} deleted.`);
      })
    );

  // List subscribers for sequence
  const subs = cmd
    .command('subscribers <sequenceId>')
    .description('List subscribers for a sequence');
  addFormatOption(subs);
  addPaginationOptions(subs);
  subs.action(
    withErrorHandler(async (sequenceId, opts) => {
      const safeId = validatePathSegment(sequenceId, 'sequence ID');
      const query = { per_page: opts.perPage, after: opts.after, before: opts.before };
      const res = await get(`/sequences/${safeId}/subscribers`, query);
      formatOutput(res.subscribers, SUB_COLUMNS, opts);
      printPagination(res.pagination);
    })
  );

  // Add subscriber to sequence by ID
  cmd
    .command('add <sequenceId> <subscriberId>')
    .description('Add a subscriber to a sequence by ID')
    .action(
      withErrorHandler(async (sequenceId, subscriberId) => {
        const safeSeqId = validatePathSegment(sequenceId, 'sequence ID');
        const safeSubId = validatePathSegment(subscriberId, 'subscriber ID');
        await post(`/sequences/${safeSeqId}/subscribers/${safeSubId}`);
        printSuccess(`Subscriber ${subscriberId} added to sequence ${sequenceId}.`);
      })
    );

  // Add subscriber to sequence by email
  cmd
    .command('add-by-email <sequenceId> <email>')
    .description('Add a subscriber to a sequence by email')
    .action(
      withErrorHandler(async (sequenceId, email) => {
        const safeSeqId = validatePathSegment(sequenceId, 'sequence ID');
        await post(`/sequences/${safeSeqId}/subscribers`, { email_address: email });
        printSuccess(`Subscriber ${email} added to sequence ${sequenceId}.`);
      })
    );

  cmd.addCommand(sequenceEmailsCommand());

  return cmd;
}
