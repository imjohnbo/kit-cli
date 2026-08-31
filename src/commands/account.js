import { Command } from 'commander';
import { get, put } from '../client.js';
import {
  formatOutput,
  printDetail,
  printSuccess,
  addFormatOption,
  withErrorHandler,
} from '../output.js';
import {
  getAll,
  setApiKey,
  setBaseUrl,
  setOAuthClientId,
  setOAuthRedirectUri,
  setDefaultFormat,
  setPerPage,
  setUpdateCheckEnabled,
  setTelemetryEnabled,
} from '../config.js';
import chalk from 'chalk';
import { cpSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));

const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const MAX_COLORS = 10;

const ACCOUNT_FIELDS = [
  { label: 'ID', accessor: (d) => d.id },
  { label: 'Name', accessor: (d) => d.name },
  { label: 'Plan', accessor: (d) => d.plan_type },
  { label: 'Billing Interval', accessor: (d) => d.plan?.interval },
  { label: 'Subscriber Limit', accessor: (d) => d.plan?.subscriber_limit },
  { label: 'On Trial', accessor: (d) => d.plan?.on_trial },
  { label: 'Renews At', accessor: (d) => d.plan?.renews_at },
  { label: 'Primary Email', accessor: (d) => d.primary_email_address },
  { label: 'Time Zone', accessor: (d) => d.timezone?.name },
  { label: 'Sending Addresses', accessor: (d) => formatSendingAddresses(d.sending_addresses) },
  { label: 'Created At', accessor: (d) => d.created_at },
];

const PROFILE_FIELDS = [
  { label: 'Name', accessor: (d) => d.name },
  { label: 'Byline', accessor: (d) => d.byline },
  { label: 'Bio', accessor: (d) => d.bio },
  { label: 'Image URL', accessor: (d) => d.image_url },
  { label: 'Profile URL', accessor: (d) => d.profile_url },
];

const EMAIL_STATS_FIELDS = [
  { label: 'Sent', accessor: (d) => d.sent },
  { label: 'Opened', accessor: (d) => d.opened },
  { label: 'Open Rate', accessor: (d) => d.open_rate },
  { label: 'Clicked', accessor: (d) => d.clicked },
  { label: 'Click Rate', accessor: (d) => d.click_rate },
  { label: 'Unsubscribe Rate', accessor: (d) => d.unsubscribe_rate },
  { label: 'Bounce Rate', accessor: (d) => d.bounce_rate },
  { label: 'Mode', accessor: (d) => d.email_stats_mode },
  { label: 'Open Tracking', accessor: (d) => d.open_tracking_enabled },
  { label: 'Click Tracking', accessor: (d) => d.click_tracking_enabled },
  { label: 'From', accessor: (d) => d.starting },
  { label: 'To', accessor: (d) => d.ending },
];

const GROWTH_STATS_FIELDS = [
  { label: 'Subscribers', accessor: (d) => d.subscribers },
  { label: 'New Subscribers', accessor: (d) => d.new_subscribers },
  { label: 'Cancellations', accessor: (d) => d.cancellations },
  { label: 'Net New Subscribers', accessor: (d) => d.net_new_subscribers },
  { label: 'From', accessor: (d) => d.starting },
  { label: 'To', accessor: (d) => d.ending },
];

const COLOR_COLUMNS = [{ header: 'Color', accessor: (d) => d }];

function formatSendingAddresses(addresses) {
  if (!Array.isArray(addresses) || addresses.length === 0) return null;
  return addresses
    .map((a) => `${a.email_address}${a.is_default ? ' (default)' : ''}${a.is_verified ? '' : ' [unverified]'}`)
    .join(', ');
}

function validateColors(values) {
  if (values.length > MAX_COLORS) {
    console.error(`Too many colors: ${values.length}. The account holds at most ${MAX_COLORS}.`);
    process.exit(1);
  }
  const invalid = values.filter((v) => !HEX_COLOR.test(v));
  if (invalid.length > 0) {
    console.error(`Invalid hex color(s): ${invalid.join(', ')}. Use #rgb or #rrggbb.`);
    process.exit(1);
  }
  return values;
}

export function accountCommand() {
  const cmd = new Command('account').description('View your Kit account info');

  addFormatOption(cmd);

  cmd.action(
    withErrorHandler(async (opts) => {
      const data = await get('/account');
      printDetail(data.account || data, ACCOUNT_FIELDS, opts);
    })
  );

  // Brand colors
  const colors = cmd.command('colors').description('List your account brand colors');
  addFormatOption(colors);
  colors.action(
    withErrorHandler(async (opts) => {
      const res = await get('/account/colors');
      formatOutput(res.colors, COLOR_COLUMNS, opts);
    })
  );

  const setColors = cmd
    .command('set-colors <colors...>')
    .description(`Replace your account brand colors with up to ${MAX_COLORS} hex codes`);
  addFormatOption(setColors);
  setColors.action(
    withErrorHandler(async (values, opts) => {
      const res = await put('/account/colors', { colors: validateColors(values) });
      if ((opts.format || 'table') === 'json') {
        formatOutput(res.colors, COLOR_COLUMNS, opts);
      } else {
        printSuccess(`Brand colors updated: ${(res.colors || []).join(', ')}`);
      }
    })
  );

  // Creator profile
  const profile = cmd.command('creator-profile').description('Show your creator profile');
  addFormatOption(profile);
  profile.action(
    withErrorHandler(async (opts) => {
      const res = await get('/account/creator_profile');
      printDetail(res.profile || res, PROFILE_FIELDS, opts);
    })
  );

  // Email stats
  const emailStats = cmd.command('email-stats').description('Show lifetime email stats');
  addFormatOption(emailStats);
  emailStats.action(
    withErrorHandler(async (opts) => {
      const res = await get('/account/email_stats');
      printDetail(res.stats || res, EMAIL_STATS_FIELDS, opts);
    })
  );

  // Growth stats
  const growthStats = cmd.command('growth-stats').description('Show subscriber growth stats');
  addFormatOption(growthStats);
  growthStats
    .option('--starting <date>', 'start of the reporting period (yyyy-mm-dd)')
    .option('--ending <date>', 'end of the reporting period (yyyy-mm-dd)')
    .action(
      withErrorHandler(async (opts) => {
        const res = await get('/account/growth_stats', {
          starting: opts.starting,
          ending: opts.ending,
        });
        printDetail(res.stats || res, GROWTH_STATS_FIELDS, opts);
      })
    );

  return cmd;
}

