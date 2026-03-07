import { Command } from 'commander';
import { get } from '../client.js';
import {
  formatOutput,
  printPagination,
  addFormatOption,
  addPaginationOptions,
  withErrorHandler,
} from '../output.js';

const TMPL_COLUMNS = [
  { header: 'ID', accessor: (d) => d.id },
  { header: 'Name', accessor: (d) => d.name },
];

export function emailTemplatesCommand() {
  const cmd = new Command('email-templates').description('View email templates');

  // List email templates
  const list = cmd.command('list').description('List all email templates');
  addFormatOption(list);
  addPaginationOptions(list);
  list.action(
    withErrorHandler(async (opts) => {
      const query = { per_page: opts.perPage, after: opts.after, before: opts.before };
      const res = await get('/email_templates', query);
      formatOutput(res.email_templates, TMPL_COLUMNS, opts);
      printPagination(res.pagination);
    })
  );

  return cmd;
}
