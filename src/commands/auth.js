import { Command } from 'commander';
import chalk from 'chalk';
import { login } from '../auth.js';
import { clearTokens, getOAuthClientId, setOAuthClientId, getOAuthRedirectUri } from '../config.js';
import { printSuccess, withErrorHandler } from '../output.js';

export function loginCommand() {
  const cmd = new Command('login')
    .description('Authenticate with Kit via OAuth (PKCE)')
    .option('--client-id <id>', 'OAuth client ID (or set KIT_CLIENT_ID env var)');

  cmd.action(
    withErrorHandler(async (opts) => {
      const clientId = opts.clientId || getOAuthClientId();

      if (!clientId) {
        throw new Error(
          'Client ID required. Pass --client-id <id> or set the KIT_CLIENT_ID env var.\n' +
          'Register your app at https://app.kit.com/account_settings/developer_settings'
        );
      }

      if (opts.clientId) {
        setOAuthClientId(opts.clientId);
      }

      const redirectUri = getOAuthRedirectUri();
      if (!redirectUri) {
        throw new Error(
          'Redirect URI not configured. Set it with:\n' +
          '  kit config set-redirect-uri <uri>\n' +
          '  or set the KIT_REDIRECT_URI env var.'
        );
      }

      console.log(chalk.cyan('Opening browser for Kit authorization...'));
      console.log(chalk.dim(`Redirect URI: ${getOAuthRedirectUri()}`));
      console.log(chalk.dim('Waiting for authorization (timeout: 5 minutes)...'));

      try {
        await login(clientId);
      } catch (err) {
        throw new Error(`Login failed: ${err.message}`);
      }

      printSuccess('Authenticated with Kit successfully.');
      console.log(chalk.dim('Run `kit account` to verify.'));
    })
  );

  return cmd;
}

export function logoutCommand() {
  const cmd = new Command('logout')
    .description('Clear stored OAuth tokens');

  cmd.action(
    withErrorHandler(async () => {
      clearTokens();
      printSuccess('Logged out. OAuth tokens cleared.');
    })
  );

  return cmd;
}
