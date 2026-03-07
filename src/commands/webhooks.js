import { Command } from 'commander';
import { get, post, del, validatePathSegment, validateNumericId } from '../client.js';
import {
  formatOutput,
  printSuccess,
  printPagination,
  printDetail,
  addFormatOption,
  addPaginationOptions,
  withErrorHandler,
} from '../output.js';

const WH_COLUMNS = [
  { header: 'ID', accessor: (d) => d.id },
  { header: 'Target URL', accessor: (d) => d.target_url },
  { header: 'Event', accessor: (d) => d.event?.name },
  { header: 'Created', accessor: (d) => d.created_at?.slice(0, 10) },
];

const EVENT_TYPES = [
  'subscriber.subscriber_activate',
  'subscriber.subscriber_unsubscribe',
  'subscriber.subscriber_bounce',
  'subscriber.subscriber_complain',
  'subscriber.form_subscribe',
  'subscriber.course_subscribe',
  'subscriber.course_complete',
  'subscriber.link_click',
  'subscriber.product_purchase',
  'subscriber.tag_add',
  'subscriber.tag_remove',
  'purchase.purchase_create',
  'custom_field.field_created',
  'custom_field.field_deleted',
  'custom_field.field_value_updated',
];

export function webhooksCommand() {
  const cmd = new Command('webhooks').description('Manage webhooks');

  // List webhooks
  const list = cmd.command('list').description('List all webhooks');
  addFormatOption(list);
  addPaginationOptions(list);
  list.action(
    withErrorHandler(async (opts) => {
      const query = { per_page: opts.perPage, after: opts.after, before: opts.before };
      const res = await get('/webhooks', query);
      formatOutput(res.webhooks, WH_COLUMNS, opts);
      printPagination(res.pagination);
    })
  );

  // Create webhook
  cmd
    .command('create <targetUrl> <eventName>')
    .description('Create a webhook')
    .option('--form-id <id>', 'form ID (for form_subscribe event)')
    .option('--sequence-id <id>', 'sequence ID (for course_subscribe/course_complete events)')
    .option('--tag-id <id>', 'tag ID (for tag_add/tag_remove events)')
    .option('--product-id <id>', 'product ID (for product_purchase event)')
    .option('--initiator-value <url>', 'link URL (for link_click event)')
    .option('--custom-field-id <id>', 'custom field ID (for field_value_updated event)')
    .addHelpText(
      'after',
      `\nAvailable event types:\n${EVENT_TYPES.map((e) => `  ${e}`).join('\n')}`
    )
    .action(
      withErrorHandler(async (targetUrl, eventName, opts) => {
        try {
          new URL(targetUrl);
        } catch {
          console.error(`Invalid target URL: "${targetUrl}". Must be a valid URL (e.g., https://example.com/webhook).`);
          process.exit(1);
        }

        if (!EVENT_TYPES.includes(eventName)) {
          console.error(
            `Invalid event. Available: ${EVENT_TYPES.join(', ')}`
          );
          process.exit(1);
        }

        const event = { name: eventName };
        if (opts.formId) event.form_id = validateNumericId(opts.formId, 'form ID');
        if (opts.sequenceId) event.sequence_id = validateNumericId(opts.sequenceId, 'sequence ID');
        if (opts.tagId) event.tag_id = validateNumericId(opts.tagId, 'tag ID');
        if (opts.productId) event.product_id = validateNumericId(opts.productId, 'product ID');
        if (opts.initiatorValue) event.initiator_value = opts.initiatorValue;
        if (opts.customFieldId) event.custom_field_id = validateNumericId(opts.customFieldId, 'custom field ID');

        const res = await post('/webhooks', { target_url: targetUrl, event });
        const wh = res.webhook || res;
        printSuccess(`Webhook created: ${wh.id}`);
        printDetail(wh, [
          { label: 'ID', accessor: (d) => d.id },
          { label: 'Target URL', accessor: (d) => d.target_url },
          { label: 'Event', accessor: (d) => d.event?.name },
          { label: 'Created At', accessor: (d) => d.created_at },
        ]);
      })
    );

  // Delete webhook
  cmd
    .command('delete <id>')
    .description('Delete a webhook')
    .action(
      withErrorHandler(async (id) => {
        const safeId = validatePathSegment(id, 'webhook ID');
        await del(`/webhooks/${safeId}`);
        printSuccess(`Webhook ${id} deleted.`);
      })
    );

  return cmd;
}
