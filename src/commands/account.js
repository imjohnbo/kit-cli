import { Command } from 'commander';
import { get } from '../client.js';
import { printDetail, printSuccess, addFormatOption, withErrorHandler } from '../output.js';
import {
  getAll,
  setApiKey,
  setOAuthClientId,
  setDefaultFormat,
  setPerPage,
} from '../config.js';
import chalk from 'chalk';
import { cpSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));

export function accountCommand() {
  const cmd = new Command('account').description('View your Kit account info');

  addFormatOption(cmd);

  cmd.action(
    withErrorHandler(async (opts) => {
      const data = await get('/account');
      printDetail(data.account || data, [
        { label: 'Name', accessor: (d) => d.name },
        { label: 'Plan', accessor: (d) => d.plan_name || d.plan },
        { label: 'Primary Email', accessor: (d) => d.primary_email_address },
        { label: 'State', accessor: (d) => d.state },
        { label: 'Created At', accessor: (d) => d.created_at },
      ], opts);
    })
  );

  return cmd;
}

export function configCommand() {
  const cmd = new Command('config').description('Manage CLI configuration');

  cmd
    .command('show')
    .description('Show current configuration')
    .action(() => {
      const cfg = getAll();
      for (const [key, val] of Object.entries(cfg)) {
        console.log(`${chalk.cyan(key.padEnd(20))}${val}`);
      }
    });

  cmd
    .command('set-api-key <key>')
    .description('Set your Kit API key')
    .action((key) => {
      try {
        setApiKey(key);
        console.log(chalk.green('\u2713 API key saved.'));
      } catch (err) {
        console.error(chalk.red(err.message));
        process.exit(1);
      }
    });

  cmd
    .command('set-client-id <id>')
    .description('Set your Kit OAuth client ID (used by `kit login`)')
    .action((id) => {
      setOAuthClientId(id);
      console.log(chalk.green('\u2713 OAuth client ID saved.'));
    });

  cmd
    .command('set-format <format>')
    .description('Set default output format (table, json)')
    .action((format) => {
      if (!['table', 'json'].includes(format)) {
        console.error(chalk.red('Format must be "table" or "json".'));
        process.exit(1);
      }
      setDefaultFormat(format);
      console.log(chalk.green(`\u2713 Default format set to ${format}.`));
    });

  cmd
    .command('set-per-page <n>')
    .description('Set default results per page (1-1000)')
    .action((n) => {
      const num = parseInt(n, 10);
      if (isNaN(num) || num < 1 || num > 1000) {
        console.error(chalk.red('Per page must be between 1 and 1000.'));
        process.exit(1);
      }
      setPerPage(num);
      console.log(chalk.green(`\u2713 Default per_page set to ${num}.`));
    });

  return cmd;
}

export function setupSkillCommand() {
  const cmd = new Command('setup-skill')
    .description('Install the Claude Code /kit skill to ~/.claude/skills/kit/');

  cmd.action(() => {
    const src = join(__dirname, '..', '..', 'skills', 'kit');
    const dest = join(homedir(), '.claude', 'skills', 'kit');

    if (!existsSync(join(src, 'SKILL.md'))) {
      console.error(chalk.red('Skill source not found. Ensure the skills/kit/ directory exists in the kit-cli package.'));
      process.exit(1);
    }

    mkdirSync(dest, { recursive: true });
    cpSync(src, dest, { recursive: true });
    printSuccess(`Claude Code skill installed to ${dest}`);
    console.log(chalk.dim('You can now use /kit in Claude Code to manage your Kit account.'));
  });

  return cmd;
}
