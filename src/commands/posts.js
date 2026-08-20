import { Command } from 'commander';
import { get, validatePathSegment } from '../client.js';
import {
  formatOutput,
  printDetail,
  printPagination,
  addFormatOption,
  addPaginationOptions,
  withErrorHandler,
} from '../output.js';

const POST_COLUMNS = [
  { header: 'ID', accessor: (d) => d.id },
  { header: 'Title', accessor: (d) => d.title },
  { header: 'Status', accessor: (d) => d.status },
  { header: 'Paid', accessor: (d) => d.is_paid ? 'yes' : 'no' },
  { header: 'Published', accessor: (d) => d.published_at?.slice(0, 10) },
  { header: 'Created', accessor: (d) => d.created_at?.slice(0, 10) },
];

const DETAIL_FIELDS = [
  { label: 'ID', accessor: (d) => d.id },
  { label: 'Publication ID', accessor: (d) => d.publication_id },
  { label: 'Title', accessor: (d) => d.title },
  { label: 'Slug', accessor: (d) => d.slug },
  { label: 'Status', accessor: (d) => d.status },
  { label: 'Paid', accessor: (d) => d.is_paid },
  { label: 'Description', accessor: (d) => d.description },
  { label: 'Meta Description', accessor: (d) => d.meta_description },
  { label: 'Public URL', accessor: (d) => d.public_url },
  { label: 'Thumbnail URL', accessor: (d) => d.thumbnail_url },
  { label: 'Thumbnail Alt', accessor: (d) => d.thumbnail_alt },
  { label: 'Published At', accessor: (d) => d.published_at },
  { label: 'Sent At', accessor: (d) => d.sent_at },
  { label: 'Created At', accessor: (d) => d.created_at },
  { label: 'Content', accessor: (d) => truncate(d.content, 300) },
];

function truncate(str, len) {
  if (!str) return null;
  return str.length > len ? str.slice(0, len) + '...' : str;
}

export function postsCommand() {
  const cmd = new Command('posts').description('View published posts');

  // List posts
  const list = cmd.command('list').description('List all posts');
  addFormatOption(list);
  addPaginationOptions(list);
  list
    .option('--include-content', 'include the body content of each post')
    .action(
      withErrorHandler(async (opts) => {
        const query = {
          per_page: opts.perPage,
          after: opts.after,
          before: opts.before,
          include_content: opts.includeContent ? 'true' : undefined,
        };
        const res = await get('/posts', query);
        formatOutput(res.posts, POST_COLUMNS, opts);
        printPagination(res.pagination);
      })
    );

  // Get post
  const show = cmd.command('get <id>').description('Get a post by ID');
  addFormatOption(show);
  show.action(
    withErrorHandler(async (id, opts) => {
      const safeId = validatePathSegment(id, 'post ID');
      const res = await get(`/posts/${safeId}`);
      printDetail(res.post || res, DETAIL_FIELDS, opts);
    })
  );

  return cmd;
}
