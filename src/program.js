import { Command } from 'commander';
import { accountCommand, configCommand, setupSkillCommand } from './commands/account.js';
import { loginCommand, logoutCommand } from './commands/auth.js';
import { bulkCommand } from './commands/bulk.js';
import { subscribersCommand } from './commands/subscribers.js';
import { tagsCommand } from './commands/tags.js';
import { formsCommand } from './commands/forms.js';
import { sequencesCommand } from './commands/sequences.js';
import { broadcastsCommand } from './commands/broadcasts.js';
import { customFieldsCommand } from './commands/custom-fields.js';
import { purchasesCommand } from './commands/purchases.js';
import { webhooksCommand } from './commands/webhooks.js';
import { segmentsCommand } from './commands/segments.js';
import { emailTemplatesCommand } from './commands/email-templates.js';
import { postsCommand } from './commands/posts.js';
import { snippetsCommand } from './commands/snippets.js';
import { upgradeCommand } from './commands/upgrade.js';

// Imported, not just re-exported, because buildProgram() below uses it.
import { VERSION } from './package-info.js';

export { VERSION };

/**
 * Builds the whole command tree.
 *
 * Kept apart from bin/kit.js so tests can walk the tree without parsing argv.
 */
export function buildProgram() {
  const program = new Command();

  program
    .name('kit')
    .description('CLI for the Kit (ConvertKit) email marketing API (V4)')
    .version(VERSION);

  program.addCommand(loginCommand());
  program.addCommand(logoutCommand());
  program.addCommand(accountCommand());
  program.addCommand(configCommand());
  program.addCommand(setupSkillCommand());
  program.addCommand(subscribersCommand());
  program.addCommand(tagsCommand());
  program.addCommand(formsCommand());
  program.addCommand(sequencesCommand());
  program.addCommand(broadcastsCommand());
  program.addCommand(customFieldsCommand());
  program.addCommand(purchasesCommand());
  program.addCommand(webhooksCommand());
  program.addCommand(segmentsCommand());
  program.addCommand(emailTemplatesCommand());
  program.addCommand(postsCommand());
  program.addCommand(snippetsCommand());
  program.addCommand(bulkCommand());
  program.addCommand(upgradeCommand());

  return program;
}
