import { readFileSync } from 'node:fs';

/**
 * The CLI version, read from package.json so there is one source of truth.
 *
 * npm ships package.json in every tarball, whatever the `files` array says. The
 * URL resolves against this module rather than the working directory, so it
 * survives the symlink that a global install creates.
 *
 * This lives apart from program.js to keep the import graph acyclic. Commands
 * need the version, and program.js imports the commands.
 */
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

export const VERSION = pkg.version;
