#!/usr/bin/env node

import { Command } from 'commander';
import { accountCommand, configCommand, setupSkillCommand } from '../src/commands/account.js';
import { subscribersCommand } from '../src/commands/subscribers.js';
import { tagsCommand } from '../src/commands/tags.js';
import { formsCommand } from '../src/commands/forms.js';
import { sequencesCommand } from '../src/commands/sequences.js';
import { broadcastsCommand } from '../src/commands/broadcasts.js';
import { customFieldsCommand } from '../src/commands/custom-fields.js';
import { purchasesCommand } from '../src/commands/purchases.js';
import { webhooksCommand } from '../src/commands/webhooks.js';
import { segmentsCommand } from '../src/commands/segments.js';
import { emailTemplatesCommand } from '../src/commands/email-templates.js';

const program = new Command();

program
  .name('kit')
  .description('CLI for the Kit (ConvertKit) email marketing API (V4)')
  .version('1.0.0');

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

program.parse();
