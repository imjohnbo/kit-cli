import { Command } from 'commander';
import {
  get,
  post,
  put,
  del,
  validatePathSegment,
  validateNumericId,
  validateIntInRange,
  validateEnum,
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

const DELAY_UNITS = ['days', 'hours'];
const SEND_DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

const EMAIL_COLUMNS = [
  { header: 'ID', accessor: (d) => d.id },
  { header: 'Pos', accessor: (d) => d.position },
  { header: 'Subject', accessor: (d) => d.subject },
  { header: 'Delay', accessor: (d) => d.delay_value === undefined ? null : `${d.delay_value} ${d.delay_unit}` },
  { header: 'Published', accessor: (d) => d.published ? 'yes' : 'no' },
];

const DETAIL_FIELDS = [
  { label: 'ID', accessor: (d) => d.id },
  { label: 'Sequence ID', accessor: (d) => d.sequence_id },
  { label: 'Position', accessor: (d) => d.position },
  { label: 'Subject', accessor: (d) => d.subject },
  { label: 'Preview Text', accessor: (d) => d.preview_text },
  { label: 'Delay', accessor: (d) => d.delay_value === undefined ? null : `${d.delay_value} ${d.delay_unit}` },
  { label: 'Published', accessor: (d) => d.published },
  { label: 'Send Days', accessor: (d) => d.send_days?.join(', ') },
  { label: 'Email Address', accessor: (d) => d.email_address },
  { label: 'Email Template', accessor: (d) => d.email_template_id },
  { label: 'Content', accessor: (d) => truncate(d.content, 200) },
];

const STATS_FIELDS = [
  { label: 'Recipients', accessor: (d) => d.recipients },
  { label: 'Opens', accessor: (d) => d.opens },
  { label: 'Open Rate', accessor: (d) => d.open_rate },
  { label: 'Clicks', accessor: (d) => d.clicks },
  { label: 'Click Rate', accessor: (d) => d.click_rate },
  { label: 'Unsubscribes', accessor: (d) => d.email_unsubscribes },
  { label: 'Bounces', accessor: (d) => d.bounces },
  { label: 'Complaints', accessor: (d) => d.complaints },
];

function truncate(str, len) {
  if (!str) return null;
  return str.length > len ? str.slice(0, len) + '...' : str;
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

/** Flags shared by `emails create` and `emails update`. */
function addEmailBodyOptions(cmd) {
  return cmd
    .option('--preview-text <text>', 'preview text shown before the email is opened')
    .option('--content <html>', 'HTML body content')
    .option('--email-template-id <id>', 'email template ID')
    .option('--published', 'publish the email so it sends to subscribers')
    .option('--no-published', 'unpublish the email, leaving it a draft')
    .option('--send-days <days>', `comma-separated send days (${SEND_DAYS.join(', ')})`)
    .option('--position <n>', 'zero-based position in the sequence');
}

function buildEmailBody(opts) {
  const body = {};

  if (opts.subject !== undefined) body.subject = opts.subject;
  if (opts.previewText !== undefined) body.preview_text = opts.previewText;
  if (opts.content !== undefined) body.content = opts.content;
  if (opts.delayValue !== undefined)
    body.delay_value = validateIntInRange(opts.delayValue, 0, 100000, 'delay value');
  if (opts.delayUnit !== undefined)
    body.delay_unit = validateEnum(opts.delayUnit, DELAY_UNITS, 'delay unit');
  if (opts.emailTemplateId !== undefined)
    body.email_template_id = validateNumericId(opts.emailTemplateId, 'email template ID');
  if (opts.published !== undefined) body.published = opts.published;
  if (opts.sendDays !== undefined) body.send_days = parseSendDays(opts.sendDays);
  if (opts.position !== undefined)
    body.position = validateIntInRange(opts.position, 0, 100000, 'position');

  return body;
}

export function sequenceEmailsCommand() {
  const cmd = new Command('emails').description('Manage the emails in a sequence');

  // List sequence emails
  const list = cmd
    .command('list <sequenceId>')
    .description('List the emails in a sequence');
  addFormatOption(list);
  addPaginationOptions(list);
  list
    .option('--include-content', 'include the HTML body of each email')
    .option('--include <fields>', 'extra data to include (stats)')
    .action(
      withErrorHandler(async (sequenceId, opts) => {
        const safeSeqId = validatePathSegment(sequenceId, 'sequence ID');
        const query = {
          per_page: opts.perPage,
          after: opts.after,
          before: opts.before,
          include_content: opts.includeContent ? 'true' : undefined,
          include: opts.include,
        };
        const res = await get(`/sequences/${safeSeqId}/emails`, query);
        formatOutput(res.emails, EMAIL_COLUMNS, opts);
        printPagination(res.pagination);
      })
    );

  // Get sequence email
  const show = cmd
    .command('get <sequenceId> <id>')
    .description('Get a single email from a sequence');
  addFormatOption(show);
  show
    .option('--include <fields>', 'extra data to include (stats)')
    .action(
      withErrorHandler(async (sequenceId, id, opts) => {
        const safeSeqId = validatePathSegment(sequenceId, 'sequence ID');
        const safeId = validatePathSegment(id, 'email ID');
        const res = await get(`/sequences/${safeSeqId}/emails/${safeId}`, { include: opts.include });
        const email = res.email || res;
        printDetail(email, DETAIL_FIELDS, opts);
        if (email.stats && (opts.format || 'table') !== 'json') {
          console.log('');
          printDetail(email.stats, STATS_FIELDS, opts);
        }
      })
    );

  // Create sequence email
  const create = cmd
    .command('create <sequenceId>')
    .description('Add an email to a sequence')
    .requiredOption('--subject <subject>', 'email subject line')
    .requiredOption('--delay-value <n>', 'how long to wait after the previous email')
    .requiredOption('--delay-unit <unit>', `delay unit (${DELAY_UNITS.join(', ')})`);
  addFormatOption(create);
  addEmailBodyOptions(create).action(
    withErrorHandler(async (sequenceId, opts) => {
      const safeSeqId = validatePathSegment(sequenceId, 'sequence ID');
      const res = await post(`/sequences/${safeSeqId}/emails`, buildEmailBody(opts));
      const email = res.email || res;
      printSuccess(`Sequence email created: ${email.id}`);
      printDetail(email, DETAIL_FIELDS, opts);
    })
  );

  // Update sequence email
  const update = cmd
    .command('update <sequenceId> <id>')
    .description('Update an email in a sequence')
    .option('--subject <subject>', 'email subject line')
    .option('--delay-value <n>', 'how long to wait after the previous email')
    .option('--delay-unit <unit>', `delay unit (${DELAY_UNITS.join(', ')})`);
  addFormatOption(update);
  addEmailBodyOptions(update).action(
    withErrorHandler(async (sequenceId, id, opts) => {
      const safeSeqId = validatePathSegment(sequenceId, 'sequence ID');
      const safeId = validatePathSegment(id, 'email ID');
      const body = buildEmailBody(opts);
      if (Object.keys(body).length === 0) {
        console.error('Nothing to update. Pass at least one field, e.g. --subject.');
        process.exit(1);
      }
      const res = await put(`/sequences/${safeSeqId}/emails/${safeId}`, body);
      const email = res.email || res;
      printSuccess(`Sequence email ${id} updated.`);
      printDetail(email, DETAIL_FIELDS, opts);
    })
  );

  // Delete sequence email
  cmd
    .command('delete <sequenceId> <id>')
    .description('Delete an email from a sequence')
    .action(
      withErrorHandler(async (sequenceId, id) => {
        const safeSeqId = validatePathSegment(sequenceId, 'sequence ID');
        const safeId = validatePathSegment(id, 'email ID');
        await del(`/sequences/${safeSeqId}/emails/${safeId}`);
        printSuccess(`Sequence email ${id} deleted from sequence ${sequenceId}.`);
      })
    );

  return cmd;
}
