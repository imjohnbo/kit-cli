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

const FORM_COLUMNS = [
  { header: 'ID', accessor: (d) => d.id },
  { header: 'Name', accessor: (d) => d.name },
  { header: 'Type', accessor: (d) => d.type },
  { header: 'Format', accessor: (d) => d.format },
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

export function formsCommand() {
  const cmd = new Command('forms').description('Manage forms');

  // List forms
  const list = cmd.command('list').description('List all forms');
  addFormatOption(list);
  addPaginationOptions(list);
  list
    .option('-s, --status <status>', 'filter by status (active, archived, trashed, all)')
    .option('-t, --type <type>', 'filter by type (embed, hosted)')
    .action(
      withErrorHandler(async (opts) => {
        const query = {
          per_page: opts.perPage,
          after: opts.after,
          before: opts.before,
          status: opts.status,
          type: opts.type,
        };
        const res = await get('/forms', query);
        formatOutput(res.forms, FORM_COLUMNS, opts);
        printPagination(res.pagination);
      })
    );

  // List subscribers for form
  const subs = cmd
    .command('subscribers <formId>')
    .description('List subscribers for a form');
  addFormatOption(subs);
  addPaginationOptions(subs);
  subs.action(
    withErrorHandler(async (formId, opts) => {
      const safeId = validatePathSegment(formId, 'form ID');
      const query = { per_page: opts.perPage, after: opts.after, before: opts.before };
      const res = await get(`/forms/${safeId}/subscribers`, query);
      formatOutput(res.subscribers, SUB_COLUMNS, opts);
      printPagination(res.pagination);
    })
  );

  // Add subscriber to form by ID
  cmd
    .command('add <formId> <subscriberId>')
    .description('Add a subscriber to a form by subscriber ID')
    .action(
      withErrorHandler(async (formId, subscriberId) => {
        const safeFormId = validatePathSegment(formId, 'form ID');
        const safeSubId = validatePathSegment(subscriberId, 'subscriber ID');
        await post(`/forms/${safeFormId}/subscribers/${safeSubId}`);
        printSuccess(`Subscriber ${subscriberId} added to form ${formId}.`);
      })
    );

  // Add subscriber to form by email
  cmd
    .command('add-by-email <formId> <email>')
    .description('Add a subscriber to a form by email')
    .action(
      withErrorHandler(async (formId, email) => {
        const safeFormId = validatePathSegment(formId, 'form ID');
        await post(`/forms/${safeFormId}/subscribers`, { email_address: email });
        printSuccess(`Subscriber ${email} added to form ${formId}.`);
      })
    );

  return cmd;
}
