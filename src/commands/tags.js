import { Command } from 'commander';
import { get, post, del, validatePathSegment } from '../client.js';
import {
  formatOutput,
  printSuccess,
  printPagination,
  addFormatOption,
  addPaginationOptions,
  withErrorHandler,
} from '../output.js';

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
  cmd
    .command('create <name>')
    .description('Create a new tag')
    .action(
      withErrorHandler(async (name) => {
        const res = await post('/tags', { name });
        const tag = res.tag || res;
        printSuccess(`Tag created: ${tag.id} - ${tag.name}`);
      })
    );

  // List subscribers for tag
  const subs = cmd
    .command('subscribers <tagId>')
    .description('List subscribers for a tag');
  addFormatOption(subs);
  addPaginationOptions(subs);
  subs.action(
    withErrorHandler(async (tagId, opts) => {
      const safeTagId = validatePathSegment(tagId, 'tag ID');
      const query = { per_page: opts.perPage, after: opts.after, before: opts.before };
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

  // Remove tag from subscriber
  cmd
    .command('remove <tagId> <subscriberId>')
    .description('Remove tag from a subscriber')
    .action(
      withErrorHandler(async (tagId, subscriberId) => {
        const safeTagId = validatePathSegment(tagId, 'tag ID');
        const safeSubId = validatePathSegment(subscriberId, 'subscriber ID');
        await del(`/tags/${safeTagId}/subscribers/${safeSubId}`);
        printSuccess(`Tag ${tagId} removed from subscriber ${subscriberId}.`);
      })
    );

  return cmd;
}
