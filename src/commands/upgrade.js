import { Command } from 'commander';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import chalk from 'chalk';
import { printSuccess, withErrorHandler } from '../output.js';
import { VERSION, PACKAGE_NAME, REPOSITORY } from '../package-info.js';
import { refreshLatest, NOT_FOUND, UNREACHABLE } from '../update-check.js';
import { isNewer } from '../semver.js';


/**
 * The upgrade command for each package manager, as an argv array.
 *
 * The CLI hands the work to the manager that installed it rather than
 * downloading and unpacking a release itself. The manager already verifies the
 * tarball integrity and the npm provenance attestation. A hand-rolled updater
 * would replace that with code nobody audits, so this stays a delegation.
 */
const UPGRADE_COMMANDS = {
  npm: ['npm', 'install', '-g', `${PACKAGE_NAME}@latest`],
  pnpm: ['pnpm', 'add', '-g', `${PACKAGE_NAME}@latest`],
  yarn: ['yarn', 'global', 'add', `${PACKAGE_NAME}@latest`],
  bun: ['bun', 'add', '-g', `${PACKAGE_NAME}@latest`],
  brew: ['brew', 'upgrade', PACKAGE_NAME],
};

/**
 * Works out how this copy of the CLI was installed, from its own path.
 *
 * Returns a package manager key, or 'source' when the CLI runs from a checkout.
 * `npm link` and `npm i && npm link`, which the README describes, both land on
 * 'source' because the real path stays inside the git working tree.
 */
export function detectInstaller(modulePath) {
  const path = String(modulePath).replace(/\\/g, '/');

  if (/\/(?:\.bun|\.cache\/\.bun)\//.test(path) || /\/bun\/install\//.test(path)) return 'bun';
  if (/\/(?:Cellar|linuxbrew|homebrew)\//i.test(path)) return 'brew';
  if (/\/\.pnpm(?:-global)?\//.test(path) || /\/pnpm\/global\//.test(path)) return 'pnpm';
  if (/\/\.(?:yarn|config\/yarn)\//.test(path) || /\/Yarn\/(?:Data|config)\//i.test(path)) return 'yarn';
  if (path.includes('/node_modules/')) return 'npm';

  return 'source';
}

/** The argv array that upgrades an install of the given kind, or null. */
export function upgradeArgv(installer) {
  return UPGRADE_COMMANDS[installer] || null;
}

/** Where this module really lives, after symlink resolution. */
function selfPath() {
  return fileURLToPath(import.meta.url);
}

export function upgradeCommand() {
  const cmd = new Command('upgrade')
    .description('Upgrade the CLI to the newest published version')
    .option('--check', 'report the newest version without installing anything')
    .option('--dry-run', 'show the command that would run, then stop')
    .action(
      withErrorHandler(async (opts) => {
        // automatic: false, because the user asked for this directly. Turning
        // off the background notice must not disable the explicit command.
        const { status, version: latest } = await refreshLatest({ force: true, automatic: false });

        if (status === NOT_FOUND) {
          console.error(`${PACKAGE_NAME} is not published to npm yet.`);
          if (REPOSITORY) {
            console.error('Install the current code straight from GitHub instead:');
            console.error('');
            console.error(`  npm install -g github:${REPOSITORY}`);
          }
          process.exit(1);
        }

        if (status === UNREACHABLE || !latest) {
          console.error('Could not reach the registry to check for a newer version.');
          console.error('Check your connection, or set KIT_REGISTRY if you use a mirror.');
          process.exit(1);
        }

        if (!isNewer(latest, VERSION)) {
          printSuccess(`kit ${VERSION} is up to date.`);
          return;
        }

        console.log(`Update available: ${VERSION} -> ${latest}`);

        if (opts.check) return;

        const installer = detectInstaller(selfPath());

        if (installer === 'source') {
          console.error('');
          console.error('This copy runs from a source checkout, not a package install.');
          console.error('Update it with git instead:');
          console.error('');
          console.error('  git pull && npm install');
          process.exit(1);
        }

        const argv = upgradeArgv(installer);
        console.log(chalk.dim(`\n$ ${argv.join(' ')}`));

        if (opts.dryRun) return;

        // No shell. The argv array is built from a fixed table above, never from
        // user input, and spawnSync passes it straight to execve.
        const result = spawnSync(argv[0], argv.slice(1), { stdio: 'inherit' });

        if (result.error) {
          console.error(`Could not run ${argv[0]}: ${result.error.message}`);
          process.exit(1);
        }
        if (result.status !== 0) {
          console.error(`${argv[0]} exited with status ${result.status}.`);
          process.exit(result.status ?? 1);
        }

        printSuccess(`Upgraded to kit ${latest}.`);
      })
    );

  return cmd;
}
