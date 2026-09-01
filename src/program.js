import { Command } from 'commander';
import chalk from 'chalk';
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
import { apiCommand } from './commands/api.js';
import { doctorCommand } from './commands/doctor.js';
import { initCommand } from './commands/init.js';
import { completionCommand, completeCommand } from './commands/completion.js';

// Imported, not just re-exported, because buildProgram() below uses it.
import { VERSION } from './package-info.js';
// current-command.js, not telemetry.js: this hook runs on every single
// invocation (--help, --version, telemetry disabled, all of it), so it must
// not have to load telemetry.js's Segment SDK import just to reach two
// accessor functions.
import { setCurrentCommand } from './current-command.js';

export { VERSION };

/**
 * Builds the whole command tree.
 *
 * Kept apart from bin/kit.js so tests can walk the tree without parsing argv.
 */
export function buildProgram() {
  const program = new Command();

  program.hook('preAction', (_thisCommand, actionCommand) => {
    setCurrentCommand(commandPath(actionCommand));
  });

  program
    .name('kit')
    .description('CLI for the Kit (ConvertKit) email marketing API (V4)')
    .version(VERSION);

  program.addHelpText('before', `${chalk.hex('#44B1FF').bold('kit')} — CLI for Kit (ConvertKit)\n`);

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
  program.addCommand(apiCommand());
  program.addCommand(doctorCommand());
  program.addCommand(initCommand());
  program.addCommand(completionCommand());
  program.addCommand(completeCommand(program), { hidden: true });

  return program;
}

/**
 * Every command path in the tree, as space-separated strings (e.g.
 * "sequences emails create"). Shared by the telemetry event map and shell
 * completions, and also used by scripts/spec-coverage.test.js — so a command
 * added or renamed only has one place this logic could go stale.
 * scripts/cli-surface.js keeps its own separate walk, since it also needs
 * each command's arguments and options, not just its path.
 */
export function commandPaths(cmd, prefix = []) {
  const paths = [];
  for (const child of cmd.commands) {
    if (child.name() === 'help') continue;
    const path = [...prefix, child.name()];
    paths.push(path.join(' '));
    paths.push(...commandPaths(child, path));
  }
  return paths;
}

/**
 * The path of a single already-resolved command node, e.g. "tags list".
 * Returns '' for the root program itself, which has no parent to walk from.
 */
export function commandPath(cmd) {
  const parts = [];
  let node = cmd;
  while (node && node.parent) {
    parts.unshift(node.name());
    node = node.parent;
  }
  return parts.join(' ');
}
