import { Command } from 'commander';
import { get, post, validatePathSegment } from '../client.js';
import {
  formatOutput,
  printSuccess,
  printPagination,
  addFormatOption,
  addPaginationOptions,
  withErrorHandler,
} from '../output.js';

const SEQ_COLUMNS = [
  { header: 'ID', accessor: (d) => d.id },
  { header: 'Name', accessor: (d) => d.name },
  { header: 'State', accessor: (d) => d.state },
  { header: 'Created', accessor: (d) => d.created_at?.slice(0, 10) },
];

const SUB_COLUMNS = [
  { header: 'ID', accessor: (d) => d.id },
  { header: 'Email', accessor: (d) => d.email_address },
  { header: 'First Name', accessor: (d) => d.first_name },
  { header: 'State', accessor: (d) => d.state },
  { header: 'Added At', accessor: (d) => d.added_at?.slice(0, 10) || d.created_at?.slice(0, 10) },
];

export function sequencesCommand() {
  const cmd = new Command('sequences').description('Manage sequences');

  // List sequences
  const list = cmd.command('list').description('List all sequences');
  addFormatOption(list);
  addPaginationOptions(list);
  list.action(
    withErrorHandler(async (opts) => {
      const query = { per_page: opts.perPage, after: opts.after, before: opts.before };
      const res = await get('/sequences', query);
      formatOutput(res.sequences, SEQ_COLUMNS, opts);
      printPagination(res.pagination);
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

  return cmd;
}
