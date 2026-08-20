import { Command } from 'commander';
import { readFileSync } from 'node:fs';
import { get, post, validatePathSegment, safeJsonParse } from '../client.js';
import {
  formatOutput,
  printDetail,
  printSuccess,
  printPagination,
  addFormatOption,
  addPaginationOptions,
  withErrorHandler,
} from '../output.js';

const PURCHASE_COLUMNS = [
  { header: 'ID', accessor: (d) => d.id },
  { header: 'Transaction ID', accessor: (d) => d.transaction_id },
  { header: 'Status', accessor: (d) => d.status },
  { header: 'Total', accessor: (d) => d.total ? `${d.currency || '$'}${d.total}` : null },
  { header: 'Subscriber', accessor: (d) => d.subscriber?.email_address || d.email_address },
  { header: 'Created', accessor: (d) => d.created_at?.slice(0, 10) },
];

const DETAIL_FIELDS = [
  { label: 'ID', accessor: (d) => d.id },
  { label: 'Transaction ID', accessor: (d) => d.transaction_id },
  { label: 'Status', accessor: (d) => d.status },
  { label: 'Currency', accessor: (d) => d.currency },
  { label: 'Total', accessor: (d) => d.total },
  { label: 'Tax', accessor: (d) => d.tax },
  { label: 'Shipping', accessor: (d) => d.shipping },
  { label: 'Discount', accessor: (d) => d.discount },
  { label: 'Subtotal', accessor: (d) => d.subtotal },
  { label: 'Products', accessor: (d) => d.products ? d.products.map((p) => p.name || p.pid).join(', ') : null },
  { label: 'Subscriber', accessor: (d) => d.subscriber?.email_address || d.email_address },
  { label: 'Created At', accessor: (d) => d.created_at },
];

// Every field the API requires on a new purchase. A purchase carries a line
// item array, so it comes in as JSON rather than as a flag apiece.
const REQUIRED_PURCHASE_FIELDS = [
  'email_address',
  'transaction_id',
  'status',
  'subtotal',
  'tax',
  'shipping',
  'discount',
  'total',
  'currency',
  'transaction_time',
  'products',
];

/**
 * Reads a purchase from a JSON file. Accepts the full request body
 * (`{ "purchase": {...} }`) or a bare purchase object.
 */
function readPurchase(file) {
  let raw;
  try {
    raw = readFileSync(file, 'utf8');
  } catch (err) {
    console.error(`Failed to read ${file}: ${err.message}`);
    process.exit(1);
  }

  const parsed = safeJsonParse(raw, 'purchase JSON');
  const purchase = parsed && parsed.purchase ? parsed.purchase : parsed;

  if (!purchase || typeof purchase !== 'object' || Array.isArray(purchase)) {
    console.error('Purchase JSON must be an object, or an object with a "purchase" key.');
    process.exit(1);
  }

  const missing = REQUIRED_PURCHASE_FIELDS.filter((f) => purchase[f] === undefined);
  if (missing.length > 0) {
    console.error(`Purchase JSON is missing required field(s): ${missing.join(', ')}.`);
    process.exit(1);
  }
  if (!Array.isArray(purchase.products) || purchase.products.length === 0) {
    console.error('Purchase JSON needs a non-empty "products" array.');
    process.exit(1);
  }

  return purchase;
}

export function purchasesCommand() {
  const cmd = new Command('purchases').description('View and record purchases');

  // List purchases
  const list = cmd.command('list').description('List all purchases');
  addFormatOption(list);
  addPaginationOptions(list);
  list.action(
    withErrorHandler(async (opts) => {
      const query = { per_page: opts.perPage, after: opts.after, before: opts.before };
      const res = await get('/purchases', query);
      formatOutput(res.purchases, PURCHASE_COLUMNS, opts);
      printPagination(res.pagination);
    })
  );

  // Get purchase
  const show = cmd.command('get <id>').description('Get a purchase by ID');
  addFormatOption(show);
  show.action(
    withErrorHandler(async (id, opts) => {
      const safeId = validatePathSegment(id, 'purchase ID');
      const res = await get(`/purchases/${safeId}`);
      printDetail(res.purchase || res, DETAIL_FIELDS, opts);
    })
  );

  // Create purchase
  const create = cmd
    .command('create')
    .description('Record a purchase from a JSON file')
    .requiredOption('--file <path>', 'JSON file holding the purchase');
  addFormatOption(create);
  create.action(
    withErrorHandler(async (opts) => {
      const res = await post('/purchases', { purchase: readPurchase(opts.file) });
      const purchase = res.purchase || res;
      printSuccess(`Purchase recorded: ${purchase.id}`, opts);
      printDetail(purchase, DETAIL_FIELDS, opts);
    })
  );

  return cmd;
}
