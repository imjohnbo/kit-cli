import { Command } from 'commander';
import { get, post, put, del, validatePathSegment } from '../client.js';
import {
  formatOutput,
  printSuccess,
  printPagination,
  addFormatOption,
  addPaginationOptions,
  withErrorHandler,
} from '../output.js';

const CF_COLUMNS = [
  { header: 'ID', accessor: (d) => d.id },
  { header: 'Label', accessor: (d) => d.label },
  { header: 'Key', accessor: (d) => d.key },
  { header: 'Name', accessor: (d) => d.name },
];

export function customFieldsCommand() {
  const cmd = new Command('custom-fields').description('Manage custom fields');

  // List custom fields
  const list = cmd.command('list').description('List all custom fields');
  addFormatOption(list);
  addPaginationOptions(list);
  list.action(
    withErrorHandler(async (opts) => {
      const query = { per_page: opts.perPage, after: opts.after, before: opts.before };
      const res = await get('/custom_fields', query);
      formatOutput(res.custom_fields, CF_COLUMNS, opts);
      printPagination(res.pagination);
    })
  );

  // Create custom field
  cmd
    .command('create <label>')
    .description('Create a new custom field')
    .action(
      withErrorHandler(async (label) => {
        const res = await post('/custom_fields', { label });
        const cf = res.custom_field || res;
        printSuccess(`Custom field created: ${cf.id} - ${cf.label} (key: ${cf.key})`);
      })
    );

  // Update custom field
  cmd
    .command('update <id> <label>')
    .description('Update a custom field label')
    .action(
      withErrorHandler(async (id, label) => {
        const safeId = validatePathSegment(id, 'custom field ID');
        const res = await put(`/custom_fields/${safeId}`, { label });
        const cf = res.custom_field || res;
        printSuccess(`Custom field ${id} updated to: ${cf.label} (key: ${cf.key})`);
      })
    );

  // Delete custom field
  cmd
    .command('delete <id>')
    .description('Delete a custom field (removes all subscriber data for this field)')
    .action(
      withErrorHandler(async (id) => {
        const safeId = validatePathSegment(id, 'custom field ID');
        await del(`/custom_fields/${safeId}`);
        printSuccess(`Custom field ${id} deleted.`);
      })
    );

  return cmd;
}
