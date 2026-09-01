import { Command } from 'commander';
import chalk from 'chalk';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { login } from '../auth.js';
import { setApiKey, setOAuthClientId, setOAuthRedirectUri, getOAuthRedirectUri } from '../config.js';
import { printSuccess, withErrorHandler } from '../output.js';
import { runChecks, printChecks } from './doctor.js';

/**
 * Folds the question and its numbered choices into the prompt string readline
 * itself writes, rather than a separate console.log — that's what keeps this
 * menu going to whatever output stream the caller injected instead of always
 * the real process.stdout.
 */
async function promptChoice(rl, question, choices) {
  const menu = `${question}\n${choices.map((c, i) => `  ${i + 1}) ${c}`).join('\n')}\n> `;
  const answer = await rl.question(menu);
  const index = Number(answer.trim()) - 1;
  if (!Number.isInteger(index) || index < 0 || index >= choices.length) {
    throw new Error(`Invalid choice: "${answer}". Enter a number between 1 and ${choices.length}.`);
  }
  return index;
}

async function promptText(rl, question) {
  return (await rl.question(`${question} `)).trim();
}

/**
 * Prompts without echoing the answer. readline has no built-in masking; the
 * standard workaround is to swap the interface's output writer for one that
 * only ever renders the prompt itself, restoring the original afterward.
 * Only takes effect against a real terminal — see the note at the top of
 * scripts/init.test.js on why the automated suite can't fully verify this.
 */
async function promptMasked(rl, output, question) {
  const originalWrite = rl._writeToOutput;
  let promptShown = false;
  rl._writeToOutput = (chunk) => {
    if (!promptShown) {
      originalWrite.call(rl, chunk);
      promptShown = true;
    }
  };
  try {
    return (await rl.question(`${question} `)).trim();
  } finally {
    rl._writeToOutput = originalWrite;
    output.write('\n');
  }
}

export async function runInit({ input = stdin, output = stdout, loginFn = login } = {}) {
  const rl = createInterface({ input, output });
  let authenticated = false;

  try {
    const choice = await promptChoice(rl, 'How do you want to authenticate with Kit?', [
      'OAuth (recommended)',
      'API key',
    ]);

    if (choice === 0) {
      const clientId = await promptText(rl, 'OAuth client ID:');
      if (!clientId) throw new Error('OAuth client ID is required.');
      setOAuthClientId(clientId);

      let redirectUri = getOAuthRedirectUri();
      if (!redirectUri) {
        redirectUri = await promptText(rl, 'OAuth redirect URI:');
        if (!redirectUri) throw new Error('OAuth redirect URI is required.');
        setOAuthRedirectUri(redirectUri);
      }

      output.write(`${chalk.cyan('Opening browser for Kit authorization...')}\n`);
      await loginFn(clientId);
      authenticated = true;
    } else {
      const apiKey = await promptMasked(rl, output, 'Kit API key:');
      if (!apiKey) throw new Error('API key is required.');
      setApiKey(apiKey);
      authenticated = true;
    }
  } finally {
    rl.close();
  }

  if (authenticated) printSuccess('Authentication configured.');

  output.write('\n');
  output.write(`${chalk.dim('Checking your setup...')}\n`);
  const results = await runChecks();
  printChecks(results, (line) => output.write(`${line}\n`));
  output.write('\n');
  output.write(`${chalk.dim('Run `kit account` to verify, or `kit doctor` any time to re-check your setup.')}\n`);
}

export function initCommand() {
  const cmd = new Command('init').description('Interactively set up authentication for the CLI');
  cmd.action(withErrorHandler(async () => { await runInit(); }));
  return cmd;
}
