import Table from 'cli-table3';
import chalk from 'chalk';
import { getDefaultFormat } from './config.js';

export function formatOutput(data, columns, opts = {}) {
  const format = opts.format || getDefaultFormat();

  if (format === 'json') {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  if (!data || (Array.isArray(data) && data.length === 0)) {
    console.log(chalk.yellow('No results found.'));
    return;
  }

  const items = Array.isArray(data) ? data : [data];

  const table = new Table({
    head: columns.map((c) => chalk.cyan(c.header)),
    style: { head: [], border: [] },
    wordWrap: true,
  });

  for (const item of items) {
    table.push(columns.map((c) => {
      const val = c.accessor(item);
      return val === null || val === undefined ? chalk.dim('-') : String(val);
    }));
  }

  console.log(table.toString());
  if (Array.isArray(data)) {
    console.log(chalk.dim(`\n${items.length} result(s)`));
  }
}

export function printDetail(data, fields, opts = {}) {
  const format = opts.format || getDefaultFormat();
  if (format === 'json') {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  const maxLen = Math.max(...fields.map((f) => f.label.length));
  for (const field of fields) {
    const val = field.accessor(data);
    const display = val === null || val === undefined ? chalk.dim('-') : String(val);
    console.log(`${chalk.cyan(field.label.padEnd(maxLen + 2))}${display}`);
  }
}

export function printSuccess(msg) {
  console.log(chalk.green(`\u2713 ${msg}`));
}

export function printError(err) {
  if (err.errors) {
    console.error(chalk.red(`Error (${err.status}): ${err.errors.join('; ')}`));
  } else {
    console.error(chalk.red(`Error: ${err.message}`));
  }
}

export function printPagination(pagination) {
  if (!pagination) return;
  const parts = [];
  if (pagination.has_previous_page) parts.push(`prev: --before ${pagination.start_cursor}`);
  if (pagination.has_next_page) parts.push(`next: --after ${pagination.end_cursor}`);
  if (parts.length) console.log(chalk.dim(`\nPagination: ${parts.join('  |  ')}`));
}

export function addFormatOption(cmd) {
  return cmd.option('-f, --format <format>', 'output format (table, json)', getDefaultFormat());
}

export function addPaginationOptions(cmd) {
  return cmd
    .option('--per-page <n>', 'results per page (max 1000)', '50')
    .option('--after <cursor>', 'cursor for next page')
    .option('--before <cursor>', 'cursor for previous page');
}

export function withErrorHandler(fn) {
  return async (...args) => {
    try {
      await fn(...args);
    } catch (err) {
      printError(err);
      process.exit(1);
    }
  };
}
