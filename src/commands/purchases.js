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

export function purchasesCommand() {
  const cmd = new Command('purchases').description('View purchases');

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

  return cmd;
}
