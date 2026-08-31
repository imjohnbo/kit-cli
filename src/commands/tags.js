import { Command } from 'commander';
import { get, post, put, del, validatePathSegment, validateEnum } from '../client.js';
import {
  formatOutput,
  printSuccess,
  printPagination,
  addFormatOption,
  addPaginationOptions,
  addSlimOption,
  withErrorHandler,
} from '../output.js';

const SUB_STATUSES = ['active', 'inactive', 'bounced', 'complained', 'cancelled', 'all'];

const TAG_COLUMNS = [
  { header: 'ID', accessor: (d) => d.id },
  { header: 'Name', accessor: (d) => d.name },
  { header: 'Created', accessor: (d) => d.created_at?.slice(0, 10) },
];

const SUB_COLUMNS = [
  { header: 'ID', accessor: (d) => d.id },
  { header: 'Email', accessor: (d) => d.email_address },
  { header: 'First Name', accessor: (d) => d.first_name },
  { header: 'State', accessor: (d) => d.state },
  { header: 'Tagged At', accessor: (d) => d.tagged_at?.slice(0, 10) },
];

export function tagsCommand() {
  const cmd = new Command('tags').description('Manage tags');

  // List tags
  const list = cmd.command('list').description('List all tags');
  addFormatOption(list);
  addPaginationOptions(list);
  list.action(
    withErrorHandler(async (opts) => {
      const query = { per_page: opts.perPage, after: opts.after, before: opts.before };
      const res = await get('/tags', query);
      formatOutput(res.tags, TAG_COLUMNS, opts);
      printPagination(res.pagination);
    })
  );

  // Create tag
  const create = cmd
    .command('create <name>')
    .description('Create a new tag');
  addFormatOption(create);
  create.action(
    withErrorHandler(async (name, opts) => {
      const res = await post('/tags', { name });
      const tag = res.tag || res;
      if ((opts.format || 'table') === 'json') {
        console.log(JSON.stringify(tag, null, 2));
      } else {
        printSuccess(`Tag created: ${tag.id} - ${tag.name}`);
      }
    })
  );

  // Rename tag
  const update = cmd
    .command('update <id> <name>')
    .description('Rename a tag');
  addFormatOption(update);
  update.action(
    withErrorHandler(async (id, name, opts) => {
      const safeId = validatePathSegment(id, 'tag ID');
      const res = await put(`/tags/${safeId}`, { name });
      const tag = res.tag || res;
      if ((opts.format || 'table') === 'json') {
        console.log(JSON.stringify(tag, null, 2));
      } else {
        printSuccess(`Tag ${id} renamed to: ${tag.name || name}`);
      }
    })
  );

  // List subscribers for tag
  const subs = cmd
    .command('subscribers <tagId>')
    .description('List subscribers for a tag');
  addFormatOption(subs);
  addPaginationOptions(subs);
  addSlimOption(subs, 'custom field values');
  subs
    .option('-s, --state <state>', `filter by state (${SUB_STATUSES.join(', ')})`)
    .option('--created-after <date>', 'filter by subscriber created after (yyyy-mm-dd)')
    .option('--created-before <date>', 'filter by subscriber created before (yyyy-mm-dd)')
    .option('--tagged-after <date>', 'filter by tagged after (yyyy-mm-dd)')
    .option('--tagged-before <date>', 'filter by tagged before (yyyy-mm-dd)')
    .action(
      withErrorHandler(async (tagId, opts) => {
        const safeTagId = validatePathSegment(tagId, 'tag ID');
        if (opts.state) validateEnum(opts.state, SUB_STATUSES, 'state');
        const query = {
          per_page: opts.perPage,
          after: opts.after,
          before: opts.before,
          status: opts.state,
          created_after: opts.createdAfter,
          created_before: opts.createdBefore,
          tagged_after: opts.taggedAfter,
          tagged_before: opts.taggedBefore,
          slim: opts.slim ? 'true' : undefined,
        };
        const res = await get(`/tags/${safeTagId}/subscribers`, query);
        formatOutput(res.subscribers, SUB_COLUMNS, opts);
        printPagination(res.pagination);
      })
    );

  // Tag a subscriber by ID
  cmd
    .command('add <tagId> <subscriberId>')
    .description('Tag a subscriber by subscriber ID')
    .action(
      withErrorHandler(async (tagId, subscriberId) => {
        const safeTagId = validatePathSegment(tagId, 'tag ID');
        const safeSubId = validatePathSegment(subscriberId, 'subscriber ID');
        await post(`/tags/${safeTagId}/subscribers/${safeSubId}`);
        printSuccess(`Subscriber ${subscriberId} tagged with tag ${tagId}.`);
      })
    );

  // Tag a subscriber by email
  cmd
    .command('add-by-email <tagId> <email>')
    .description('Tag a subscriber by email address')
    .action(
      withErrorHandler(async (tagId, email) => {
        const safeTagId = validatePathSegment(tagId, 'tag ID');
        await post(`/tags/${safeTagId}/subscribers`, { email_address: email });
        printSuccess(`Subscriber ${email} tagged with tag ${tagId}.`);
      })
    );

  // Remove tag from subscriber by ID
  cmd
    .command('remove <tagId> <subscriberId>')
    .description('Remove tag from a subscriber by subscriber ID')
    .action(
      withErrorHandler(async (tagId, subscriberId) => {
        const safeTagId = validatePathSegment(tagId, 'tag ID');
        const safeSubId = validatePathSegment(subscriberId, 'subscriber ID');
        await del(`/tags/${safeTagId}/subscribers/${safeSubId}`);
        printSuccess(`Tag ${tagId} removed from subscriber ${subscriberId}.`);
      })
    );

  // Remove tag from subscriber by email. The API identifies the subscriber
  // with an email_address query parameter rather than a request body.
  cmd
    .command('remove-by-email <tagId> <email>')
    .description('Remove tag from a subscriber by email address')
    .action(
      withErrorHandler(async (tagId, email) => {
        const safeTagId = validatePathSegment(tagId, 'tag ID');
        await del(`/tags/${safeTagId}/subscribers`, undefined, { email_address: email });
        printSuccess(`Tag ${tagId} removed from subscriber ${email}.`);
      })
    );

  return cmd;
}
