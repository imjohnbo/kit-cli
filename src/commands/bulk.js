import { Command } from 'commander';
import { readFileSync } from 'node:fs';
import chalk from 'chalk';
import { post, del } from '../client.js';
import { withErrorHandler } from '../output.js';

function readJsonFile(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch (err) {
    console.error(chalk.red(`Failed to read ${filePath}: ${err.message}`));
    process.exit(1);
  }
}

function addBulkOptions(cmd) {
  return cmd
    .requiredOption('--file <path>', 'path to JSON file containing array of items')
    .option('--callback-url <url>', 'URL to POST results to when processing asynchronously');
}

function printResult(result, itemKey) {
  if (!result || Object.keys(result).length === 0) {
    console.log(chalk.yellow('Queued for async processing. Results will be POSTed to callback_url when complete.'));
    return;
  }
  const items = result[itemKey] || [];
  const failures = result.failures || [];
  console.log(chalk.green(`\u2713 ${items.length} succeeded, ${failures.length} failed.`));
  if (failures.length > 0) {
    console.log(chalk.red('\nFailures:'));
    for (const f of failures) {
      console.log(chalk.red(`  ${JSON.stringify(f)}`));
    }
  }
}

export function bulkCommand() {
  const bulk = new Command('bulk').description('Bulk operations (requires OAuth)');

  // --- subscribers ---
  const subscribers = new Command('subscribers').description('Bulk subscriber operations');

  addBulkOptions(
    subscribers
      .command('create')
      .description('Create or upsert up to 100+ subscribers from a JSON file (sync ≤100, async >100)')
  ).action(withErrorHandler(async (opts) => {
    const items = readJsonFile(opts.file);
    const body = { subscribers: items };
    if (opts.callbackUrl) body.callback_url = opts.callbackUrl;
    const result = await post('/bulk/subscribers', body);
    printResult(result, 'subscribers');
  }));

  bulk.addCommand(subscribers);

  // --- tags ---
  const tags = new Command('tags').description('Bulk tag operations');

  addBulkOptions(
    tags
      .command('create')
      .description('Create up to 100+ tags from a JSON file (sync ≤100, async >100)')
  ).action(withErrorHandler(async (opts) => {
    const items = readJsonFile(opts.file);
    const body = { tags: items };
    if (opts.callbackUrl) body.callback_url = opts.callbackUrl;
    const result = await post('/bulk/tags', body);
    printResult(result, 'tags');
  }));

  addBulkOptions(
    tags
      .command('add')
      .description('Tag multiple subscribers. JSON: [{tag_id, subscriber_id}, ...] (sync ≤100, async >100)')
  ).action(withErrorHandler(async (opts) => {
    const items = readJsonFile(opts.file);
    const body = { taggings: items };
    if (opts.callbackUrl) body.callback_url = opts.callbackUrl;
    const result = await post('/bulk/tags/subscribers', body);
    printResult(result, 'subscribers');
  }));

  addBulkOptions(
    tags
      .command('remove')
      .description('Remove tags from multiple subscribers. JSON: [{tag_id, subscriber_id}, ...] (sync ≤100, async >100)')
  ).action(withErrorHandler(async (opts) => {
    const items = readJsonFile(opts.file);
    const body = { taggings: items };
    if (opts.callbackUrl) body.callback_url = opts.callbackUrl;
    const result = await del('/bulk/tags/subscribers', body);
    printResult(result, 'failures');
  }));

  bulk.addCommand(tags);

  // --- forms ---
  const forms = new Command('forms').description('Bulk form operations');

  addBulkOptions(
    forms
      .command('add')
      .description('Add multiple subscribers to forms. JSON: [{form_id, subscriber_id, referrer?}, ...] (sync ≤100, async >100)')
  ).action(withErrorHandler(async (opts) => {
    const items = readJsonFile(opts.file);
    const body = { additions: items };
    if (opts.callbackUrl) body.callback_url = opts.callbackUrl;
    const result = await post('/bulk/forms/subscribers', body);
    printResult(result, 'subscribers');
  }));

  bulk.addCommand(forms);

  // --- custom-fields ---
  const customFields = new Command('custom-fields').description('Bulk custom field operations');

  addBulkOptions(
    customFields
      .command('create')
      .description('Create multiple custom fields. JSON: [{label}, ...] (sync ≤100, async >100)')
  ).action(withErrorHandler(async (opts) => {
    const items = readJsonFile(opts.file);
    const body = { custom_fields: items };
    if (opts.callbackUrl) body.callback_url = opts.callbackUrl;
    const result = await post('/bulk/custom_fields', body);
    printResult(result, 'custom_fields');
  }));

  addBulkOptions(
    customFields
      .command('update-values')
      .description('Update custom field values for multiple subscribers. JSON: [{subscriber_id, subscriber_custom_field_id, value}, ...] (sync ≤100, async >100)')
  ).action(withErrorHandler(async (opts) => {
    const items = readJsonFile(opts.file);
    const body = { custom_field_values: items };
    if (opts.callbackUrl) body.callback_url = opts.callbackUrl;
    const result = await post('/bulk/custom_fields/subscribers', body);
    printResult(result, 'custom_field_values');
  }));

  bulk.addCommand(customFields);

  return bulk;
}