export function configCommand() {
  const cmd = new Command('config').description('Manage CLI configuration');

  cmd
    .command('show')
    .description('Show current configuration')
    .action(
      withErrorHandler(async () => {
        const cfg = getAll();
        for (const [key, val] of Object.entries(cfg)) {
          console.log(`${chalk.cyan(key.padEnd(20))}${val}`);
        }
      })
    );

  cmd
    .command('set-base-url <url>')
    .description('Set the API base URL (default: https://api.kit.com/v4)')
    .action(
      withErrorHandler(async (url) => {
        setBaseUrl(url);
        console.log(chalk.green('✓ API base URL saved.'));
      })
    );

  cmd
    .command('set-api-key <key>')
    .description('Set your Kit API key')
    .action(
      withErrorHandler(async (key) => {
        setApiKey(key);
        console.log(chalk.green('\u2713 API key saved.'));
      })
    );

  cmd
    .command('set-client-id <id>')
    .description('Set your Kit OAuth client ID (used by `kit login`)')
    .action(
      withErrorHandler(async (id) => {
        setOAuthClientId(id);
        console.log(chalk.green('\u2713 OAuth client ID saved.'));
      })
    );

  cmd
    .command('set-redirect-uri <uri>')
    .description('Set the OAuth redirect URI (default: hosted GitHub Pages shim)')
    .action(
      withErrorHandler(async (uri) => {
        setOAuthRedirectUri(uri);
        console.log(chalk.green('\u2713 OAuth redirect URI saved.'));
      })
    );

  cmd
    .command('set-format <format>')
    .description('Set default output format (table, json)')
    .action(
      withErrorHandler(async (format) => {
        if (!['table', 'json'].includes(format)) {
          throw new Error('Format must be "table" or "json".');
        }
        setDefaultFormat(format);
        console.log(chalk.green(`\u2713 Default format set to ${format}.`));
      })
    );

  cmd
    .command('set-per-page <n>')
    .description('Set default results per page (1-1000)')
    .action(
      withErrorHandler(async (n) => {
        const num = parseInt(n, 10);
        if (isNaN(num) || num < 1 || num > 1000) {
          throw new Error('Per page must be between 1 and 1000.');
        }
        setPerPage(num);
        console.log(chalk.green(`\u2713 Default per_page set to ${num}.`));
      })
    );

  cmd
    .command('set-update-check <enabled>')
    .description('Turn the update notice on or off (true, false)')
    .action(
      withErrorHandler(async (enabled) => {
        if (!['true', 'false'].includes(enabled)) {
          throw new Error('Value must be "true" or "false".');
        }
        setUpdateCheckEnabled(enabled === 'true');
        console.log(chalk.green(`\u2713 Update check ${enabled === 'true' ? 'enabled' : 'disabled'}.`));
      })
    );

  cmd
    .command('set-telemetry <enabled>')
    .description('Turn anonymous usage telemetry and error reporting on or off (true, false)')
    .action(
      withErrorHandler(async (enabled) => {
        if (!['true', 'false'].includes(enabled)) {
          throw new Error('Value must be "true" or "false".');
        }
        setTelemetryEnabled(enabled === 'true');
        console.log(chalk.green(`\u2713 Telemetry ${enabled === 'true' ? 'enabled' : 'disabled'}.`));
      })
    );

  return cmd;
}

export function setupSkillCommand() {
  const cmd = new Command('setup-skill')
    .description('Install the Claude Code /kit skill to ~/.claude/skills/kit/');

  cmd.action(
    withErrorHandler(async () => {
      const src = join(__dirname, '..', '..', 'skills', 'kit');
      const dest = join(homedir(), '.claude', 'skills', 'kit');

      if (!existsSync(join(src, 'SKILL.md'))) {
        throw new Error('Skill source not found. Ensure the skills/kit/ directory exists in the kit-cli package.');
      }

      mkdirSync(dest, { recursive: true });
      cpSync(src, dest, { recursive: true });
      printSuccess(`Claude Code skill installed to ${dest}`);
      console.log(chalk.dim('You can now use /kit in Claude Code to manage your Kit account.'));
    })
  );

  return cmd;
}
