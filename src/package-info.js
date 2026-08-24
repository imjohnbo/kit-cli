import { readFileSync } from 'node:fs';

/**
 * Facts read from package.json, so there is one source of truth for each.
 *
 * npm ships package.json in every tarball, whatever the `files` array says. The
 * URL resolves against this module rather than the working directory, so it
 * survives the symlink that a global install creates.
 *
 * This lives apart from program.js to keep the import graph acyclic. Commands
 * need these values, and program.js imports the commands.
 */
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

export const VERSION = pkg.version;

/**
 * The published package name. The update check asks the registry about it, and
 * `kit upgrade` passes it to the package manager. Renaming the package is then a
 * single edit in package.json.
 */
export const PACKAGE_NAME = pkg.name;

/**
 * The GitHub slug, as `owner/repo`, parsed from the repository URL.
 *
 * The CLI points users at a GitHub install while the package is unpublished, so
 * the slug must not be a second hardcoded copy of the repo name.
 */
export const REPOSITORY = (() => {
  const url = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url ?? '';
  const m = /github\.com[/:]([^/]+)\/([^/.]+)/.exec(url);
  return m ? `${m[1]}/${m[2]}` : null;
})();
