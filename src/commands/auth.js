import { Command } from 'commander';
import chalk from 'chalk';
import { login } from '../auth.js';
import { clearTokens, getOAuthClientId, setOAuthClientId, getOAuthRedirectUri } from '../config.js';
import { printSuccess } from '../output.js';

export function loginCommand() {
  const cmd = new Command('login')
    .description('Authenticate with Kit via OAuth (PKCE)')
    .option('--client-id <id>', 'OAuth client ID (or set KIT_CLIENT_ID env var)');

  cmd.action(async (opts) => {
    const clientId = opts.clientId || getOAuthClientId();

    if (!clientId) {
      console.error(chalk.red('Client ID required. Pass --client-id <id> or set the KIT_CLIENT_ID env var.'));
      console.error(chalk.dim('Register your app at https://app.kit.com/account_settings/developer_settings'));
      process.exit(1);
    }

    if (opts.clientId) {
      setOAuthClientId(opts.clientId);
    }

    const redirectUri = getOAuthRedirectUri();
    if (!redirectUri) {
      console.error(chalk.red('Redirect URI not configured. Set it with:'));
      console.error(chalk.dim('  kit config set-redirect-uri <uri>'));
      console.error(chalk.dim('  or set the KIT_REDIRECT_URI env var.'));
      process.exit(1);
    }

    console.log(chalk.cyan('Opening browser for Kit authorization...'));
    console.log(chalk.dim(`Redirect URI: ${getOAuthRedirectUri()}`));
    console.log(chalk.dim('Waiting for authorization (timeout: 5 minutes)...'));

    try {
      await login(clientId);
      printSuccess('Authenticated with Kit successfully.');
      console.log(chalk.dim('Run `kit account` to verify.'));
    } catch (err) {
      console.error(chalk.red(`Login failed: ${err.message}`));
      process.exit(1);
    }
  });

  return cmd;
}

export function logoutCommand() {
  const cmd = new Command('logout')
    .description('Clear stored OAuth tokens');

  cmd.action(() => {
    clearTokens();
    printSuccess('Logged out. OAuth tokens cleared.');
  });

  return cmd;
}
