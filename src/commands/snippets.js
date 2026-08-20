import { Command } from 'commander';
import { get, post, put, validatePathSegment, validateEnum } from '../client.js';
import {
  formatOutput,
  printDetail,
  printSuccess,
  printPagination,
  addFormatOption,
  addPaginationOptions,
  withErrorHandler,
} from '../output.js';

const SNIPPET_TYPES = ['inline', 'block'];

const SNIPPET_COLUMNS = [
  { header: 'ID', accessor: (d) => d.id },
  { header: 'Name', accessor: (d) => d.name },
  { header: 'Type', accessor: (d) => d.snippet_type },
  { header: 'Key', accessor: (d) => d.key },
  { header: 'Archived', accessor: (d) => d.archived ? 'yes' : 'no' },
  { header: 'Updated', accessor: (d) => d.updated_at?.slice(0, 10) },
];

const DETAIL_FIELDS = [
  { label: 'ID', accessor: (d) => d.id },
  { label: 'Name', accessor: (d) => d.name },
  { label: 'Type', accessor: (d) => d.snippet_type },
  { label: 'Key', accessor: (d) => d.key },
  { label: 'Archived', accessor: (d) => d.archived },
  { label: 'Content', accessor: (d) => truncate(d.content, 300) },
  { label: 'HTML', accessor: (d) => truncate(d.document?.value_html, 300) },
  { label: 'Created At', accessor: (d) => d.created_at },
  { label: 'Updated At', accessor: (d) => d.updated_at },
];

function truncate(str, len) {
  if (!str) return null;
  return str.length > len ? str.slice(0, len) + '...' : str;
}

/**
 * An inline snippet carries Liquid text in `content`. A block snippet carries
 * HTML in `document_attributes.value_html`. The API rejects the wrong pairing,
 * so check it here and give a clearer message than a 422 would.
 */
function buildSnippetBody({ name, snippetType, content, html, archived }) {
  const body = {};
  if (name !== undefined) body.name = name;
  if (snippetType !== undefined) body.snippet_type = snippetType;
  if (archived !== undefined) body.archived = archived;

  if (content !== undefined && html !== undefined) {
    console.error('Pass either --content (inline snippets) or --html (block snippets), not both.');
    process.exit(1);
  }
  if (content !== undefined) body.content = content;
  if (html !== undefined) body.document_attributes = { value_html: html };

  return body;
}

export function snippetsCommand() {
  const cmd = new Command('snippets').description('Manage reusable content snippets');

  // List snippets
  const list = cmd.command('list').description('List all snippets');
  addFormatOption(list);
  addPaginationOptions(list);
  list
    .option('--snippet-type <type>', `filter by type (${SNIPPET_TYPES.join(', ')})`)
    .option('--archived', 'list archived snippets instead of active ones')
    .option('--include-content', 'include the content of each snippet')
    .action(
      withErrorHandler(async (opts) => {
        if (opts.snippetType) validateEnum(opts.snippetType, SNIPPET_TYPES, 'snippet type');
        const query = {
          per_page: opts.perPage,
          after: opts.after,
          before: opts.before,
          snippet_type: opts.snippetType,
          archived: opts.archived ? 'true' : undefined,
          include_content: opts.includeContent ? 'true' : undefined,
        };
        const res = await get('/snippets', query);
        formatOutput(res.snippets, SNIPPET_COLUMNS, opts);
        printPagination(res.pagination);
      })
    );

  // Get snippet
  const show = cmd.command('get <id>').description('Get a snippet by ID');
  addFormatOption(show);
  show.action(
    withErrorHandler(async (id, opts) => {
      const safeId = validatePathSegment(id, 'snippet ID');
      const res = await get(`/snippets/${safeId}`);
      printDetail(res.snippet || res, DETAIL_FIELDS, opts);
    })
  );

  // Create snippet
  const create = cmd
    .command('create <name>')
    .description('Create a snippet')
    .requiredOption('--type <type>', `snippet type (${SNIPPET_TYPES.join(', ')})`)
    .option('--content <text>', 'Liquid-enabled text, for an inline snippet')
    .option('--html <html>', 'HTML body, for a block snippet');
  addFormatOption(create);
  create.action(
    withErrorHandler(async (name, opts) => {
      const type = validateEnum(opts.type, SNIPPET_TYPES, 'snippet type');
      if (type === 'inline' && opts.content === undefined) {
        console.error('An inline snippet needs --content.');
        process.exit(1);
      }
      if (type === 'block' && opts.html === undefined) {
        console.error('A block snippet needs --html.');
        process.exit(1);
      }
      const body = buildSnippetBody({
        name,
        snippetType: type,
        content: opts.content,
        html: opts.html,
      });
      const res = await post('/snippets', body);
      const snippet = res.snippet || res;
      printSuccess(`Snippet created: ${snippet.id} - ${snippet.name} (key: ${snippet.key})`);
      printDetail(snippet, DETAIL_FIELDS, opts);
    })
  );

  // Update snippet
  const update = cmd
    .command('update <id>')
    .description('Update, archive, or restore a snippet')
    .option('--name <name>', 'new snippet name')
    .option('--content <text>', 'new Liquid-enabled text, for an inline snippet')
    .option('--html <html>', 'new HTML body, for a block snippet')
    .option('--archive', 'archive the snippet')
    .option('--restore', 'restore an archived snippet');
  addFormatOption(update);
  update.action(
    withErrorHandler(async (id, opts) => {
      const safeId = validatePathSegment(id, 'snippet ID');
      if (opts.archive && opts.restore) {
        console.error('Pass either --archive or --restore, not both.');
        process.exit(1);
      }
      let archived;
      if (opts.archive) archived = true;
      if (opts.restore) archived = false;

      const body = buildSnippetBody({
        name: opts.name,
        content: opts.content,
        html: opts.html,
        archived,
      });
      if (Object.keys(body).length === 0) {
        console.error('Nothing to update. Pass at least one of --name, --content, --html, --archive, or --restore.');
        process.exit(1);
      }
      const res = await put(`/snippets/${safeId}`, body);
      const snippet = res.snippet || res;
      printSuccess(`Snippet ${id} updated.`);
      printDetail(snippet, DETAIL_FIELDS, opts);
    })
  );

  return cmd;
}
