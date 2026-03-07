import { Command } from 'commander';
import { get } from '../client.js';
import {
  formatOutput,
  printPagination,
  addFormatOption,
  addPaginationOptions,
  withErrorHandler,
} from '../output.js';

const SEG_COLUMNS = [
  { header: 'ID', accessor: (d) => d.id },
  { header: 'Name', accessor: (d) => d.name },
  { header: 'Created', accessor: (d) => d.created_at?.slice(0, 10) },
];

export function segmentsCommand() {
  const cmd = new Command('segments').description('View segments');

  // List segments
  const list = cmd.command('list').description('List all segments');
  addFormatOption(list);
  addPaginationOptions(list);
  list.action(
    withErrorHandler(async (opts) => {
      const query = { per_page: opts.perPage, after: opts.after, before: opts.before };
      const res = await get('/segments', query);
      formatOutput(res.segments, SEG_COLUMNS, opts);
      printPagination(res.pagination);
    })
  );

  return cmd;
}
